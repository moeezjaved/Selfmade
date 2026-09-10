/**
 * GET /api/ads-studio/discover — the workspace "Discover" feed. Leads with the logged-in user's own
 * competitors' image ads (their FÜM etc — live, deduped by creative), then fills with trending images
 * from our crawl library. Up to ~100. Each card is "Create Similar" → tags into the Mello chat.
 * (Trending alone is sparse since the R2 purge, so the competitor pull is what keeps the feed full.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveBrandNames } from '@/lib/discovery/brandNames'
import { fetchLiveAdsByPage } from '@/lib/ads-studio/adlibrary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60   // spied competitors' live ads come off the droplet (Playwright)

type DiscoverAd = { id: string; brand: string; thumb: string; copy: string; format: string }

const mediaUrl = (u?: string | null) => (u ? `/api/ads-studio/media?u=${encodeURIComponent(u)}` : null)
// Signature of the actual image behind a thumb, so we dedup by CREATIVE (Meta repeats the same image
// under many ad ids). Proxied live thumb → inner fbcdn image path; corpus thumb → stable R2 url.
const imgSig = (thumb?: string | null): string => {
  if (!thumb) return ''
  try {
    const m = thumb.match(/[?&]u=([^&]+)/)
    const raw = m ? decodeURIComponent(m[1]) : thumb
    const u = new URL(raw, 'https://x')
    return (u.pathname.split('/').filter(Boolean).pop() || raw).toLowerCase()
  } catch { return thumb }
}

const MAX_SPIED_BRANDS = 6   // bound the droplet work: at most this many spied competitors get a live pull

/** The user's spied competitors' IMAGE ads (live, images only), interleaved across brands, deduped. */
async function spiedCompetitorImages(admin: any): Promise<DiscoverAd[]> {
  try {
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return []
    const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
    let q = admin.from('followed_brands').select('page_id, brand_name, brand_id').eq('user_id', user.id).eq('spied', true)
    if (brandId) q = q.eq('brand_id', brandId)   // STRICT per active brand (matches the competitors feed)
    const { data: follows } = await q.limit(30)
    const pageIds: string[] = Array.from(new Set<string>((follows || []).map((f: any) => String(f.page_id)).filter(Boolean))).slice(0, MAX_SPIED_BRANDS)
    if (!pageIds.length) return []
    const nameMap = await resolveBrandNames(admin, pageIds).catch(() => new Map<string, string>())
    const perBrand = await Promise.all(pageIds.map(async (pid) => {
      const live = await fetchLiveAdsByPage(pid, 100).catch(() => [])
      const brand = nameMap.get(pid) || (follows || []).find((f: any) => String(f.page_id) === pid)?.brand_name || 'Competitor'
      return live
        .filter((a) => a.images?.length && !a.videos?.length)   // image ads only
        .map((a) => ({ id: a.adId, brand, thumb: mediaUrl(a.images[0]) || '', copy: (a.body || a.title || '').slice(0, 120), format: 'image' as const }))
        .filter((a) => a.thumb)
    }))
    // Interleave brands (round-robin) so one competitor doesn't hog the whole front of the feed, dedup by image.
    const seen = new Set<string>()
    const out: DiscoverAd[] = []
    for (let i = 0; ; i++) {
      let added = false
      for (const list of perBrand) {
        const a = list[i]
        if (!a) continue
        added = true
        const s = imgSig(a.thumb) || a.id
        if (s && !seen.has(s)) { seen.add(s); out.push(a) }
      }
      if (!added) break
    }
    return out
  } catch { return [] }
}

export async function GET(req: NextRequest) {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '24', 10), 100)
  try {
    const admin = createAdminClient() as any

    // 1. The user's own spied competitors' image ads — these lead the feed.
    const spied = await spiedCompetitorImages(admin)
    const seenImg = new Set<string>(spied.map((a) => imgSig(a.thumb) || a.id))
    const seenBrand = new Set<string>(spied.map((a) => a.brand))

    // 2. Trending images from our crawl library — fill the rest (one per brand for a varied wall).
    const need = Math.max(0, limit - spied.length)
    const globalAds: DiscoverAd[] = []
    if (need > 0) {
      const { data: index } = await admin.from('discovery_ads_index')
        .select('ad_id, page_name, body, title, format, performance_score')
        .eq('has_creative', true).eq('is_active', true)
        .order('performance_score', { ascending: false, nullsFirst: false })
        .limit(need * 20)
      const rows = (index || []) as any[]
      if (rows.length) {
        // The R2 purge kept discovery_creatives posters/images for spied brands only, so the creatives
        // table is the source of truth for what STILL EXISTS. Only show those (no dead thumbs).
        const ids = rows.map((r) => r.ad_id)
        const { data: cre } = await admin.from('discovery_creatives')
          .select('ad_id, asset_type, r2_url, poster_url, position')
          .in('ad_id', ids).order('position', { ascending: true })
        const thumbByAd = new Map<string, string>()
        for (const c of (cre || []) as any[]) {
          if (thumbByAd.has(c.ad_id)) continue
          const t = c.poster_url || (c.asset_type !== 'video' ? c.r2_url : null)
          if (t) thumbByAd.set(c.ad_id, t)
        }
        for (const a of rows) {
          const thumb = thumbByAd.get(a.ad_id)
          const brand = a.page_name || 'Brand'
          if (!thumb || seenBrand.has(brand)) continue
          const s = imgSig(thumb) || a.ad_id
          if (seenImg.has(s)) continue
          seenImg.add(s); seenBrand.add(brand)
          globalAds.push({ id: a.ad_id, brand, thumb, copy: (a.body || a.title || '').slice(0, 120), format: a.format || 'image' })
          if (globalAds.length >= need) break
        }
      }
    }

    return NextResponse.json({ ads: [...spied, ...globalAds].slice(0, limit) })
  } catch (e: any) {
    return NextResponse.json({ ads: [], error: String(e?.message || e).slice(0, 160) })
  }
}
