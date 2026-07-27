/**
 * Mello Tasks — the decision engine behind the "CEO desk". Instead of showing analytics, Mello proposes
 * a small set of TASKS (decisions already made, one click to execute). Deterministic, from data the
 * brief already has (notifications + report history + the crawled ad index) — no AI cost to decide.
 *
 *   RESEARCH — a competitor pushed a burst of ads AND has no fresh report → "produce their report".
 *   CREATIVE — the competitor's best-performing image ad → "make your version" (image gen, one click).
 *   VIDEO    — their best-performing video ad → "recreate it" (builds the storyboard; you approve the
 *              one expensive click yourself, so no video credits are spent autonomously).
 *
 * CREATIVE/VIDEO need the reader's product photos (to swap the brand in), so they only appear when the
 * active brand has at least one product image.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type TaskSuggestion = {
  kind: 'research' | 'creative' | 'video'
  title: string
  why: string
  evidence: Record<string, any>
  credits: number | null
  suggested_key: string
  brand_id: string | null
}

const H72 = () => new Date(Date.now() - 72 * 3600e3).toISOString()
const D7 = () => new Date(Date.now() - 7 * 86400e3).toISOString()
const isoDay = (d = new Date()) => d.toISOString().slice(0, 10)

type BrandCtx = { id: string; name: string | null; brandType: string; productImages: string[] }
type TopAd = { adId: string; headline: string | null; media: string | null; days: number | null }

/** The reader's active brand + its product photos — the raw material CREATIVE/VIDEO tasks swap in. */
async function resolveBrand(admin: SupabaseClient, userId: string, brandId?: string | null): Promise<BrandCtx | null> {
  let q = admin.from('brands').select('id, name, brand_type').eq('user_id', userId)
  if (brandId) q = q.eq('id', brandId)
  const { data: b } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!b) return null
  const { data: prods } = await admin.from('brand_products').select('image_urls').eq('brand_id', (b as any).id)
  const productImages = ((prods || []) as any[])
    .flatMap((p) => p.image_urls || [])
    .filter((u: any) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, 4)
  return { id: (b as any).id, name: (b as any).name || null, brandType: (b as any).brand_type || 'physical', productImages }
}

/** A competitor's single best image ad + best video ad (by performance), with real R2 media. */
async function topAdsForPage(admin: SupabaseClient, pageId: string): Promise<{ image: TopAd | null; video: TopAd | null }> {
  const { data } = await admin.from('discovery_ads_index')
    .select('ad_id, title, days_running, performance_score, discovery_creatives(asset_type, r2_url, poster_url)')
    .eq('page_id', pageId)
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(20)
  let image: TopAd | null = null, video: TopAd | null = null
  for (const a of (data || []) as any[]) {
    const cre: any[] = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : []
    const vid = cre.find((c) => c?.asset_type === 'video' && c?.r2_url)
    const img = cre.find((c) => c?.asset_type === 'image' && c?.r2_url)
    if (!video && vid) video = { adId: String(a.ad_id), headline: a.title || null, media: vid.r2_url, days: a.days_running || null }
    if (!image && (img || vid?.poster_url)) image = { adId: String(a.ad_id), headline: a.title || null, media: img?.r2_url || vid?.poster_url || null, days: a.days_running || null }
    if (image && video) break
  }
  return { image, video }
}

/**
 * Propose today's tasks — RESEARCH, then (if the brand has product photos) CREATIVE + VIDEO off the
 * top competitor's winners. Capped at 4, deduped by key so a run/dismissed task never re-suggests.
 */
export async function suggestTasks(admin: SupabaseClient, userId: string, brandId?: string | null): Promise<TaskSuggestion[]> {
  const out: TaskSuggestion[] = []

  // Recent competitor launches (the alert-worker writes these). A burst = a real push worth studying.
  const { data: notifs } = await admin.from('notifications')
    .select('brand_name, page_id, ad_count, created_at')
    .eq('user_id', userId).eq('type', 'new_ad').gte('created_at', H72())
    .order('created_at', { ascending: false }).limit(30)

  // Which competitors already have a fresh report — don't re-suggest those.
  const { data: docs } = await admin.from('mello_documents')
    .select('subject, created_at').eq('user_id', userId).gte('created_at', D7()).limit(50)
  const reported = new Set((docs || []).map((d: any) => String(d.subject || '').toLowerCase().trim()).filter(Boolean))

  // Aggregate launches per competitor (page_id), summing the burst size.
  const byPage = new Map<string, { name: string; pageId: string; ads: number }>()
  for (const n of (notifs || []) as any[]) {
    const pid = String(n.page_id || '')
    if (!pid) continue
    const cur = byPage.get(pid) || { name: n.brand_name || 'A competitor', pageId: pid, ads: 0 }
    cur.ads += Number(n.ad_count) || 1
    byPage.set(pid, cur)
  }
  const ranked = Array.from(byPage.values()).sort((a, b) => b.ads - a.ads)

  // ── RESEARCH — the strongest signal first (a burst worth a full report) ──
  for (const c of ranked) {
    if (c.ads < 4) continue                                     // a real push, not routine rotation
    if (reported.has(c.name.toLowerCase().trim())) continue     // already reported this week
    out.push({
      kind: 'research',
      title: `Produce the ${c.name} intelligence report`,
      why: `${c.name} launched ${c.ads} ad${c.ads === 1 ? '' : 's'} in 48h — a real push, not rotation. You want their playbook before it compounds.`,
      evidence: { competitor: c.name, pageId: c.pageId, adCount: c.ads },
      credits: 50,
      suggested_key: `research:${c.pageId}:${isoDay()}`,
      brand_id: brandId || null,
    })
    if (out.length >= 2) break                                  // leave room for a creative + video move
  }

  // ── CREATIVE + VIDEO — need the reader's product photos to swap the brand in ──
  const brand = await resolveBrand(admin, userId, brandId)
  if (brand && brand.productImages.length > 0 && ranked.length) {
    // Anchor on the busiest competitor — the one whose momentum matters most today.
    const lead = ranked[0]
    const { image, video } = await topAdsForPage(admin, lead.pageId)

    if (image?.adId) {
      const runs = image.days && image.days >= 14 ? ` — it's been running ${image.days} days, so it's working` : ''
      out.push({
        kind: 'creative',
        title: `Make your version of ${lead.name}'s top ad`,
        why: `Their best-performing image ad${runs}. I'll rebuild its winning structure around ${brand.name || 'your product'} — your version, ready to launch.`,
        evidence: { competitor: lead.name, sourceAdId: image.adId, media: image.media, brandId: brand.id, productType: brand.brandType, format: 'image' },
        credits: null,   // priced by plan (free for subscribers) — clone-image reserves/commits its own
        suggested_key: `creative:${image.adId}:${isoDay()}`,
        brand_id: brand.id,
      })
    }
    if (video?.adId && brand.brandType !== 'service') {   // service-brand video needs a screencast we don't have here
      const runs = video.days && video.days >= 14 ? ` (running ${video.days} days)` : ''
      out.push({
        kind: 'video',
        title: `Recreate ${lead.name}'s top video`,
        why: `Their strongest video ad${runs}. I'll analyze it into a storyboard for ${brand.name || 'your product'} — you approve the plan before any video credits are spent.`,
        evidence: { competitor: lead.name, sourceAdId: video.adId, sourceVideoUrl: video.media, brandId: brand.id, productType: brand.brandType, format: 'video' },
        credits: null,   // storyboard is free; video is charged only on approve
        suggested_key: `video:${video.adId}:${isoDay()}`,
        brand_id: brand.id,
      })
    }
  }

  return out.slice(0, 4)
}
