/**
 * GET /api/mello/desk → the mission desk's live panels, DB-only (no Meta call — the Meta numbers come from
 * the strategist plan). Fast, so panels populate while the LLM plan is still thinking. Everything is
 * strict active-brand scoped (brand-isolation rule) and read-only.
 *
 *   ownAds     — the founder's OWN ad creatives (real thumbnails from the crawled index) for the "Your ads"
 *                filmstrip. Pairs with plan.meta's account headline. No fabricated per-ad metrics.
 *   rivals     — spied competitors + their new-ad burst in the last 72h (the "hot" signal).
 *   generations— recent images/videos Mello made (the studio glimpse) → /studio.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveOwnPageId } from '@/lib/mello/own-brand'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

type OwnAd = { adId: string; title: string | null; days: number | null; thumb: string; isVideo: boolean }
type Rival = { name: string; pageId: string; newAds: number }
type Gen = { id: string; url: string; isVideo: boolean; at: string }

const H72 = () => new Date(Date.now() - 72 * 3600e3).toISOString()

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)

  // brand name → own page (only when a brand is active; All-brands has no single "own" page)
  let brandName: string | null = null
  if (brandId) { try { const { data } = await admin.from('brands').select('name').eq('id', brandId).maybeSingle(); brandName = data?.name || null } catch { /* ignore */ } }
  const ownPageId = brandName ? await resolveOwnPageId(admin, brandName) : null

  const ownAdsP = (async (): Promise<OwnAd[]> => {
    if (!ownPageId) return []
    const { data } = await admin.from('discovery_ads_index')
      .select('ad_id, title, days_running, performance_score, discovery_creatives(asset_type, r2_url, poster_url)')
      .eq('page_id', ownPageId).order('performance_score', { ascending: false, nullsFirst: false }).limit(14)
    const out: OwnAd[] = []
    for (const a of (data || []) as any[]) {
      const cre: any[] = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : []
      const img = cre.find((c) => c?.asset_type === 'image' && c?.r2_url)
      const vid = cre.find((c) => c?.asset_type === 'video' && (c?.poster_url || c?.r2_url))
      const thumb = img?.r2_url || vid?.poster_url || null
      if (!thumb) continue
      out.push({ adId: String(a.ad_id), title: a.title || null, days: a.days_running ?? null, thumb, isVideo: !img && !!vid })
      if (out.length >= 8) break
    }
    return out
  })()

  const rivalsP = (async (): Promise<Rival[]> => {
    let q = admin.from('followed_brands').select('page_id, brand_name, brand_id').eq('user_id', user.id).eq('spied', true)
    const { data: fb } = await q
    let rivals: Rival[] = ((fb || []) as any[])
      .filter((r) => r.page_id && (!brandId || String(r.brand_id) === brandId))   // strict active-brand scope
      .map((r) => ({ name: r.brand_name || String(r.page_id), pageId: String(r.page_id), newAds: 0 }))
    if (rivals.length) {
      const { data: notifs } = await admin.from('notifications')
        .select('page_id, ad_count').eq('user_id', user.id).eq('type', 'new_ad').gte('created_at', H72())
      const burst = new Map<string, number>()
      for (const n of (notifs || []) as any[]) { const pid = String(n.page_id || ''); if (pid) burst.set(pid, (burst.get(pid) || 0) + (Number(n.ad_count) || 1)) }
      rivals.forEach((r) => { r.newAds = burst.get(r.pageId) || 0 })
      rivals.sort((a, b) => b.newAds - a.newAds || a.name.localeCompare(b.name))
    }
    return rivals.slice(0, 8)
  })()

  const gensP = (async (): Promise<Gen[]> => {
    let q = admin.from('creative_generations')
      .select('id, image_url, media_type, status, created_at')
      .eq('user_id', user.id).not('image_url', 'is', null)
      .or('status.eq.done,status.is.null')
      .order('created_at', { ascending: false }).limit(8)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q
    return ((data || []) as any[]).map((g) => ({ id: String(g.id), url: g.image_url, isVideo: g.media_type === 'video', at: g.created_at }))
  })()

  try {
    const [ownAds, rivals, generations] = await Promise.all([ownAdsP, rivalsP, gensP])
    return NextResponse.json({ ownAds, rivals, generations, ownIndexed: !!ownPageId })
  } catch (e) {
    return NextResponse.json({ error: 'desk_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
