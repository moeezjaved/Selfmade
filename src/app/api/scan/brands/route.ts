/**
 * GET /api/scan/brands?q=  — PUBLIC brand picker for the /scan audit. Returns page_id (the key we
 * audit ads by). No auth. Sources, in order:
 *   1) getIndexableBrands() — brands we've CRAWLED with >=100 ads (instant audit, has page_id + adCount).
 *   2) brand_directory (611K catalog) via the relevance-ranked, ACCENT-INSENSITIVE RPC
 *      `search_brand_directory` (migration 118) — the SAME search onboarding/the Brands tab use, so
 *      "fum" surfaces "Füm — The Good Habit" first instead of a wall of par·fum / per·fume. Falls back
 *      to an accent-insensitive ILIKE if the RPC isn't present. Uncrawled picks trigger a priority crawl
 *      in /api/scan/run.
 * We then flag which directory hits we've actually crawled (discovery_brand_crawl_state) so a crawled
 * brand ranks first (instant audit) even when it has <100 ads and thus isn't in getIndexableBrands.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createReadClient } from '@/lib/supabase/server'
import { getIndexableBrands } from '@/lib/seo/brands'

export const dynamic = 'force-dynamic'

type Row = { pageId: string; name: string; adCount: number; crawled: boolean }

// Accent/case-insensitive fold so "fum" matches "Füm" and "café" matches "cafe".
const fold = (s: string) => (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })
  const qf = fold(q)
  const out = new Map<string, Row>()   // insertion order = rank within a crawled/uncrawled tier

  // 1) crawled brands with an SEO page (>=100 ads) — proven source, instant audit. Accent-insensitive.
  try {
    const idx = await getIndexableBrands()
    for (const b of idx) {
      if (fold(b.name).includes(qf)) out.set(b.pageId, { pageId: b.pageId, name: b.name, adCount: b.adCount || 0, crawled: true })
      if (out.size >= 40) break
    }
  } catch { /* fall through to the catalog */ }

  // 2) the full 611K catalog — relevance-ranked, accent-insensitive RPC (mig 118); ILIKE fallback.
  try {
    const db = createReadClient()
    const { data: rpc, error } = await db.rpc('search_brand_directory', { p_q: q, p_industry: null, p_limit: 25 })
    let rows: { page_id: string; name: string; source_ad_count: number }[]
    if (!error && Array.isArray(rpc)) {
      rows = rpc as any[]
    } else {
      const { data } = await db.from('brand_directory')
        .select('page_id, name, source_ad_count')
        .ilike('name', `%${q}%`).order('source_ad_count', { ascending: false }).limit(25)
      rows = (data || []) as any[]
    }
    for (const b of rows) {
      const pid = String(b.page_id)
      if (!out.has(pid)) out.set(pid, { pageId: pid, name: b.name, adCount: b.source_ad_count || 0, crawled: false })
    }

    // Flag which of these we've actually crawled (so a crawled-but-<100-ad brand still ranks first and
    // shows a real ad count) — same signal the Brands tab badges with.
    const ids = Array.from(out.values()).filter((r) => !r.crawled).map((r) => r.pageId)
    if (ids.length) {
      const { data: states } = await db.from('discovery_brand_crawl_state').select('page_id, ads_indexed').in('page_id', ids)
      for (const s of (states || []) as { page_id: string; ads_indexed: number }[]) {
        const r = out.get(String(s.page_id))
        if (r && (s.ads_indexed || 0) > 0) { r.crawled = true; r.adCount = Math.max(r.adCount, s.ads_indexed || 0) }
      }
    }
  } catch { /* catalog optional */ }

  // Rank: crawled first (instant audit); within a tier, keep source order (RPC relevance).
  const results = Array.from(out.values())
    .sort((a, b) => (b.crawled ? 1 : 0) - (a.crawled ? 1 : 0))
    .slice(0, 10)

  return NextResponse.json({ results })
}
