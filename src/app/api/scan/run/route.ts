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

    // Rivals = highest-volume OTHER brands in the same niche. We PREFER same-country rivals (a real peer,
    // same language/market) and relax to niche-wide only if that pool is too thin, so the "make it yours"
    // comparison isn't a foreign-language store. Directory first, then the live ad index (off-catalog).
    let competitorPageIds: string[] = []
    if (niche) {
      const pickRivals = async (useCountry: boolean): Promise<string[]> => {
        let q = admin.from('brand_directory').select('page_id').eq('industry', niche).neq('page_id', pageId).gt('source_ad_count', 0)
        if (useCountry && brandCountry) q = q.eq('country', brandCountry)
        const { data } = await q.order('source_ad_count', { ascending: false }).limit(10)
        return (data || []).map((r: any) => String(r.page_id))
      }
      const push = (arr: string[]) => { const seen = new Set(competitorPageIds); for (const p of arr) if (!seen.has(p)) { seen.add(p); competitorPageIds.push(p) } }

      // 1) same-country directory rivals (only if we know the country)
      if (brandCountry) push(await pickRivals(true))
      // 2) relax to niche-wide directory rivals if the country pool is thin (country matches stay first)
      if (competitorPageIds.length < 5) push(await pickRivals(false))
      competitorPageIds = competitorPageIds.slice(0, 10)

      // 3) live ad-index fallback — prefer same-country ads, then relax
      if (competitorPageIds.length < 3) {
        let lq = admin.from('discovery_ads_index').select('page_id').eq('niche', niche).eq('has_creative', true).neq('page_id', pageId)
        if (brandCountry) lq = lq.contains('countries', [brandCountry])
        const { data: live } = await lq.limit(400)
        push((live || []).map((r: any) => String(r.page_id)))
        if (competitorPageIds.length < 3) {
          const { data: live2 } = await admin.from('discovery_ads_index').select('page_id').eq('niche', niche).eq('has_creative', true).neq('page_id', pageId).limit(400)
          push((live2 || []).map((r: any) => String(r.page_id)))
        }
        competitorPageIds = competitorPageIds.slice(0, 10)
      }
    }

    const result = await runDnaEngine({ brandName, competitorPageIds, ownPageId: pageId, niche })

    // Payoff act inputs: concrete briefs the visitor can act on + the single longest-running rival ad to remake.
    const briefs = creativeBriefs(result, brandName, niche, 2)
    const rivalToRemake = result.winners.examples[0] || null

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
