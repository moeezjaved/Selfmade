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
  dequeue,
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
import { imageHash, videoHash, imageDimensions } from './hash.js'

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
  terminal?: boolean       // give-up (marked failed) → dequeue, don't retry. transient (timeout/exception) leaves it queued for the 3-min stale reclaim.
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
): Promise<{ url: string | null; hash: string | null; deduped: boolean; width: number | null; height: number | null }> {
  const contentType = type === 'image' ? 'image/jpeg' : 'video/mp4'
  // Use the buffer downloaded via the proxied browser/undici path.
  // The bare-IP downloadFromCDN fallback used to live here, but it ALWAYS
  // returns 1087-byte placeholders against Meta's CDN — it was just
  // generating noise. We now silently skip URLs the proxied path rejected.
  if (!prefetchedBuf) return { url: null, hash: null, deduped: false, width: null, height: null }
  const buf = prefetchedBuf

  // Pixel dimensions for the no-reflow grid (images only — sharp reads the header,
  // ~free; videos get a client-side aspect fallback until video-dim parsing lands).
  const dims = type === 'image' ? await imageDimensions(buf) : null
  const width = dims?.width ?? null
  const height = dims?.height ?? null

  const hash = type === 'image' ? await imageHash(buf) : videoHash(buf)
  if (!hash) {
    const key = type === 'image'
      ? `thumbnails/${adId}_${position}.jpg`
      : `videos/${adId}_${position}.mp4`
    const url = await uploadBufferToR2(buf, key, contentType)
    return { url, hash: null, deduped: false, width, height }
  }

  const existing = await findExistingByHash(hash, type)
  if (existing) {
    return { url: existing, hash, deduped: true, width, height }
  }

  // Use position in key so carousels don't overwrite each other
  const key = type === 'image'
    ? `thumbnails/${adId}_${position}.jpg`
    : `videos/${adId}_${position}.mp4`
  const url = await uploadBufferToR2(buf, key, contentType)
  return { url, hash, deduped: false, width, height }
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
    return { ad_id: ad.ad_id, ok: false, terminal: true, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'fast_path: empty raw URL arrays' }
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
    return { ad_id: ad.ad_id, ok: false, terminal: true, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'fast_path: all placeholders → marked failed' }
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
    if (r.url) creatives.push({ ad_id: ad.ad_id, position: i, asset_type: 'image', r2_url: r.url, hash: r.hash, width: r.width, height: r.height })
  })
  videoResults.forEach((r, i) => {
    if (r.url) creatives.push({ ad_id: ad.ad_id, position: i, asset_type: 'video', r2_url: r.url, hash: r.hash, width: r.width, height: r.height })
  })

  if (creatives.length === 0) {
    await markExtractionFailed(ad.ad_id)
    return { ad_id: ad.ad_id, ok: false, terminal: true, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'fast_path: r2 upload failed' }
  }

  // ── VIDEO POSTERS (drain-time, fresh URL) ──────────────────────────────────────────
  // Re-host FB's video_preview_image_url for each video creative WHILE we're draining the
  // ad, i.e. while that signed fbcdn URL is still valid (it expires in hours). Download is
  // direct-first/proxy-fallback like image creatives — it's an image, so it never touches
  // IPRoyal in the common case. Best-effort: a poster failure must never fail the creative
  // save. Old/expired ads are handled separately (mp4 frame extraction), not here.
  const previewUrls = ad.raw_video_preview_urls || []
  if (previewUrls.length > 0 && creatives.some((c) => c.asset_type === 'video')) {
    try {
      const { images: posterAssets } = await downloadAssetsForAd({
        adId: ad.ad_id,
        imageUrls: previewUrls.slice(0, 6),
        timeoutMs: 30_000,
      })
      const posterBufByUrl = new Map(posterAssets.map((a) => [a.url, a.buffer]))
      const posterByPos: Record<number, string> = {}
      await Promise.all(
        previewUrls.map(async (purl, i) => {
          const buf = posterBufByUrl.get(purl)
          if (!buf) return
          const h = await imageHash(buf).catch(() => null)
          const url = await uploadBufferToR2(buf, `posters/${h || `${ad.ad_id}_${i}`}.jpg`, 'image/jpeg')
          if (url) posterByPos[i] = url
        })
      )
      const firstPoster = Object.values(posterByPos)[0]
      for (const c of creatives) {
        if (c.asset_type === 'video') c.poster_url = posterByPos[c.position] || firstPoster || null
      }
    } catch {
      /* poster is best-effort — never fail the creative save over it */
    }
  }

  // APPEND-ONLY (creative-queue Phase 2): write creatives to discovery_creatives and
  // STOP here. We no longer UPDATE discovery_ads_index (thumbnail_url/video_url/
  // image_hash/video_hash) per ad — that ~50K/hr UPDATE on a 23-index table was the
  // dead-tuple churn that bloated the DB and capped crawl+drain. Serving now reads
  // creatives from discovery_creatives. The consumer dequeues this ad on success.
  await saveCreatives(creatives)

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
 * Streaming producer/consumer drain.
 *
 * The old model claimed a batch, waited for the ENTIRE batch to finish, then
 * claimed the next + slept — so concurrency collapsed at every boundary (the
 * last slow videos held up the next claim). This keeps an in-memory buffer
 * topped up by a producer while N consumers pull continuously: no idle slots,
 * no boundary drain, no inter-batch sleep.
 *
 * `claimed` (in-memory) stops the producer from re-buffering an ad that's claimed
 * but not yet processed — its thumbnail is still null so claimAds would hand it
 * back. Each ad is processed by exactly one consumer (queue.shift is atomic in
 * single-threaded JS), so nothing is double-processed or dropped.
 */
async function runStream(isStopping: () => boolean): Promise<void> {
  const queue: AdRow[] = []
  const claimed = new Set<string>()
  const REFILL_AT = Math.max(config.concurrency * 2, config.batchSize)
  // rolling-window counters, flushed to telemetry every 30s
  let wImg = 0, wVid = 0, wDed = 0, wProxy = 0, wDroplet = 0, wOk = 0, wCount = 0

  async function producer() {
    while (!isStopping()) {
      await waitIfPaused()
      if (queue.length >= REFILL_AT) { await sleep(150); continue }
      let ads: AdRow[] = []
      try { ads = await claimAds(config.batchSize, config.imagesOnly) }
      catch (e: any) { console.warn(`[producer] claim error: ${e?.message ?? e}`); await sleep(3000); continue }
      const fresh = ads.filter((a) => !claimed.has(a.ad_id))
      if (fresh.length) {
        for (const a of fresh) claimed.add(a.ad_id)
        queue.push(...fresh)
      } else if (queue.length === 0 && claimed.size === 0) {
        const depth = await getQueueDepth().catch(() => -1)
        console.log(`💤 Queue empty (${depth} in DB). Sleeping ${config.emptyQueueSleep / 1000}s…`)
        await sleep(config.emptyQueueSleep)
      } else {
        await sleep(400)  // only already-buffered ads came back; let consumers drain
      }
    }
  }

  async function consumer() {
    while (!isStopping()) {
      const ad = queue.shift()
      if (!ad) { await sleep(80); continue }
      const t0 = Date.now()
      let result: ProcessResult
      try {
        result = await Promise.race([
          processAd(ad),
          new Promise<ProcessResult>((r) => setTimeout(
            () => r({ ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: 'timeout' }),
            config.adTimeoutMs)),
        ])
      } catch (e: any) {
        result = { ad_id: ad.ad_id, ok: false, imageCount: 0, videoCount: 0, dedupedCount: 0, error: e?.message ?? String(e) }
      } finally {
        claimed.delete(ad.ad_id)
      }
      // Dequeue on a TERMINAL result (success or give-up). Transient failures
      // (timeout / unexpected exception) are left in the queue → re-claimed after the
      // 3-min stale window, so a blip never loses an ad.
      if (result.ok || result.terminal) await dequeue(ad.ad_id).catch(() => {})
      const dt = ((Date.now() - t0) / 1000).toFixed(1)
      const dedupTag = result.dedupedCount > 0 ? ` ♻️${result.dedupedCount}` : ''
      console.log(`  ${result.ok ? '✅' : '❌'} ${ad.ad_id} (${dt}s) ${result.ok ? `${result.imageCount}img+${result.videoCount}vid${dedupTag}` : (result.error || 'unknown')}`)
      totalProcessed++; wCount++
      if (result.ok) { totalSuccess++; wOk++ } else { totalFailed++ }
      wImg += result.imageCount; wVid += result.videoCount; wDed += result.dedupedCount
      wProxy += result.bytes_proxy ?? 0; wDroplet += result.bytes_droplet ?? 0
    }
  }

  async function flusher() {
    while (!isStopping()) {
      await sleep(30_000)
      lifetimeProxyMB += wProxy / 1024 / 1024
      lifetimeDropletMB += wDroplet / 1024 / 1024
      const adsPerMin = totalProcessed / Math.max((Date.now() - startTime) / 60000, 0.01)
      const depth = await getQueueDepth().catch(() => -1)
      console.log(`\n📊 ${totalSuccess}/${totalProcessed} ok | ${adsPerMin.toFixed(0)} ads/min | buffer=${queue.length} inflight=${claimed.size} | queue(DB)=${depth} | +${wImg}img +${wVid}vid /30s`)
      try {
        await (supabase as any).from('worker_runs').insert({
          worker_id: WORKER_ID, hostname: HOSTNAME, batch_size: wCount,
          ads_ok: wOk, ads_failed: wCount - wOk, images_saved: wImg, videos_saved: wVid,
          deduped_count: wDed, bytes_proxy: wProxy, bytes_droplet: wDroplet, duration_ms: 30_000,
        })
      } catch { /* telemetry only */ }
      await writeHeartbeat({
        worker_id: WORKER_ID, hostname: HOSTNAME, session_started_at: SESSION_STARTED_AT,
        session_processed: totalProcessed, session_succeeded: totalSuccess, session_failed: totalFailed,
        last_batch_size: wCount, last_batch_seconds: 30, ads_per_min: parseFloat(adsPerMin.toFixed(2)),
      }).catch(() => {})
      wImg = wVid = wDed = wProxy = wDroplet = wOk = wCount = 0
    }
  }

  await Promise.all([producer(), flusher(), ...Array.from({ length: config.concurrency }, () => consumer())])
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

  // Streaming drain — producer keeps the buffer full, N consumers pull
  // continuously. Runs until shutdown (it loops internally).
  try {
    await runStream(() => stopping)
  } catch (err) {
    console.error('💥 Stream error:', err)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('💀 Fatal:', err)
  process.exit(1)
})
