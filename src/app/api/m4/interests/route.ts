import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

// Intent types in priority order — higher = shown first, harder to filter out
const INTENT_PRIORITY: Record<string, number> = {
  'problem':   4, // Hair loss, Weight loss — buyer knows they have the problem
  'solution':  3, // Rogaine, Minoxidil — actively seeking a fix
  'category':  2, // Hair care, Men's grooming — in the product category
  'lifestyle': 1, // Men's Health magazine, LinkedIn — persona signal
}

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

  type MetaInterest = {
    id: string; name: string; path: string[]; topic: string
    audience_size_lower_bound?: number; audience_size_upper_bound?: number
  }

  // ── Meta interest search — returns ALL matches (not just first) ──────────
  // This prevents "Minoxidil" being dropped because it maps to the same Meta ID
  // as "Rogaine" — we can skip that ID and find a distinct alternative.
  const searchMetaAll = async (q: string): Promise<MetaInterest[]> => {
    if (!tok) return []
    try {
      const r = await fetch(
        'https://graph.facebook.com/v20.0/search?' +
        new URLSearchParams({ type: 'adinterest', q, limit: '15', access_token: tok })
      )
      const d = await r.json()
      if (!d.data?.length) return []
      const ql = q.toLowerCase().trim()
      const qWords = ql.split(/[\s(),]+/).filter((w: string) => w.length >= 4)
      return d.data
        .filter((i: any) => {
          const nl = i.name.toLowerCase()
          if (nl === ql || nl.startsWith(ql) || ql.startsWith(nl)) return true
          if (ql.length >= 4 && nl.includes(ql)) return true
          if (nl.length >= 4 && ql.includes(nl)) return true
          if (qWords.length > 0 && qWords.some((w: string) => nl.includes(w))) return true
          return false
        })
        .map((i: any) => ({
          id: i.id, name: i.name, path: i.path || [], topic: i.topic || '',
          audience_size_lower_bound: i.audience_size_lower_bound,
          audience_size_upper_bound: i.audience_size_upper_bound,
        }))
    } catch { return [] }
  }

  // Single-result wrapper for backward-compat (brand confirmation)
  const searchMeta = async (q: string) => {
    const r = await searchMetaAll(q)
    return r[0] || null
  }

  // ── Junk filter — reject clearly wrong results ──────────────
  const isJunk = (meta: MetaInterest, suggestedName: string): boolean => {
    const topCat = (meta.path[1] || '').toLowerCase()
    const mn = meta.name.toLowerCase()
    const sn = suggestedName.toLowerCase()
    if (topCat.includes('place') || topCat.includes('geograph') || /\(place\)|\(city\)|\(country\)/.test(mn)) return true
    const snWords = sn.split(/[\s(),]+/).filter(w => w.length >= 4)
    if (snWords.length > 0) {
      const pathStr = (meta.path.join(' ') + ' ' + mn).toLowerCase()
      if (!snWords.some(w => pathStr.includes(w))) return true
    }
    return false
  }

  // ── Audience size rules ─────────────────────────────────────
  const passesAudienceFilter = (aud: number, intentType: string, isCore: boolean): boolean => {
    if (isCore) return true
    if (intentType === 'problem' || intentType === 'solution') return aud >= 100_000
    if (aud > 900_000_000) return false
    if (aud < 1_000_000) return false
    return true
  }

  // ── Competitor brand confirmation ──────────────────────────
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

  // ── Claude prompt ────────────────────────────────────────────
  const prompt = `You are a performance media buyer generating Meta ad interest targeting. Your goal is CONVERSIONS, not reach.

Product: ${product}
Description: ${description || ''}
Target Customer: ${targetCustomer || ''}
${country ? `Market: ${country}` : ''}
${compCtx ? `\n${compCtx}` : ''}

══════════════════════════════════════
GENERATE EXACTLY 3 TIERS OF INTERESTS
Minimum 7 interests total across all tiers.
══════════════════════════════════════

🔥 TIER 1 — HIGH INTENT (2–3 interests, MANDATORY)
These are BUYERS, not browsers. Highest conversion rate.
TWO types to include:
  ▸ Problem-aware: people who identify they have this problem
    Logic: think "what does this person Google at 2am because they're frustrated?"
    Example for hair: "Hair loss", "Alopecia"
    Example for weight: "Weight loss", "Obesity"
    Example for skincare: "Acne", "Eczema"
  ▸ Solution-aware: brand names or treatments people actively search for
    Logic: think "what product/treatment would they already know about?"
    Example for hair: "Rogaine", "Minoxidil", "Hair transplant"
    Example for weight: "Weight Watchers", "Ozempic", "Ketogenic diet"
    Example for skincare: "Cetaphil", "Differin", "Retinol"
  Generate 3–4 of these so if 1–2 don't exist on Meta, we still hit the minimum.

🎯 TIER 2 — CORE CATEGORY (2–3 interests)
Direct product category that captures buyers in research mode.
  ▸ The product category itself and adjacent categories
  ▸ Must be broad enough to have significant audience size (10M+)
  Example for hair: "Hair care", "Men's grooming", "Personal care"
  Example for weight: "Dieting", "Nutrition", "Fitness and wellness"

⚡ TIER 3 — SUPPORT (1–2 interests)
Lifestyle or behavioral signals strongly correlated with buyers.
  ▸ Publications, communities, or platforms this buyer uses
  ▸ Only include if CLEARLY connected to purchase behavior
  ▸ Always include LinkedIn for professional/working adult products
  Example: "Men's Health (magazine)", "LinkedIn", "GQ (magazine)"

HARD RULES:
✅ Use REAL exact Meta interest names (what people follow on Facebook)
✅ Suggest 3–4 High Intent interests (some may not exist on Meta)
✅ Publications: exact name with format e.g. "Men's Health (magazine)"
❌ NO biological/anatomical terms (hair follicle, sebaceous gland)
❌ NO weak indirect wellness (e.g. "Natural skin care" for hair loss — too indirect)
❌ NO pets, unrelated sports, hobbies, or entertainment
❌ NO interests audience >1B (too broad)
❌ NO duplicates

PRE-FLIGHT CHECK:
  □ Does tier 1 have ≥2 interests? (1 problem-aware + 1 solution-aware minimum)
  □ Does tier 2 have ≥2 category interests?
  □ Total ≥7 interests? If not, add more to tier 1 or tier 2.

Respond ONLY with valid JSON:
{
  "tiers": {
    "high_intent": [
      { "name": "Exact Meta interest name", "intent_type": "problem|solution", "reason": "Why this buyer converts" }
    ],
    "core_category": [
      { "name": "Exact Meta interest name", "intent_type": "category", "reason": "Why this is core" }
    ],
    "support": [
      { "name": "Exact Meta interest name", "intent_type": "lifestyle", "reason": "Why this persona signal converts" }
    ]
  },
  "personas": [
    {
      "name": "Short persona name (3-4 words)",
      "interests": [
        { "name": "Exact Meta interest name", "intent_type": "problem|solution|category|lifestyle", "reason": "One sentence" }
      ]
    }
  ]
}`

  let tiers: any = { high_intent: [], core_category: [], support: [] }
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
      tiers = parsed.tiers || { high_intent: [], core_category: [], support: [] }
      personas = parsed.personas || []
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }

  const validated: any[] = []
  const seenIds = new Set<string>()
  const seenNames = new Set<string>()

  // ── Core addInterest: tries ALL Meta results to survive duplicate IDs ──
  const addInterest = async (name: string, displayCategory: string, reason: string, intentType: string, isCore: boolean) => {
    if (validated.length >= 14) return
    const nameLower = name.toLowerCase()
    if (seenNames.has(nameLower)) return

    const results = await searchMetaAll(name)

    for (const meta of results) {
      if (isJunk(meta, name)) continue
      if (seenIds.has(meta.id)) continue   // skip same ID, try next match

      const aud = meta.audience_size_lower_bound || 0
      if (!passesAudienceFilter(aud, intentType, isCore)) continue

      // Valid non-duplicate found
      seenIds.add(meta.id)
      seenNames.add(meta.name.toLowerCase())
      seenNames.add(nameLower)

      const intentBadge =
        intentType === 'problem'  ? 'High Intent 🔥' :
        intentType === 'solution' ? 'High Intent 🔥' :
        intentType === 'category' ? 'Core Category 🎯' :
        'Support ⚡'

      validated.push({
        name: meta.name,
        category: displayCategory,
        why: reason,
        size: aud >= 10_000_000 ? 'Large' : aud >= 1_000_000 ? 'Medium' : 'Small',
        confidence: INTENT_PRIORITY[intentType] || 1,
        metaId: meta.id,
        audienceSize: aud,
        intentType,
        intentBadge,
      })
      return // stop at first valid match
    }
  }

  // Process in tier order — high intent first (most important)
  for (const i of (tiers.high_intent || [])) {
    await addInterest(i.name, 'High Intent', i.reason, i.intent_type || 'problem', true)
  }
  for (const i of (tiers.core_category || [])) {
    await addInterest(i.name, 'Core Category', i.reason, i.intent_type || 'category', true)
  }
  for (const i of (tiers.support || [])) {
    await addInterest(i.name, 'Support', i.reason, i.intent_type || 'lifestyle', false)
  }
  for (const persona of personas) {
    for (const i of (persona.interests || [])) {
      await addInterest(i.name, persona.name, i.reason, i.intent_type || 'lifestyle', false)
    }
  }

  // Sort: problem > solution > category > lifestyle, then by audienceSize desc
  validated.sort((a, b) => {
    const pa = INTENT_PRIORITY[a.intentType] || 0
    const pb = INTENT_PRIORITY[b.intentType] || 0
    if (pb !== pa) return pb - pa
    return (b.audienceSize || 0) - (a.audienceSize || 0)
  })

  console.log(`Tiers: hi=${tiers.high_intent?.length} cat=${tiers.core_category?.length} sup=${tiers.support?.length} | Validated: ${validated.length}`)
  return NextResponse.json({ interests: validated })
}
