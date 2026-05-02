import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product, description, competitorDomains, targetCustomer, country } = await request.json()

  const extractBrands = (input: string) => {
    if (!input) return []
    return input.split(',').map((s: string) => s.trim()
      .replace(/https?:\/\//g,'').replace(/www\./g,'')
      .replace(/facebook\.com\//g,'').replace(/instagram\.com\//g,'')
      .replace(/\.[a-z]{2,4}$/g,'').replace(/@/g,'').trim()
    ).filter(Boolean)
  }
  const allBrands = Array.from(new Set(extractBrands(competitorDomains || '')))

  let tok = ''

  try {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { decryptToken } = await import('@/lib/meta/client')
    const admin = createAdminClient()
    const { data: ma } = await admin.from('meta_accounts').select('*').eq('user_id', user.id).eq('is_primary', true).single()
    if (ma) tok = decryptToken(ma.access_token)
  } catch {}

  // Search Meta — word-level match to handle "Hair loss (health & wellness)" for query "Hair loss"
  const searchMeta = async (q: string): Promise<{id:string,name:string,topic?:string,audience_size_lower_bound?:number}|null> => {
    if (!tok) return null
    try {
      const r = await fetch('https://graph.facebook.com/v20.0/search?' + new URLSearchParams({ type: 'adinterest', q, limit: '10', access_token: tok }))
      const d = await r.json()
      if (!d.data?.length) return null
      const ql = q.toLowerCase().trim()
      const qWords = ql.split(/[\s(),]+/).filter(w => w.length >= 4)

      const match = d.data.find((i: any) => {
        const nl = i.name.toLowerCase()
        if (nl === ql || nl.startsWith(ql) || ql.startsWith(nl)) return true
        if (ql.length >= 4 && nl.includes(ql)) return true
        if (nl.length >= 4 && ql.includes(nl)) return true
        if (qWords.length > 0 && qWords.some(w => nl.includes(w))) return true
        return false
      })
      return match || null
    } catch { return null }
  }

  const isPlace = (topic?: string, name?: string) => {
    const t = (topic || '').toLowerCase()
    const n = (name || '').toLowerCase()
    return t === 'place' || t === 'geography' || t === 'location' ||
      /\(place\)|\(city\)|\(country\)|\(region\)/.test(n)
  }

  // Validate competitor brands to feed as context
  const confirmedBrandInterests: string[] = []
  for (const brand of allBrands.slice(0, 6)) {
    const match = await searchMeta(brand)
    if (match && !isPlace(match.topic, match.name)) confirmedBrandInterests.push(match.name)
  }

  const compCtx = confirmedBrandInterests.length > 0
    ? 'These competitor brands are confirmed in Meta: ' + confirmedBrandInterests.join(', ')
    : allBrands.length > 0 ? 'Competitor brands (not yet verified in Meta): ' + allBrands.join(', ') : ''

  // ── PERSONA-FIRST PROMPT ────────────────────────────────────────
  // Products don't buy — people do. Map product → buyer personas → interests.
  const prompt = `You are a Facebook Ads targeting expert. Your job is to suggest interests that actually exist in Meta Ads Manager and convert well.

CRITICAL RULE: Don't think "what is this product?" — think "WHO BUYS this product and what are they into?"

Product: ${product}
Description: ${description || ''}
Target Customer: ${targetCustomer || ''}
${country ? `Market: ${country}` : ''}
${compCtx ? `\n${compCtx}` : ''}

STEP 1 — Identify 3-4 buyer personas for this product.
STEP 2 — For each persona, suggest 3-4 Facebook interests that:
  • Are broad and common enough to exist globally in Meta's database
  • Reflect the persona's BEHAVIOR and MINDSET, not just the product name
  • Are real interest categories Meta actually uses (e.g. "Parenting", "Organic food", "Men's Health (magazine)")
  • Include a mix of: lifestyle interests, publications/media, behaviors, and brand/competitor names if large enough

AVOID:
  • Obscure local brands (they won't exist in Meta)
  • Geographic places or sports teams
  • Interests too generic to convert (e.g. just "Health" or "Food")
  • Interests too specific/obscure to exist (e.g. small local brands)

EXAMPLE — if product is "Baby Milk Formula":
  Persona: New Mothers → Parenting, Motherhood, Baby food, What to Expect
  Persona: Health-conscious parents → Organic food, Healthy eating, Child nutrition
  Persona: Busy families → Family, Grocery shopping, Household management

Respond ONLY with valid JSON:
{
  "personas": [
    {
      "persona": "Persona name",
      "interests": [
        {"name": "Interest name exactly as Meta uses it", "why": "one sentence", "confidence": 85}
      ]
    }
  ]
}`

  let personas: any[] = []
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const data = await res.json()
    const text = (data.content?.[0]?.text || '').trim()
    console.log('Claude personas raw:', text.substring(0, 400))
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(text.slice(start, end + 1))
      personas = parsed.personas || []
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  // Flatten persona → interests, preserving persona as category
  const allSuggestions: any[] = []
  for (const p of personas) {
    for (const interest of (p.interests || [])) {
      allSuggestions.push({ ...interest, category: p.persona })
    }
  }

  // Validate each against Meta — use persona name as category label
  const validated: any[] = []
  if (tok) {
    for (const suggestion of allSuggestions) {
      if (validated.length >= 12) break
      const match = await searchMeta(suggestion.name)
      if (match && !isPlace(match.topic, match.name)) {
        validated.push({
          name: match.name,
          category: suggestion.category,
          why: suggestion.why,
          size: match.audience_size_lower_bound
            ? match.audience_size_lower_bound >= 10_000_000 ? 'Large'
              : match.audience_size_lower_bound >= 1_000_000 ? 'Medium' : 'Small'
            : 'Unknown',
          confidence: suggestion.confidence || 80,
          metaId: match.id,
          audienceSize: match.audience_size_lower_bound,
        })
      }
    }
  } else {
    validated.push(...allSuggestions.slice(0, 10).map((s: any) => ({
      ...s, size: 'Unknown', confidence: s.confidence || 80,
    })))
  }

  console.log(`Personas: ${personas.length}, Suggestions: ${allSuggestions.length}, Confirmed: ${validated.length}`)
  return NextResponse.json({ interests: validated })
}
