/**
 * GET /api/ads-studio/competitors — the ads-workspace "My Competitors" feed.
 * Returns the logged-in user's spied competitors (followed_brands, scoped to the active project) with a
 * few of each one's REAL running ads pulled from the crawled ad-DNA corpus (discovery_ads_index).
 * No login → empty (the workspace is entered from the ads audit, where the user IS logged in).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const AD_COLS = 'ad_id, page_id, page_name, thumbnail_url, raw_image_urls, body, title, format, days_running, is_active'

export async function GET(req: NextRequest) {
  try {
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return NextResponse.json({ competitors: [] })

    const admin = createAdminClient() as any
    const brandId = await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand') || undefined).catch(() => null)

    // The user's spied competitors, scoped to the active project (brand_id) when we have one.
    let q = admin.from('followed_brands').select('page_id, brand_name, brand_id').eq('user_id', user.id).eq('spied', true)
    if (brandId) q = q.or(`brand_id.eq.${brandId},brand_id.is.null`)
    const { data: follows } = await q.limit(30)
    const pageIds: string[] = Array.from(new Set((follows || []).map((f: any) => String(f.page_id)).filter(Boolean)))
    if (!pageIds.length) return NextResponse.json({ competitors: [] })

    const nameMap = await resolveBrandNames(admin, pageIds).catch(() => new Map<string, string>())

    const competitors = await Promise.all(pageIds.slice(0, 12).map(async (pageId) => {
      const [{ data: ads }, { count }, { data: state }] = await Promise.all([
        admin.from('discovery_ads_index').select(AD_COLS).eq('page_id', pageId).eq('has_creative', true).order('performance_score', { ascending: false, nullsFirst: false }).order('last_seen', { ascending: false }).limit(6),
        admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', pageId),
        admin.from('discovery_brand_crawl_state').select('active_count, video_count, image_count, brand_name').eq('page_id', pageId).maybeSingle(),
      ])
      const cleanAds = (ads || []).map((a: any) => ({
        id: a.ad_id,
        thumb: a.thumbnail_url || (Array.isArray(a.raw_image_urls) ? a.raw_image_urls[0] : null) || null,
        copy: (a.body || a.title || '').slice(0, 220),
        format: a.format || null,
        active: a.is_active ?? true,
      })).filter((a: any) => a.thumb)
      return {
        pageId,
        name: nameMap.get(pageId) || state?.brand_name || (follows || []).find((f: any) => String(f.page_id) === pageId)?.brand_name || 'Competitor',
        adCount: count ?? cleanAds.length,
        activeCount: state?.active_count ?? null,
        ads: cleanAds,
      }
    }))

    // Surface competitors that actually have creatives first.
    competitors.sort((a, b) => (b.ads.length - a.ads.length))
    return NextResponse.json({ competitors })
  } catch (e: any) {
    return NextResponse.json({ competitors: [], error: String(e?.message || e).slice(0, 160) })
  }
}
