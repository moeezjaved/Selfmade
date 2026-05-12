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
import {
  claimAds,
  updateAdCreative,
  getQueueDepth,
  writeHeartbeat,
  findExistingByHash,
  saveCreatives,
  markExtractionFailed,
  AdRow,
  CreativeInsert,
} from './db.js'
import { extractCreative, getBrowser, closeBrowser } from './extract.js'
import { downloadFromCDN, uploadBufferToR2 } from './r2.js'
import { imageHash, videoHash } from './hash.js'

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
  imageCount: number       // total images saved (carousel)
  videoCount: number       // total videos saved
  dedupedCount: number     // assets that hit dedup
  error?: string
}

/**
 * Process a single asset (image or video):
 *   1. Download from FB CDN
 *   2. Hash it
 *   3. Check if any existing creative has this hash → reuse R2 URL (skip upload)
 *   4. Otherwise upload to R2 and return new URL + hash
 */
async function processAsset(
  cdnUrl: string,
  type: 'image' | 'video',
  adId: string,
  position: number,
): Promise<{ url: string | null; hash: string | null; deduped: boolean }> {
  const contentType = type === 'image' ? 'image/jpeg' : 'video/mp4'
  const buf = await downloadFromCDN(cdnUrl, contentType)
  if (!buf) return { url: null, hash: null, deduped: false }

  const hash = type === 'image' ? await imageHash(buf) : videoHash(buf)
  if (!hash) {
    const key = type === 'image'
      ? `thumbnails/${adId}_${position}.jpg`
      : `videos/${adId}_${position}.mp4`
    const url = await uploadBufferToR2(buf, key, contentType)
    return { url, hash: null, deduped: false }
  }

  const existing = await findExistingByHash(hash, type)
  if (existing) {
    return { url: existing, hash, deduped: true }
  }

  // Use position in key so carousels don't overwrite each other
  const key = type === 'image'
    ? `thumbnails/${adId}_${position}.jpg`
    : `videos/${adId}_${position}.mp4`
  const url = await uploadBufferToR2(buf, key, contentType)
  return { url, hash, deduped: false }
}

async function processAd(ad: AdRow): Promise<ProcessResult> {
  try {
    const { imageUrls, videoUrls, pageStatus, error } = await extractCreative(
      ad.snapshot_url,
      config.adTimeoutMs - 10_000,
      ad.ad_id,                       // sticky proxy session key — same IP for full ad lifecycle
    )

    if (error) {
      // Network/timeout — leave for retry, don't mark failed
      return { ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: `extract: ${error}` }
    }
    if (imageUrls.length === 0 && videoUrls.length === 0) {
      // Page loaded but no creative — ad likely deactivated or token expired.
      // Mark so we never retry it.
      await markExtractionFailed(ad.ad_id)
      return { ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: `no_creative_found (page=${pageStatus}) → marked failed` }
    }

    // Process all images + all videos in parallel
    const imagePromises = imageUrls.map((url, i) => processAsset(url, 'image', ad.ad_id, i))
    const videoPromises = videoUrls.map((url, i) => processAsset(url, 'video', ad.ad_id, i))

    const [imageResults, videoResults] = await Promise.all([
      Promise.all(imagePromises),
      Promise.all(videoPromises),
    ])

    // Build creatives table rows — one per asset that uploaded successfully
    const creatives: CreativeInsert[] = []
    imageResults.forEach((r, i) => {
      if (r.url) creatives.push({ ad_id: ad.ad_id, position: i, asset_type: 'image', r2_url: r.url, hash: r.hash })
    })
    videoResults.forEach((r, i) => {
      if (r.url) creatives.push({ ad_id: ad.ad_id, position: i, asset_type: 'video', r2_url: r.url, hash: r.hash })
    })

    if (creatives.length === 0) {
      // All assets failed to upload — usually means Meta returned only placeholder
      // images (1334-1507 bytes) because the ad was removed/deactivated/violates
      // ad standards. Mark failed so we never retry it (otherwise these placeholder
      // ads loop in the queue forever, burning proxy bandwidth).
      await markExtractionFailed(ad.ad_id)
      return { ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'r2_upload_failed → marked failed (placeholder only)' }
    }

    // Save all creatives + update legacy columns (first image, first video)
    const firstImage = imageResults.find((r) => r.url)
    const firstVideo = videoResults.find((r) => r.url)
    await Promise.all([
      saveCreatives(creatives),
      updateAdCreative(
        ad.ad_id,
        firstImage?.url ?? null,
        firstVideo?.url ?? null,
        firstImage?.hash ?? null,
        firstVideo?.hash ?? null,
      ),
    ])

    const imageCount = imageResults.filter((r) => r.url).length
    const videoCount = videoResults.filter((r) => r.url).length
    const dedupedCount =
      imageResults.filter((r) => r.deduped).length +
      videoResults.filter((r) => r.deduped).length

    return { ad_id: ad.ad_id, ok: true, imageCount, videoCount, dedupedCount }
  } catch (err) {
    return {
      ad_id: ad.ad_id,
      ok: false,
      imageCount: 0,
      videoCount: 0,
      dedupedCount: 0,
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
            () => resolve({ ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'timeout' }),
            config.adTimeoutMs,
          ),
        ),
      ])
      const dt = ((Date.now() - t0) / 1000).toFixed(1)
      const tag = result.ok ? '✅' : '❌'
      const dedupTag = result.dedupedCount > 0 ? ` ♻️${result.dedupedCount}` : ''
      const detail = result.ok
        ? `${result.imageCount}img+${result.videoCount}vid${dedupTag}`
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
  const totalImages = results.reduce((s, r) => s + r.imageCount, 0)
  const totalVideos = results.reduce((s, r) => s + r.videoCount, 0)
  const totalDeduped = results.reduce((s, r) => s + r.dedupedCount, 0)
  totalProcessed += results.length
  totalSuccess += ok
  totalFailed += fail

  const elapsedMin = (Date.now() - startTime) / 1000 / 60
  const adsPerMin = totalProcessed / elapsedMin
  const remaining = await getQueueDepth()
  const etaMin = remaining / Math.max(adsPerMin, 1)

  console.log(`\n✅ Batch done in ${dt.toFixed(1)}s — ${ok} ok, ${fail} failed | ${totalImages} imgs + ${totalVideos} vids saved, ${totalDeduped} ♻️ deduped`)
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
