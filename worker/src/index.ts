/**
 * Selfmade Creative Worker — main loop.
 *
 * Continuously polls Supabase for ads needing creative extraction,
 * runs them through Playwright (real Chrome) in parallel, downloads
 * raw .jpg/.mp4 from Facebook CDN, uploads to R2, updates the DB.
 *
 * Designed to run on a small DigitalOcean droplet 24/7.
 *
 * Run:
 *   npm install
 *   npx playwright install --with-deps chromium
 *   npm run build
 *   node dist/index.js
 *
 * Env vars: see config.ts
 */
import os from 'node:os'
import { config } from './config.js'
import { claimAds, updateAdCreative, getQueueDepth, writeHeartbeat, AdRow } from './db.js'
import { extractCreative, getBrowser, closeBrowser } from './extract.js'
import { downloadAndUploadToR2 } from './r2.js'

const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}`
const HOSTNAME = os.hostname()
const SESSION_STARTED_AT = new Date().toISOString()

let totalProcessed = 0
let totalSuccess = 0
let totalFailed = 0
const startTime = Date.now()

interface ProcessResult {
  ad_id: string
  ok: boolean
  hasImage: boolean
  hasVideo: boolean
  error?: string
}

async function processAd(ad: AdRow): Promise<ProcessResult> {
  try {
    const { imageUrl, videoUrl, pageStatus, error } = await extractCreative(
      ad.snapshot_url,
      config.adTimeoutMs - 10_000,
    )

    if (error) {
      return { ad_id: ad.ad_id, ok: false, hasImage: false, hasVideo: false, error: `extract: ${error}` }
    }
    if (!imageUrl && !videoUrl) {
      return { ad_id: ad.ad_id, ok: false, hasImage: false, hasVideo: false, error: `no_creative_found (page=${pageStatus})` }
    }

    // Download from CDN + upload to R2 in parallel
    const [thumbR2, videoR2] = await Promise.all([
      imageUrl ? downloadAndUploadToR2(imageUrl, `thumbnails/${ad.ad_id}.jpg`, 'image/jpeg') : Promise.resolve(null),
      videoUrl ? downloadAndUploadToR2(videoUrl, `videos/${ad.ad_id}.mp4`, 'video/mp4') : Promise.resolve(null),
    ])

    if (!thumbR2 && !videoR2) {
      return { ad_id: ad.ad_id, ok: false, hasImage: false, hasVideo: false, error: 'r2_upload_failed' }
    }

    await updateAdCreative(ad.ad_id, thumbR2, videoR2)
    return { ad_id: ad.ad_id, ok: true, hasImage: !!thumbR2, hasVideo: !!videoR2 }
  } catch (err) {
    return {
      ad_id: ad.ad_id,
      ok: false,
      hasImage: false,
      hasVideo: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Process a batch of ads with concurrency control.
 * Uses a sliding-window pool — never blocks on the slowest ad in a chunk.
 */
async function processBatch(ads: AdRow[]): Promise<ProcessResult[]> {
  const results: ProcessResult[] = []
  let cursor = 0
  const total = ads.length

  async function worker() {
    while (cursor < total) {
      const idx = cursor++
      const ad = ads[idx]
      const t0 = Date.now()
      const result = await Promise.race([
        processAd(ad),
        new Promise<ProcessResult>((resolve) =>
          setTimeout(
            () => resolve({ ad_id: ad.ad_id, ok: false, hasImage: false, hasVideo: false, error: 'timeout' }),
            config.adTimeoutMs,
          ),
        ),
      ])
      const dt = ((Date.now() - t0) / 1000).toFixed(1)
      const tag = result.ok ? '✅' : '❌'
      const detail = result.ok
        ? `${result.hasImage ? 'img' : ''}${result.hasImage && result.hasVideo ? '+' : ''}${result.hasVideo ? 'vid' : ''}`
        : result.error || 'unknown'
      console.log(`  ${tag} [${idx + 1}/${total}] ${ad.ad_id} (${dt}s) ${detail}`)
      results.push(result)
    }
  }

  const pool = Array.from({ length: Math.min(config.concurrency, total) }, () => worker())
  await Promise.all(pool)
  return results
}

async function loop() {
  console.log(`\n🔄 Polling for ads (concurrency=${config.concurrency}, batch=${config.batchSize})…`)
  const ads = await claimAds(config.batchSize, config.imagesOnly)

  if (!ads.length) {
    const remaining = await getQueueDepth()
    console.log(`💤 Queue empty (${remaining} total in DB). Sleeping ${config.emptyQueueSleep / 1000}s…`)
    await sleep(config.emptyQueueSleep)
    return
  }

  console.log(`📦 Got ${ads.length} ads to process`)
  const t0 = Date.now()
  const results = await processBatch(ads)
  const dt = (Date.now() - t0) / 1000

  const ok = results.filter((r) => r.ok).length
  const fail = results.length - ok
  totalProcessed += results.length
  totalSuccess += ok
  totalFailed += fail

  const elapsedMin = (Date.now() - startTime) / 1000 / 60
  const adsPerMin = totalProcessed / elapsedMin
  const remaining = await getQueueDepth()
  const etaMin = remaining / Math.max(adsPerMin, 1)

  console.log(`\n✅ Batch done in ${dt.toFixed(1)}s — ${ok} ok, ${fail} failed`)
  console.log(`📊 Lifetime: ${totalSuccess}/${totalProcessed} ok (${((totalSuccess / totalProcessed) * 100).toFixed(0)}%) | ${adsPerMin.toFixed(1)} ads/min | queue: ${remaining} | ETA: ${etaMin.toFixed(0)} min\n`)

  // Best-effort heartbeat for the dashboard
  await writeHeartbeat({
    worker_id: WORKER_ID,
    hostname: HOSTNAME,
    session_started_at: SESSION_STARTED_AT,
    session_processed: totalProcessed,
    session_succeeded: totalSuccess,
    session_failed: totalFailed,
    last_batch_size: results.length,
    last_batch_seconds: parseFloat(dt.toFixed(2)),
    ads_per_min: parseFloat(adsPerMin.toFixed(2)),
  })

  await sleep(config.batchSleep)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  console.log('🚀 Selfmade Creative Worker starting…')
  console.log(`   concurrency=${config.concurrency} | batch=${config.batchSize} | images_only=${config.imagesOnly}`)

  await getBrowser() // warm up Chromium

  // Graceful shutdown
  let stopping = false
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      if (stopping) process.exit(1)
      stopping = true
      console.log(`\n🛑 ${sig} received, finishing current work…`)
      await closeBrowser()
      process.exit(0)
    })
  }

  while (!stopping) {
    try {
      await loop()
    } catch (err) {
      console.error('💥 Loop error (will retry in 10s):', err)
      await sleep(10_000)
    }
  }
}

main().catch((err) => {
  console.error('💀 Fatal:', err)
  process.exit(1)
})
