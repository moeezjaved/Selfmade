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
      .not('snapshot_url', 'is', null),
    admin
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })
      .like('thumbnail_url', '%r2.dev%'),
    admin
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })
      .like('video_url', '%r2.dev%'),
    // Recent successfully-processed ads for visual confirmation
    admin
      .from('discovery_ads_index')
      .select('ad_id, page_name, thumbnail_url, video_url, format, last_seen')
      .like('thumbnail_url', '%r2.dev%')
      .order('last_seen', { ascending: false })
      .limit(12),
  ])

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
      progress_pct: totalAds && totalAds > 0
        ? Math.round((((totalAds ?? 0) - (queueRemaining ?? 0)) / (totalAds ?? 1)) * 100)
        : 0,
      live_worker_count: liveWorkers.length,
      total_workers_seen: workers.length,
      aggregate_ads_per_min: parseFloat(aggregateAdsPerMin.toFixed(1)),
      eta_minutes: etaMinutes,
    },
    workers,
    recent_samples: recentSamples || [],
  })
}
