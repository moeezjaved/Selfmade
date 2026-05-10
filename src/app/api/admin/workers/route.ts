/**
 * Admin Workers API — status of self-hosted creative-extraction workers.
 * Reads worker_heartbeats + computes queue stats from discovery_ads_index.
 *
 * GET /api/admin/workers
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Fire all queries in parallel
  const [
    { data: heartbeats },
    { count: totalAds },
    { count: queueRemaining },
    { count: imagesProcessed },
    { count: videosProcessed },
    { data: uniqueImageHashes },
    { data: uniqueVideoHashes },
    { data: recentSamples },
  ] = await Promise.all([
    admin
      .from('worker_heartbeats')
      .select('*')
      .order('last_active_at', { ascending: false }),
    admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }),
    admin
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })
      .is('thumbnail_url', null)
      .is('video_url', null)
      .not('snapshot_url', 'is', null),
    admin
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })
      .like('thumbnail_url', '%r2.dev%'),
    admin
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })
      .like('video_url', '%r2.dev%'),
    // Approximate unique creative count via distinct hashes
    admin
      .from('discovery_ads_index')
      .select('image_hash')
      .not('image_hash', 'is', null)
      .limit(50_000),
    admin
      .from('discovery_ads_index')
      .select('video_hash')
      .not('video_hash', 'is', null)
      .limit(50_000),
    // Pull a larger pool of recent processed ads — we'll dedupe by hash below
    admin
      .from('discovery_ads_index')
      .select('ad_id, page_name, thumbnail_url, video_url, image_hash, video_hash, format, last_seen')
      .or('thumbnail_url.like.%r2.dev%,video_url.like.%r2.dev%')
      .order('last_seen', { ascending: false })
      .limit(400),
  ])

  // Count unique hashes for "creative" stats (after dedup)
  const uniqueImages = new Set((uniqueImageHashes || []).map((r: any) => r.image_hash)).size
  const uniqueVideos = new Set((uniqueVideoHashes || []).map((r: any) => r.video_hash)).size

  // Group recent samples by hash so the visual grid shows unique creatives
  // (not 50 cards for the same image). Each entry includes ad_count.
  const groups = new Map<string, any>()
  for (const ad of (recentSamples || []) as any[]) {
    // Prefer image_hash, fall back to video_hash, fall back to ad_id (no dedup)
    const key = ad.image_hash || ad.video_hash || `_${ad.ad_id}`
    const existing = groups.get(key)
    if (existing) {
      existing.ad_count++
      // Keep most recent per group (first one is already most recent due to order)
    } else {
      groups.set(key, { ...ad, ad_count: 1 })
    }
  }
  const dedupedSamples = Array.from(groups.values()).slice(0, 60)

  // Tag each worker as live (heartbeat < 2 min old)
  const now = Date.now()
  const workers: any[] = (heartbeats || []).map((h: any) => {
    const lastActive = new Date(h.last_active_at).getTime()
    const ageSeconds = Math.floor((now - lastActive) / 1000)
    return {
      ...h,
      is_live: ageSeconds < 120,
      seconds_since_heartbeat: ageSeconds,
    }
  })

  const liveWorkers = workers.filter((w: any) => w.is_live)
  const aggregateAdsPerMin = liveWorkers.reduce((sum: number, w: any) => sum + (Number(w.ads_per_min) || 0), 0)
  const totalProcessed = (imagesProcessed ?? 0) + (videosProcessed ?? 0)

  // ETA: queue / aggregate rate
  const etaMinutes = aggregateAdsPerMin > 0 && (queueRemaining ?? 0) > 0
    ? Math.round((queueRemaining ?? 0) / aggregateAdsPerMin)
    : null

  return NextResponse.json({
    summary: {
      total_ads: totalAds ?? 0,
      queue_remaining: queueRemaining ?? 0,
      images_processed: imagesProcessed ?? 0,
      videos_processed: videosProcessed ?? 0,
      unique_images: uniqueImages,
      unique_videos: uniqueVideos,
      dedup_ratio_images: imagesProcessed && uniqueImages
        ? parseFloat((imagesProcessed / uniqueImages).toFixed(1))
        : 1,
      dedup_ratio_videos: videosProcessed && uniqueVideos
        ? parseFloat((videosProcessed / uniqueVideos).toFixed(1))
        : 1,
      progress_pct: totalAds && totalAds > 0
        ? Math.round((((totalAds ?? 0) - (queueRemaining ?? 0)) / (totalAds ?? 1)) * 100)
        : 0,
      live_worker_count: liveWorkers.length,
      total_workers_seen: workers.length,
      aggregate_ads_per_min: parseFloat(aggregateAdsPerMin.toFixed(1)),
      eta_minutes: etaMinutes,
    },
    workers,
    recent_samples: dedupedSamples,
  })
}
