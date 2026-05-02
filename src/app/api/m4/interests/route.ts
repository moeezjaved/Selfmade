import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 120
export const dynamic = 'force-dynamic'

// Intent types in priority order — higher = shown first, harder to filter out
const INTENT_PRIORITY: Record<string, number> = {
  'problem':   4, // Hair loss, Alopecia — buyer knows they have the problem
  'solution':  3, // Rogaine, Minoxidil, Hair transplant — actively seeking a fix
  'category':  2, // Hair care, Men's grooming — in the product category
  'lifestyle': 1, // Men's Health magazine, Fitness — persona signal
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

  // ── Meta interest search ────────────────────────────────────
  const searchMeta = async (q: string): Promise<{ id: string; name: string; path: string[]; topic: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number } | null> => {
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
      return {
        id: match.id,
        name: match.name,
        path: match.path || [],
        topic: match.topic || '',
        audience_size_lower_bound: match.audience_size_lower_bound,
        audience_size_upper_bound: match.audience_size_upper_bound,
      }
    } catch { return null }
  }

  // ── Junk filter — reject clearly wrong results ──────────────
  const isJunk = (meta: { name: string; path: string[] }, suggestedName: string): boolean => {
    const topCat = (meta.path[1] || '').toLowerCase()
    const mn = meta.name.toLowerCase()
    const sn = suggestedName.toLowerCase()
    if (topCat.includes('place') || topCat.includes('geograph') || /\(place\)|\(city\)|\(country\)/.test(mn)) return true
    // No word overlap between suggested and returned name AND path
    const snWords = sn.split(/[\s(),]+/).filter(w => w.length >= 4)
    if (snWords.length > 0) {
      const pathStr = (meta.path.join(' ') + ' ' + mn).toLowerCase()
      if (!snWords.some(w => pathStr.includes(w))) return true
    }
    return false
  }

  // ── Audience size rules ─────────────────────────────────────
  // Too broad = waste spend. Too narrow = can't scale.
  const passesAudienceFilter = (aud: number, intentType: string, isCore: boolean): boolean => {
    if (isCore) return true // always allow core anchors regardless of size
    if (intentType === 'problem' || intentType === 'solution') return aud >= 100_000 // high intent — allow small
    if (aud > 900_000_000) return false // >900M is too broad for non-core (e.g. "Fitness and wellness")
    if (aud < 500_000) return false     // <500K won't scale for lifestyle/category interests
    return true
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

  // ── Claude prompt ────────────────────────────────────────────
  const prompt = `You are a performance media buyer with 10 years Facebook Ads experience managing $10M+ in ad spend. You are generating interest targeting for a real campaign that needs to be PROFITABLE, not just "interesting."

Product: ${product}
Description: ${description || ''}
Target Customer: ${targetCustomer || ''}
${country ? `Market: ${country}` : ''}
${compCtx ? `\n${compCtx}` : ''}

INTENT FRAMEWORK — interests ranked by purchase intent:
🔥 problem    = person KNOWS they have this problem (e.g. Hair loss, Alopecia, Hair thinning)
🔥 solution   = person is SEEKING a fix (e.g. Rogaine, Minoxidil, Hair transplant)
🎯 category   = product category interest (e.g. Hair care, Men's grooming, Personal care)
⚡ lifestyle  = strong persona signal — high-correlation publications or communities (e.g. Men's Health (magazine), LinkedIn)

STEP 1 — ANCHORS (5-6 interests, always include)
The highest-converting, most buyer-ready interests for this product.
Must include:
- At least 2 problem-aware interests (person identifies with having this problem)
- At least 2 solution-aware interests (brand names of treatments/products people search for)
- At least 1 core category interest

AUDIENCE SIZE TARGET MIX:
- 1–2 broad anchors (100M+ audience) — category-level reach
- 2–3 mid-tier (5M–50M audience) — core buyers
- 1–2 high-intent (1M–10M audience) — problem/solution aware

STEP 2 — PERSONA INTERESTS (3 personas × 3-4 interests)
Translate each buyer persona into real Meta interests.
Think: what does this buyer follow, read, search for? Include publications, communities, and brands.

ABSOLUTE HARD RULES:
✅ Use REAL, exact, searchable Meta interest names
✅ Use CONSUMER BEHAVIOR interests — what people actually search/follow, not medical body parts
   ❌ BAD: "Human hair growth" (biological/anatomical — maps weirdly, weak performance)
   ✅ GOOD: "Hair loss", "Hair care", "Rogaine"
✅ Include brand names of competitor treatments and clinically-known terms people search
✅ Publications: use exact name with type e.g. "Men's Health (magazine)"
✅ LinkedIn is a strong lifestyle signal — always include for professional buyer personas
❌ NO biological/anatomical terms (hair follicle, keratin production, sebaceous gland)
❌ NO pet/animal interests unless product is for pets
❌ NO sports/gymnastics unless product is sports-related
❌ NO vague wellness interests with no direct purchase correlation (e.g. "Vegan nutrition" for hair products)
❌ NO fashion accessories, random hobbies, entertainment unless directly relevant
❌ NO interests with audience <500K — exception: high-intent problem/solution (allow ≥100K)
❌ NO interests with audience >1B (too broad)
❌ NO duplicates — each interest name must be unique

Respond ONLY with valid JSON:
{
  "anchors": [
    {
      "name": "Exact Meta interest name",
      "intent_type": "problem|solution|category|lifestyle",
      "reason": "Why this is a must-have for this product"
    }
  ],
  "personas": [
    {
      "name": "Short practical persona name (3-4 words max)",
      "interests": [
        {
          "name": "Exact Meta interest name",
          "intent_type": "problem|solution|category|lifestyle",
          "reason": "One sentence why this converts"
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
  const seenIds = new Set<string>()   // dedupe by Meta ID
  const seenNames = new Set<string>() // dedupe by lowercase name

  const addInterest = async (name: string, category: string, reason: string, intentType: string, isCore: boolean) => {
    if (validated.length >= 14) return
    const nameLower = name.toLowerCase()
    if (seenNames.has(nameLower)) return

    const meta = await searchMeta(name)
    if (!meta) return
    if (isJunk(meta, name)) return
    if (seenIds.has(meta.id)) return // exact duplicate from Meta

    const aud = meta.audience_size_lower_bound || 0
    if (!passesAudienceFilter(aud, intentType, isCore)) return

    seenIds.add(meta.id)
    seenNames.add(meta.name.toLowerCase())
    seenNames.add(nameLower)

    // Intent badge shown in UI
    const intentBadge =
      intentType === 'problem'   ? 'High Intent 🔥' :
      intentType === 'solution'  ? 'High Intent 🔥' :
      intentType === 'category'  ? 'Core Category 🎯' :
      'Support ⚡'

    validated.push({
      name: meta.name,
      category: isCore ? 'Core' : category,
      why: reason,
      size: aud >= 10_000_000 ? 'Large' : aud >= 1_000_000 ? 'Medium' : 'Small',
      confidence: INTENT_PRIORITY[intentType] || 1,
      metaId: meta.id,
      audienceSize: aud,
      intentType,
      intentBadge,
    })
  }

  // Anchors first (isCore = true, bypass size filter)
  for (const a of anchors) {
    await addInterest(a.name, 'Core', a.reason, a.intent_type || 'category', true)
  }

  // Persona interests (size filter applies)
  for (const persona of personas) {
    for (const interest of (persona.interests || [])) {
      await addInterest(interest.name, persona.name, interest.reason, interest.intent_type || 'lifestyle', false)
    }
  }

  // Sort: problem > solution > category > lifestyle, then by audience size desc
  validated.sort((a, b) => {
    const pa = INTENT_PRIORITY[a.intentType] || 0
    const pb = INTENT_PRIORITY[b.intentType] || 0
    if (pb !== pa) return pb - pa
    return (b.audienceSize || 0) - (a.audienceSize || 0)
  })

  console.log(`Anchors: ${anchors.length}, Personas: ${personas.length}, Validated+filtered: ${validated.length}`)
  return NextResponse.json({ interests: validated })
}
