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
import { pickProxy, openProxyChain, recordEvent, proxyPoolEnabled, type PoolProxy } from './proxy-pool.js'

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
// Re-crawl cadence. A successful crawl marks the brand crawled "now" → not
// re-crawled for SCHED_GAP_MIN. A GATED crawl (0 ads, IP soft-blocked) backs
// off only GATE_RETRY_MIN so a different IP can retry soon — without the old
// behaviour of hammering the same blocked brand every cycle.
const SCHED_GAP_MIN = parseInt(process.env.SCHEDULER_MIN_BRAND_GAP_MIN ?? '360', 10)  // 6h between full re-crawls
const GATE_RETRY_MIN = parseInt(process.env.SCHEDULER_GATE_RETRY_MIN ?? '15', 10)     // retry a gated brand in 15m
// After a crawl that added >= this many ads, re-crawl soon to verify we got the
// FULL inventory (Meta soft-gates can truncate a big brand to ~30 and mark it
// "complete"). The verify pass is cheap thanks to incremental early-stop.
const GROWTH_VERIFY_THRESHOLD = parseInt(process.env.SCHEDULER_GROWTH_VERIFY ?? '20', 10)
const VERIFY_RETRY_MIN = parseInt(process.env.SCHEDULER_VERIFY_RETRY_MIN ?? '30', 10) // verify-recrawl in 30m
// Below this many already-indexed ads, skip incremental early-stop and crawl
// fully — guards under-covered / soft-gated brands from being cemented low.
const INCREMENTAL_MIN_KNOWN = parseInt(process.env.SCHEDULER_INCREMENTAL_MIN_KNOWN ?? '100', 10)
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
async function saveAdsToIndex(
  ads: ExtractedAd[],
  // When set (affiliate-discovery mode), tag every saved ad with this marker in
  // seed_terms (e.g. "aff:184711951390377") so the brand's Discovery grid can
  // surface affiliate ads alongside the brand's own ads, without a schema change.
  seedTag?: string,
): Promise<{ inserted: number; existed: number }> {
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
    ...(seedTag ? { seed_terms: [seedTag] } : {}),
    raw_image_urls:         ad.raw_image_urls.length         > 0 ? ad.raw_image_urls         : null,
    raw_video_urls:         ad.raw_video_urls.length         > 0 ? ad.raw_video_urls         : null,
    raw_video_preview_urls: ad.raw_video_preview_urls.length > 0 ? ad.raw_video_preview_urls : null,
  }))

  // Split into NEW (insert) and EXISTING (update raw URLs only — keep
  // existing thumbnails/etc untouched).
  const adIds = ads.map(a => a.ad_archive_id)
  const { data: existing } = await (supabase as any)
    .from('discovery_ads_index')
    .select('ad_id, seed_terms')
    .in('ad_id', adIds)
  const existingIds = new Set((existing || []).map((r: any) => r.ad_id))
  const existingSeeds = new Map<string, string[]>(
    (existing || []).map((r: any) => [r.ad_id, Array.isArray(r.seed_terms) ? r.seed_terms : []])
  )
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
    // Affiliate mode: make sure the tag lands even on ads we'd already indexed.
    const needsTag = !!seedTag && !(existingSeeds.get(row.ad_id) || []).includes(seedTag)
    if (!row.raw_image_urls && !row.raw_video_urls && !needsTag) continue  // nothing to do
    const update: any = { last_seen: row.last_seen }
    if (row.raw_image_urls)         update.raw_image_urls = row.raw_image_urls
    if (row.raw_video_urls)         update.raw_video_urls = row.raw_video_urls
    if (row.raw_video_preview_urls) update.raw_video_preview_urls = row.raw_video_preview_urls
    if (needsTag) update.seed_terms = [...(existingSeeds.get(row.ad_id) || []), seedTag!]
    const { error } = await (supabase as any)
      .from('discovery_ads_index')
      .update(update)
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
  // ── Affiliate-discovery mode ──
  // When set, crawl a KEYWORD search (across all advertisers) instead of a
  // single page. Keep only ads whose page_id differs from `pageId` (the brand's
  // own page) AND whose caption/link/body references `affiliateDomain` — i.e.
  // OTHER pages running ads that drive to the brand's site. `probeOnly` logs the
  // affiliate pages found without writing them to the index.
  searchTerm?: string
  affiliateDomain?: string
  probeOnly?: boolean
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

  // ── Incremental crawl: load the ad IDs we already have for this brand ──
  // Meta lists a page's ads newest-first, so on a re-crawl we hit known ads
  // after a few pages. We stop the cursor-walk once a page is mostly-known,
  // turning a ~100-request full crawl into a ~10-request "just the new ads"
  // crawl. New brands (no known IDs) still crawl fully. Skipped in affiliate
  // mode (we want every affiliate, not just new ones).
  let knownIds: string[] = []
  if (!opts.searchTerm) {
    try {
      const { data } = await (supabase as any)
        .from('discovery_ads_index')
        .select('ad_id')
        .eq('page_id', opts.pageId)
        .order('last_seen', { ascending: false })
        .limit(2000)
      const loaded = ((data || []) as any[]).map(r => r.ad_id)
      // Only enable early-stop for WELL-COVERED brands. A brand with few indexed
      // ads may have been soft-gate-truncated (e.g. ag1 stuck at 30) — early-
      // stopping there would cement the partial count. Below the threshold we
      // crawl fully (cheap anyway) so under-covered brands always get a real shot.
      if (loaded.length >= INCREMENTAL_MIN_KNOWN) {
        knownIds = loaded
        console.log(`  ♻️ incremental: ${knownIds.length} ads already indexed — will stop early on known inventory`)
      } else if (loaded.length > 0) {
        console.log(`  🌱 ${loaded.length} ads indexed (< ${INCREMENTAL_MIN_KNOWN}) — full crawl to ensure coverage`)
      }
    } catch { /* full crawl on error */ }
  }

  // Try the proxy pool first (USE_PROXY_POOL=true + DB has enabled rows).
  // If pool returns nothing, fall back to legacy IPRoyal sticky session.
  // This keeps IPRoyal as a zero-config fallback during rollout.
  let pickedPoolProxy: PoolProxy | null = null
  let proxy: { url: string; close: () => Promise<void> } | null = null
  if (proxyPoolEnabled) {
    pickedPoolProxy = await pickProxy()
    if (pickedPoolProxy) {
      proxy = await openProxyChain(pickedPoolProxy)
      console.log(`  🔀 proxy-pool: ${pickedPoolProxy.label} (${pickedPoolProxy.host}:${pickedPoolProxy.port})`)
    }
  }
  if (!proxy && proxyChainEnabled) {
    proxy = await startProxyChain({ sessionId, lifetime: '1h', country: 'us' })
    console.log(`  🔀 iproyal-fallback (session ${sessionId})`)
  }

  // Chromium "new headless" mode (--headless=new). The OLD headless mode is
  // detectable by Meta — verified 2026-05-15: Arhaus pagination XHR never
  // fires in old headless even with stealth + real mouse.wheel events. New
  // headless behaves much closer to a real Chrome window: full DOM event
  // pipeline, real IntersectionObserver triggers, viewport rendering.
  // headless: false tells Playwright not to add its own --headless flag;
  // we set --headless=new ourselves.
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
    ],
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
  // Skip storage state — cookies accumulated across many crawls may be
  // flagged by Meta's session fingerprinting (verified 2026-05-16: same
  // code with no storage state captured 169 ads via cursor walk; with
  // stale cookies, ZERO GraphQL POSTs fired during crawl).
  // if (existsSync(STORAGE_STATE_FILE)) {
  //   try { ctxOpts.storageState = STORAGE_STATE_FILE } catch { /* ignore corrupted */ }
  // }
  const context = await browser.newContext(ctxOpts)

  // ROUTE BLOCKING DISABLED 2026-05-16. Standalone tool with NO blocking
  // captured 169 ads. Production with blocking gets 30 + zero GraphQL POSTs.
  // Some blocked URL is preventing Meta's pagination loader from initializing.
  // Cost trade-off: ~3 MB more bandwidth per crawl, but we get 5-7× more ads
  // captured. Net better value per MB.

  const page = await context.newPage()
  const allAds = new Map<string, ExtractedAd>()

  // ========== Pagination template capture ==========
  // Capture the FIRST AdLibrarySearchPaginationQuery POST that fires after
  // initial page load. We use it as a template to splice cursors into via
  // in-browser fetch (page.evaluate) — bypasses Meta's session-binding
  // rejection that breaks external replay (verified 2026-05-16: 169 Arhaus
  // ads captured in one cursor-walked run vs 30 from scroll-only).
  type PaginationTemplate = { url: string; headers: Record<string, string>; parsedBody: Record<string, string> }
  const tplState: { template: PaginationTemplate | null } = { template: null }
  const debugSeenGraphqlNames: string[] = []     // for diagnostic logging if no template found
  page.on('request', (req) => {
    if (tplState.template) return
    if (req.method() !== 'POST') return
    if (!req.url().includes('/api/graphql/')) return
    const body = req.postData() ?? ''
    if (!body.includes('variables=')) return
    const parsed: Record<string, string> = {}
    for (const pair of body.split('&')) {
      const [k, ...v] = pair.split('=')
      if (k) parsed[decodeURIComponent(k)] = decodeURIComponent(v.join('=') ?? '')
    }
    if (!parsed.variables) return
    const friendly = parsed.fb_api_req_friendly_name ?? ''
    debugSeenGraphqlNames.push(friendly || '(no name)')
    // Accept any AdLibrary-related POST that has cursor-style pagination params.
    // The exact friendly name varies (PaginationQuery, SearchResultsQuery, etc).
    const isAdLib = friendly.toLowerCase().includes('adlibrary')
    const hasCursor = parsed.variables.includes('cursor') || parsed.variables.includes('"first"')
    const hasPageId = parsed.variables.includes('viewAllPageID') || parsed.variables.includes('pageID')
    if (!isAdLib && !hasPageId) return
    if (!hasCursor) return
    tplState.template = { url: req.url(), headers: req.headers(), parsedBody: parsed }
    console.log(`  📡 Captured pagination template (friendly="${friendly}", has cursor: yes)`)
  })

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

      // Add to in-memory map (dedupe by ad_id).
      // IMPORTANT: ad_archive_id appears multiple times per ad in Meta's
      // responses — once in a lightweight collation wrapper (no snapshot/media)
      // and once in the full object (with snapshot media). "First wins" would
      // let a media-less wrapper permanently block the media-rich copy, leaving
      // ~60% of ads with no raw_image_urls. So we UPGRADE: a later copy that
      // carries media replaces an earlier media-less one.
      let newCount = 0
      const hasMedia = (a: ExtractedAd) => (a.raw_image_urls?.length ?? 0) > 0 || (a.raw_video_urls?.length ?? 0) > 0
      for (const ad of ads) {
        const existing = allAds.get(ad.ad_archive_id)
        if (!existing) {
          allAds.set(ad.ad_archive_id, ad)
          newCount++
        } else if (!hasMedia(existing) && hasMedia(ad)) {
          allAds.set(ad.ad_archive_id, ad)   // upgrade media-less → media-rich
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
  // Affiliate mode: keyword search across ALL advertisers. Otherwise: single page.
  const url = opts.searchTerm
    ? `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(opts.searchTerm)}&search_type=keyword_unordered&media_type=all`
    : `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${opts.pageId}`
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
      // ── Single discrete wheel per iteration (matches standalone tool that captured 169 ads) ──
      // Earlier rapid 3× wheels per iteration didn't register as discrete user
      // events — Meta's IntersectionObserver only saw clustered scrolls.
      // ONE wheel + longer wait works (verified by in-browser-paginate.ts).
      const viewport = page.viewportSize() ?? { width: 1440, height: 900 }
      await page.mouse.move(
        Math.floor(viewport.width * (0.3 + Math.random() * 0.4)),
        Math.floor(viewport.height * (0.4 + Math.random() * 0.3)),
      ).catch(() => {})
      await page.mouse.wheel(0, 1500 + Math.floor(Math.random() * 800)).catch(() => {})

      metrics.scrollCount++
      await sleep(1500 + Math.random() * 1000)   // 1.5-2.5 sec — match standalone

      // Direction-change bounce on iterations 6 + 11 (also from standalone)
      if (scrollIdx === 5 || scrollIdx === 10) {
        await page.mouse.wheel(0, -1200).catch(() => {})
        await sleep(800)
      }

      // ── Once we've captured a pagination template, switch to cursor-walk ──
      // Scroll-only pagination caps at 30 ads (Meta gates non-scroll-triggered
      // pagination from automation sessions). In-browser cursor walk via
      // page.evaluate sidesteps this — verified 2026-05-16: 169 ads/run.
      if (tplState.template) {
        console.log(`  🔁 Template captured — switching to cursor-walk pagination`)
        const adsCountBefore = allAds.size
        try {
          // Find latest end_cursor from already-captured responses. The response
          // listener above feeds extractAdsFromText which also finds cursors —
          // but we need the cursor from the most-recent pagination response,
          // not from the initial HTML. We let page.evaluate just run from the
          // template's current cursor (same one the template carried).
          const tpl = tplState.template
          const initialCursor: string | null = (() => {
            try { return JSON.parse(tpl.parsedBody.variables ?? '{}').cursor ?? null }
            catch { return null }
          })()
          if (!initialCursor) {
            console.warn(`  ⚠️ Template has no initial cursor — falling back to scroll-only`)
            continue
          }

          const evalScript = `
            (async () => {
              const tpl = ${JSON.stringify(tpl)};
              const startCursor = ${JSON.stringify(initialCursor)};
              const maxPages = ${TARGET_ADS_PER_BRAND / 10 + 5};   // ~10 ads per page
              const knownSet = new Set(${JSON.stringify(knownIds)});  // incremental: ads we already have

              const out = { pages: 0, fetched: 0, lastCursor: null, hasNext: true, stoppedEarly: false };
              let cursor = startCursor;
              let reqCounter = parseInt(tpl.parsedBody.__req || '0', 10);
              let knownStreak = 0;

              const hasNextRe = (s) => { const m = s.match(/"has_next_page"\\s*:\\s*(true|false)/); return m ? m[1] === 'true' : false; };
              const cursorRe = (s) => { const m = s.match(/"end_cursor"\\s*:\\s*"([^"]+)"/); return m ? m[1] : null; };
              const adIdRe = /"ad_archive_id"\\s*:\\s*"(\\d{10,})"/g;

              for (let p = 0; p < maxPages && cursor; p++) {
                const params = Object.assign({}, tpl.parsedBody);
                try {
                  const v = JSON.parse(params.variables);
                  v.cursor = cursor;
                  params.variables = JSON.stringify(v);
                } catch (e) { break; }
                reqCounter++;
                params.__req = String(reqCounter);
                params.__spin_t = String(Math.floor(Date.now() / 1000));
                const body = Object.entries(params).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
                try {
                  const r = await fetch(tpl.url, { method: 'POST', credentials: 'include', headers: tpl.headers, body });
                  if (!r.ok) break;
                  const text = await r.text();
                  out.fetched += text.length;
                  out.pages++;
                  cursor = cursorRe(text);
                  out.lastCursor = cursor;
                  out.hasNext = hasNextRe(text);
                  // ── Incremental early-stop ──
                  // If this page is mostly ads we already have (newest-first
                  // listing), we've reached known inventory. Two such pages in a
                  // row → stop; nothing new beyond here.
                  if (knownSet.size > 0) {
                    const ids = [];
                    let mm; adIdRe.lastIndex = 0;
                    while ((mm = adIdRe.exec(text)) !== null) ids.push(mm[1]);
                    const uniq = Array.from(new Set(ids));
                    if (uniq.length > 0) {
                      const knownCount = uniq.filter(id => knownSet.has(id)).length;
                      knownStreak = (knownCount / uniq.length >= 0.9) ? knownStreak + 1 : 0;
                      if (knownStreak >= 2 && p >= 1) { out.stoppedEarly = true; break; }
                    }
                  }
                  if (!out.hasNext || !cursor) break;
                  await new Promise(res => setTimeout(res, 800 + Math.random() * 700));
                } catch (e) { break; }
              }
              return out;
            })()
          `
          const result = await page.evaluate<{ pages: number; fetched: number; lastCursor: string | null; hasNext: boolean; stoppedEarly: boolean }>(evalScript)
          metrics.bytesThroughProxy += result.fetched
          // Wait briefly for response listener to drain final responses
          await sleep(2_000)
          const adsCountAfter = allAds.size
          console.log(`  🔁 Cursor-walk: ${result.pages} pages, ${(result.fetched / 1024).toFixed(1)} KB, ${adsCountAfter - adsCountBefore} new ads captured (total: ${adsCountAfter}) | has_next=${result.hasNext}${result.stoppedEarly ? ' | ♻️ stopped early (reached known ads)' : ''}`)

          // Cursor walk replaces the scroll loop — break out
          abortReason = result.stoppedEarly ? 'incremental_known' : (result.hasNext ? 'cursor_walk_ended_with_more' : 'cursor_walk_complete')
          break
        } catch (e: any) {
          console.warn(`  ⚠️ Cursor-walk error: ${e?.message?.slice(0, 200)} — continuing with scroll-only`)
        }
      }

      // 4. Every 3rd iteration: bounce-scroll up then real wheel down again.
      // Many lazy-loaders fire on direction-change rather than absolute position.
      if (scrollIdx % 3 === 0) {
        await page.mouse.wheel(0, -1200).catch(() => {})
        await sleep(800)
        await page.mouse.wheel(0, 2000).catch(() => {})
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Crawl error: ${e?.message}`)
    abortReason = `crawl_error: ${e?.message?.slice(0, 100)}`
    aborted = true   // mark as aborted so status='aborted' (was incorrectly staying 'success')
  }

  // Diagnostic: if we never captured a template, log what GraphQL POSTs we DID see
  if (!tplState.template && debugSeenGraphqlNames.length > 0) {
    const counts: Record<string, number> = {}
    for (const n of debugSeenGraphqlNames) counts[n] = (counts[n] ?? 0) + 1
    console.log(`  🔍 No template captured. GraphQL POSTs observed: ${JSON.stringify(counts)}`)
  } else if (!tplState.template) {
    console.log(`  🔍 No template captured. ZERO GraphQL POSTs observed during entire crawl — Meta is gating us.`)
  }

  // Save cookies for next run
  try {
    const state = await context.storageState()
    await writeFile(STORAGE_STATE_FILE, JSON.stringify(state))
  } catch { /* ignore */ }

  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  if (proxy) await proxy.close().catch(() => {})

  // Log crawl outcome to proxy pool (one event per brand crawl).
  // Drives the per-IP latency / error-rate stats on the admin dashboard.
  if (pickedPoolProxy) {
    const durMs = Date.now() - metrics.startedAt
    recordEvent({
      proxyId: pickedPoolProxy.id,
      kind: aborted ? 'error' : 'crawl',
      latencyMs: durMs,
      bytes: metrics.bytesThroughProxy,
      brandPageId: opts.pageId,
      errorMessage: aborted ? (abortReason || 'aborted') : null,
    })
  }

  // ========== Save to DB ==========
  metrics.adsDiscovered = allAds.size
  let adsArray = Array.from(allAds.values())

  // ── Affiliate filtering ──
  // In affiliate mode the keyword search returns ads from MANY pages. Keep only
  // genuine affiliates: a DIFFERENT page_id that references the brand's domain in
  // its caption, link, or body. This excludes the brand's own page and unrelated
  // ads that merely matched the keyword.
  if (opts.searchTerm && opts.affiliateDomain) {
    const dom = opts.affiliateDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
    const refsDomain = (a: ExtractedAd) =>
      [a.caption, a.link_url, a.body_text].some(f => (f || '').toLowerCase().includes(dom))
    const before = adsArray.length
    const affiliates = adsArray.filter(a => a.page_id && a.page_id !== opts.pageId && refsDomain(a))

    // Distinct affiliate pages, with counts — this is the headline result.
    const byPage = new Map<string, { name: string; count: number }>()
    for (const a of affiliates) {
      const e = byPage.get(a.page_id) || { name: a.page_name || '(unknown)', count: 0 }
      e.count++; byPage.set(a.page_id, e)
    }
    console.log(`\n  🔗 Affiliate scan for "${dom}": ${affiliates.length}/${before} ads from ${byPage.size} OTHER page(s):`)
    for (const [pid, { name, count }] of [...byPage.entries()].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`     ${String(count).padStart(4)}  ${pid}  ${name}`)
    }

    if (opts.probeOnly) {
      console.log(`  🧪 probe-only — not saving. (${affiliates.length} affiliate ads would be indexed)`)
      metrics.adsDiscovered = affiliates.length
      await (supabase as any).from('crawler_runs').update({
        finished_at: new Date().toISOString(),
        ads_discovered: affiliates.length,
        status: 'success', abort_reason: 'probe_only',
      }).eq('id', opts.runId)
      return metrics
    }
    adsArray = affiliates
  }

  // Tag affiliate ads so the brand's grid can surface them (mixed-in display).
  const seedTag = (opts.searchTerm && opts.affiliateDomain) ? `aff:${opts.pageId}` : undefined
  const { inserted, existed } = await saveAdsToIndex(adsArray, seedTag)
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

  // ── Affiliate-discovery mode ──
  //   npx tsx src/playwright-indexer.ts --affiliates=<domain> --own=<pageId> [--name="Brand"] [--probe] [--max-pages=N]
  // Crawls a keyword search for <domain> and reports/saves ads from OTHER pages
  // that drive to that domain (genuine affiliates).
  const affArg = process.argv.find(a => a.startsWith('--affiliates='))
  if (affArg) {
    const domain = affArg.split('=')[1]
    const ownArg = process.argv.find(a => a.startsWith('--own='))
    const nameArg = process.argv.find(a => a.startsWith('--name='))
    const searchArg = process.argv.find(a => a.startsWith('--search='))
    const probe = process.argv.includes('--probe')
    const ownPageId = ownArg ? ownArg.split('=')[1] : ''
    const brandName = nameArg ? nameArg.split('=')[1].replace(/^"|"$/g, '') : ''
    // What to TYPE into Meta's keyword search (recall). Defaults to the domain,
    // but you can search the brand NAME for broader recall and still filter by domain.
    const searchTerm = searchArg ? searchArg.split('=')[1].replace(/^"|"$/g, '') : domain
    if (!domain) { console.error('Usage: --affiliates=<domain> --own=<pageId> [--search="Brand Name"] [--probe]'); process.exit(1) }
    console.log(`🔗 Affiliate discovery — search="${searchTerm}" filter-domain="${domain}" own_page=${ownPageId || '(none)'} ${probe ? '[PROBE]' : '[SAVE]'}`)
    const runId = randomBytes(16).toString('hex').slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
    await crawlBrand({
      pageId: ownPageId || domain,
      brandName: brandName || `affiliates:${domain}`,
      runId, maxScrolls,
      searchTerm,
      affiliateDomain: domain,
      probeOnly: probe,
    })
    process.exit(0)
  }

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
      // Decide when this brand is eligible to crawl again by setting
      // last_crawled_at into the past so `now - last_crawled_at >= SCHED_GAP_MIN`
      // fires after `backoffMin`. Three cases:
      //   • Gated (0 ads, IP soft-blocked) → GATE_RETRY_MIN, another IP retries.
      //   • Substantial new ads (>= GROWTH_VERIFY_THRESHOLD) → VERIFY_RETRY_MIN.
      //     A truncated "soft-gate" crawl returns a partial set but is marked
      //     complete (e.g. ag1 returned 30 of hundreds). We can't tell a soft-gate
      //     from a real small brand in one crawl — so after ANY big haul we
      //     re-crawl soon to verify. Incremental makes the verify cheap: a fully
      //     covered brand finds ~0 new and settles to full cadence; a soft-gated
      //     one keeps finding new ads and keeps recovering until it stabilises.
      //   • Otherwise (little/no growth → stable) → full SCHED_GAP_MIN cadence.
      const now = Date.now()
      let backoffMin: number
      if (m.adsDiscovered === 0) {
        backoffMin = GATE_RETRY_MIN
        console.warn(`  ⚠️ ${brand.term || brand.page_id}: 0 ads (gated) — retry in ${GATE_RETRY_MIN} min`)
      } else if (m.adsNew >= GROWTH_VERIFY_THRESHOLD) {
        backoffMin = VERIFY_RETRY_MIN
        console.log(`  🔎 ${brand.term || brand.page_id}: +${m.adsNew} new — verify-recrawl in ${VERIFY_RETRY_MIN} min (guards against soft-gate truncation)`)
      } else {
        backoffMin = SCHED_GAP_MIN
      }
      const lastCrawled = new Date(now - Math.max(0, SCHED_GAP_MIN - backoffMin) * 60_000).toISOString()
      await (supabase as any).from('discovery_crawl_terms')
        .update({ last_crawled_at: lastCrawled })
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
