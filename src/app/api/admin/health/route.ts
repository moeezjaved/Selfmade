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
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetch as undiciFetch } from 'undici'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  const now = new Date()
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  // ── Queue counts (parallelised) ──
  const [
    qTotal,
    qThumbed,
    qVideo,
    qFastReady,
    qMissing,
    qFailed,
  ] = await Promise.all([
    exactTotal(admin),
    countWhere(admin, ['thumbnail_url', 'not.is', null]),
    countWhere(admin, ['video_url', 'not.is', null]),
    countWhere(admin, ['raw_image_urls', 'not.is', null], ['thumbnail_url', 'is', null]),
    // "missing" = NO creative at all (no image thumbnail AND no video). A downloaded
    // video ad sets video_url (not thumbnail_url), so counting only thumbnail-null
    // wrongly showed 61K finished video ads as "missing".
    countWhere(admin, ['thumbnail_url', 'is', null], ['video_url', 'is', null]),
    countWhere(admin, ['creative_extraction_failed_at', 'not.is', null]),
  ])
  // ── ACCURATE creative coverage (post-Phase-2) ──────────────────────────────
  // The thumbnail_url/video_url counts above are LEGACY: the append-only worker
  // stopped writing those columns (creatives live in discovery_creatives now), so a
  // drained ad shows as "missing" by the old yardstick. Count the ads that ACTUALLY
  // have a creative row (RPC, migration 037), and report "pending" from the real
  // work-queue. Falls back to the legacy calc if the RPC isn't deployed yet.
  let qCreativeAds: number | null = null
  try {
    // Creative coverage = ads with has_creative=true. Use EXACT: the dai_has_creative partial index
    // makes a `has_creative=true` count an index-only scan (fast), and 'estimated' reltuples drifts
    // badly between ANALYZEs — it showed 611K when the real count was ~2.88M, making the dashboard
    // read "2.74M missing" when the true backlog was ~480K. Exact via the partial index is accurate
    // AND fast; fall back to estimated only if exact errors (e.g. transient load).
    let cc: number | null | undefined
    try {
      const { count, error } = await admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).eq('has_creative', true)
      if (!error) cc = count
    } catch { /* fall through to estimate */ }
    if (cc == null) {
      const { count } = await admin.from('discovery_ads_index').select('*', { count: 'estimated', head: true }).eq('has_creative', true)
      cc = count
    }
    if (typeof cc === 'number' && cc > 0) qCreativeAds = cc
  } catch { /* fall back to legacy estimate below */ }
  let qPending = 0
  try {
    const { count } = await admin.from('creative_queue').select('*', { count: 'exact', head: true })
    qPending = count ?? 0
  } catch { /* creative_queue absent → 0 */ }

  // "with creative" = ads with a real creative row (accurate) — else legacy estimate.
  const qWithCreative = qCreativeAds ?? Math.max(0, qTotal - qMissing)
  // Real "no creative yet" = total − with_creative (replaces the stale thumbnail calc).
  const qMissingReal = qCreativeAds != null ? Math.max(0, qTotal - qCreativeAds) : qMissing

  // ── Crawler runs (1h + 24h) ──
  const [{ data: runs1h }, { data: runs24h }] = await Promise.all([
    admin.from('crawler_runs').select('id, status').gte('started_at', hourAgo).limit(500),
    admin.from('crawler_runs')
      .select('id, brand_name, started_at, finished_at, ads_discovered, ads_new, bytes_through_proxy, status, abort_reason')
      .gte('started_at', dayAgo)
      .order('started_at', { ascending: false })
      .limit(50),
  ])

  // ── Currently-running crawler (if any) ──
  const { data: runningRows } = await admin
    .from('crawler_runs')
    .select('brand_name, brand_page_id, started_at')
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(1)
  const currentlyRunning = runningRows?.[0] ?? null

  const successPct = (rows: any[] | null) => {
    if (!rows || rows.length === 0) return null
    // Exclude in-flight 'running' crawls — at high concurrency there are always
    // ~N running at any snapshot, and counting them as failures tanked the rate
    // (showed 58% when real completion was ~98%). Rate over COMPLETED runs only.
    const done = rows.filter(r => r.status !== 'running')
    if (done.length === 0) return null
    const ok = done.filter(r => r.status === 'success').length
    return Math.round((ok / done.length) * 100)
  }

  const successRate1h = successPct(runs1h ?? [])
  const successRate24h = successPct(runs24h ?? [])

  const indexerBandwidth24h = (runs24h ?? []).reduce((s: number, r: any) => s + (r.bytes_through_proxy ?? 0), 0)
  const adsDiscovered24h = (runs24h ?? []).reduce((s: number, r: any) => s + (r.ads_discovered ?? 0), 0)
  const lastSuccessAt = (runs24h ?? []).find((r: any) => r.status === 'success')?.started_at ?? null
  const lastRunAt = (runs24h ?? [])[0]?.started_at ?? null

  // ── Worker bandwidth (24h) — newly tracked per migration 014 ──
  const { data: workerRuns24h } = await admin
    .from('worker_runs')
    .select('bytes_proxy, bytes_droplet, ads_ok, ads_failed, finished_at')
    .gte('finished_at', dayAgo)
    .limit(2000)
  const workerBytesProxy24h = (workerRuns24h ?? []).reduce((s: number, r: any) => s + Number(r.bytes_proxy ?? 0), 0)
  const workerBytesDroplet24h = (workerRuns24h ?? []).reduce((s: number, r: any) => s + Number(r.bytes_droplet ?? 0), 0)

  // Total IPRoyal bandwidth = indexer (page loads) + worker (image downloads).
  // Videos go via droplet so they do NOT count here.
  const totalProxyBytes24h = indexerBandwidth24h + workerBytesProxy24h
  const bandwidth24h = totalProxyBytes24h   // keep variable name for back-compat

  // ── Per-brand snapshot (top 10 oldest-first active brands) ──
  const { data: brandList } = await admin
    .from('discovery_crawl_terms')
    .select('term, page_id, last_crawled_at, is_active')
    .eq('is_active', true)
    .not('page_id', 'is', null)
    .order('last_crawled_at', { ascending: true, nullsFirst: true })
    .limit(20)

  // ── Next-crawl ETA computation ──
  // Scheduler picks oldest last_crawled_at first, with 45-min min gap per brand
  // (SCHEDULER_MIN_BRAND_GAP_MIN). Scheduler also pauses 3 min between brand runs
  // (SCHEDULER_BETWEEN_PAUSE_MIN). We approximate "when will the next crawl start".
  const SCHEDULER_GAP_MIN = parseInt(process.env.SCHEDULER_MIN_BRAND_GAP_MIN ?? '45', 10)
  const nextBrand = (brandList ?? [])[0] as any
  let nextCrawl: any = null
  if (nextBrand) {
    if (nextBrand.last_crawled_at === null) {
      nextCrawl = {
        brand: nextBrand.term,
        page_id: nextBrand.page_id,
        eligible_at: now.toISOString(),
        eta_seconds: 0,
        reason: 'never crawled — picked next cycle',
      }
    } else {
      const lastMs = new Date(nextBrand.last_crawled_at).getTime()
      const eligibleMs = lastMs + SCHEDULER_GAP_MIN * 60_000
      const etaSeconds = Math.max(0, Math.round((eligibleMs - Date.now()) / 1000))
      nextCrawl = {
        brand: nextBrand.term,
        page_id: nextBrand.page_id,
        eligible_at: new Date(eligibleMs).toISOString(),
        eta_seconds: etaSeconds,
        reason: etaSeconds > 0 ? `cooldown — ${SCHEDULER_GAP_MIN}m gap per brand` : 'eligible — waiting for scheduler tick',
      }
    }
  }

  const brandStats: any[] = []
  for (const b of (brandList ?? []).slice(0, 10) as any[]) {
    const [thumbed, fastReady, missing, failed] = await Promise.all([
      countWhere(admin, ['page_id', 'eq', b.page_id], ['thumbnail_url', 'not.is', null]),
      countWhere(admin, ['page_id', 'eq', b.page_id], ['raw_image_urls', 'not.is', null], ['thumbnail_url', 'is', null]),
      countWhere(admin, ['page_id', 'eq', b.page_id], ['thumbnail_url', 'is', null]),
      countWhere(admin, ['page_id', 'eq', b.page_id], ['creative_extraction_failed_at', 'not.is', null]),
    ])

    // ── Per-brand "fully crawled" ETA ──
    // Pull the brand's last 5 successful crawler_runs. Count avg new ads
    // per crawl. If recent crawls return ~0 new ads → brand is fully crawled.
    // Otherwise estimate remaining crawls + multiply by 45-min cooldown.
    const { data: brandRecentRuns } = await admin
      .from('crawler_runs')
      .select('ads_new, started_at')
      .eq('brand_page_id', b.page_id)
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(5)
    const recent = (brandRecentRuns ?? []) as any[]
    let crawl_eta: any = null
    if (recent.length === 0) {
      crawl_eta = { status: 'no_data', label: 'never crawled', avg_new_per_crawl: null, est_minutes: null }
    } else if (recent.length === 1) {
      crawl_eta = { status: 'estimating', label: `need 2+ crawls (${recent[0].ads_new} on first)`, avg_new_per_crawl: recent[0].ads_new, est_minutes: null }
    } else {
      // Use only the last 3 crawls for avg (recency-weighted) so the first
      // crawl's "all 30 are new" outlier doesn't pollute the estimate after
      // the brand is actually caught up.
      const recentForAvg = recent.slice(0, 3)
      const avgNew = recentForAvg.reduce((s, r) => s + (r.ads_new ?? 0), 0) / recentForAvg.length
      const lastCrawlNew = recent[0].ads_new ?? 0
      const lastTwoNew = (recent[0].ads_new ?? 0) + (recent[1]?.ads_new ?? 0)
      const SCHEDULER_GAP_MIN = parseInt(process.env.SCHEDULER_MIN_BRAND_GAP_MIN ?? '45', 10)

      // Caught-up rule: last crawl returned ≤2 new OR last two crawls combined ≤5 new.
      // Doesn't care about the average — earlier first-crawl outliers shouldn't
      // override evidence that the brand is now stable.
      if (lastCrawlNew <= 2 || lastTwoNew <= 5) {
        crawl_eta = { status: 'caught_up', label: 'fully crawled', avg_new_per_crawl: Math.round(avgNew * 10) / 10, est_minutes: 0 }
      } else if (lastCrawlNew >= 25) {
        // Last crawl still finding lots of new ads — many crawls left
        crawl_eta = { status: 'progressing', label: 'still discovering — many crawls left', avg_new_per_crawl: Math.round(avgNew * 10) / 10, est_minutes: null }
      } else {
        // 3-24 new on last crawl — extrapolate using diminishing-returns curve.
        const remainingCrawls = Math.max(1, Math.ceil(Math.log2(Math.max(1, lastCrawlNew))))
        const estMinutes = remainingCrawls * SCHEDULER_GAP_MIN
        crawl_eta = { status: 'estimating', label: `~${remainingCrawls} more crawl${remainingCrawls === 1 ? '' : 's'}`, avg_new_per_crawl: Math.round(avgNew * 10) / 10, est_minutes: estMinutes }
      }
    }

    brandStats.push({
      term: b.term,
      page_id: b.page_id,
      last_crawled_at: b.last_crawled_at,
      thumbed,
      fastReady,
      missing,
      failed,
      crawl_eta,
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
    .select('*', { count: 'estimated', head: true })
    .gte('indexed_at', hourAgo)
    .not('thumbnail_url', 'is', null)
  const worker_status: 'up' | 'idle' | 'unknown' =
    recentThumbs === null ? 'unknown'
    : recentThumbs > 0 ? 'up' : 'idle'

  // ── DB write health — latency probe + bloat % (is the DB keeping up with writes?) ──
  let db_health: any = null
  try {
    const t0 = Date.now()
    await admin.from('discovery_ads_index').select('ad_id').limit(1)
    const probe_ms = Date.now() - t0
    const { data: dbh } = await admin.rpc('db_write_health')
    const r = Array.isArray(dbh) ? dbh[0] : dbh
    db_health = {
      probe_ms,
      dead_pct: r ? Number(r.dead_pct) || 0 : null,
      live: r ? Number(r.live) || 0 : null,
      dead: r ? Number(r.dead) || 0 : null,
      last_autovacuum: r?.last_autovacuum ?? null,
      table_mb: r?.table_bytes ? Math.round(Number(r.table_bytes) / 1024 / 1024) : null,
    }
  } catch { db_health = null }

  // ── Nightly rollup status (written by worker/src/nightly-rollup.mjs) ──
  const { data: rollupRow } = await admin
    .from('discovery_rollup_status')
    .select('ran_at, total_rows, winners, bad_winners, fail_chunks, wrote, fetch_s, write_s, total_s')
    .eq('id', 1)
    .maybeSingle()
  const rollupAgeHours = rollupRow?.ran_at
    ? (Date.now() - new Date(rollupRow.ran_at).getTime()) / 3_600_000
    : null
  // Cron runs 04:15 daily; >26h since last completion means it missed a night.
  const rollupStale = rollupAgeHours === null || rollupAgeHours > 26
  const nightly_rollup = rollupRow ? {
    ran_at: rollupRow.ran_at,
    age_hours: rollupAgeHours !== null ? Math.round(rollupAgeHours * 10) / 10 : null,
    stale: rollupStale,
    total_rows: rollupRow.total_rows,
    winners: rollupRow.winners,
    bad_winners: rollupRow.bad_winners,
    fail_chunks: rollupRow.fail_chunks,
    wrote: rollupRow.wrote,
    fetch_s: rollupRow.fetch_s,
    write_s: rollupRow.write_s,
    total_s: rollupRow.total_s,
  } : null

  // ── Health alerts ──
  const alerts: { level: 'critical' | 'warning' | 'info'; message: string }[] = []
  if (!rollupRow) {
    alerts.push({ level: 'warning', message: 'Nightly rollup has never reported a status (migration 027 + droplet cron not yet run?).' })
  } else if (rollupStale) {
    alerts.push({ level: 'critical', message: `Nightly rollup hasn't completed in ${rollupAgeHours !== null ? Math.round(rollupAgeHours) : '∞'}h — days_running / Winner Score going stale.` })
  }
  if (rollupRow && rollupRow.bad_winners > 0) {
    alerts.push({ level: 'critical', message: `Nightly rollup REGRESSION: ${rollupRow.bad_winners} "winning" ads are under 14 days old — the longevity gate leaked.` })
  }
  if (rollupRow && rollupRow.fail_chunks > 0) {
    alerts.push({ level: 'critical', message: `Nightly rollup: ${rollupRow.fail_chunks} write chunk(s) failed — performance scores partially stale.` })
  }
  if (db_health?.dead_pct != null && db_health.dead_pct > 30) {
    alerts.push({ level: 'warning', message: `DB bloat at ${db_health.dead_pct}% dead rows — autovacuum is falling behind the write load. Ease crawl concurrency.` })
  }
  if (db_health?.probe_ms != null && db_health.probe_ms > 5000) {
    alerts.push({ level: 'critical', message: `DB read latency ${(db_health.probe_ms / 1000).toFixed(1)}s — the database is struggling. Pause/throttle writers.` })
  }
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
      video: qVideo,
      with_creative: qWithCreative,
      fast_path_ready: qFastReady,
      // accurate "no creative yet" (from discovery_creatives, not the dead thumbnail
      // column) + the real drainable backlog sitting in the work-queue.
      missing: qMissingReal,
      pending: qPending,
      failed: qFailed,
      thumbed_pct: qTotal > 0 ? Math.round((qWithCreative / qTotal) * 1000) / 10 : 0,
    },
    activity: {
      runs_1h: (runs1h ?? []).length,
      runs_24h: (runs24h ?? []).length,
      success_rate_1h_pct: successRate1h,
      success_rate_24h_pct: successRate24h,
      bandwidth_24h_bytes: bandwidth24h,
      bandwidth_24h_mb: Math.round(bandwidth24h / 1024 / 1024 * 10) / 10,
      // ── Bandwidth split (24h) — accurate accounting per migration 014 ──
      bandwidth_indexer_proxy_mb: Math.round(indexerBandwidth24h / 1024 / 1024 * 10) / 10,
      bandwidth_worker_proxy_mb: Math.round(workerBytesProxy24h / 1024 / 1024 * 10) / 10,
      bandwidth_worker_droplet_mb: Math.round(workerBytesDroplet24h / 1024 / 1024 * 10) / 10,
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
    currently_running: currentlyRunning ? {
      brand: (currentlyRunning as any).brand_name ?? null,
      page_id: (currentlyRunning as any).brand_page_id ?? null,
      started_at: (currentlyRunning as any).started_at,
      elapsed_seconds: Math.round((Date.now() - new Date((currentlyRunning as any).started_at).getTime()) / 1000),
    } : null,
    next_crawl: nextCrawl,
    nightly_rollup,
    db_health,
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

// TOTAL is the headline number, so it must be truthful — NOT the reltuples estimate, which drifts
// high after brand-culling deletes (it read 3.06M when the exact count was 2.59M). An unfiltered
// count(*) is a single index/heap scan (~1-2s); if it times out under heavy crawl-write load we fall
// back to the estimate so the dashboard still renders rather than 504-ing.
async function exactTotal(admin: any): Promise<number> {
  try {
    const { count, error } = await admin
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })
    if (!error && typeof count === 'number' && count > 0) return count
  } catch { /* fall through to the estimate */ }
  return countWhere(admin)
}

async function countWhere(admin: any, ...filters: [string, string, any][]): Promise<number> {
  // 'estimated' (planner stats, not a full scan) — exact counts on a 160K+ row
  // table under heavy crawl-write load were timing out the whole route (504).
  // Approximate counts are fine for an at-a-glance health dashboard.
  let q = admin.from('discovery_ads_index').select('*', { count: 'estimated', head: true })
  for (const [col, op, val] of filters) {
    if (op === 'is') q = q.is(col, val)
    else if (op === 'not.is') q = q.not(col, 'is', val)
    else if (op === 'eq') q = q.eq(col, val)
  }
  const { count } = await q
  return count ?? 0
}
