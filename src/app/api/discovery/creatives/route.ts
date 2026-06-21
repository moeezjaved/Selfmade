/**
 * Creatives API — groups ads by perceptual hash.
 * One row per unique creative with metadata: how many ads use it,
 * how many copy variations, how many brands, total runtime, etc.
 *
 * GET /api/discovery/creatives?country=US&min_ads=2&type=image&page=0
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface CreativeGroup {
  hash: string
  type: 'image' | 'video'
  thumbnail_url: string | null
  video_url: string | null
  ad_count: number
  active_count: number
  copy_variations: number
  brand_count: number
  brands: string[]
  industries: string[]
  formats: string[]
  first_seen: string
  last_seen: string
  sample_ad_id: string
  sample_body: string | null
  // Internal accumulators
  _bodies?: Set<string>
  _brands?: Set<string>
  _industries?: Set<string>
  _formats?: Set<string>
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { searchParams } = req.nextUrl

  const country = searchParams.get('country') || ''
  const industry = searchParams.get('industry') || ''
  const format = searchParams.get('format') || ''
  const type = (searchParams.get('type') || 'all') as 'image' | 'video' | 'all'
  const minAds = Math.max(1, parseInt(searchParams.get('min_ads') || '1', 10))
  const sort = searchParams.get('sort') || 'most_used'
  const page = parseInt(searchParams.get('page') || '0', 10)
  const pageSize = 60

  // Pull ads that have a hash AND a stored R2 creative.
  // Limit to a manageable pool — sort by last_seen for relevance.
  // Creative hash + r2_url now come from discovery_creatives via an INNER JOIN
  // (creative-queue Phase 2 — the drain no longer writes hash/thumbnail to the ads
  // table). The type filter is applied in JS against the joined creatives.
  let query: any = admin
    .from('discovery_ads_index')
    .select('ad_id, page_id, page_name, body, is_active, start_date, last_seen, industries, format, country, discovery_creatives!inner(asset_type,hash,r2_url)')
    .order('last_seen', { ascending: false })
    .limit(8000)

  if (country) query = query.eq('country', country)
  if (format) query = query.eq('format', format)
  if (industry) query = query.contains('industries', [industry])

  const { data: ads, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by hash in JS — way simpler than custom Postgres aggregation
  const groups = new Map<string, CreativeGroup>()
  for (const ad of ads || []) {
    const cr: any[] = ad.discovery_creatives || []
    const img = cr.find(c => c.asset_type === 'image')
    const vid = cr.find(c => c.asset_type === 'video')
    // pick the creative matching the type filter (default: image-first primary)
    const chosen = type === 'image' ? img : type === 'video' ? vid : (img || vid)
    const key = chosen?.hash
    if (!key) continue
    const isImage = chosen.asset_type === 'image'

    if (!groups.has(key)) {
      groups.set(key, {
        hash: key,
        type: isImage ? 'image' : 'video',
        thumbnail_url: isImage ? chosen.r2_url : null,
        video_url: isImage ? null : chosen.r2_url,
        ad_count: 0,
        active_count: 0,
        copy_variations: 0,
        brand_count: 0,
        brands: [],
        industries: [],
        formats: [],
        first_seen: ad.start_date || ad.last_seen,
        last_seen: ad.last_seen,
        sample_ad_id: ad.ad_id,
        sample_body: ad.body || null,
        _bodies: new Set(),
        _brands: new Set(),
        _industries: new Set(),
        _formats: new Set(),
      })
    }
    const g = groups.get(key)!
    g.ad_count++
    if (ad.is_active) g.active_count++
    if (ad.page_name) g._brands!.add(ad.page_name)
    if (ad.body) g._bodies!.add(ad.body)
    ;(ad.industries || []).forEach((i: string) => g._industries!.add(i))
    if (ad.format) g._formats!.add(ad.format)
    if (ad.start_date && (!g.first_seen || ad.start_date < g.first_seen)) g.first_seen = ad.start_date
    if (ad.last_seen && ad.last_seen > g.last_seen) g.last_seen = ad.last_seen
  }

  // Finalize: convert sets, filter min_ads, sort, paginate
  let creatives: CreativeGroup[] = Array.from(groups.values()).map(g => ({
    ...g,
    brands: Array.from(g._brands!).slice(0, 10),
    brand_count: g._brands!.size,
    copy_variations: g._bodies!.size,
    industries: Array.from(g._industries!),
    formats: Array.from(g._formats!),
    _bodies: undefined,
    _brands: undefined,
    _industries: undefined,
    _formats: undefined,
  })).filter(g => g.ad_count >= minAds)

  // Sort
  if (sort === 'most_brands') {
    creatives.sort((a, b) => b.brand_count - a.brand_count || b.ad_count - a.ad_count)
  } else if (sort === 'most_active') {
    creatives.sort((a, b) => b.active_count - a.active_count || b.ad_count - a.ad_count)
  } else if (sort === 'most_variations') {
    creatives.sort((a, b) => b.copy_variations - a.copy_variations || b.ad_count - a.ad_count)
  } else if (sort === 'newest') {
    creatives.sort((a, b) => (b.last_seen > a.last_seen ? 1 : -1))
  } else {
    // most_used (default)
    creatives.sort((a, b) => b.ad_count - a.ad_count)
  }

  const total = creatives.length
  const paged = creatives.slice(page * pageSize, (page + 1) * pageSize)

  return NextResponse.json({
    creatives: paged,
    total,
    page,
    hasMore: (page + 1) * pageSize < total,
  })
}
