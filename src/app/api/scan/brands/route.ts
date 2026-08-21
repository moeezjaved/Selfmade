/**
 * GET /api/scan/brands?q=  — PUBLIC brand picker for the /scan audit. Returns page_id (the key we
 * audit ads by). No auth. Sources, in order:
 *   1) getIndexableBrands() — brands we've CRAWLED (instant audit, has page_id + adCount). Same source
 *      the production /brands search uses, so it works on preview too (read client, cached).
 *   2) brand_directory (611K catalog) via the READ client — broader coverage; uncrawled picks trigger a
 *      priority crawl in /api/scan/run. (brand_directory has a public RLS read policy.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createReadClient } from '@/lib/supabase/server'
import { getIndexableBrands } from '@/lib/seo/brands'

export const dynamic = 'force-dynamic'

type Row = { pageId: string; name: string; adCount: number; crawled: boolean }

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })
  const ql = q.toLowerCase()
  const out = new Map<string, Row>()

  // 1) crawled brands — proven source, has page_id, instant audit
  try {
    const idx = await getIndexableBrands()
    for (const b of idx) {
      if (b.name.toLowerCase().includes(ql)) out.set(b.pageId, { pageId: b.pageId, name: b.name, adCount: b.adCount || 0, crawled: true })
      if (out.size >= 40) break
    }
  } catch { /* fall through to the catalog */ }

  // 2) the full 611K catalog — read client (public RLS read on brand_directory)
  try {
    const db = createReadClient()
    const { data } = await db.from('brand_directory')
      .select('page_id, name, source_ad_count')
      .ilike('name', `%${q}%`).order('source_ad_count', { ascending: false }).limit(25)
    for (const b of (data || []) as { page_id: string; name: string; source_ad_count: number }[]) {
      if (!out.has(b.page_id)) out.set(b.page_id, { pageId: b.page_id, name: b.name, adCount: b.source_ad_count || 0, crawled: false })
    }
  } catch { /* catalog optional */ }

  const results = Array.from(out.values()).sort((a, b) =>
    (a.name.toLowerCase().startsWith(ql) ? 0 : 1) - (b.name.toLowerCase().startsWith(ql) ? 0 : 1) ||
    (b.crawled ? 1 : 0) - (a.crawled ? 1 : 0) ||
    b.adCount - a.adCount
  ).slice(0, 10)

  return NextResponse.json({ results })
}
