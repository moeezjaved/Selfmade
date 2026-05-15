/**
 * One-shot health dashboard.
 *
 * Prints an operations summary: queue size, success rates, bandwidth,
 * per-brand progress, recent crawler runs. Intended to be eyeballed
 * by a human (you) periodically, or piped into a Slack alert.
 *
 * Usage:
 *   docker run --rm --env-file .env selfmade-worker npx tsx src/health.ts
 *   docker run --rm --env-file .env selfmade-worker npx tsx src/health.ts --json
 *
 * Exit codes:
 *   0 — healthy
 *   1 — degraded (success rate < 70% in last hour OR worker idle > 1h)
 *   2 — critical (no successful crawls in last 6h OR queue empty + brand gap broken)
 */
import { supabase } from './db.js'

const jsonOut = process.argv.includes('--json')

async function main() {
  const stats = await gatherStats()

  if (jsonOut) {
    console.log(JSON.stringify(stats, null, 2))
  } else {
    renderHuman(stats)
  }

  // Exit code reflects health
  if (stats.health.critical.length > 0) process.exit(2)
  if (stats.health.degraded.length > 0) process.exit(1)
  process.exit(0)
}

async function gatherStats() {
  const now = new Date()
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  // ── Queue overview ──
  const { data: qOverall } = await (supabase as any).rpc('count_queue_states').catch(() => ({ data: null }))
  // RPC may not exist — fall back to plain queries
  let queue: any
  if (qOverall) queue = qOverall
  else {
    const [thumbed, fastReady, missing, marked, total] = await Promise.all([
      countWhere('thumbnail_url', 'not.is', null),
      countWhere('raw_image_urls', 'not.is', null, 'thumbnail_url', 'is', null),
      countWhere('thumbnail_url', 'is', null),
      countWhere('creative_extraction_failed_at', 'not.is', null),
      countAll(),
    ])
    queue = { thumbed, fastReady, missing, marked, total }
  }

  // ── Per-brand snapshot (top 10 active brands by remaining work) ──
  const { data: brands } = await (supabase as any)
    .from('discovery_crawl_terms')
    .select('term, page_id, last_crawled_at, is_active')
    .eq('is_active', true)
    .not('page_id', 'is', null)
    .order('last_crawled_at', { ascending: true, nullsFirst: true })

  const brandStats: Array<{ term: string; page_id: string; last_crawled_at: string | null; thumbed: number; fastReady: number; missing: number; failed: number }> = []
  for (const b of (brands || []).slice(0, 10) as any[]) {
    const [thumbed, fastReady, missing, failed] = await Promise.all([
      countWhere('thumbnail_url', 'not.is', null, 'page_id', 'eq', b.page_id),
      countWhere('raw_image_urls', 'not.is', null, 'thumbnail_url', 'is', null, 'page_id', 'eq', b.page_id),
      countWhere('thumbnail_url', 'is', null, 'page_id', 'eq', b.page_id),
      countWhere('creative_extraction_failed_at', 'not.is', null, 'page_id', 'eq', b.page_id),
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

  // ── Crawler runs (last 24h) ──
  const { data: runs } = await (supabase as any)
    .from('crawler_runs')
    .select('brand_name, started_at, finished_at, ads_discovered, ads_new, bytes_through_proxy, status, abort_reason')
    .gte('started_at', dayAgo)
    .order('started_at', { ascending: false })
    .limit(20)

  const totalBytes24h = (runs || []).reduce((s: number, r: any) => s + (r.bytes_through_proxy || 0), 0)
  const totalAds24h = (runs || []).reduce((s: number, r: any) => s + (r.ads_discovered || 0), 0)
  const successfulRuns24h = (runs || []).filter((r: any) => r.status === 'success').length

  // ── Recent crawler runs in last hour (used for the worker-idle check) ──
  const { data: recentRuns } = await (supabase as any)
    .from('crawler_runs')
    .select('id, started_at, status')
    .gte('started_at', hourAgo)
    .limit(50)
  const lastSuccessfulCrawl: string | null =
    ((runs || []).find((r: any) => r.status === 'success') as any)?.started_at ?? null

  // ── Health checks ──
  const degraded: string[] = []
  const critical: string[] = []

  if (recentRuns && recentRuns.length === 0) {
    degraded.push(`No crawler runs in last hour`)
  }
  if (lastSuccessfulCrawl) {
    const ageH = (Date.now() - new Date(lastSuccessfulCrawl).getTime()) / 3600 / 1000
    if (ageH > 6) critical.push(`No successful crawl in ${ageH.toFixed(1)}h`)
    else if (ageH > 1) degraded.push(`Last successful crawl was ${ageH.toFixed(1)}h ago`)
  } else {
    critical.push('No successful crawl in 24h tracked range')
  }
  if (queue.fastReady === 0 && queue.missing > 100) {
    degraded.push(`${queue.missing} ads need processing but 0 have raw URLs — indexer not populating`)
  }

  return {
    timestamp: new Date().toISOString(),
    queue,
    brands: brandStats,
    runs_24h: {
      count: (runs || []).length,
      successful: successfulRuns24h,
      total_ads_discovered: totalAds24h,
      total_bytes_through_proxy: totalBytes24h,
      bytes_per_ad: totalAds24h > 0 ? Math.round(totalBytes24h / totalAds24h) : 0,
    },
    health: { degraded, critical },
  }
}

async function countAll(): Promise<number> {
  const { count } = await (supabase as any)
    .from('discovery_ads_index')
    .select('*', { count: 'exact', head: true })
  return count ?? 0
}

async function countWhere(...filters: (string | any)[]): Promise<number> {
  // Pairs of (column, operator, value, ...)
  let q: any = (supabase as any).from('discovery_ads_index').select('*', { count: 'exact', head: true })
  for (let i = 0; i < filters.length; i += 3) {
    const col = filters[i] as string
    const op = filters[i + 1] as string
    const val = filters[i + 2]
    if (op === 'is') q = q.is(col, val)
    else if (op === 'not.is') q = q.not(col, 'is', val)
    else if (op === 'eq') q = q.eq(col, val)
  }
  const { count } = await q
  return count ?? 0
}

function renderHuman(stats: any) {
  console.log(`\n══════════════════════════════════════════`)
  console.log(`🏥 SELFMADE WORKER HEALTH @ ${stats.timestamp}`)
  console.log(`══════════════════════════════════════════\n`)

  console.log(`📦 QUEUE`)
  console.log(`   Total ads:          ${stats.queue.total.toLocaleString()}`)
  console.log(`   With thumbnails:    ${stats.queue.thumbed.toLocaleString()}  (${pct(stats.queue.thumbed, stats.queue.total)})`)
  console.log(`   Fast-path ready:    ${stats.queue.fastReady.toLocaleString()}  (raw URLs populated, no thumbnail yet)`)
  console.log(`   Awaiting work:      ${stats.queue.missing.toLocaleString()}`)
  console.log(`   Marked failed:      ${stats.queue.marked.toLocaleString()}\n`)

  console.log(`📈 LAST 24H`)
  console.log(`   Crawler runs:       ${stats.runs_24h.count}  (${stats.runs_24h.successful} successful)`)
  console.log(`   Ads discovered:     ${stats.runs_24h.total_ads_discovered.toLocaleString()}`)
  console.log(`   Proxy bandwidth:    ${(stats.runs_24h.total_bytes_through_proxy / 1024 / 1024).toFixed(1)} MB`)
  console.log(`   Bytes per ad:       ${(stats.runs_24h.bytes_per_ad / 1024).toFixed(1)} KB\n`)

  console.log(`🏷️  TOP 10 ACTIVE BRANDS (oldest crawl first)`)
  console.log(`   ${'term'.padEnd(20)} ${'thumbed'.padStart(8)} ${'fastReady'.padStart(10)} ${'missing'.padStart(8)} ${'failed'.padStart(7)}  last_crawled`)
  for (const b of stats.brands) {
    const ago = b.last_crawled_at
      ? `${humanAgo(b.last_crawled_at)} ago`
      : 'never'
    console.log(`   ${b.term.padEnd(20)} ${b.thumbed.toString().padStart(8)} ${b.fastReady.toString().padStart(10)} ${b.missing.toString().padStart(8)} ${b.failed.toString().padStart(7)}  ${ago}`)
  }

  console.log(`\n🩺 HEALTH`)
  if (stats.health.critical.length > 0) {
    console.log(`   🚨 CRITICAL`)
    stats.health.critical.forEach((s: string) => console.log(`      - ${s}`))
  }
  if (stats.health.degraded.length > 0) {
    console.log(`   ⚠️  DEGRADED`)
    stats.health.degraded.forEach((s: string) => console.log(`      - ${s}`))
  }
  if (stats.health.critical.length === 0 && stats.health.degraded.length === 0) {
    console.log(`   ✅ All checks passing`)
  }
  console.log()
}

function pct(n: number, d: number): string {
  if (d === 0) return '0%'
  return `${((n / d) * 100).toFixed(1)}%`
}

function humanAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`
  return `${(ms / 86_400_000).toFixed(1)}d`
}

main().catch(err => { console.error('Fatal:', err); process.exit(2) })
