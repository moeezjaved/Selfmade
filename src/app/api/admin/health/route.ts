/**
 * Health metrics API for the /admin/health dashboard.
 *
 * Aggregates everything the operator wants to see on one page:
 *   - Queue overview (totals + breakdown by state)
 *   - Last 1h and 24h crawler activity (success rate, bandwidth, ads found)
 *   - Per-brand progress (top 10 active brands)
 *   - Recent crawler runs (last 10)
 *   - Worker / scheduler / preview-server liveness (pings the droplet
 *     /health endpoint AND looks at recent activity timestamps)
 *
 * Designed to be polled every 30s by the dashboard page.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetch as undiciFetch } from 'undici'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  const now = new Date()
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  // ── Queue counts (parallelised) ──
  const [
    qTotal,
    qThumbed,
    qFastReady,
    qMissing,
    qFailed,
  ] = await Promise.all([
    countWhere(admin),
    countWhere(admin, ['thumbnail_url', 'not.is', null]),
    countWhere(admin, ['raw_image_urls', 'not.is', null], ['thumbnail_url', 'is', null]),
    countWhere(admin, ['thumbnail_url', 'is', null]),
    countWhere(admin, ['creative_extraction_failed_at', 'not.is', null]),
  ])

  // ── Crawler runs (1h + 24h) ──
  const [{ data: runs1h }, { data: runs24h }] = await Promise.all([
    admin.from('crawler_runs').select('id, status').gte('started_at', hourAgo).limit(500),
    admin.from('crawler_runs')
      .select('id, brand_name, started_at, finished_at, ads_discovered, ads_new, bytes_through_proxy, status, abort_reason')
      .gte('started_at', dayAgo)
      .order('started_at', { ascending: false })
      .limit(50),
  ])

  const successPct = (rows: any[] | null) => {
    if (!rows || rows.length === 0) return null
    const ok = rows.filter(r => r.status === 'success').length
    return Math.round((ok / rows.length) * 100)
  }

  const successRate1h = successPct(runs1h ?? [])
  const successRate24h = successPct(runs24h ?? [])

  const bandwidth24h = (runs24h ?? []).reduce((s: number, r: any) => s + (r.bytes_through_proxy ?? 0), 0)
  const adsDiscovered24h = (runs24h ?? []).reduce((s: number, r: any) => s + (r.ads_discovered ?? 0), 0)
  const lastSuccessAt = (runs24h ?? []).find((r: any) => r.status === 'success')?.started_at ?? null
  const lastRunAt = (runs24h ?? [])[0]?.started_at ?? null

  // ── Per-brand snapshot (top 10 oldest-first active brands) ──
  const { data: brandList } = await admin
    .from('discovery_crawl_terms')
    .select('term, page_id, last_crawled_at, is_active')
    .eq('is_active', true)
    .not('page_id', 'is', null)
    .order('last_crawled_at', { ascending: true, nullsFirst: true })
    .limit(20)

  const brandStats: any[] = []
  for (const b of (brandList ?? []).slice(0, 10) as any[]) {
    const [thumbed, fastReady, missing, failed] = await Promise.all([
      countWhere(admin, ['page_id', 'eq', b.page_id], ['thumbnail_url', 'not.is', null]),
      countWhere(admin, ['page_id', 'eq', b.page_id], ['raw_image_urls', 'not.is', null], ['thumbnail_url', 'is', null]),
      countWhere(admin, ['page_id', 'eq', b.page_id], ['thumbnail_url', 'is', null]),
      countWhere(admin, ['page_id', 'eq', b.page_id], ['creative_extraction_failed_at', 'not.is', null]),
    ])
    brandStats.push({
      term: b.term,
      page_id: b.page_id,
      last_crawled_at: b.last_crawled_at,
      thumbed,
      fastReady,
      missing,
      failed,
    })
  }

  // ── Liveness check: ping droplet preview-server /health ──
  let preview_server_status: 'up' | 'down' | 'unknown' = 'unknown'
  let preview_server_latency_ms: number | null = null
  if (process.env.DROPLET_PREVIEW_URL) {
    const t0 = Date.now()
    try {
      const r = await undiciFetch(`${process.env.DROPLET_PREVIEW_URL.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      preview_server_status = r.ok ? 'up' : 'down'
      preview_server_latency_ms = Date.now() - t0
    } catch {
      preview_server_status = 'down'
      preview_server_latency_ms = Date.now() - t0
    }
  }

  // Worker + scheduler liveness inferred from recent activity
  // (we don't have direct daemon health endpoints — use crawler_runs as proxy)
  const minutesSinceLastRun = lastRunAt
    ? (Date.now() - new Date(lastRunAt).getTime()) / 60_000
    : null
  const scheduler_status: 'up' | 'down' | 'unknown' =
    minutesSinceLastRun === null ? 'unknown'
    : minutesSinceLastRun < 60 ? 'up' : 'down'

  // Worker liveness: check if any thumbnails were added in last hour
  const { count: recentThumbs } = await admin
    .from('discovery_ads_index')
    .select('*', { count: 'exact', head: true })
    .gte('indexed_at', hourAgo)
    .not('thumbnail_url', 'is', null)
  const worker_status: 'up' | 'idle' | 'unknown' =
    recentThumbs === null ? 'unknown'
    : recentThumbs > 0 ? 'up' : 'idle'

  // ── Health alerts ──
  const alerts: { level: 'critical' | 'warning' | 'info'; message: string }[] = []
  if (preview_server_status === 'down') {
    alerts.push({ level: 'critical', message: 'Preview-server droplet unreachable — admin preview button will fail.' })
  }
  if (scheduler_status === 'down') {
    alerts.push({ level: 'critical', message: `Scheduler hasn't run in ${Math.round(minutesSinceLastRun!)} minutes.` })
  }
  if (successRate24h !== null && successRate24h < 50) {
    alerts.push({ level: 'warning', message: `24h crawler success rate is ${successRate24h}%.` })
  }
  if (qFastReady === 0 && qMissing > 100) {
    alerts.push({ level: 'warning', message: 'No fast-path-ready ads in queue — indexer not populating raw URLs.' })
  }

  return NextResponse.json({
    timestamp: now.toISOString(),
    queue: {
      total: qTotal,
      thumbed: qThumbed,
      fast_path_ready: qFastReady,
      missing: qMissing,
      failed: qFailed,
      thumbed_pct: qTotal > 0 ? Math.round((qThumbed / qTotal) * 1000) / 10 : 0,
    },
    activity: {
      runs_1h: (runs1h ?? []).length,
      runs_24h: (runs24h ?? []).length,
      success_rate_1h_pct: successRate1h,
      success_rate_24h_pct: successRate24h,
      bandwidth_24h_bytes: bandwidth24h,
      bandwidth_24h_mb: Math.round(bandwidth24h / 1024 / 1024 * 10) / 10,
      ads_discovered_24h: adsDiscovered24h,
      last_run_at: lastRunAt,
      last_success_at: lastSuccessAt,
      minutes_since_last_run: minutesSinceLastRun !== null ? Math.round(minutesSinceLastRun) : null,
    },
    daemons: {
      preview_server: {
        status: preview_server_status,
        latency_ms: preview_server_latency_ms,
        url: process.env.DROPLET_PREVIEW_URL ?? null,
      },
      scheduler: {
        status: scheduler_status,
        note: 'Inferred from crawler_runs activity in last 60 min',
      },
      worker: {
        status: worker_status,
        recent_thumbnails_added: recentThumbs ?? 0,
        note: 'Inferred from new thumbnails added in last 60 min',
      },
    },
    brands: brandStats,
    recent_runs: (runs24h ?? []).slice(0, 10).map((r: any) => ({
      brand_name: r.brand_name,
      started_at: r.started_at,
      finished_at: r.finished_at,
      duration_s: r.finished_at && r.started_at
        ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)
        : null,
      ads_discovered: r.ads_discovered,
      ads_new: r.ads_new,
      bytes: r.bytes_through_proxy,
      status: r.status,
      abort_reason: r.abort_reason,
    })),
    alerts,
  })
}

async function countWhere(admin: any, ...filters: [string, string, any][]): Promise<number> {
  let q = admin.from('discovery_ads_index').select('*', { count: 'exact', head: true })
  for (const [col, op, val] of filters) {
    if (op === 'is') q = q.is(col, val)
    else if (op === 'not.is') q = q.not(col, 'is', val)
    else if (op === 'eq') q = q.eq(col, val)
  }
  const { count } = await q
  return count ?? 0
}
