/**
 * GET /api/discovery/following?page=0 → recent ads from the brands the user follows.
 * Same result shape as db-search so the Following page renders identically.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createReadClient } from '@/lib/supabase/server'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

export const dynamic = 'force-dynamic'
const LIMIT = 40

const isBlankName = (b: unknown) => { const t = String(b ?? '').trim(); return !t || /^\d+$/.test(t) }

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createReadClient()   // serving reads → replica when SUPABASE_READ_URL set
  const page = parseInt(req.nextUrl.searchParams.get('page') || '0')

  const { data: follows } = await admin.from('followed_brands').select('page_id, brand_name').eq('user_id', user.id)
  const pageIds = (follows || []).map((f: any) => f.page_id)
  if (!pageIds.length) return NextResponse.json({ ads: [], total: 0, hasMore: false, brands: [] })

  // Resolve real names for the brand chips so we never show a bare Meta page_id like "1544270769212882".
  const needIds = (follows || []).filter((f: any) => isBlankName(f.brand_name)).map((f: any) => f.page_id)
  if (needIds.length) {
    const names = await resolveBrandNames(admin, needIds)
    for (const f of follows as any[]) if (isBlankName(f.brand_name)) f.brand_name = names.get(String(f.page_id)) || f.brand_name
  }

  // Fetch recent ads PER brand and round-robin interleave — NOT one global last_seen
  // window. A single freshly re-crawled brand (all its rows get the newest last_seen)
  // would otherwise monopolize the whole window and the feed would show only that one
  // brand's ads even though the user follows many. INNER-JOIN discovery_creatives so we
  // (a) filter to has-creative ads and (b) carry creatives for stable dedup + thumbnails.
  const perBrand = Math.max(6, Math.ceil((LIMIT * 2) / pageIds.length))
  const perBrandRows = await Promise.all(pageIds.map((pid: any) =>
    admin
      .from('discovery_ads_index')
      .select('*, discovery_creatives!inner(asset_type,position,r2_url,hash,width,height)')
      .eq('page_id', pid)
      .order('last_seen', { ascending: false })
      .range(page * perBrand, page * perBrand + perBrand - 1)
      .then((r: any) => (r.data || []) as any[])
  ))
  // Round-robin across brands so the 40 shown are a fair mix (brand1[0], brand2[0], … then [1]…).
  const maxLen = perBrandRows.reduce((m, a) => Math.max(m, a.length), 0)
  const rows: any[] = []
  for (let i = 0; i < maxLen; i++) for (const arr of perBrandRows) if (arr[i]) rows.push(arr[i])
  const brandHasMore = perBrandRows.some((a) => a.length >= perBrand)

  // Sort each ad's creatives images-first / position-asc so the FIRST is a STABLE dedup
  // key (the index row's "primary" hash is whichever creative was written last, so two
  // identical carousels got different keys and failed to dedup).
  type Cre = { position: number; asset_type: 'image' | 'video'; r2_url: string; hash: string | null; width: number | null; height: number | null }
  const sortCres = (cs: Cre[]) => cs.slice().sort((a, b) =>
    (a.asset_type === b.asset_type ? 0 : a.asset_type === 'image' ? -1 : 1) || (a.position - b.position))

  const seen = new Set<string>()
  const deduped: { ad: any; cres: Cre[] }[] = []
  for (const ad of (rows || []) as any[]) {
    const cres = sortCres((ad.discovery_creatives || []) as Cre[])
    if (!cres.length) continue
    const key = cres[0].hash || `_${ad.ad_id}`
    if (seen.has(key)) continue
    seen.add(key); deduped.push({ ad, cres })
    if (deduped.length >= LIMIT) break
  }

  const ads = deduped.map(({ ad, cres }) => {
    const imgC = cres.find((c) => c.asset_type === 'image')
    const vidC = cres.find((c) => c.asset_type === 'video')
    return {
      id: ad.ad_id, pageId: ad.page_id, pageName: ad.page_name, body: ad.body, title: ad.title,
      caption: ad.caption, description: ad.description, snapshotUrl: ad.snapshot_url,
      thumbnailUrl: imgC?.r2_url || vidC?.r2_url || null, videoUrl: vidC?.r2_url || null,
      image_hash: imgC?.hash ?? null, video_hash: vidC?.hash ?? null,
      creatives: cres, startDate: ad.start_date, stopDate: ad.stop_date,
      platforms: ad.platforms || [], languages: ad.languages || [], isActive: ad.is_active,
      daysRunning: ad.days_running, country: ad.country, format: ad.format,
      industries: ad.industries || [], topics: ad.topics || [], cta: ad.cta,
    }
  })
  return NextResponse.json({ ads, hasMore: brandHasMore, brands: follows || [] })
}
