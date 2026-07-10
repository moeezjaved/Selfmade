/**
 * Brands tab — search/sort/paginate the brand_directory catalog (the big ~611K list).
 * Public catalog data. For the visible page we also flag which brands we already crawl / spy
 * (join to the `brands` queue by page_id) so the UI can badge them.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createReadClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/lib/supabase/missing-table'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

// Distinct industries change rarely — cache the list so the filter dropdown doesn't scan 611K each load.
let _industries: { at: number; list: string[] } | null = null
const IND_TTL = 10 * 60_000

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createReadClient()
  const sp = req.nextUrl.searchParams
  const q = (sp.get('q') || '').trim()
  const industry = (sp.get('industry') || '').trim()
  const sort = sp.get('sort') || 'ads'
  const page = Math.max(0, parseInt(sp.get('page') || '0'))
  const offset = page * PAGE_SIZE

  let query = admin
    .from('brand_directory')
    .select('page_id, name, avatar_url, industry, source_ad_count, country', { count: 'planned' })
  if (q) query = query.ilike('name', `%${q}%`)
  if (industry) query = query.eq('industry', industry)

  if (sort === 'name') query = query.order('name', { ascending: true })
  else query = query.order('source_ad_count', { ascending: false })   // 'ads' default
  query = query.order('page_id', { ascending: true })                 // stable tiebreaker
  query = query.range(offset, offset + PAGE_SIZE - 1)

  const { data, error, count } = await query
  if (error) {
    // brand_directory not created yet (migration 049 pending) → clean empty state, not a 500.
    if (isMissingTable(error)) return NextResponse.json({ brands: [], total: 0, page, pageSize: PAGE_SIZE, hasMore: false, industries: [] })
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  const brands = (data || []) as any[]

  // Flag status for the visible page (cheap — INs over ≤50 ids):
  //  • inIndex = we've actually crawled this brand's ads (discovery_brand_crawl_state.ads_indexed>0)
  //  • spied   = THIS user already paid to spy it (credit_transactions ledger, ref = page_id)
  // Most directory brands are NOT yet crawled — that's fine: clicking Spy enqueues an on-demand
  // crawl (see /api/discovery/brand-spy POST). inIndex just lets us badge the ones we already have.
  const ids = brands.map(b => b.page_id)
  const inIndex = new Set<string>(), spied = new Set<string>()
  const indexedCount = new Map<string, number>()   // our live crawl count per brand
  if (ids.length) {
    const { data: states } = await admin
      .from('discovery_brand_crawl_state').select('page_id, ads_indexed').in('page_id', ids)
    for (const r of (states || []) as any[]) if ((r.ads_indexed || 0) > 0) { inIndex.add(r.page_id); indexedCount.set(r.page_id, r.ads_indexed) }
    // "Spying" badge = an explicit spy in followed_brands (spied=true). Spying is free now, so the old
    // credit_transactions ledger is empty and can't be the source of truth.
    const { data: fb } = await admin
      .from('followed_brands').select('page_id').eq('user_id', user.id).eq('spied', true).in('page_id', ids)
    for (const t of (fb || []) as any[]) if (t.page_id) spied.add(String(t.page_id))
  }

  // Industries for the filter dropdown (cached 10 min). Sample the most-populated brands first
  // (order by ad count) and take a wide slice so we capture the full taxonomy, not just whatever
  // 2000 rows happened to sort first — that was dropping industries from the picker.
  let industries: string[] = []
  if (!_industries || Date.now() - _industries.at > IND_TTL) {
    const { data: inds } = await admin.from('brand_directory')
      .select('industry').not('industry', 'is', null)
      .order('source_ad_count', { ascending: false, nullsFirst: false })
      .limit(20000)
    const names: string[] = (inds || []).map((r: any) => String(r.industry).trim()).filter((s: string) => s && s !== 'null' && s !== '—')
    industries = Array.from(new Set<string>(names)).sort()
    _industries = { at: Date.now(), list: industries }
  } else industries = _industries.list

  return NextResponse.json({
    brands: brands.map(b => ({
      pageId: b.page_id,
      name: b.name,
      // Avatar: stored value if the import had one, else derive from the FB page id (public picture endpoint).
      avatar: b.avatar_url || `https://graph.facebook.com/${b.page_id}/picture?type=square`,
      industry: b.industry,
      // Ad count: prefer our LIVE crawl count (accurate, grows as you crawl); fall back to the
      // imported source count (e.g. Foreplay's "# community ads" when that column is provided).
      adCount: Math.max(indexedCount.get(b.page_id) || 0, b.source_ad_count || 0),
      country: b.country,
      adLibraryUrl: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${b.page_id}`,
      isCrawled: inIndex.has(b.page_id),
      isSpied: spied.has(b.page_id),
    })),
    total: count || brands.length,
    page,
    pageSize: PAGE_SIZE,
    hasMore: brands.length === PAGE_SIZE,
    industries,
  })
}
