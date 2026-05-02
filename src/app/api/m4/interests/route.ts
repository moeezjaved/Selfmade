import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product, description, competitorDomains, targetCustomer, country } = await request.json()

  let tok = ''
  try {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { decryptToken } = await import('@/lib/meta/client')
    const admin = createAdminClient()
    const { data: ma } = await admin.from('meta_accounts').select('*').eq('user_id', user.id).eq('is_primary', true).single()
    if (ma) tok = decryptToken(ma.access_token)
  } catch {}

  // ── Meta interest search ─────────────────────────────────────
  const searchMeta = async (q: string): Promise<{ id: string; name: string; path: string[]; topic: string; audience_size_lower_bound?: number } | null> => {
    if (!tok) return null
    try {
      const r = await fetch('https://graph.facebook.com/v20.0/search?' + new URLSearchParams({ type: 'adinterest', q, limit: '10', access_token: tok }))
      const d = await r.json()
      if (!d.data?.length) return null
      const ql = q.toLowerCase().trim()
      const qWords = ql.split(/[\s(),]+/).filter((w: string) => w.length >= 4)
      const match = d.data.find((i: any) => {
        const nl = i.name.toLowerCase()
        if (nl === ql || nl.startsWith(ql) || ql.startsWith(nl)) return true
        if (ql.length >= 4 && nl.includes(ql)) return true
        if (nl.length >= 4 && ql.includes(nl)) return true
        if (qWords.length > 0 && qWords.some((w: string) => nl.includes(w))) return true
        return false
      })
      if (!match) return null
      return { id: match.id, name: match.name, path: match.path || [], topic: match.topic || '', audience_size_lower_bound: match.audience_size_lower_bound }
    } catch { return null }
  }

  // ── Reject clearly wrong Meta results ────────────────────────
  const isJunk = (meta: { name: string; path: string[] }, suggestedName: string): boolean => {
    const topCat = (meta.path[1] || '').toLowerCase()
    const mn = meta.name.toLowerCase()
    const sn = suggestedName.toLowerCase()
    // Geographic places
    if (topCat.includes('place') || topCat.includes('geograph') || /\(place\)|\(city\)|\(country\)/.test(mn)) return true
    // Name completely unrelated — no word overlap at all
    const snWords = sn.split(/[\s(),]+/).filter(w => w.length >= 4)
    const mnWords = mn.split(/[\s(),]+/).filter(w => w.length >= 4)
    if (snWords.length > 0 && mnWords.length > 0) {
      const hasOverlap = snWords.some(sw => mnWords.some(mw => mw.includes(sw) || sw.includes(mw)))
      if (!hasOverlap && meta.path.length > 0) {
        // allow if same broad topic category
        const pathStr = meta.path.join(' ').toLowerCase()
        const topicMatch = snWords.some(w => pathStr.includes(w))
        if (!topicMatch) return true
      }
    }
    return false
  }

  // ── Extract competitor brands for context ───────────────────
  const extractBrands = (input: string) =>
    input.split(',').map(s => s.trim().replace(/https?:\/\//g,'').replace(/www\./g,'').replace(/\.[a-z]{2,4}$/g,'').replace(/@/g,'').trim()).filter(Boolean)
  const allBrands = Array.from(new Set(extractBrands(competitorDomains || '')))

  const confirmedBrands: string[] = []
  for (const brand of allBrands.slice(0, 5)) {
    const m = await searchMeta(brand)
    if (m && !isJunk(m, brand)) confirmedBrands.push(m.name)
  }

  const compCtx = confirmedBrands.length > 0
    ? `These competitor brands are confirmed in Meta: ${confirmedBrands.join(', ')}`
    : allBrands.length > 0 ? `Competitor brands (unverified): ${allBrands.join(', ')}` : ''

  // ── Prompt: anchor-first + real personas ─────────────────────
  const prompt = `You are a performance media buyer with 10 years of Facebook Ads experience. You are generating interest targeting for a real ad campaign that needs to spend money and convert.

Product: ${product}
Description: ${description || ''}
Target Customer: ${targetCustomer || ''}
${country ? `Market: ${country}` : ''}
${compCtx ? `\n${compCtx}` : ''}

YOUR JOB: Suggest interests that:
1. Actually exist in Meta Ads Manager (real, searchable interests)
2. Have large enough audiences to scale (prefer 1M+ reach)
3. Are proven ad categories — not theoretical or psychological labels

━━━━━━━━━━━━━━━━━━━━━━━
PART 1 — ANCHOR INTERESTS (required)
━━━━━━━━━━━━━━━━━━━━━━━
Suggest 5 anchor interests that are DIRECTLY about this product category.
These should be the most obvious, broad, high-volume interests.
Think: what would any media buyer immediately put in for this product?

Examples:
- Hair loss product → Hair loss, Hair care, Men's grooming, Beauty, Personal care
- Baby milk → Baby food, Parenting, Motherhood, Infant formula, Child nutrition
- Fitness supplement → Fitness, Bodybuilding, Nutrition, Whey protein, Gym

━━━━━━━━━━━━━━━━━━━━━━━
PART 2 — PERSONA INTERESTS
━━━━━━━━━━━━━━━━━━━━━━━
Identify 3 buyer personas and for each suggest 3-4 REAL Facebook interests.
Translate each persona into actual behaviors and real interest names — NOT abstract labels.

STRICT RULES:
- Only suggest interests that are real Meta interest names (what you'd type in Ads Manager)
- Prefer: grooming brands, health/fitness publications, lifestyle activities, well-known apps
- Reject: dating shows, obscure niches, micro-psychological labels, entertainment categories unrelated to product
- If suggesting a publication/magazine, use its exact Meta name (e.g. "Men's Health (magazine)")
- If suggesting a brand, only use it if it's large enough to be in Meta (millions of users)

Respond ONLY with valid JSON:
{
  "anchors": [
    {
      "name": "Interest name exactly as Meta would show it",
      "expected_path": "Category > Subcategory",
      "reason": "Core product category interest"
    }
  ],
  "personas": [
    {
      "name": "Short practical persona name",
      "interests": [
        {
          "name": "Interest name exactly as Meta would show it",
          "expected_path": "Category > Subcategory",
          "reason": "One sentence — why this converts for this product"
        }
      ]
    }
  ]
}`

  let anchors: any[] = []
  let personas: any[] = []
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] }),
    })
    const data = await res.json()
    const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim()
    const start = text.indexOf('{'); const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      const parsed = JSON.parse(text.slice(start, end + 1))
      anchors = parsed.anchors || []
      personas = parsed.personas || []
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  const validated: any[] = []
  const seen = new Set<string>()

  const addInterest = async (name: string, category: string, reason: string) => {
    if (validated.length >= 14) return
    if (seen.has(name.toLowerCase())) return
    const meta = await searchMeta(name)
    if (!meta) return
    if (isJunk(meta, name)) return
    seen.add(meta.name.toLowerCase())
    const aud = meta.audience_size_lower_bound || 0
    validated.push({
      name: meta.name,
      category,
      why: reason,
      size: aud >= 10_000_000 ? 'Large' : aud >= 1_000_000 ? 'Medium' : 'Small',
      confidence: meta.id ? 85 : 70, // confirmed in Meta = high confidence
      metaId: meta.id,
      audienceSize: aud,
    })
  }

  // Anchors first — shown at top, tagged "Core"
  for (const a of anchors) {
    await addInterest(a.name, 'Core', a.reason)
  }

  // Then persona interests
  for (const persona of personas) {
    for (const interest of (persona.interests || [])) {
      await addInterest(interest.name, persona.name, interest.reason)
    }
  }

  console.log(`Anchors: ${anchors.length}, Personas: ${personas.length}, Validated: ${validated.length}`)
  return NextResponse.json({ interests: validated })
}
