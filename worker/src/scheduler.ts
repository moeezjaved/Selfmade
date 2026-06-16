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
const BETWEEN_PAUSE_MIN = parseInt(process.env.SCHEDULER_BETWEEN_PAUSE_MIN ?? '3', 10)
const MAX_PAGES_PER_BRAND = parseInt(process.env.SCHEDULER_MAX_PAGES ?? '40', 10)

interface BrandRow {
  page_id: string
  term: string
  last_crawled_at: string | null
}

async function main() {
  console.log(`\n🤖 Indexer scheduler started`)
  console.log(`   min_brand_gap = ${MIN_BRAND_GAP_MIN} min  (anti-throttle)`)
  console.log(`   between_pause = ${BETWEEN_PAUSE_MIN} min  (cooldown after each crawl)`)
  console.log(`   max_pages     = ${MAX_PAGES_PER_BRAND}\n`)

  let cycle = 0
  while (true) {
    cycle++
    try {
      const brand = await pickNextBrand()
      if (!brand) {
        console.log(`[cycle ${cycle}] 💤 No brands due — sleeping ${BETWEEN_PAUSE_MIN} min`)
        await sleep(BETWEEN_PAUSE_MIN * 60 * 1000)
        continue
      }

      console.log(`[cycle ${cycle}] 🌐 Crawling ${brand.term} (page_id=${brand.page_id})`)
      const t0 = Date.now()
      const ok = await runIndexer(brand.page_id)
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`[cycle ${cycle}] ${ok ? '✅' : '❌'} ${brand.term} finished in ${elapsed}s\n`)
    } catch (err: any) {
      console.error(`[cycle ${cycle}] 💥 Scheduler error: ${err?.message ?? err}`)
    }

    await sleep(BETWEEN_PAUSE_MIN * 60 * 1000)
  }
}

/**
 * Pick the brand with the oldest last_crawled_at where:
 *   - is_active = true
 *   - page_id IS NOT NULL
 *   - last crawl was >= MIN_BRAND_GAP_MIN minutes ago (or never)
 */
async function pickNextBrand(): Promise<BrandRow | null> {
  const cutoff = new Date(Date.now() - MIN_BRAND_GAP_MIN * 60 * 1000).toISOString()

  // Brands that have NEVER been crawled — top priority
  const { data: never } = await (supabase as any)
    .from('discovery_crawl_terms')
    .select('page_id, term, last_crawled_at')
    .eq('is_active', true)
    .not('page_id', 'is', null)
    .is('last_crawled_at', null)
    .limit(1)

  if (never && never.length > 0) return never[0] as BrandRow

  // Otherwise the oldest one past the gap
  const { data: aged } = await (supabase as any)
    .from('discovery_crawl_terms')
    .select('page_id, term, last_crawled_at')
    .eq('is_active', true)
    .not('page_id', 'is', null)
    .lte('last_crawled_at', cutoff)
    .order('last_crawled_at', { ascending: true })
    .limit(1)

  if (aged && aged.length > 0) return aged[0] as BrandRow
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
