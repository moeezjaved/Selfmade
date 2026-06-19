/**
 * Round-robin indexer scheduler.
 *
 * Runs forever. Every cycle:
 *   1. Pick the next active brand (oldest last_crawled_at first)
 *   2. Skip if its last crawl was less than MIN_BRAND_GAP_MIN min ago
 *      (avoids the per-brand throttling Meta applied to Hims after 4×
 *      crawls in 30 min)
 *   3. Run the indexer on that brand (TARGET_ADS_PER_BRAND, all the
 *      pagination, raw URL extraction)
 *   4. Sleep BETWEEN_BRAND_PAUSE_MIN min, repeat
 *
 * Failure modes:
 *   - Crawl errors → logged + scheduler continues to next brand
 *   - Anti-burn aborts → that brand auto-marked failed by indexer; we
 *     skip it on next cycle until min gap elapses
 *   - DB connection drops → we log + retry the SAME brand after a short delay
 *
 * Usage:
 *   docker run -d --name scheduler --env-file .env selfmade-worker \
 *     npx tsx src/scheduler.ts
 *
 *   # Override defaults:
 *   docker run -d --env-file .env \
 *     -e SCHEDULER_MIN_BRAND_GAP_MIN=60 \
 *     -e SCHEDULER_BETWEEN_PAUSE_MIN=2 \
 *     selfmade-worker npx tsx src/scheduler.ts
 *
 * Bandwidth budget: indexer crawls are ~3 MB/brand. At 1 brand/2-min
 * cycle and 50 active brands → full rotation every ~100 min, ~150 MB/h.
 * For 9.6 GB IPRoyal budget → ~64 hours of continuous indexing. Plenty.
 */
import { spawn } from 'node:child_process'
import { supabase } from './db.js'

// Re-crawl cadence. Raised from 45 min → 6 h: incremental crawls make re-crawls
// cheap (they stop once they hit already-indexed ads), so re-crawling a covered
// brand every 6 h is plenty and spreads scarce IP budget across many brands.
// Gated brands set a shorter backoff themselves (see indexer GATE_RETRY_MIN).
const MIN_BRAND_GAP_MIN = parseInt(process.env.SCHEDULER_MIN_BRAND_GAP_MIN ?? '360', 10)
const MAX_PAGES_PER_BRAND = parseInt(process.env.SCHEDULER_MAX_PAGES ?? '40', 10)

// ── Concurrency ──────────────────────────────────────────────────────────────
// Each crawl is an independent subprocess with its OWN random IPRoyal session id
// (playwright-indexer.ts:544 → distinct residential IP). So running N at once =
// N distinct IPs simultaneously, one IPRoyal account. The droplet is RAM-bound
// (~400–700 MB per Chromium), so keep N within the box's headroom (~8–10 on 8 GB).
// Default 1 = legacy single-worker behavior; ramp via SCHEDULER_CONCURRENCY.
const CONCURRENCY = Math.max(1, parseInt(process.env.SCHEDULER_CONCURRENCY ?? '1', 10))

// Per-worker cooldown after each crawl. Now in SECONDS (was 3 minutes). With
// concurrency we don't need a long nap — each worker just grabs the next brand.
// Back-compat: honor the old SCHEDULER_BETWEEN_PAUSE_MIN if it's still set.
const BETWEEN_PAUSE_SEC = parseInt(
  process.env.SCHEDULER_BETWEEN_PAUSE_SEC
    ?? (process.env.SCHEDULER_BETWEEN_PAUSE_MIN
        ? String(parseInt(process.env.SCHEDULER_BETWEEN_PAUSE_MIN, 10) * 60)
        : '15'),
  10,
)

// In-flight claim shared across the N workers (single Node process, so a
// synchronous check-and-add is race-free). Stops two workers crawling the same
// brand during the window between pick and the indexer stamping last_crawled_at.
const inFlight = new Set<string>()

interface BrandRow {
  page_id: string
  term: string
  last_crawled_at: string | null
}

// Cooperative write-pause: the nightly rollup sets `system_flags.crawl_paused`
// (TTL'd) so it can write with near-zero contention. We back off while it's set.
async function waitIfPaused() {
  for (;;) {
    let until = 0
    try {
      const { data } = await (supabase as any).from('system_flags').select('until').eq('key', 'crawl_paused').maybeSingle()
      until = data?.until ? Date.parse(data.until) : 0
    } catch { return }   // never let a flag-check error stall crawling
    if (!until || until <= Date.now()) return
    console.log(`[paused] rollup write in progress — backing off 20s`)
    await sleep(20000)
  }
}

async function main() {
  console.log(`\n🤖 Indexer scheduler started`)
  console.log(`   concurrency   = ${CONCURRENCY}  (parallel crawls, each its own IPRoyal IP)`)
  console.log(`   min_brand_gap = ${MIN_BRAND_GAP_MIN} min  (anti-throttle)`)
  console.log(`   between_pause = ${BETWEEN_PAUSE_SEC} s  (per-worker cooldown)`)
  console.log(`   max_pages     = ${MAX_PAGES_PER_BRAND}\n`)

  // N independent workers pulling from the shared queue. Promise.all keeps them
  // all alive; a worker only exits if it throws fatally (it shouldn't — the loop
  // catches per-iteration errors).
  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)),
  )
}

async function worker(id: number): Promise<void> {
  while (true) {
    await waitIfPaused()   // hold off while the nightly rollup is writing

    let brand: BrandRow | null = null
    try {
      brand = await pickNextBrand(inFlight)
    } catch (err: any) {
      console.error(`[w${id}] 💥 pick error: ${err?.message ?? err}`)
      await sleep(5000)
      continue
    }
    if (!brand) {
      // Nothing due — wait a bit before re-checking (avoids a hot loop when idle).
      await sleep(Math.max(BETWEEN_PAUSE_SEC, 30) * 1000)
      continue
    }

    // Claim synchronously — no await between the check and the add, so two
    // workers can never grab the same brand (single-threaded event loop).
    if (inFlight.has(brand.page_id)) continue
    inFlight.add(brand.page_id)

    try {
      console.log(`[w${id}] 🌐 ${brand.term} (page_id=${brand.page_id})  [inflight=${inFlight.size}]`)
      const t0 = Date.now()
      const ok = await runIndexer(brand.page_id)
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`[w${id}] ${ok ? '✅' : '❌'} ${brand.term} finished in ${elapsed}s  [inflight=${inFlight.size - 1}]`)
    } catch (err: any) {
      console.error(`[w${id}] 💥 crawl error: ${err?.message ?? err}`)
    } finally {
      inFlight.delete(brand.page_id)
    }

    await sleep(BETWEEN_PAUSE_SEC * 1000)
  }
}

/**
 * Pick the brand with the oldest last_crawled_at where:
 *   - is_active = true
 *   - page_id IS NOT NULL
 *   - last crawl was >= MIN_BRAND_GAP_MIN minutes ago (or never)
 *   - NOT currently being crawled by another worker (exclude set)
 *
 * Fetches a small candidate batch (not limit 1) so concurrent workers each find
 * a fresh brand instead of all colliding on the single oldest one.
 */
async function pickNextBrand(exclude: Set<string>): Promise<BrandRow | null> {
  const cutoff = new Date(Date.now() - MIN_BRAND_GAP_MIN * 60 * 1000).toISOString()
  const batch = Math.max(20, CONCURRENCY * 3)

  // Brands that have NEVER been crawled — top priority
  const { data: never } = await (supabase as any)
    .from('discovery_crawl_terms')
    .select('page_id, term, last_crawled_at')
    .eq('is_active', true)
    .not('page_id', 'is', null)
    .is('last_crawled_at', null)
    .limit(batch)
  for (const b of (never || []) as BrandRow[]) if (!exclude.has(b.page_id)) return b

  // Otherwise the oldest ones past the gap
  const { data: aged } = await (supabase as any)
    .from('discovery_crawl_terms')
    .select('page_id, term, last_crawled_at')
    .eq('is_active', true)
    .not('page_id', 'is', null)
    .lte('last_crawled_at', cutoff)
    .order('last_crawled_at', { ascending: true })
    .limit(batch)
  for (const b of (aged || []) as BrandRow[]) if (!exclude.has(b.page_id)) return b

  return null
}

/**
 * Run the indexer as a subprocess. Streams stdout/stderr to our log.
 * Returns true on success (exit 0), false otherwise.
 */
function runIndexer(pageId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', 'src/playwright-indexer.ts', pageId, `--max-pages=${MAX_PAGES_PER_BRAND}`], {
      stdio: 'inherit',
      env: process.env,
    })
    child.on('exit', (code) => resolve(code === 0))
    child.on('error', (err) => { console.error(`spawn error: ${err.message}`); resolve(false) })
  })
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
