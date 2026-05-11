/**
 * Worker configuration — loaded from env vars at startup.
 * Fail fast if anything's missing.
 */
function need(key: string): string {
  const v = process.env[key]
  if (!v) {
    console.error(`❌ Missing env var: ${key}`)
    process.exit(1)
  }
  return v
}

function num(key: string, def: number): number {
  const v = process.env[key]
  if (!v) return def
  const n = parseInt(v, 10)
  return isNaN(n) ? def : n
}

export const config = {
  supabase: {
    url: need('SUPABASE_URL'),
    serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
  },
  r2: {
    accountId: need('R2_ACCOUNT_ID'),
    accessKeyId: need('R2_ACCESS_KEY_ID'),
    secretAccessKey: need('R2_SECRET_ACCESS_KEY'),
    bucket: need('R2_BUCKET_NAME'),
    publicUrl: need('R2_PUBLIC_URL').replace(/\/$/, ''),
  },
  // How many ads to process simultaneously. Tune to droplet size.
  // 4GB RAM → 5-6 concurrent. 8GB → 10-12 (default). 16GB → 15-20.
  concurrency: num('WORKER_CONCURRENCY', 12),
  // How many ads to grab per DB poll
  batchSize: num('WORKER_BATCH_SIZE', 50),
  // Sleep when queue is empty (ms)
  emptyQueueSleep: num('WORKER_EMPTY_SLEEP_MS', 30_000),
  // Sleep between batches when busy (ms) — keep tight
  batchSleep: num('WORKER_BATCH_SLEEP_MS', 200),
  // Per-ad timeout (extracts CDN URL + download + upload).
  // Most dead ads still finish around 12-15s, so cap at 25s.
  adTimeoutMs: num('WORKER_AD_TIMEOUT_MS', 25_000),
  // Skip videos? (set true to do images only first)
  imagesOnly: process.env.WORKER_IMAGES_ONLY === '1',
  // Process only active (currently-running) ads first — much higher
  // success rate than inactive ads (where Meta often serves placeholders).
  // Inactive ads are still in the queue, just deprioritized.
  activeOnly: process.env.WORKER_ACTIVE_ONLY === '1',
}
