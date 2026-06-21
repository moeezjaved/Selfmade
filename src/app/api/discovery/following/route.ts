/**
 * GET /api/discovery/following?page=0 → recent ads from the brands the user follows.
 * Same result shape as db-search so the Following page renders identically.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
const LIMIT = 40

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const page = parseInt(req.nextUrl.searchParams.get('page') || '0')

  const { data: follows } = await admin.from('followed_brands').select('page_id, brand_name').eq('user_id', user.id)
  const pageIds = (follows || []).map((f: any) => f.page_id)
  if (!pageIds.length) return NextResponse.json({ ads: [], total: 0, hasMore: false, brands: [] })

  // "Has a creative" is now an INNER JOIN to discovery_creatives (creative-queue
  // Phase 2 — the drain no longer writes thumbnail_url/hash back to discovery_ads_index).
  const imgC = (cr: any[]) => cr?.find((c: any) => c.asset_type === 'image')
  const vidC = (cr: any[]) => cr?.find((c: any) => c.asset_type === 'video')
  // Over-fetch for hash dedup, newest first.
  const over = LIMIT * 5
  const { data: rows } = await admin
    .from('discovery_ads_index')
    .select('*, discovery_creatives!inner(asset_type,hash)')
    .in('page_id', pageIds)
    .order('last_seen', { ascending: false })
    .range(page * over, page * over + over - 1)

  const seen = new Set<string>()
  const deduped: any[] = []
  for (const ad of (rows || []) as any[]) {
    const key = imgC(ad.discovery_creatives)?.hash || vidC(ad.discovery_creatives)?.hash || `_${ad.ad_id}`
    if (seen.has(key)) continue
    seen.add(key); deduped.push(ad)
    if (deduped.length >= LIMIT) break
  }

  const adIds = deduped.map(a => a.ad_id)
  let creativesByAd: Record<string, any[]> = {}
  if (adIds.length) {
    const { data: cre } = await admin.from('discovery_creatives')
      .select('ad_id, position, asset_type, r2_url, hash').in('ad_id', adIds)
      .order('asset_type', { ascending: true }).order('position', { ascending: true })
    creativesByAd = ((cre || []) as any[]).reduce((a: any, c: any) => { (a[c.ad_id] ||= []).push(c); return a }, {})
  }

  const ads = deduped.map((ad: any) => ({
    id: ad.ad_id, pageId: ad.page_id, pageName: ad.page_name, body: ad.body, title: ad.title,
    caption: ad.caption, description: ad.description, snapshotUrl: ad.snapshot_url,
    thumbnailUrl: imgC(creativesByAd[ad.ad_id])?.r2_url || ad.thumbnail_url || null,
    videoUrl: vidC(creativesByAd[ad.ad_id])?.r2_url || ad.video_url || null,
    creatives: creativesByAd[ad.ad_id] || [], startDate: ad.start_date, stopDate: ad.stop_date,
    platforms: ad.platforms || [], languages: ad.languages || [], isActive: ad.is_active,
    daysRunning: ad.days_running, country: ad.country, format: ad.format,
    industries: ad.industries || [], topics: ad.topics || [], cta: ad.cta,
  }))
  return NextResponse.json({ ads, hasMore: (rows || []).length >= over, brands: follows || [] })
}
