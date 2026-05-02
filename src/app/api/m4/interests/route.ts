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

  // ── Semantic confidence scoring ──────────────────────────────
  // Validates that the Meta result actually matches the persona intent
  const scoreInterest = (
    personaName: string,
    suggestedName: string,
    expectedPath: string,
    meta: { name: string; path: string[]; topic: string; audience_size_lower_bound?: number }
  ): { score: number; accepted: boolean; rejectionReason?: string } => {
    let score = 50
    const mn = meta.name.toLowerCase()
    const sn = suggestedName.toLowerCase()
    const pathStr = meta.path.join(' ').toLowerCase()
    const topCategory = (meta.path[1] || '').toLowerCase()

    // Name match
    if (mn === sn) score += 30
    else if (mn.includes(sn) || sn.includes(mn)) score += 18
    else {
      const qWords = sn.split(/[\s(),]+/).filter(w => w.length >= 4)
      if (qWords.some(w => mn.includes(w))) score += 8
      else score -= 15
    }

    // Hard reject: geographic places
    if (topCategory.includes('place') || topCategory.includes('geograph') || /\(place\)|\(city\)|\(country\)/.test(mn)) {
      return { score: 0, accepted: false, rejectionReason: 'Geographic place, not a targetable interest' }
    }

    // Sports penalty: reject sports interests for non-sports personas
    const personaL = personaName.toLowerCase()
    const isPersonaSports = personaL.includes('sport') || personaL.includes('fitness') || personaL.includes('gym') || personaL.includes('athlet')
    if (!isPersonaSports && (topCategory.includes('sport') || topCategory.includes('ball'))) {
      score -= 35
    }

    // Path alignment with Claude's expected path
    if (expectedPath) {
      const expectedWords = expectedPath.toLowerCase().split(/[\s>\/,&]+/).filter(w => w.length >= 4)
      const matched = expectedWords.filter(w => pathStr.includes(w)).length
      if (expectedWords.length > 0) score += Math.round((matched / expectedWords.length) * 20)
    }

    // Audience size adjustments
    const aud = meta.audience_size_lower_bound || 0
    if (aud >= 10_000_000) score += 5
    else if (aud >= 1_000_000) score += 3
    else if (aud > 0 && aud < 50_000) score -= 8

    const final = Math.max(0, Math.min(100, score))
    const accepted = final >= 65
    return {
      score: final,
      accepted,
      rejectionReason: accepted ? undefined : `Low relevance score (${final}). ${topCategory.includes('sport') ? 'Sports category mismatch.' : 'Interest not aligned with persona.'}`,
    }
  }

  // ── Validate competitor brands as context ───────────────────
  const extractBrands = (input: string) =>
    input.split(',').map(s => s.trim().replace(/https?:\/\//g,'').replace(/www\./g,'').replace(/\.[a-z]{2,4}$/g,'').replace(/@/g,'').trim()).filter(Boolean)
  const allBrands = Array.from(new Set(extractBrands(competitorDomains || '')))

  const confirmedBrands: string[] = []
  for (const brand of allBrands.slice(0, 5)) {
    const m = await searchMeta(brand)
    if (m && !(m.path[1] || '').toLowerCase().includes('place')) confirmedBrands.push(m.name)
  }

  const compCtx = confirmedBrands.length > 0
    ? `These competitor brands exist in Meta: ${confirmedBrands.join(', ')}`
    : allBrands.length > 0 ? `Competitor brands (unverified): ${allBrands.join(', ')}` : ''

  // ── Persona-first Claude prompt ──────────────────────────────
  const prompt = `You are a Facebook Ads targeting expert.

RULE: Think WHO BUYS this product, not what keywords match the product name.

Product: ${product}
Description: ${description || ''}
Target Customer: ${targetCustomer || ''}
${country ? `Market: ${country}` : ''}
${compCtx ? `\n${compCtx}` : ''}

STEP 1: Identify 3-4 distinct buyer personas for this product.
STEP 2: For each persona, suggest 4-5 Facebook interests that:
  • Reflect the persona's BEHAVIOR, MINDSET, and LIFESTYLE — not just the product keyword
  • Are broad and common enough to exist globally in Meta's database
  • Include a mix of: lifestyle behaviors, publications/media, well-known brands, activity-based interests
  • Have an expected Meta path (the interest category tree)

AVOID:
  • Geographic places or sports teams (unless the product is sports-related)
  • Obscure local brands unlikely to be in Meta's global database
  • Interests with only a keyword match but wrong meaning (e.g. "Ball sports" for hair loss)

EXAMPLES of good persona thinking:
  Baby milk formula → "New Mothers" → Parenting, Motherhood, Baby food, What to Expect
  Hair loss product → "Men with hair loss" → Hair loss, Rogaine, Men's Health (magazine), Trichology
  Milk product → "Health-conscious adults" → Healthy eating, Organic food, Nutrition, Whole Foods Market

Respond ONLY with valid JSON:
{
  "personas": [
    {
      "name": "Persona name",
      "description": "Who they are and why they buy this",
      "interests": [
        {
          "name": "Interest name exactly as Meta would show it",
          "expected_path": "Top category > Sub category",
          "reason": "One sentence why this persona responds to this interest",
          "confidence": 85
        }
      ]
    }
  ]
}`

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
    if (start !== -1 && end !== -1) personas = JSON.parse(text.slice(start, end + 1)).personas || []
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  // ── Validate every suggestion against Meta + semantic score ──
  const validated: any[] = []
  const seen = new Set<string>()

  for (const persona of personas) {
    for (const interest of (persona.interests || [])) {
      if (validated.length >= 12) break
      if (seen.has(interest.name.toLowerCase())) continue

      const meta = await searchMeta(interest.name)
      if (!meta) continue // not found in Meta at all — skip

      const { score, accepted, rejectionReason } = scoreInterest(persona.name, interest.name, interest.expected_path || '', meta)
      if (!accepted) continue // silently drop rejected — user only sees good ones

      seen.add(meta.name.toLowerCase())
      validated.push({
        name: meta.name,
        category: persona.name, // persona name as category label in UI
        why: interest.reason,
        size: (meta.audience_size_lower_bound || 0) >= 10_000_000 ? 'Large'
          : (meta.audience_size_lower_bound || 0) >= 1_000_000 ? 'Medium' : 'Small',
        confidence: score,
        metaId: meta.id,
        audienceSize: meta.audience_size_lower_bound,
      })
    }
    if (validated.length >= 12) break
  }

  // Fallback: if too few validated, add unvalidated Claude suggestions
  if (validated.length < 5 && !tok) {
    for (const persona of personas) {
      for (const interest of (persona.interests || [])) {
        if (validated.length >= 10) break
        if (seen.has(interest.name.toLowerCase())) continue
        seen.add(interest.name.toLowerCase())
        validated.push({ name: interest.name, category: persona.name, why: interest.reason, size: 'Unknown', confidence: interest.confidence || 75 })
      }
    }
  }

  console.log(`Personas: ${personas.length}, Validated interests: ${validated.length}`)
  return NextResponse.json({ interests: validated })
}
