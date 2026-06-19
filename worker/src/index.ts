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
  supabase,
  AdRow,
  CreativeInsert,
} from './db.js'
import { extractCreative, getBrowser, closeBrowser } from './extract.js'
import { downloadAssetsForAd } from './proxied-fetch.js'
import { uploadBufferToR2 } from './r2.js'
import { imageHash, videoHash } from './hash.js'

const WORKER_ID = process.env.WORKER_ID || `worker-${os.hostname()}`
const HOSTNAME = os.hostname()
const SESSION_STARTED_AT = new Date().toISOString()

let totalProcessed = 0
let totalSuccess = 0
let totalFailed = 0
let lifetimeProxyMB = 0    // bytes via IPRoyal (paid)
let lifetimeDropletMB = 0  // bytes via droplet direct (free)
const startTime = Date.now()

interface ProcessResult {
  ad_id: string
  ok: boolean
  imageCount: number       // total images saved (carousel)
  videoCount: number       // total videos saved
  dedupedCount: number     // assets that hit dedup
  bytes_proxy?: number     // bytes consumed via IPRoyal (images only)
  bytes_droplet?: number   // bytes consumed via droplet direct (videos only)
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
  prefetchedBuf?: Buffer | null,
): Promise<{ url: string | null; hash: string | null; deduped: boolean }> {
  const contentType = type === 'image' ? 'image/jpeg' : 'video/mp4'
  // Use the buffer downloaded via the proxied browser/undici path.
  // The bare-IP downloadFromCDN fallback used to live here, but it ALWAYS
  // returns 1087-byte placeholders against Meta's CDN — it was just
  // generating noise. We now silently skip URLs the proxied path rejected.
  if (!prefetchedBuf) return { url: null, hash: null, deduped: false }
  const buf = prefetchedBuf

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

/**
 * FAST PATH — used when the indexer pre-extracted raw fbcdn URLs from the
 * GraphQL listing payload (post-migration 013). No browser launch required.
 *
 * Steps:
 *   1. Spin up a per-ad sticky residential session (matches indexer behavior)
 *   2. Download every raw_image_url + raw_video_url through that proxy
 *   3. Hash + dedup against existing R2 objects
 *   4. Upload survivors to R2
 *
 * Performance: ~3-5s per ad vs ~15-25s for the legacy DOM path. Bandwidth
 * usage drops because we don't load Meta's React shell + JS bundles.
 */
async function processAdFastPath(ad: AdRow): Promise<ProcessResult> {
  const imageUrls = ad.raw_image_urls || []
  const videoUrls = ad.raw_video_urls || []

  if (imageUrls.length === 0 && videoUrls.length === 0) {
    await markExtractionFailed(ad.ad_id)
    return { ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'fast_path: empty raw URL arrays' }
  }

  const { images, videos, bytes_proxy_total, bytes_droplet_total } = await downloadAssetsForAd({
    adId: ad.ad_id,
    imageUrls,
    videoUrls,
    timeoutMs: 60_000,
  })

  if (images.length === 0 && videos.length === 0) {
    // All raw URLs returned placeholders — could be: ad expired between
    // indexing and download, IPRoyal session blocked by Meta, or the ad
    // is in a state where Meta now gates everything. Mark failed.
    await markExtractionFailed(ad.ad_id)
    return { ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'fast_path: all placeholders → marked failed' }
  }

  // Map URL → buffer so processAsset can skip its own download
  const imageBufByUrl = new Map(images.map(a => [a.url, a.buffer]))
  const videoBufByUrl = new Map(videos.map(a => [a.url, a.buffer]))

  // Process all assets through hash+dedup+upload pipeline
  const imagePromises = imageUrls.map((url, i) => processAsset(url, 'image', ad.ad_id, i, imageBufByUrl.get(url)))
  const videoPromises = videoUrls.map((url, i) => processAsset(url, 'video', ad.ad_id, i, videoBufByUrl.get(url)))
  const [imageResults, videoResults] = await Promise.all([
    Promise.all(imagePromises),
    Promise.all(videoPromises),
  ])

  const creatives: CreativeInsert[] = []
  imageResults.forEach((r, i) => {
    if (r.url) creatives.push({ ad_id: ad.ad_id, position: i, asset_type: 'image', r2_url: r.url, hash: r.hash })
  })
  videoResults.forEach((r, i) => {
    if (r.url) creatives.push({ ad_id: ad.ad_id, position: i, asset_type: 'video', r2_url: r.url, hash: r.hash })
  })

  if (creatives.length === 0) {
    await markExtractionFailed(ad.ad_id)
    return { ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'fast_path: r2 upload failed' }
  }

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

  return {
    ad_id: ad.ad_id,
    ok: true,
    imageCount,
    videoCount,
    dedupedCount,
    bytes_proxy: bytes_proxy_total,
    bytes_droplet: bytes_droplet_total,
  }
}

async function processAd(ad: AdRow): Promise<ProcessResult> {
  try {
    // FAST-PATH ONLY. The legacy DOM-extraction path (Playwright per ad)
    // was retired 2026-05-15 — it consumed 2-3 MB IPRoyal per ad. We now
    // require every ad in the worker queue to have raw URLs from the
    // indexer (db.ts claimAds enforces this with a SQL filter).
    return await processAdFastPath(ad)
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

// Cooperative write-pause: back off while the nightly rollup holds `crawl_paused`,
// so its big write runs with near-zero row-lock contention.
async function waitIfPaused() {
  for (;;) {
    let until = 0
    try {
      const { data } = await (supabase as any).from('system_flags').select('until').eq('key', 'crawl_paused').maybeSingle()
      until = data?.until ? Date.parse(data.until) : 0
    } catch { return }
    if (!until || until <= Date.now()) return
    console.log(`⏸️  rollup write in progress — pausing 20s`)
    await sleep(20_000)
  }
}

async function loop() {
  await waitIfPaused()
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
  const batchProxyMB = results.reduce((s, r) => s + (r.bytes_proxy ?? 0), 0) / 1024 / 1024
  const batchDropletMB = results.reduce((s, r) => s + (r.bytes_droplet ?? 0), 0) / 1024 / 1024
  totalProcessed += results.length
  totalSuccess += ok
  totalFailed += fail
  lifetimeProxyMB += batchProxyMB
  lifetimeDropletMB += batchDropletMB

  const elapsedMin = (Date.now() - startTime) / 1000 / 60
  const adsPerMin = totalProcessed / elapsedMin
  const remaining = await getQueueDepth()
  const etaMin = remaining / Math.max(adsPerMin, 1)

  console.log(`\n✅ Batch done in ${dt.toFixed(1)}s — ${ok} ok, ${fail} failed | ${totalImages} imgs + ${totalVideos} vids saved, ${totalDeduped} ♻️ deduped`)
  console.log(`💾 Bandwidth (batch): ${batchProxyMB.toFixed(2)} MB proxy + ${batchDropletMB.toFixed(2)} MB droplet`)
  console.log(`📊 Lifetime: ${totalSuccess}/${totalProcessed} ok (${((totalSuccess / totalProcessed) * 100).toFixed(0)}%) | ${adsPerMin.toFixed(1)} ads/min | queue: ${remaining} | ETA: ${etaMin.toFixed(0)} min`)
  console.log(`💰 Lifetime bandwidth: ${lifetimeProxyMB.toFixed(1)} MB proxy ($${(lifetimeProxyMB * 0.0035).toFixed(3)} approx) + ${lifetimeDropletMB.toFixed(1)} MB droplet (free)\n`)

  // Persist batch metrics to DB so the admin /admin/health dashboard can
  // sum total bandwidth (worker + indexer) — was previously only logging
  // to stdout, causing dashboard to underreport actual IPRoyal usage by
  // ~50× (only indexer was tracked).
  try {
    const totalBytesProxy = results.reduce((s, r) => s + (r.bytes_proxy ?? 0), 0)
    const totalBytesDroplet = results.reduce((s, r) => s + (r.bytes_droplet ?? 0), 0)
    await (supabase as any).from('worker_runs').insert({
      worker_id: WORKER_ID,
      hostname: HOSTNAME,
      batch_size: results.length,
      ads_ok: ok,
      ads_failed: fail,
      images_saved: totalImages,
      videos_saved: totalVideos,
      deduped_count: totalDeduped,
      bytes_proxy: totalBytesProxy,
      bytes_droplet: totalBytesDroplet,
      duration_ms: Math.round(dt * 1000),
    })
  } catch (e: any) {
    // Non-fatal — telemetry only. If worker_runs table doesn't exist
    // (migration 014 not applied), just continue.
    console.warn(`[worker_runs] write failed: ${e?.message ?? e}`)
  }

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
