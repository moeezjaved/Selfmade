/**
 * POST /api/scan/run — PUBLIC ad audit (no login). This is an AUDIT of YOUR ads first; spying on rivals
 * is one part of it. Input: { pageId } (your brand, from the picker) or { adLibraryUrl } (your Meta Ad
 * Library link). We resolve your page, read YOUR ads (ownDna), pull same-niche rivals from the 611K
 * directory, and run the DNA engine (winners + gaps + score + prescriptions). Best-effort IP rate limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runDnaEngine } from '@/lib/dna/engine'
import { creativeBriefs } from '@/lib/dna/creative'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// Best-effort in-memory IP limiter (no Redis in this stack). Per warm instance; fine for a top-of-funnel
// audit — abuse is bounded and the heavy spend (LLM) is cached in R2 by the engine anyway.
const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'MX', 'BR', 'IN', 'JP', 'SG', 'AE', 'ZA']
const HITS = new Map<string, { n: number; t: number }>()
const WINDOW = 3600_000, MAX = 30
function limited(ip: string): boolean {
  const now = Date.now(); const h = HITS.get(ip)
  if (!h || now - h.t > WINDOW) { HITS.set(ip, { n: 1, t: now }); return false }
  h.n++; return h.n > MAX
}

// Dominant writing system of a string — so we don't hand a Latin-script brand a Cyrillic/CJK "peer".
function scriptOf(s: string): 'latin' | 'cyrillic' | 'cjk' | 'arabic' | 'other' {
  const counts = { latin: 0, cyrillic: 0, cjk: 0, arabic: 0 }
  for (const ch of s || '') {
    const c = ch.codePointAt(0) || 0
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) counts.latin++
    else if (c >= 0x400 && c <= 0x4ff) counts.cyrillic++
    else if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3040 && c <= 0x30ff) || (c >= 0xac00 && c <= 0xd7af)) counts.cjk++
    else if (c >= 0x600 && c <= 0x6ff) counts.arabic++
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return top && top[1] > 0 ? (top[0] as 'latin' | 'cyrillic' | 'cjk' | 'arabic') : 'other'
}

// Prefer a rival example whose brand+hook is in the SAME script as the user's brand; else the first.
function pickRival<T extends { brand: string; hook: string }>(examples: T[], brandName: string): T | null {
  if (!examples?.length) return null
  const want = scriptOf(brandName)
  if (want !== 'other') {
    const match = examples.find((e) => scriptOf(`${e.brand} ${e.hook}`) === want)
    if (match) return match
  }
  return examples[0]
}

// Distinctive keywords from a brand's own ad copy — the words that actually define its product/category
// (nicotine, quit, mattress, mango…), so we can find brands that talk about the SAME things, not just the
// same coarse industry. Drops stopwords + the brand's own name tokens.
// Common words + generic commerce/ad filler that DON'T discriminate a category (a nicotine brand and a
// mattress brand both say "product", "shop", "quality"). Removing them lets the distinctive terms lead.
const STOPWORDS = new Set(('the and for you your with that this are our from have get all can now out not but they their what when more just how why who was will has off new one only use make made into over than then them some any been about after before best free shop buy today order also here like most much such very want kit set try day love feel need help time '
  + 'product products brand brands start shop store official collection sale discount code click link learn save price prices premium quality offer offers deal deals limited exclusive shipping order orders online website site check checkout cart bundle bundles pack size color colours available available now more info details bio profile follow comment dm message tag share post reel video watch swipe').split(/\s+/))
function topKeywords(ads: { body?: string | null; title?: string | null }[], exclude: Set<string>): string[] {
  const freq: Record<string, number> = {}
  for (const a of ads) {
    // strip Meta {{product.brand}} placeholders first so "product"/"brand" don't leak in as keywords
    const text = `${a.body || ''} ${a.title || ''}`.replace(/\{\{[^}]*\}\}/g, ' ').toLowerCase()
    for (const w of text.split(/[^a-z]+/)) {
      if (w.length < 4 || STOPWORDS.has(w) || exclude.has(w)) continue
      freq[w] = (freq[w] || 0) + 1
    }
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w)
}

// Pull a Meta page id out of an Ad Library link (view_all_page_id=… / page_id=… / …/<id>) or a bare id.
function extractPageId(s: string): string | null {
  const t = (s || '').trim()
  const m = t.match(/(?:view_all_page_id|page_id|[?&]id)=(\d{5,})/i) || t.match(/\/(\d{7,})(?:[/?]|$)/)
  if (m) return m[1]
  if (/^\d{7,}$/.test(t)) return t
  return null
}

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'anon'
  if (limited(ip)) return NextResponse.json({ error: 'Too many scans — try again in a bit.' }, { status: 429 })

  let body: { pageId?: string; adLibraryUrl?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const pageId = (body.pageId && /^\d{5,}$/.test(body.pageId)) ? body.pageId : extractPageId(body.adLibraryUrl || '')
  if (!pageId) return NextResponse.json({ error: 'Pick your brand or paste your Meta Ad Library link.' }, { status: 400 })

  try {
    const admin = createAdminClient()
    // Resolve the brand + its niche. Prefer the directory; fall back to the brand's OWN crawled ads
    // (page_name + most-common niche) so a brand that's crawled but not in the 611K catalog still resolves.
    const { data: brand } = await admin.from('brand_directory').select('name, industry, country').eq('page_id', pageId).maybeSingle()
    let brandName = (brand?.name as string) || ''
    let niche = (brand?.industry as string) || null
    let brandCountry = (brand?.country as string) || null
    if (!brandName || !niche) {
      const { data: mine } = await admin.from('discovery_ads_index').select('page_name, niche').eq('page_id', pageId).limit(80)
      const rows = (mine || []) as { page_name?: string; niche?: string }[]
      if (!brandName) brandName = rows.find((r) => r.page_name)?.page_name || ''
      if (!niche) {
        const c: Record<string, number> = {}
        for (const r of rows) { const n = (r.niche || '').trim(); if (n) c[n] = (c[n] || 0) + 1 }
        niche = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null
      }
    }
    if (!brandName) brandName = 'your brand'

    // Region signal for RELEVANT rivals — a $1M Bulgarian store is not a peer of a US brand. If the
    // directory has no country, infer the brand's dominant ad country from its own ads' `countries[]`.
    if (!brandCountry) {
      const { data: mc } = await admin.from('discovery_ads_index').select('countries').eq('page_id', pageId).limit(120)
      const cc: Record<string, number> = {}
      for (const r of (mc || []) as { countries?: string[] }[]) for (const c of (r.countries || [])) { const k = String(c).trim().toUpperCase(); if (k) cc[k] = (cc[k] || 0) + 1 }
      brandCountry = Object.entries(cc).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    }

    // Rivals by CONTENT OVERLAP — the coarse niche ("Health & Wellness") lumps a nicotine brand in with
    // mattresses and period care. So we pull the brand's OWN distinctive ad keywords and rank same-niche
    // brands by how much their ad copy talks about the same things. Fall back to volume-in-niche if thin.
    let competitorPageIds: string[] = []
    const push = (arr: string[]) => { const seen = new Set(competitorPageIds); for (const p of arr) if (!seen.has(p)) { seen.add(p); competitorPageIds.push(p) } }

    // 1) the brand's distinctive keywords from its own ad copy
    const { data: myAds } = await admin.from('discovery_ads_index').select('body, title').eq('page_id', pageId).eq('has_creative', true).limit(80)
    const brandTokens = new Set(brandName.toLowerCase().split(/[^a-z]+/).filter(Boolean))
    const kw = topKeywords((myAds || []) as { body?: string | null; title?: string | null }[], brandTokens)

    // 2) FAST ranked keyword search (search_ads_v2 RPC, mig 099 — indexed, ~1s) → brands whose ads match
    // the brand's own keywords, ranked by how many of their ads hit. This is what surfaces real peers.
    if (kw.length) {
      try {
        const { data: hits } = await admin.rpc('search_ads_v2', { p_q: kw.slice(0, 6).join(' '), p_tags: [], p_sort: 'recommended', p_lim: 500, p_off: 0 })
        const score: Record<string, number> = {}
        for (const h of (hits || []) as { page_id?: string }[]) { const p = String(h.page_id || ''); if (p && p !== pageId) score[p] = (score[p] || 0) + 1 }
        competitorPageIds = Object.entries(score).sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 12)
      } catch { /* RPC missing/slow → fall back below */ }
    }

    // 3) fallback — too few content matches → highest-volume same-niche brands (directory, then live index)
    if (competitorPageIds.length < 3 && niche) {
      let q = admin.from('brand_directory').select('page_id').eq('industry', niche).neq('page_id', pageId).gt('source_ad_count', 0)
      if (brandCountry) q = q.eq('country', brandCountry)
      const { data: dir } = await q.order('source_ad_count', { ascending: false }).limit(10)
      push((dir || []).map((r: any) => String(r.page_id)))
      if (competitorPageIds.length < 3) {
        const { data: live } = await admin.from('discovery_ads_index').select('page_id').eq('niche', niche).eq('has_creative', true).neq('page_id', pageId).limit(400)
        push((live || []).map((r: any) => String(r.page_id)))
      }
      competitorPageIds = competitorPageIds.slice(0, 12)
    }

    const result = await runDnaEngine({ brandName, competitorPageIds, ownPageId: pageId, niche })

    // Payoff act inputs: concrete briefs the visitor can act on + a rival ad to remake. Pick a rival in the
    // SAME writing system as the brand — a Cyrillic/CJK store is not a believable "peer" for a Latin-script
    // brand even inside the same niche (country data is too sparse to rely on alone). Fall back to the
    // longest-running example if none match.
    const briefs = creativeBriefs(result, brandName, niche, 2)
    const rivalToRemake = pickRival(result.winners.examples, brandName)

    // Your ads aren't in our index yet → kick off a PRIORITY (full-archive) crawl of your page so the
    // own-ad audit fills in within minutes. Same mechanism Brand Spy uses (priority 9). Best-effort.
    let ownPending = false
    if (!result.own.found) {
      try {
        const { data: ex } = await admin.from('discovery_crawl_terms').select('page_id').eq('page_id', pageId).maybeSingle()
        if (ex) await admin.from('discovery_crawl_terms').update({ is_active: true, last_crawled_at: null, priority: 9 }).eq('page_id', pageId)
        else await admin.from('discovery_crawl_terms').insert({ term: brandName, page_id: pageId, term_type: 'brand', category: 'General', is_active: true, priority: 9, last_crawled_at: null, countries: COUNTRIES })
        ownPending = true
      } catch { /* enqueue best-effort */ }
    }

    // Nothing to show yet (your ads not indexed AND no rival data) → the UI shows a "building" state
    // instead of a meaningless score. The crawl we just kicked off fills this in within minutes.
    const building = !result.own.found && result.winners.sampleSize === 0
    return NextResponse.json({ brand: { pageId, name: brandName, niche }, competitors: competitorPageIds.length, ownPending, building, briefs, rivalToRemake, ...result })
  } catch (e) {
    return NextResponse.json({ error: 'Scan failed', detail: String(e).slice(0, 200) }, { status: 500 })
  }
}
