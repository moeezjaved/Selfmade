/**
 * Playwright-based Ads Library Indexer (production).
 *
 * Replaces the Meta Graph API path with public-web GraphQL interception.
 * Validated MVP: extracted real ads from Gymshark/Hims/Nike with no token.
 *
 * Design decisions baked in from day 1:
 *   1. Raw response archive    — every GraphQL body saved to DB for 24h
 *                                 (debugging / replay / schema-change recovery)
 *   2. Schema versioning       — track field signatures, alert on Meta changes
 *   3. Creative URL dedup      — hash CDN URLs, skip already-downloaded media
 *   4. Anti-burn protection    — auto-pause on low success rate
 *   5. Cookie persistence      — single storage_state.json reused across runs
 *   6. Sticky session per brand — same IPRoyal IP for whole crawl
 *   7. Random delays            — 2-8s between scrolls to mimic humans
 *   8. Cursor pagination resume — pick up where last run left off
 *
 * CLI usage:
 *   npx tsx src/playwright-indexer.ts                      # cycle through all active brands
 *   npx tsx src/playwright-indexer.ts <page_id>            # single brand
 *   npx tsx src/playwright-indexer.ts <page_id> --max-pages=5
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { BrowserContext, Page, Response } from 'playwright'
import { writeFile, mkdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { supabase } from './db.js'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'

chromium.use(StealthPlugin())

// ========== Config ==========
const STORAGE_STATE_FILE = '/tmp/playwright-indexer/storage-state.json'
const RAW_ARCHIVE_DIR = '/tmp/playwright-indexer/raw'
const COOKIE_DIR = '/tmp/playwright-indexer'

// Anti-burn — if success rate drops below this we auto-pause
const MIN_SUCCESS_RATE = 0.30
const SUCCESS_RATE_WINDOW = 50  // last N ads checked

// Per-brand budget
const PER_BRAND_TIME_BUDGET_MS = 240_000  // 4 min — we hit this often during pagination
const MAX_SCROLLS_PER_BRAND = 60          // hard cap (was 30 — most listings have ~1500 ads)
const SCROLL_DELAY_MIN_MS = 2_500
const SCROLL_DELAY_MAX_MS = 5_000         // tighter range — we want pagination to fire faster

// Pagination
const TARGET_ADS_PER_BRAND = 1500         // bumped after fixing pagination scroll — Hims has ~2800 visible ads
                                          // and crawls now ingest ~10/scroll, so 1500 is reachable in ~3-5 min
const MAX_AD_BYTES_TO_STORE = 800_000     // truncate huge responses for archive

// ========== Types ==========
interface RunMetrics {
  brandPageId: string
  brandName: string
  sessionId: string
  startedAt: number
  adsDiscovered: number
  adsNew: number
  adsAlreadySeen: number
  bytesThroughProxy: number
  responsesCaptured: number
  cursorsSeen: number
  scrollCount: number
  successWindow: boolean[]   // true = ad data, false = empty/error
}

interface ExtractedAd {
  ad_archive_id: string
  page_id: string
  page_name: string
  is_active: boolean
  start_date_string?: string
  end_date_string?: string
  display_format?: string
  body_text?: string
  cta_text?: string
  caption?: string
  link_url?: string
  image_urls: string[]               // ALL image URLs found (includes placeholders) — kept for backwards compat
  video_urls: string[]               // ALL video URLs found
  // Structured extraction from snapshot.images / videos / cards (verified
  // schema 2026-05-14, see analyze-payload.ts output). These are the URLs
  // the worker's fast path downloads directly via proxy.
  raw_image_urls: string[]           // snapshot.images[].original_image_url + cards[].original_image_url
  raw_video_urls: string[]           // snapshot.videos[].video_hd_url||video_sd_url + cards[].video_hd_url||video_sd_url
  raw_video_preview_urls: string[]   // snapshot.videos[].video_preview_image_url + cards[].video_preview_image_url
  raw: any                           // keep raw object for debugging / future field additions
}

// ========== Utilities ==========
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
function randomDelay() { return SCROLL_DELAY_MIN_MS + Math.random() * (SCROLL_DELAY_MAX_MS - SCROLL_DELAY_MIN_MS) }
function sha256(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex')
}

async function ensureDirs() {
  for (const d of [COOKIE_DIR, RAW_ARCHIVE_DIR]) {
    if (!existsSync(d)) await mkdir(d, { recursive: true })
  }
}

// ========== Schema fingerprinting ==========
function collectFieldPaths(obj: any, prefix = '', out: Set<string> = new Set()): Set<string> {
  if (out.size > 200) return out  // cap to avoid blowup
  if (obj === null || obj === undefined) return out
  if (Array.isArray(obj)) {
    if (obj.length > 0) collectFieldPaths(obj[0], `${prefix}[]`, out)
    return out
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj).sort()) {
      const fullPath = prefix ? `${prefix}.${k}` : k
      out.add(fullPath)
      collectFieldPaths(obj[k], fullPath, out)
    }
  }
  return out
}

async function trackSchema(adObj: any, snapshotObj: any) {
  try {
    const adKeys = adObj && typeof adObj === 'object' ? Object.keys(adObj).sort() : []
    const snapKeys = snapshotObj && typeof snapshotObj === 'object' ? Object.keys(snapshotObj).sort() : []
    const sig = sha256([...adKeys, '|', ...snapKeys].join(','))
    const fields = Array.from(collectFieldPaths(adObj)).slice(0, 100)
    await (supabase as any).from('crawler_schema_versions').upsert({
      schema_signature: sig,
      example_fields: fields,
      ad_object_keys: adKeys,
      snapshot_keys: snapKeys,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'schema_signature' })
  } catch (e: any) {
    console.warn(`[schema-tracker] ${e?.message ?? e}`)
  }
}

// ========== Creative URL dedup (pre-download) ==========
async function isCreativeAlreadyDownloaded(url: string): Promise<string | null> {
  if (!url) return null
  const hash = sha256(url)
  try {
    const { data } = await (supabase as any)
      .from('creative_url_seen')
      .select('r2_url')
      .eq('url_sha256', hash)
      .maybeSingle()
    return data?.r2_url || null
  } catch { return null }
}

async function recordCreativeUrlSeen(url: string, type: 'image' | 'video', r2Url?: string, bytes?: number) {
  try {
    const hash = sha256(url)
    await (supabase as any).from('creative_url_seen').upsert({
      url_sha256: hash,
      first_url: url.slice(0, 1000),
      asset_type: type,
      r2_url: r2Url || null,
      bytes: bytes || null,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'url_sha256' })
  } catch { /* non-fatal */ }
}

// ========== Ad object parser ==========
// Extract structured ad data from Meta's GraphQL response shape (verified
// from MVP captures of Gymshark/Hims/Nike).
function extractAdsFromText(text: string): ExtractedAd[] {
  const found: ExtractedAd[] = []
  const adIdRegex = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
  const positions: number[] = []
  let m: RegExpExecArray | null
  while ((m = adIdRegex.exec(text)) !== null) {
    positions.push(m.index)
  }

  for (const pos of positions) {
    // Find the enclosing {} object
    let start = pos
    while (start > 0 && text[start] !== '{') start--
    let depth = 0, end = start
    for (let i = start; i < text.length && i < start + MAX_AD_BYTES_TO_STORE; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    if (end === start) continue
    const slice = text.slice(start, end)
    let obj: any
    try { obj = JSON.parse(slice) } catch { continue }
    if (!obj.ad_archive_id) continue

    const snap = obj.snapshot || {}
    const media = extractMediaUrls(snap)

    found.push({
      ad_archive_id: obj.ad_archive_id,
      page_id: obj.page_id || snap.page_id || '',
      page_name: snap.page_name || '',
      is_active: !!obj.is_active,
      start_date_string: obj.start_date_string,
      end_date_string: obj.end_date_string,
      display_format: snap.display_format,
      body_text: snap.body?.text,
      cta_text: snap.cta_text,
      caption: snap.caption,
      link_url: snap.link_url,
      image_urls: media.allImages,
      video_urls: media.allVideos,
      raw_image_urls: media.rawImages,
      raw_video_urls: media.rawVideos,
      raw_video_preview_urls: media.rawVideoPreviews,
      raw: obj,
    })
  }
  return found
}

/**
 * Pull creative URLs out of a snapshot using the verified GraphQL schema.
 *
 * Sources (in priority order — first non-empty wins):
 *   - snapshot.images[].original_image_url           (full-resolution image)
 *   - snapshot.images[].resized_image_url            (s600x600 fallback)
 *   - snapshot.videos[].video_hd_url                 (HD MP4)
 *   - snapshot.videos[].video_sd_url                 (SD fallback)
 *   - snapshot.videos[].video_preview_image_url      (poster frame)
 *   - snapshot.cards[].original_image_url            (carousel slides)
 *   - snapshot.cards[].video_hd_url || video_sd_url  (carousel video slides)
 *   - snapshot.extra_images[] / extra_videos[]       (variant cuts)
 *
 * The "raw" buckets contain ONLY structured creative URLs we trust. The
 * "all" buckets retain the legacy fbcdn-walking behaviour for backwards
 * compatibility (and to capture profile pictures etc. for debugging).
 */
function extractMediaUrls(snap: any): {
  rawImages: string[]
  rawVideos: string[]
  rawVideoPreviews: string[]
  allImages: string[]
  allVideos: string[]
} {
  const rawImages = new Set<string>()
  const rawVideos = new Set<string>()
  const rawVideoPreviews = new Set<string>()

  function pushImage(...candidates: any[]) {
    for (const c of candidates) {
      if (typeof c === 'string' && c.startsWith('http') && c.includes('fbcdn')) {
        rawImages.add(c)
        return            // first non-empty wins per call
      }
    }
  }
  function pushVideo(...candidates: any[]) {
    for (const c of candidates) {
      if (typeof c === 'string' && c.startsWith('http') && c.includes('fbcdn')) {
        rawVideos.add(c)
        return
      }
    }
  }
  function pushPreview(...candidates: any[]) {
    for (const c of candidates) {
      if (typeof c === 'string' && c.startsWith('http') && c.includes('fbcdn')) {
        rawVideoPreviews.add(c)
        return
      }
    }
  }

  // images[] → prefer original (no size tag = full res), fallback to resized
  if (Array.isArray(snap?.images)) {
    for (const img of snap.images) {
      pushImage(img?.original_image_url, img?.resized_image_url)
    }
  }
  // videos[] → prefer HD, fallback to SD; also grab poster frame
  if (Array.isArray(snap?.videos)) {
    for (const v of snap.videos) {
      pushVideo(v?.video_hd_url, v?.video_sd_url)
      pushPreview(v?.video_preview_image_url)
    }
  }
  // cards[] → carousel slides; each card may have BOTH image and video fields
  if (Array.isArray(snap?.cards)) {
    for (const card of snap.cards) {
      pushImage(card?.original_image_url, card?.resized_image_url)
      pushVideo(card?.video_hd_url, card?.video_sd_url)
      pushPreview(card?.video_preview_image_url)
    }
  }
  // extra_images[] / extra_videos[] — variant cuts (less common)
  if (Array.isArray(snap?.extra_images)) {
    for (const img of snap.extra_images) {
      pushImage(img?.original_image_url, img?.resized_image_url)
    }
  }
  if (Array.isArray(snap?.extra_videos)) {
    for (const v of snap.extra_videos) {
      pushVideo(v?.video_hd_url, v?.video_sd_url)
      pushPreview(v?.video_preview_image_url)
    }
  }

  // Legacy walker — captures profile pics etc. Kept for diagnostic completeness;
  // worker's fast path uses only the rawImages/rawVideos sets above.
  const allImages = new Set<string>()
  const allVideos = new Set<string>()
  function walk(node: any, depth = 0) {
    if (depth > 6 || node === null || node === undefined) return
    if (typeof node === 'string') {
      if (node.includes('fbcdn.net') || node.includes('scontent')) {
        if (/\.(mp4|webm)/i.test(node) || node.includes('video.xx') || node.includes('/v/t2/')) {
          allVideos.add(node)
        } else if (/\.(jpg|jpeg|png|webp)/i.test(node)) {
          allImages.add(node)
        }
      }
      return
    }
    if (Array.isArray(node)) { node.forEach(n => walk(n, depth + 1)); return }
    if (typeof node === 'object') Object.values(node).forEach(v => walk(v, depth + 1))
  }
  walk(snap)

  return {
    rawImages: Array.from(rawImages),
    rawVideos: Array.from(rawVideos),
    rawVideoPreviews: Array.from(rawVideoPreviews),
    allImages: Array.from(allImages),
    allVideos: Array.from(allVideos),
  }
}

function extractCursors(text: string): string[] {
  const cursors: string[] = []
  const patterns = [
    /"end_?cursor"\s*:\s*"([^"]+)"/g,
    /"forwardCursor"\s*:\s*"([^"]+)"/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[1] && !cursors.includes(m[1])) cursors.push(m[1])
    }
  }
  return cursors
}

// ========== Raw response archive ==========
async function archiveRawResponse(args: {
  runId: string
  brandPageId: string
  url: string
  responseType: string
  status: number
  body: string
  adIdsCount: number
  cursors: string[]
}) {
  try {
    const bodyHash = sha256(args.body)
    await (supabase as any).from('crawler_raw_responses').insert({
      run_id: args.runId,
      brand_page_id: args.brandPageId,
      url: args.url.slice(0, 500),
      response_type: args.responseType,
      status_code: args.status,
      bytes: args.body.length,
      body_sha256: bodyHash,
      body_text: args.body.slice(0, 1_500_000),  // truncate to 1.5MB (most Meta ad-library responses are 600-900KB; need full body for offline analysis of media fields)
      ad_ids_count: args.adIdsCount,
      cursors: args.cursors.slice(0, 5),
    })
  } catch (e: any) {
    console.warn(`[raw-archive] ${e?.message ?? e}`)
  }
}

// ========== DB writes ==========
async function saveAdsToIndex(ads: ExtractedAd[]): Promise<{ inserted: number; existed: number }> {
  if (ads.length === 0) return { inserted: 0, existed: 0 }

  // Build rows with structured raw URLs lifted from GraphQL payload.
  // Worker's fast path uses raw_image_urls / raw_video_urls instead of
  // launching Playwright per-ad. Falls back to snapshot_url + DOM only
  // when these arrays are NULL (legacy ads from before migration 013).
  const rows = ads.map(ad => ({
    ad_id: ad.ad_archive_id,
    page_id: ad.page_id,
    page_name: ad.page_name,
    snapshot_url: `https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`,
    body: ad.body_text || null,
    title: null,
    caption: ad.caption || null,
    cta: ad.cta_text || null,
    is_active: ad.is_active,
    format: ad.display_format || null,
    start_date: ad.start_date_string || null,
    stop_date: ad.end_date_string || null,
    last_seen: new Date().toISOString(),
    raw_image_urls:         ad.raw_image_urls.length         > 0 ? ad.raw_image_urls         : null,
    raw_video_urls:         ad.raw_video_urls.length         > 0 ? ad.raw_video_urls         : null,
    raw_video_preview_urls: ad.raw_video_preview_urls.length > 0 ? ad.raw_video_preview_urls : null,
  }))

  // Split into NEW (insert) and EXISTING (update raw URLs only — keep
  // existing thumbnails/etc untouched).
  const adIds = ads.map(a => a.ad_archive_id)
  const { data: existing } = await (supabase as any)
    .from('discovery_ads_index')
    .select('ad_id')
    .in('ad_id', adIds)
  const existingIds = new Set((existing || []).map((r: any) => r.ad_id))
  const newRows      = rows.filter(r => !existingIds.has(r.ad_id))
  const existedRows  = rows.filter(r =>  existingIds.has(r.ad_id))

  if (newRows.length > 0) {
    const { error } = await (supabase as any)
      .from('discovery_ads_index')
      .upsert(newRows, { onConflict: 'ad_id' })
    if (error) console.warn(`[save-ads] insert error: ${error.message}`)
  }

  // Backfill raw URLs onto existing rows. Critical for the migration: most
  // discovered ads predate migration 013 and have raw_*_urls = NULL. As
  // soon as the indexer re-sees them, we populate the columns and the
  // worker's fast path picks them up.
  for (const row of existedRows) {
    if (!row.raw_image_urls && !row.raw_video_urls) continue  // nothing to backfill
    const { error } = await (supabase as any)
      .from('discovery_ads_index')
      .update({
        raw_image_urls: row.raw_image_urls,
        raw_video_urls: row.raw_video_urls,
        raw_video_preview_urls: row.raw_video_preview_urls,
        last_seen: row.last_seen,
      })
      .eq('ad_id', row.ad_id)
    if (error) console.warn(`[save-ads] backfill error ${row.ad_id}: ${error.message}`)
  }

  return { inserted: newRows.length, existed: existedRows.length }
}

// ========== Main per-brand crawl ==========
async function crawlBrand(opts: {
  pageId: string
  brandName?: string
  maxScrolls?: number
  runId: string
}): Promise<RunMetrics> {
  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  const metrics: RunMetrics = {
    brandPageId: opts.pageId,
    brandName: opts.brandName || '',
    sessionId,
    startedAt: Date.now(),
    adsDiscovered: 0, adsNew: 0, adsAlreadySeen: 0,
    bytesThroughProxy: 0,
    responsesCaptured: 0, cursorsSeen: 0, scrollCount: 0,
    successWindow: [],
  }

  console.log(`\n🌐 Crawling ${opts.brandName || opts.pageId} (session ${sessionId})…`)
  await (supabase as any).from('crawler_runs').insert({
    id: opts.runId,
    brand_page_id: opts.pageId,
    brand_name: opts.brandName || null,
    session_id: sessionId,
    status: 'running',
  })

  const proxy = proxyChainEnabled
    ? await startProxyChain({ sessionId, lifetime: '1h', country: 'us' })
    : null

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    proxy: proxy ? { server: proxy.url } : undefined,
  })

  // Cookie persistence — reuse across runs
  const ctxOpts: any = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  }
  if (existsSync(STORAGE_STATE_FILE)) {
    try { ctxOpts.storageState = STORAGE_STATE_FILE } catch { /* ignore corrupted */ }
  }
  const context = await browser.newContext(ctxOpts)

  // Block static UI assets to save bandwidth
  await context.route('**/*', (route) => {
    const t = route.request().resourceType()
    const url = route.request().url()
    if (t === 'font' || t === 'stylesheet') return route.abort()
    if (t === 'image' && url.includes('static.xx.fbcdn.net')) return route.abort()
    if (url.includes('/ajax/bz?') || url.includes('/log_clientside_error')) return route.abort()
    return route.continue()
  })

  const page = await context.newPage()
  const allAds = new Map<string, ExtractedAd>()

  // ========== Response interception ==========
  page.on('response', async (response: Response) => {
    try {
      const url = response.url()
      const rt = response.request().resourceType()
      if (!['xhr', 'fetch', 'document'].includes(rt)) return
      if (url.includes('static.xx.fbcdn') || url.includes('/v/t39') || url.includes('/v/t45')) return

      let body: Buffer | null = null
      try { body = await response.body() } catch { return }
      if (!body || body.length === 0) return
      const text = body.toString('utf-8')
      metrics.bytesThroughProxy += body.length

      const ads = extractAdsFromText(text)
      const cursors = extractCursors(text)
      if (ads.length === 0 && cursors.length === 0) return

      metrics.responsesCaptured++
      metrics.cursorsSeen += cursors.length

      // Schema track on first ad found
      if (ads.length > 0) {
        await trackSchema(ads[0].raw, ads[0].raw?.snapshot).catch(() => {})
      }

      // Archive raw response (for debugging schema changes / replay)
      await archiveRawResponse({
        runId: opts.runId,
        brandPageId: opts.pageId,
        url,
        responseType: url.includes('graphql') ? 'graphql_pagination' : 'initial_html',
        status: response.status(),
        body: text,
        adIdsCount: ads.length,
        cursors,
      })

      // Add to in-memory map (dedupe by ad_id)
      let newCount = 0
      for (const ad of ads) {
        if (!allAds.has(ad.ad_archive_id)) {
          allAds.set(ad.ad_archive_id, ad)
          newCount++
        }
      }
      metrics.successWindow.push(ads.length > 0)
      if (metrics.successWindow.length > SUCCESS_RATE_WINDOW) {
        metrics.successWindow.shift()
      }
      console.log(`  📦 captured ${ads.length} ads (${newCount} new) + ${cursors.length} cursors | ${(metrics.bytesThroughProxy / 1024).toFixed(1)} KB total`)
    } catch (e: any) {
      console.warn(`  ⚠️ response handler: ${e?.message?.slice(0, 100)}`)
    }
  })

  // ========== Navigate + scroll ==========
  const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${opts.pageId}`
  let aborted = false
  let abortReason = ''
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await sleep(8_000)  // initial render

    const startMs = Date.now()
    const maxScrolls = opts.maxScrolls ?? MAX_SCROLLS_PER_BRAND

    for (let scrollIdx = 0; scrollIdx < maxScrolls; scrollIdx++) {
      // Anti-burn check
      if (metrics.successWindow.length >= 10) {
        const successRate = metrics.successWindow.filter(Boolean).length / metrics.successWindow.length
        if (successRate < MIN_SUCCESS_RATE) {
          console.log(`  🛑 Anti-burn triggered: success rate ${(successRate * 100).toFixed(0)}% < ${MIN_SUCCESS_RATE * 100}%. Pausing.`)
          aborted = true
          abortReason = 'low_success_rate'
          break
        }
      }
      // Time budget
      if (Date.now() - startMs > PER_BRAND_TIME_BUDGET_MS) {
        console.log(`  ⏰ Time budget exhausted (${PER_BRAND_TIME_BUDGET_MS / 1000}s)`)
        abortReason = 'time_budget'
        break
      }
      // Target ads
      if (allAds.size >= TARGET_ADS_PER_BRAND) {
        console.log(`  🎯 Reached target of ${TARGET_ADS_PER_BRAND} ads`)
        break
      }
      // ── Multi-strategy scroll ──
      // Window-level scroll often doesn't trigger Meta's IntersectionObserver
      // because the ad list uses an inner scrollable container. We try every
      // strategy in sequence so at least one fires Meta's pagination loader.
      await page.evaluate(() => {
        // 1. Outer window scroll — works when body is the scrollable element
        window.scrollTo(0, document.body.scrollHeight)
        // 2. Walk every scrollable element and push to bottom
        const all = document.querySelectorAll<HTMLElement>('*')
        for (let i = 0; i < all.length; i++) {
          const el = all[i]
          const cs = getComputedStyle(el)
          if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100) {
            el.scrollTop = el.scrollHeight
          }
        }
        // 3. Dispatch a wheel event in case Meta listens for that
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 2000 }))
      }).catch(() => {})

      // 4. Keyboard End-key fallback (also triggers focus-based scroll)
      await page.keyboard.press('End').catch(() => {})

      metrics.scrollCount++
      await sleep(randomDelay())

      // 5. Bounce-scroll: scroll up a bit then back to bottom — many lazy-loaders
      // fire on direction-change rather than absolute position.
      if (scrollIdx % 3 === 0) {
        await page.evaluate(() => window.scrollBy(0, -800)).catch(() => {})
        await sleep(500)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {})
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Crawl error: ${e?.message}`)
    abortReason = `crawl_error: ${e?.message?.slice(0, 100)}`
    aborted = true   // mark as aborted so status='aborted' (was incorrectly staying 'success')
  }

  // Save cookies for next run
  try {
    const state = await context.storageState()
    await writeFile(STORAGE_STATE_FILE, JSON.stringify(state))
  } catch { /* ignore */ }

  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  if (proxy) await proxy.close().catch(() => {})

  // ========== Save to DB ==========
  metrics.adsDiscovered = allAds.size
  const adsArray = Array.from(allAds.values())
  const { inserted, existed } = await saveAdsToIndex(adsArray)
  metrics.adsNew = inserted
  metrics.adsAlreadySeen = existed

  console.log(`  ✅ ${opts.brandName || opts.pageId}: ${metrics.adsDiscovered} ads found (${inserted} new, ${existed} already seen) | ${metrics.scrollCount} scrolls | ${(metrics.bytesThroughProxy / 1024).toFixed(1)} KB`)

  // Update run record
  await (supabase as any).from('crawler_runs').update({
    finished_at: new Date().toISOString(),
    ads_discovered: metrics.adsDiscovered,
    ads_new: metrics.adsNew,
    ads_already_seen: metrics.adsAlreadySeen,
    bytes_through_proxy: metrics.bytesThroughProxy,
    responses_captured: metrics.responsesCaptured,
    cursors_seen: metrics.cursorsSeen,
    scroll_count: metrics.scrollCount,
    status: aborted ? 'aborted' : 'success',
    abort_reason: abortReason || null,
  }).eq('id', opts.runId)

  return metrics
}

// ========== Main ==========
async function main() {
  await ensureDirs()

  const arg = process.argv[2]
  const maxScrollsArg = process.argv.find(a => a.startsWith('--max-pages='))
  const maxScrolls = maxScrollsArg ? parseInt(maxScrollsArg.split('=')[1], 10) : undefined

  let brands: { page_id: string; term: string }[] = []
  if (arg && /^\d+$/.test(arg)) {
    // Look up the brand name from DB so crawler_runs.brand_name is populated
    // (otherwise the admin /admin/health dashboard shows "—" for these runs).
    const { data } = await (supabase as any)
      .from('discovery_crawl_terms')
      .select('term')
      .eq('page_id', arg)
      .limit(1)
      .maybeSingle()
    brands = [{ page_id: arg, term: data?.term ?? '' }]
  } else {
    const { data } = await (supabase as any)
      .from('discovery_crawl_terms')
      .select('page_id, term')
      .eq('is_active', true)
      .not('page_id', 'is', null)
      .order('last_crawled_at', { ascending: true, nullsFirst: true })
      .limit(20)
    brands = (data || []).map((b: any) => ({ page_id: b.page_id, term: b.term }))
  }

  if (brands.length === 0) {
    console.log('No brands to crawl. Add page_ids to discovery_crawl_terms.')
    process.exit(0)
  }

  console.log(`🚀 Playwright Indexer — ${brands.length} brand(s) to crawl`)
  for (const brand of brands) {
    const runId = randomBytes(16).toString('hex').slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
    try {
      const m = await crawlBrand({
        pageId: brand.page_id,
        brandName: brand.term,
        runId,
        maxScrolls,
      })
      // Only update last_crawled_at when the crawl actually discovered ads.
      // If the crawl errored at page.goto (proxy tunnel down, Meta 403'd, etc)
      // we want the scheduler to retry on the next cycle, not wait 45 min.
      if (m.adsDiscovered === 0) {
        console.warn(`  ⚠️ ${brand.term || brand.page_id}: 0 ads discovered — NOT updating last_crawled_at, will retry next cycle`)
        continue
      }
      await (supabase as any).from('discovery_crawl_terms')
        .update({ last_crawled_at: new Date().toISOString() })
        .eq('page_id', brand.page_id)
    } catch (e: any) {
      console.error(`💥 Brand ${brand.page_id} crashed: ${e?.message}`)
    }
  }

  console.log(`\n✅ All brands processed.`)
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
