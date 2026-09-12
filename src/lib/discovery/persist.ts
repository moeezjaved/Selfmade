/**
 * Durably save pulled competitor live ads into the shared discovery library, so they survive the ad going
 * down and power the Discover feed for every user. Mirrors the proven Brand-Spy pull path EXACTLY:
 *   · ad metadata → `discovery_ads_index` (upsert by ad_id — additive, never clobbers crawler rows)
 *   · each ad's IMAGE → download to R2 → `discovery_creatives` (which flips has_creative → shows in Discover)
 *
 * Images only (competitor-library scope). Best-effort + capped; call inside waitUntil so the pull stays fast.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { uploadBufferToR2, isR2Configured } from '@/lib/r2'
import type { LiveAd } from '@/lib/ads-studio/adlibrary'

const MAX_SAVE = 200   // cap creatives rehosted per pull (generous — a brand's whole live set; bounded for safety)

export async function persistPulledAds(
  admin: ReturnType<typeof createAdminClient>,
  pageId: string,
  pageName: string,
  ads: LiveAd[],
  opts: { imagesOnly?: boolean } = {},
): Promise<{ saved: number; rehosted: number }> {
  const imagesOnly = opts.imagesOnly !== false   // default true
  // Keep only ads that carry a real image creative (skip pure-video when imagesOnly).
  const list = (ads || []).filter((a) => (a.images?.length || (!imagesOnly && a.videos?.length)))
  if (!list.length || !pageId) return { saved: 0, rehosted: 0 }
  const nowIso = new Date().toISOString()

  // 1. Ad metadata → discovery_ads_index (upsert by ad_id; additive). Mirrors brand-spy's row shape.
  const rows = list.map((a) => ({
    ad_id: a.adId, page_id: pageId, page_name: a.pageName || pageName,
    body: a.body || null, title: a.title || null,
    is_active: a.isActive, format: (a.videos?.length ? 'video' : 'image'),
    link_url: a.link || null, snapshot_url: `https://www.facebook.com/ads/library/?id=${a.adId}`,
    raw_image_urls: a.images?.length ? a.images : null,
    raw_video_urls: a.videos?.length ? a.videos : null,
    raw_video_preview_urls: a.videoPreviews?.length ? a.videoPreviews : null,
    last_seen: nowIso,
  }))
  await admin.from('discovery_ads_index').upsert(rows, { onConflict: 'ad_id' }).then(() => {}, () => {})

  // 2. Each ad's first IMAGE → permanent R2 → discovery_creatives (flips has_creative → surfaces in Discover).
  if (!isR2Configured()) return { saved: rows.length, rehosted: 0 }
  let rehosted = 0
  for (const a of list.slice(0, MAX_SAVE)) {
    const img = a.images?.[0] || a.videoPreviews?.[0]
    if (!img) continue
    try {
      const r = await fetch(img, { signal: AbortSignal.timeout(15_000) })
      if (!r.ok) continue
      const buf = Buffer.from(await r.arrayBuffer())
      if (!buf.length || buf.length > 30 * 1024 * 1024) continue
      const u = await uploadBufferToR2(buf, `discovery/spy/${a.adId}-0.jpg`, 'image/jpeg')
      if (u) {
        await admin.from('discovery_creatives')
          .upsert({ ad_id: a.adId, position: 0, asset_type: 'image', r2_url: u }, { onConflict: 'ad_id,position,asset_type' })
          .then(() => { rehosted++ }, () => {})
      }
    } catch { /* best-effort per ad */ }
  }
  return { saved: rows.length, rehosted }
}
