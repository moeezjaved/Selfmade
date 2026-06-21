/**
 * Creatives API — groups unique creatives by perceptual hash.
 * One row per unique creative with metadata: how many ads use it,
 * how many copy variations, how many brands, total runtime, etc.
 *
 * Source of truth is `discovery_creatives` (append-only per-asset rows) — NOT
 * the legacy `discovery_ads_index.thumbnail_url LIKE '%r2.dev%'` seq-scan, which
 * (a) was an unindexed scan that drained 33s under load, and (b) missed new
 * append-only ads whose creatives live only in discovery_creatives.
 *
 * GET /api/discovery/creatives?country=US&min_ads=2&type=image&page=0
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createReadClient } from '@/lib/supabase/server'

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
  width: number | null
  height: number | null
  // Internal accumulators
  _adIds?: Set<string>
  _activeAdIds?: Set<string>
  _bodies?: Set<string>
  _brands?: Set<string>
  _industries?: Set<string>
  _formats?: Set<string>
}

interface AdMeta {
  page_id: string | null
  page_name: string | null
  body: string | null
  is_active: boolean | null
  start_date: string | null
  last_seen: string | null
  industries: string[] | null
  format: string | null
  country: string | null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createReadClient()   // serving reads → replica when SUPABASE_READ_URL set
  const { searchParams } = req.nextUrl

  const country = searchParams.get('country') || ''
  const industry = searchParams.get('industry') || ''
  const format = searchParams.get('format') || ''
  const type = (searchParams.get('type') || 'all') as 'image' | 'video' | 'all'
  const minAds = Math.max(1, parseInt(searchParams.get('min_ads') || '1', 10))
  const sort = searchParams.get('sort') || 'most_used'
  const page = parseInt(searchParams.get('page') || '0', 10)
  const pageSize = 60

  // ── Pull a bounded window of creatives from the source-of-truth table ──
  // Prefer rows with a non-null hash (we group by hash, so hash-less rows are
  // useless here) and order by hash so grouping is natural. Honor the type filter
  // (image/video → asset_type).
  let cre: any = admin
    .from('discovery_creatives')
    .select('ad_id, position, asset_type, r2_url, hash, width, height')
    .not('hash', 'is', null)
    .order('hash', { ascending: true })
    .limit(8000)

  if (type === 'image') cre = cre.eq('asset_type', 'image')
  if (type === 'video') cre = cre.eq('asset_type', 'video')

  const { data: creatives0, error: creErr } = await cre
  if (creErr) return NextResponse.json({ error: creErr.message }, { status: 500 })

  const creativeRows = (creatives0 || []) as Array<{
    ad_id: string
    position: number | null
    asset_type: 'image' | 'video'
    r2_url: string | null
    hash: string | null
    width: number | null
    height: number | null
  }>

  // ── Batch-fetch ad metadata for the distinct ad_ids (chunk if >1000) ──
  const adIds = Array.from(new Set(creativeRows.map(c => c.ad_id).filter(Boolean)))
  const adMeta = new Map<string, AdMeta>()
  for (let i = 0; i < adIds.length; i += 1000) {
    const slice = adIds.slice(i, i + 1000)
    const { data: meta, error: metaErr } = await admin
      .from('discovery_ads_index')
      .select('ad_id, page_id, page_name, body, is_active, start_date, last_seen, industries, format, country')
      .in('ad_id', slice)
    if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 500 })
    for (const m of (meta || []) as any[]) {
      adMeta.set(m.ad_id, {
        page_id: m.page_id ?? null,
        page_name: m.page_name ?? null,
        body: m.body ?? null,
        is_active: m.is_active ?? null,
        start_date: m.start_date ?? null,
        last_seen: m.last_seen ?? null,
        industries: m.industries ?? null,
        format: m.format ?? null,
        country: m.country ?? null,
      })
    }
  }

  // ── Group by hash. ad-level filters (country / industry / format) are applied
  // via the ad's metadata so the creative is excluded when its ad doesn't match. ──
  const groups = new Map<string, CreativeGroup>()
  for (const c of creativeRows) {
    const key = c.hash
    if (!key) continue
    const meta = adMeta.get(c.ad_id)
    // If the ad row is missing entirely we can't apply ad-level filters; only keep
    // it when no ad-level filter is active (otherwise we'd leak unfiltered rows).
    if (country && meta?.country !== country) continue
    if (format && meta?.format !== format) continue
    if (industry && !(meta?.industries || []).includes(industry)) continue

    const isImage = c.asset_type === 'image'

    if (!groups.has(key)) {
      groups.set(key, {
        hash: key,
        type: isImage ? 'image' : 'video',
        thumbnail_url: isImage ? c.r2_url : null,
        video_url: isImage ? null : c.r2_url,
        ad_count: 0,
        active_count: 0,
        copy_variations: 0,
        brand_count: 0,
        brands: [],
        industries: [],
        formats: [],
        first_seen: meta?.start_date || meta?.last_seen || '',
        last_seen: meta?.last_seen || '',
        sample_ad_id: c.ad_id,
        sample_body: meta?.body || null,
        width: c.width ?? null,
        height: c.height ?? null,
        _adIds: new Set(),
        _activeAdIds: new Set(),
        _bodies: new Set(),
        _brands: new Set(),
        _industries: new Set(),
        _formats: new Set(),
      })
    }
    const g = groups.get(key)!
    // Fill in a representative URL / dimensions if the first row for this hash
    // lacked one (e.g. group was seeded by a row missing width/height).
    if (isImage && !g.thumbnail_url) g.thumbnail_url = c.r2_url
    if (!isImage && !g.video_url) g.video_url = c.r2_url
    if (g.width == null && c.width != null) g.width = c.width
    if (g.height == null && c.height != null) g.height = c.height

    g._adIds!.add(c.ad_id)
    if (meta?.is_active) g._activeAdIds!.add(c.ad_id)
    if (meta?.page_name) g._brands!.add(meta.page_name)
    if (meta?.body) g._bodies!.add(meta.body)
    ;(meta?.industries || []).forEach((iName: string) => g._industries!.add(iName))
    if (meta?.format) g._formats!.add(meta.format)
    if (meta?.start_date && (!g.first_seen || meta.start_date < g.first_seen)) g.first_seen = meta.start_date
    if (meta?.last_seen && meta.last_seen > g.last_seen) g.last_seen = meta.last_seen
  }

  // ── Finalize: convert sets, filter min_ads, sort, paginate ──
  let out: CreativeGroup[] = Array.from(groups.values()).map(g => ({
    ...g,
    ad_count: g._adIds!.size,
    active_count: g._activeAdIds!.size,
    brands: Array.from(g._brands!).slice(0, 10),
    brand_count: g._brands!.size,
    copy_variations: g._bodies!.size,
    industries: Array.from(g._industries!),
    formats: Array.from(g._formats!),
    _adIds: undefined,
    _activeAdIds: undefined,
    _bodies: undefined,
    _brands: undefined,
    _industries: undefined,
    _formats: undefined,
  })).filter(g => g.ad_count >= minAds)

  // Sort
  if (sort === 'most_brands') {
    out.sort((a, b) => b.brand_count - a.brand_count || b.ad_count - a.ad_count)
  } else if (sort === 'most_active') {
    out.sort((a, b) => b.active_count - a.active_count || b.ad_count - a.ad_count)
  } else if (sort === 'most_variations') {
    out.sort((a, b) => b.copy_variations - a.copy_variations || b.ad_count - a.ad_count)
  } else if (sort === 'newest') {
    out.sort((a, b) => (b.last_seen > a.last_seen ? 1 : -1))
  } else {
    // most_used (default)
    out.sort((a, b) => b.ad_count - a.ad_count)
  }

  const total = out.length
  const paged = out.slice(page * pageSize, (page + 1) * pageSize)

  return NextResponse.json({
    creatives: paged,
    total,
    page,
    hasMore: (page + 1) * pageSize < total,
  })
}
