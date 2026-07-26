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
import { isCacheableAsset, readAsset, writeAsset } from './asset-cache.js'
import { startProxyChain, proxyChainEnabled, getProxyBytesTotal } from './proxy-chain.js'
import { pickProxy, openProxyChain, recordEvent, proxyPoolEnabled, type PoolProxy } from './proxy-pool.js'
import { detectIndustries, detectThemes, normalizePlatforms } from './classify.js'

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
const EMPTY_BRAND_BAIL_SCROLLS = 5        // if 0 ads + no pagination template after this many
                                          // scrolls, the page has nothing (personal acct / inactive
                                          // advertiser — ~86% of the cold queue). Bail instead of
                                          // grinding the full 60 / 4-min time budget on a dead brand.
const SCROLL_DELAY_MIN_MS = 2_500
const SCROLL_DELAY_MAX_MS = 5_000         // tighter range — we want pagination to fire faster

// Pagination
const TARGET_ADS_PER_BRAND = 10000        // per-PASS cap for the bulk queue. With cursor-resume,
                                          // this is just how many ads a single pass grabs before
                                          // saving the resume point — a brand bigger than 10K keeps
                                          // filling across passes until done. Spied brands (opts.full)
                                          // ignore this entirely (200K).
// Re-crawl cadence. A successful crawl marks the brand crawled "now" → not
// re-crawled for SCHED_GAP_MIN. A GATED crawl (0 ads, IP soft-blocked) backs
// off only GATE_RETRY_MIN so a different IP can retry soon — without the old
// behaviour of hammering the same blocked brand every cycle.
const SCHED_GAP_MIN = parseInt(process.env.SCHEDULER_MIN_BRAND_GAP_MIN ?? '360', 10)  // 6h between full re-crawls
const GATE_RETRY_MIN = parseInt(process.env.SCHEDULER_GATE_RETRY_MIN ?? '15', 10)     // retry a gated brand in 15m
// Verify-recrawl: re-crawl soon ONLY when this crawl looks SOFT-GATED, not after
// every productive haul. Meta soft-gates truncate a brand to ~30 ads and mark the
// page "complete" (has_next_page=false). The OLD trigger ("added >= GROWTH_VERIFY
// new ads") fired on EVERY productive crawl — e.g. a fresh brand returning 1,013
// ads got re-crawled 30 min later for nothing — which is what was burning IPRoyal
// and breaking the 7-day cadence (re-crawling at ~283/hr). The real soft-gate
// SIGNATURE is a crawl that hit Meta's has_next_page=false at a SUSPICIOUSLY LOW
// count (truncation) — OR hit the page cap with more pages still pending. A big
// "complete" haul or an incremental early-stop on known ads is NOT suspect.
const SOFT_GATE_SUSPECT_MAX = parseInt(process.env.SCHEDULER_SOFT_GATE_MAX ?? '45', 10) // a "complete" crawl returning <= this many is truncation-suspect
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
  bytesThroughProxy: number          // decompressed JSON length (body.length) — NOT the IPRoyal bill
  proxyBytesStart: number            // getProxyBytesTotal() snapshot at brand start → real compressed delta
  blockedMedia: number       // video/image/font requests aborted (never hit IPRoyal)
  cacheHits: number          // JS/CSS served from disk cache (0 IPRoyal)
  cacheMiss: number          // JS/CSS fetched + cached (paid IPRoyal once)
  responsesCaptured: number
  cursorsSeen: number
  scrollCount: number
  successWindow: boolean[]   // true = ad data, false = empty/error
  softGateSuspect: boolean   // crawl looks truncated/incomplete → warrants one verify-recrawl
  emptyBrandBail: boolean    // 0 ads + no template → genuinely empty page (not gated)
  nextCursor: string | null  // resume point: cursor to start the NEXT crawl from when we
                             // stopped mid-library (cap/budget) with more to go; null = done
}

interface ExtractedAd {
  ad_archive_id: string
  page_id: string
  page_name: string
  is_active: boolean
  start_date_string?: string
  end_date_string?: string
  start_date_epoch?: number      // Meta's start_date (unix seconds) — present ~always
  end_date_epoch?: number
  targeted_countries?: string[]  // targeted_or_reached_countries (empty in country=ALL crawls)
  publisher_platform?: string[]  // FACEBOOK / INSTAGRAM / MESSENGER / ...
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
let DEBUG_DATES_SEEN = 0  // TEMP: caps the DEBUG_DATES probe output (remove with the probe)
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

    // TEMP DIAGNOSTIC (writes to crawl_date_probe, mig 120): capture every date/time-ish key Meta
    // sends per ad, next to the value our CURRENT parser would store, so we can SELECT the table and
    // see which field holds the REAL launch date — then ship the days_running fix with certainty
    // instead of guessing, and DROP this table. Only writes SUSPICIOUS ads (active with a computed
    // start within the last ~2 days = the broken population), so the table stays tiny. Fire-and-forget,
    // capped per process. Remove this block + the table after diagnosis.
    if (DEBUG_DATES_SEEN < 400) {
      const computedStartIso = obj.start_date_string || epochToIso(typeof obj.start_date === 'number' ? obj.start_date : undefined)
      const computedMs = computedStartIso ? Date.parse(computedStartIso) : NaN
      const suspicious = !!obj.is_active && (!Number.isFinite(computedMs) || (Date.now() - computedMs) < 2 * 86400e3)
      if (suspicious) {
        DEBUG_DATES_SEEN++
        const dateKeys: Record<string, any> = {}
        for (const k of Object.keys(obj)) {
          if (/date|time|start|end|active|created|elapsed|duration|collation/i.test(k)) dateKeys[k] = obj[k]
        }
        const hasMediaHere = (media.allImages?.length ?? 0) > 0 || (media.allVideos?.length ?? 0) > 0
        void (supabase as any).from('crawl_date_probe').upsert({
          ad_id: String(obj.ad_archive_id),
          page_name: snap.page_name || null,
          is_active: !!obj.is_active,
          has_media: hasMediaHere,
          computed_start: computedStartIso || null,
          raw_dates: dateKeys,
          seen_at: new Date().toISOString(),
        }, { onConflict: 'ad_id' }).then(() => {}, () => {})
      }
    }

    found.push({
      ad_archive_id: obj.ad_archive_id,
      page_id: obj.page_id || snap.page_id || '',
      page_name: snap.page_name || '',
      is_active: !!obj.is_active,
      start_date_string: obj.start_date_string,
      end_date_string: obj.end_date_string,
      start_date_epoch: typeof obj.start_date === 'number' ? obj.start_date : undefined,
      end_date_epoch: typeof obj.end_date === 'number' ? obj.end_date : undefined,
      targeted_countries: Array.isArray(obj.targeted_or_reached_countries) ? obj.targeted_or_reached_countries : undefined,
      publisher_platform: Array.isArray(snap.publisher_platform) ? snap.publisher_platform
                        : (Array.isArray(obj.publisher_platform) ? obj.publisher_platform : undefined),
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

// Normalize Meta's messy display_format (VIDEO/IMAGE/Image/DCO/DPA/CAROUSEL…)
// into the 3 values the Discovery UI filters on: Image / Video / Carousel.
// Prefer the actual media (video present = Video), then explicit format, then
// infer (multiple distinct images = Carousel). Fixes the format filter, which
// returned 0 for "Video"/"Carousel" due to the case/taxonomy mismatch.
function normalizeFormat(ad: ExtractedAd): string {
  const df = (ad.display_format || '').toUpperCase()
  if ((ad.raw_video_urls?.length ?? 0) > 0 || df === 'VIDEO') return 'Video'
  if (df === 'CAROUSEL') return 'Carousel'
  if (df === 'IMAGE') return 'Image'
  if ((ad.raw_image_urls?.length ?? 0) > 1) return 'Carousel'
  return 'Image'
}
function epochToIso(sec?: number): string | null {
  return (typeof sec === 'number' && sec > 0) ? new Date(sec * 1000).toISOString() : null
}

// ========== DB writes ==========
async function saveAdsToIndex(
  ads: ExtractedAd[],
  // When set (affiliate-discovery mode), tag every saved ad with this marker in
  // seed_terms (e.g. "aff:184711951390377") so the brand's Discovery grid can
  // surface affiliate ads alongside the brand's own ads, without a schema change.
  seedTag?: string,
  // When set (per-country crawl, country=<CC>), every ad returned ran in <CC> —
  // merge it into the ad's targeted_countries so the Country filter works.
  tagCountry?: string,
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
    link_url: ad.link_url || null,   // destination URL (migration 045) → Brand Spy Landing Pages

    is_active: ad.is_active,
    format: normalizeFormat(ad),
    // Meta usually omits the *_string dates but always sends epoch start_date.
    start_date: ad.start_date_string || epochToIso(ad.start_date_epoch),
    stop_date: ad.end_date_string || epochToIso(ad.end_date_epoch),
    // Auto-tag from ad text + payload so Industry/Theme/Platform filters work
    // server-side (no manual category typing needed — Mars Men self-tags).
    industries: detectIndustries(`${ad.body_text || ''} ${ad.caption || ''} ${ad.page_name || ''}`),
    themes: detectThemes(`${ad.body_text || ''} ${ad.caption || ''}`),
    platforms: normalizePlatforms(ad.publisher_platform),
    last_seen: new Date().toISOString(),
    ...(tagCountry
      ? { targeted_countries: [tagCountry] }
      : (ad.targeted_countries && ad.targeted_countries.length > 0 ? { targeted_countries: ad.targeted_countries } : {})),
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
    .select('ad_id, seed_terms, targeted_countries')
    .in('ad_id', adIds)
  const existingIds = new Set((existing || []).map((r: any) => r.ad_id))
  const existingSeeds = new Map<string, string[]>(
    (existing || []).map((r: any) => [r.ad_id, Array.isArray(r.seed_terms) ? r.seed_terms : []])
  )
  const existingCountries = new Map<string, string[]>(
    (existing || []).map((r: any) => [r.ad_id, Array.isArray(r.targeted_countries) ? r.targeted_countries : []])
  )
  const newRows      = rows.filter(r => !existingIds.has(r.ad_id))
  const existedRows  = rows.filter(r =>  existingIds.has(r.ad_id))

  if (newRows.length > 0) {
    // CHUNK the upsert. discovery_ads_index carries ~23 indexes (incl. 3 GIN), so
    // each row is heavy to write; a single statement inserting a big brand's
    // hundreds of new ads blew the 60s statement_timeout under concurrency and
    // LOST those ads. Small batches each finish fast → inserts succeed and more
    // concurrent crawls can run. Sequential so we don't pile parallel writes.
    const CHUNK = 50
    for (let i = 0; i < newRows.length; i += CHUNK) {
      const batch = newRows.slice(i, i + CHUNK)
      const { error } = await (supabase as any)
        .from('discovery_ads_index')
        .upsert(batch, { onConflict: 'ad_id' })
      if (error) console.warn(`[save-ads] insert error (rows ${i}-${i + batch.length}): ${error.message}`)
    }
  }

  // Backfill raw URLs onto existing rows. Critical for the migration: most
  // discovered ads predate migration 013 and have raw_*_urls = NULL. As
  // soon as the indexer re-sees them, we populate the columns and the
  // worker's fast path picks them up.
  for (const row of existedRows) {
    // Affiliate mode: make sure the tag lands even on ads we'd already indexed.
    const needsTag = !!seedTag && !(existingSeeds.get(row.ad_id) || []).includes(seedTag)
    // Per-country crawl: add this country to the ad's targeted_countries if missing.
    const needsCountry = !!tagCountry && !(existingCountries.get(row.ad_id) || []).includes(tagCountry)
    if (!row.raw_image_urls && !row.raw_video_urls && !needsTag && !needsCountry) continue  // nothing to do
    const update: any = { last_seen: row.last_seen }
    if (row.raw_image_urls)         update.raw_image_urls = row.raw_image_urls
    if (row.raw_video_urls)         update.raw_video_urls = row.raw_video_urls
    if (row.raw_video_preview_urls) update.raw_video_preview_urls = row.raw_video_preview_urls
    if (needsTag) update.seed_terms = [...(existingSeeds.get(row.ad_id) || []), seedTag!]
    if (needsCountry) update.targeted_countries = [...(existingCountries.get(row.ad_id) || []), tagCountry!]
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
  // Per-country crawl: crawl country=<CC> instead of country=ALL and tag every
  // returned ad with <CC> in targeted_countries (powers the Country filter).
  country?: string
  // FULL re-crawl (spied brands only): lift the 1500 target / page / time caps AND
  // disable the incremental early-stop, so we walk the ENTIRE library to has_next=false —
  // including the inactive/taken-down archive that sits past the active ads. Expensive, so
  // scoped to high-priority spied brands, never the bulk queue.
  full?: boolean
}): Promise<RunMetrics> {
  // Per-crawl caps — lifted when `full` so a spied brand gets its complete archive.
  const TARGET = opts.full ? 200_000 : TARGET_ADS_PER_BRAND
  const TIME_BUDGET = opts.full ? 2_100_000 : PER_BRAND_TIME_BUDGET_MS   // 35 min for full (a 14K-ad
  // brand like Grüns is ~19 min of paging; the old 20 min cut it off mid-archive). Cursor-resume
  // still backstops anything that exceeds even this, filling across the next pass.
  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  const metrics: RunMetrics = {
    brandPageId: opts.pageId,
    brandName: opts.brandName || '',
    sessionId,
    startedAt: Date.now(),
    adsDiscovered: 0, adsNew: 0, adsAlreadySeen: 0,
    bytesThroughProxy: 0, proxyBytesStart: getProxyBytesTotal(), blockedMedia: 0, cacheHits: 0, cacheMiss: 0,
    responsesCaptured: 0, cursorsSeen: 0, scrollCount: 0,
    successWindow: [],
    softGateSuspect: false,
    emptyBrandBail: false,
    nextCursor: null,
  }

  // Cursor-resume: country=ALL crawls resume from where the last pass stopped, so a big
  // brand (50K ads) fills in over many cheap passes instead of restarting from the top and
  // early-stopping on the ads we already have. Only for the single-country path.
  let resumeCursor: string | null = null
  if (!opts.country && !opts.searchTerm) {
    const { data: st } = await (supabase as any).from('discovery_brand_crawl_state').select('cursor').eq('page_id', opts.pageId).maybeSingle()
    resumeCursor = st?.cursor || null
    if (resumeCursor) console.log(`  ⏭️  resuming from saved cursor (brand has more ads past what we've crawled)`)
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
  // Incremental: load ads we already have. For a PER-COUNTRY crawl the known set
  // is ads already TAGGED with that country (targeted_countries contains it) — so
  // a re-crawl of country=GB stops once it hits ads already known-in-GB, fetching
  // only NEW ads instead of re-pulling all 1,580 every week. First crawl of a
  // country has 0 tagged → full enumeration (one-time). Skipped in affiliate mode.
  if (!opts.searchTerm) {
    try {
      let q = (supabase as any)
        .from('discovery_ads_index')
        .select('ad_id')
        .eq('page_id', opts.pageId)
      if (opts.country) q = q.contains('targeted_countries', [opts.country])
      const { data } = await q.order('last_seen', { ascending: false }).limit(2000)
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

  // ── Media/asset blocking (2026-06-19, v2 host-based) ──
  // The IPRoyal video CDN bytes weren't from resourceType 'media' — Meta streams
  // ad-video previews via xhr/fetch (MSE), which a resourceType block can't catch
  // (we must allow 'fetch' for GraphQL). So block the media CDNs by HOST: any
  // `video-*`/`video.*` and `scontent-*`/`scontent.*` fbcdn/cdninstagram host —
  // we never need those bytes (ad data + media URLs come from GraphQL JSON; the
  // real media is downloaded later DIRECT off-proxy by the worker). We deliberately
  // do NOT touch `static.xx.fbcdn.net` (Meta's pagination JS) or `www.facebook.com`
  // (the GraphQL endpoint) — blocking those broke pagination on 2026-05-16.
  await context.route('**/*', async (route) => {
    const req = route.request()
    const t = req.resourceType()
    if (t === 'media' || t === 'image' || t === 'font') { metrics.blockedMedia++; return route.abort() }
    const url = req.url()
    let host = ''
    try { host = new URL(url).hostname } catch { /* ignore */ }
    if (host.startsWith('video-') || host.startsWith('video.') || host.startsWith('scontent-') || host.startsWith('scontent.')) { metrics.blockedMedia++; return route.abort() }
    // JS/CSS DISK CACHE — Facebook's static bundles are the same versioned files
    // every crawl. Serve from local disk to skip the metered proxy. Only GET; a
    // cache hit costs 0 IPRoyal. Misses fetch through the proxy once, then cache.
    if (req.method() === 'GET' && isCacheableAsset(url)) {
      try {
        const hit = await readAsset(url)
        if (hit) { metrics.cacheHits++; return route.fulfill({ status: hit.status, headers: hit.headers, body: hit.body }) }
        const resp = await route.fetch()
        const body = await resp.body()
        void writeAsset(url, resp.status(), resp.headers(), body)
        metrics.cacheMiss++
        const headers: Record<string, string> = { ...resp.headers() }
        delete headers['content-encoding']; delete headers['content-length']
        return route.fulfill({ status: resp.status(), headers, body })
      } catch { return route.continue() }   // any cache/fetch error → normal load
    }
    return route.continue()
  })

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
      // Real IPRoyal cost = compressed wire bytes (getProxyBytesTotal delta), NOT body.length
      // (decompressed JSON, ~5-10× larger). Show the real number so cost is never misread again.
      const realKB = (getProxyBytesTotal() - metrics.proxyBytesStart) / 1024
      console.log(`  📦 captured ${ads.length} ads (${newCount} new) + ${cursors.length} cursors | ${realKB.toFixed(1)} KB IPRoyal (real) · ${(metrics.bytesThroughProxy / 1024).toFixed(1)} KB JSON | ${metrics.blockedMedia} media blocked | JS/CSS cache ${metrics.cacheHits} hit / ${metrics.cacheMiss} miss`)
    } catch (e: any) {
      console.warn(`  ⚠️ response handler: ${e?.message?.slice(0, 100)}`)
    }
  })

  // ========== Navigate + scroll ==========
  // Affiliate mode: keyword search across ALL advertisers. Otherwise: single page.
  const url = opts.searchTerm
    ? `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&q=${encodeURIComponent(opts.searchTerm)}&search_type=keyword_unordered&media_type=all`
    : `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${opts.country || 'ALL'}&view_all_page_id=${opts.pageId}`
  let aborted = false
  let abortReason = ''
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // Adaptive initial wait: poll (up to 8s) for the first real ad-library GraphQL response instead
    // of a blind 8s sleep. responsesCaptured/allAds/template only advance when actual ad data or a
    // pagination template arrives, so this NEVER proceeds before the page has data (no false-empties)
    // — it just stops waiting once the data is already here. Responsive brands go in ~2-3s; slow ones
    // still get the full 8s. Saves several seconds on the ~third of brands that respond fast.
    {
      const renderDeadline = Date.now() + 8_000
      while (Date.now() < renderDeadline) {
        if (metrics.responsesCaptured > 0 || allAds.size > 0 || tplState.template) break
        await sleep(400)
      }
    }

    const startMs = Date.now()
    const maxScrolls = opts.maxScrolls ?? (opts.full ? 600 : MAX_SCROLLS_PER_BRAND)

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
      if (Date.now() - startMs > TIME_BUDGET) {
        console.log(`  ⏰ Time budget exhausted (${TIME_BUDGET / 1000}s)`)
        abortReason = 'time_budget'
        break
      }
      // Target ads
      if (allAds.size >= TARGET) {
        console.log(`  🎯 Reached target of ${TARGET} ads`)
        break
      }
      // Empty-brand early bail — page rendered + scrolled a few times with ZERO ads and
      // no pagination template captured → this advertiser has nothing in the Library.
      // ~86% of the cold queue is like this (personal accounts), and without this they
      // run the full 4-min time budget. Bail now and let the crawler move on. Distinct
      // from a gate (which trips anti-burn / returns block pages) → cadence treats it as
      // a clean empty, not a soon-retry.
      if (scrollIdx >= EMPTY_BRAND_BAIL_SCROLLS && allAds.size === 0 && !tplState.template) {
        console.log(`  ∅ ${opts.brandName || opts.pageId}: 0 ads after ${scrollIdx} scrolls, no template — empty brand, bailing`)
        metrics.emptyBrandBail = true
        abortReason = 'empty_brand_bail'
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
          const initialCursor: string | null = resumeCursor || (() => {
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
              const maxPages = ${opts.full ? 20000 : TARGET_ADS_PER_BRAND / 10 + 5};   // ~10 ads per page
              const knownSet = new Set(${JSON.stringify(opts.full ? [] : knownIds)});  // empty in FULL mode → no early-stop, walk the whole archive

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
          // Cursor-resume: stopped mid-library with more to go AND made progress → save the
          // resume point for the next pass. Complete / caught-up / no-progress → clear it.
          metrics.nextCursor = (abortReason === 'cursor_walk_ended_with_more' && result.lastCursor && (adsCountAfter - adsCountBefore) > 0)
            ? result.lastCursor : null
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
  // Soft-gate suspicion (drives verify-recrawl). TRUE only when the result might be
  // INCOMPLETE: Meta said "complete" (has_next_page=false) but at a suspiciously low
  // count (classic ~30 truncation), OR we stopped at the page cap with more pending.
  // FALSE for a big clean haul (clearly complete) and for an incremental early-stop
  // on known ads (we know we captured the full NEW set) — so productive crawls no
  // longer trigger a wasteful 30-min re-crawl.
  metrics.softGateSuspect =
    abortReason === 'cursor_walk_ended_with_more' ||
    (abortReason === 'cursor_walk_complete' && metrics.adsDiscovered <= SOFT_GATE_SUSPECT_MAX)
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
  const { inserted, existed } = await saveAdsToIndex(adsArray, seedTag, opts.country)
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

// ── Country config (admin /admin/countries) ──
// Stored as a config row in discovery_crawl_terms. Multi-country crawling is
// OFF by default → behaviour is unchanged (single country=ALL crawl per brand).
async function readCountryConfig(): Promise<{ enabled: boolean; countries: string[] }> {
  try {
    const { data } = await (supabase as any)
      .from('discovery_crawl_terms')
      .select('countries, is_active')
      .eq('term', '__crawl_countries__')
      .eq('term_type', 'config')
      .maybeSingle()
    return {
      enabled: !!data?.is_active,
      countries: (Array.isArray(data?.countries) ? data.countries : []).filter((c: any) => /^[A-Z]{2}$/.test(c)),
    }
  } catch { return { enabled: false, countries: [] } }
}

/**
 * Crawl one brand, honouring the multi-country toggle.
 *  • OFF  → one country=ALL crawl (unchanged).
 *  • ON   → crawl each target country, tag ads with it. SKIP-EMPTY: only crawl
 *           the countries this brand actually has ads in (stored in its
 *           `countries` column); 1-in-5 cycles re-sweep the full list to catch
 *           expansion. Returns aggregate {adsDiscovered, adsNew} for cadence logic.
 */
async function crawlBrandCountries(opts: {
  pageId: string; brandName: string; maxScrolls?: number; full?: boolean
  config: { enabled: boolean; countries: string[] }
  activeCountries: string[]
}): Promise<{ adsDiscovered: number; adsNew: number; softGateSuspect: boolean; emptyBrandBail: boolean; nextCursor: string | null }> {
  const mkRun = () => randomBytes(16).toString('hex').slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')

  // Single country=ALL crawl (toggle OFF or no countries configured).
  if (!opts.config.enabled || opts.config.countries.length === 0) {
    const m = await crawlBrand({ pageId: opts.pageId, brandName: opts.brandName, runId: mkRun(), maxScrolls: opts.maxScrolls, full: opts.full })
    return { adsDiscovered: m.adsDiscovered, adsNew: m.adsNew, softGateSuspect: m.softGateSuspect, emptyBrandBail: m.emptyBrandBail, nextCursor: m.nextCursor }
  }

  // Multi-country: pick the countries to crawl (skip-empty). Intersect the
  // brand's active list with the CONFIGURED countries — brands can carry a stale
  // `countries` column (old data) with countries no longer in the admin list.
  const configured = new Set(opts.config.countries)
  const activeInConfig = opts.activeCountries.filter(c => configured.has(c))
  const fullSweep = activeInConfig.length === 0 || Math.random() < 0.2
  const toCrawl = fullSweep ? opts.config.countries : activeInConfig
  console.log(`  🌍 multi-country (${fullSweep ? 'full sweep' : 'active only'}): ${toCrawl.join(', ')}`)

  let totalDiscovered = 0, totalNew = 0, anySuspect = false, everyEmptyBail = true
  const hadAds: string[] = []
  for (const cc of toCrawl) {
    const m = await crawlBrand({ pageId: opts.pageId, brandName: opts.brandName, runId: mkRun(), maxScrolls: opts.maxScrolls, country: cc, full: opts.full })
    totalDiscovered += m.adsDiscovered; totalNew += m.adsNew
    if (m.softGateSuspect) anySuspect = true
    if (!m.emptyBrandBail) everyEmptyBail = false   // empty only if EVERY country was empty
    if (m.adsDiscovered > 0) hadAds.push(cc)
    await sleep(2_000)  // small gap between country crawls
  }

  // Update the brand's active-country list (where it actually has ads). On a
  // full sweep this is authoritative; on an active-only pass, keep any prior
  // country that still produced ads + drop the ones that went silent.
  const newActive = fullSweep
    ? hadAds
    : Array.from(new Set([...opts.activeCountries.filter(c => hadAds.includes(c)), ...hadAds]))
  await (supabase as any).from('discovery_crawl_terms')
    .update({ countries: newActive })
    .eq('page_id', opts.pageId)
  console.log(`  🌍 active countries for ${opts.brandName || opts.pageId}: ${newActive.join(', ') || '(none)'}`)

  return { adsDiscovered: totalDiscovered, adsNew: totalNew, softGateSuspect: anySuspect, emptyBrandBail: totalDiscovered === 0 && everyEmptyBail, nextCursor: null }
}

// Stamp a brand's MANUAL admin categories onto all its ads (brand_categories),
// Apply a brand's MANUAL admin metadata to all its ads: the category tag, and —
// if the admin set a manual industry — that industry (overriding the keyword
// auto-detector, which mislabels e.g. apparel brands as "Health & Fitness").
// The manual industry is authoritative and applies to new + existing ads.
async function stampBrandMetadata(pageId: string, categories: string[], industry?: string | null) {
  const update: any = {}
  if (categories.length) update.brand_categories = categories
  if (industry) update.industries = [industry]
  if (Object.keys(update).length === 0) return
  await (supabase as any).from('discovery_ads_index').update(update).eq('page_id', pageId)
  console.log(`  🏷️ stamped${categories.length ? ` categories [${categories.join(', ')}]` : ''}${industry ? ` industry [${industry}]` : ''}`)
}

/**
 * Affiliate discovery for a SPIED brand. After we've fully crawled the brand's OWN page, we
 * also want the "Sarah Graysun with Grüns" creator/affiliate ads that Atria counts toward the
 * brand's total (Grüns shows 14,448 there — far more than its own page). Those ads live on
 * OTHER pages but reference the brand's domain, so:
 *   1. Derive the brand's destination domain from its own ads' link_url (the most common one,
 *      excluding social hosts), and
 *   2. Run a keyword search for that domain, keeping ads from other pages that reference it,
 *      tagged `aff:<pageId>` so the Brand Spy engine can merge them into the brand view.
 * Best-effort: if we can't find a domain (no link_url captured), skip silently.
 */
async function discoverAffiliatesFor(pageId: string, brandName: string, maxScrolls?: number) {
  const SOCIAL = ['facebook.com', 'instagram.com', 'fb.com', 'fb.me', 'l.facebook.com', 'lm.facebook.com']
  // Sample recent ads to find the brand's own destination domain.
  const { data } = await (supabase as any)
    .from('discovery_ads_index')
    .select('link_url')
    .eq('page_id', pageId)
    .not('link_url', 'is', null)
    .order('last_seen', { ascending: false })
    .limit(800)
  const tally = new Map<string, number>()
  for (const r of (data || []) as { link_url: string | null }[]) {
    const raw = (r.link_url || '').toLowerCase()
    const m = raw.match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})/i)
    if (!m) continue
    const host = m[1]
    if (SOCIAL.some(s => host === s || host.endsWith('.' + s))) continue
    tally.set(host, (tally.get(host) || 0) + 1)
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!top) { console.log(`  🔗 ${brandName || pageId}: no destination domain in ads — skipping affiliate scan`); return }
  const domain = top[0]
  console.log(`  🔗 ${brandName || pageId}: affiliate scan for domain="${domain}" (search by brand name)`)
  const runId = randomBytes(16).toString('hex').slice(0, 32).replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')
  try {
    await crawlBrand({
      pageId, brandName, runId,
      // Search the brand NAME for broad recall, then filter to ads that actually reference the
      // domain — catches affiliates who name the brand but link via a tracker/shortlink too.
      searchTerm: brandName || domain,
      affiliateDomain: domain,
      maxScrolls: maxScrolls ?? 80,
    })
  } catch (e: any) {
    console.warn(`  🔗 affiliate scan failed for ${brandName || pageId}: ${e?.message ?? e}`)
  }
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

  const countryConfig = await readCountryConfig()
  if (countryConfig.enabled) console.log(`🌍 Multi-country crawling ON: ${countryConfig.countries.join(', ')}`)

  // Manual categories the user set in admin live in either `categories` (array)
  // or `category` (singular) — merge both, lowercased, for stamping onto ads.
  const manualCats = (b: any): string[] => Array.from(new Set([
    ...((Array.isArray(b?.categories) ? b.categories : []) as string[]),
    ...(b?.category && b.category !== 'General' ? [b.category] : []),
  ].map(c => String(c).trim().toLowerCase()).filter(Boolean)))

  let brands: { page_id: string; term: string; countries: string[]; categories: string[]; industry: string | null; ads_found: number | null; priority: number; full_crawled_at: string | null }[] = []
  if (arg && /^\d+$/.test(arg)) {
    const { data } = await (supabase as any)
      .from('discovery_crawl_terms')
      .select('term, countries, category, categories, industry, ads_found, priority, full_crawled_at')
      .eq('page_id', arg)
      .limit(1)
      .maybeSingle()
    brands = [{ page_id: arg, term: data?.term ?? '', countries: Array.isArray(data?.countries) ? data.countries : [], categories: manualCats(data), industry: data?.industry || null, ads_found: data?.ads_found ?? null, priority: data?.priority ?? 5, full_crawled_at: data?.full_crawled_at ?? null }]
  } else {
    const { data } = await (supabase as any)
      .from('discovery_crawl_terms')
      .select('page_id, term, countries, category, categories, industry, ads_found, priority, full_crawled_at')
      .eq('is_active', true)
      .not('page_id', 'is', null)
      // Never-crawled brands first (last_crawled_at null), and WITHIN those, NEWEST-ADDED first
      // (created_at desc) — so a freshly-imported batch of good brands jumps ahead of the older
      // junk import instead of waiting behind 48K never-crawled locals. Crawled brands re-enter
      // oldest-first for the re-crawl cadence.
      .order('last_crawled_at', { ascending: true, nullsFirst: true })
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(20)
    brands = (data || []).map((b: any) => ({ page_id: b.page_id, term: b.term, countries: Array.isArray(b.countries) ? b.countries : [], categories: manualCats(b), industry: b.industry || null, ads_found: b.ads_found ?? null, priority: b.priority ?? 5, full_crawled_at: b.full_crawled_at ?? null }))
  }

  if (brands.length === 0) {
    console.log('No brands to crawl. Add page_ids to discovery_crawl_terms.')
    process.exit(0)
  }

  console.log(`🚀 Playwright Indexer — ${brands.length} brand(s) to crawl`)
  for (const brand of brands) {
    try {
      // FULL (deep archive) crawl — no caps, no early-stop, captures the complete library
      // incl. inactive/taken-down ads — fires for:
      //   • SPIED brands (priority >= 9, paid),
      //   • NEW brands (ads_found null = never produced ads yet → crawl them fully, not capped),
      //   • BACKFILL (full_crawled_at null = never deep-crawled → one-time deep re-walk to recover
      //     the old archive we truncated at 1500). After it completes we stamp full_crawled_at so
      //     the brand reverts to fast incremental. Kill-switch: FULL_BACKFILL=0 to pause the sweep.
      // DEPTH vs BREADTH, balanced for a single droplet:
      //   • SPIED brands (priority >= 9) → ALWAYS full (a user paid for depth on demand).
      //   • NEW brands (ads_found null, never crawled) → FAST capped crawl, so the never-crawled
      //     queue keeps draining at full speed (a deep walk would hold a worker 35 min).
      //   • ALREADY-CRAWLED-but-never-deep brands (ads_found > 0, full_crawled_at null) → run the
      //     deep BACKFILL on only ~1-in-N passes (FULL_BACKFILL_RATE, default 0.25). The other
      //     passes crawl fast. So archives backfill gradually in the background without choking
      //     fresh throughput. Kill the sweep entirely with FULL_BACKFILL=0.
      const backfillOn = process.env.FULL_BACKFILL !== '0'
      const backfillRate = parseFloat(process.env.FULL_BACKFILL_RATE ?? '0.25')
      const eligibleForBackfill = backfillOn && brand.full_crawled_at == null && (brand.ads_found ?? 0) > 0
      const isFull = (brand.priority ?? 5) >= 9 || (eligibleForBackfill && Math.random() < backfillRate)
      const m = await crawlBrandCountries({
        pageId: brand.page_id,
        brandName: brand.term,
        maxScrolls,
        full: isFull,
        config: countryConfig,
        activeCountries: brand.countries,
      })
      // Propagate the brand's manual admin categories + industry override.
      await stampBrandMetadata(brand.page_id, brand.categories, brand.industry)

      // Spied brand (priority >= 9), own-page crawl fully done (no resume cursor pending) and
      // productive → also pull affiliate/creator ads referencing the brand's domain, tagged
      // aff:<pageId> so the Brand Spy dashboard merges them in. Runs once per full-crawl
      // completion (≈ weekly cadence), not on every resume pass.
      // DEFERRED: gated off until we enable affiliate display (set BRAND_SPY_AFFILIATES=1).
      if (process.env.BRAND_SPY_AFFILIATES === '1' && (brand.priority ?? 5) >= 9 && !m.nextCursor && m.adsDiscovered > 0) {
        await discoverAffiliatesFor(brand.page_id, brand.term || brand.page_id)
      }
      // Decide when this brand is eligible to crawl again by setting
      // last_crawled_at into the past so `now - last_crawled_at >= SCHED_GAP_MIN`
      // fires after `backoffMin`. Three cases:
      //   • Gated (0 ads, IP soft-blocked) → GATE_RETRY_MIN, another IP retries.
      //   • SOFT-GATE SUSPECT (m.softGateSuspect) → VERIFY_RETRY_MIN. Set ONLY when
      //     the crawl might be truncated: Meta marked the page complete
      //     (has_next_page=false) at a suspiciously low count (e.g. ag1 returned 30
      //     of hundreds), OR we hit the page cap with more pending. The verify is
      //     cheap (incremental): a fully covered brand finds ~0 new and settles; a
      //     real soft-gate keeps recovering. NOTE: this used to fire on ANY haul
      //     >= GROWTH_VERIFY_THRESHOLD new ads — which re-crawled every productive
      //     brand 30 min later (~283/hr, burning IPRoyal + breaking the 7-day gap).
      //   • Otherwise (clean complete haul or incremental early-stop) → full SCHED_GAP_MIN cadence.
      const now = Date.now()
      let backoffMin: number
      const update: any = {}   // extra fields written alongside last_crawled_at
      let removeBrand = false
      if (m.nextCursor) {
        // Big brand, partially crawled — a resume cursor is saved. Re-crawl SOON so it keeps
        // filling in across passes (a 50K-ad brand otherwise takes ages at full cadence).
        backoffMin = VERIFY_RETRY_MIN
        console.log(`  ⏭️  ${brand.term || brand.page_id}: more ads to crawl — resume in ${VERIFY_RETRY_MIN} min`)
      } else if (m.adsDiscovered === 0 && m.emptyBrandBail) {
        // FAST REMOVAL (1-strike). A clean empty-bail means the page rendered and returned
        // ZERO ads under active_status=all — which surfaces even PAUSED/inactive ads. So any
        // brand that has EVER advertised shows ads here; a clean empty means the account has
        // never run an ad (a non-advertiser). DELETE it from the crawl list on the first
        // clean empty so the queue self-cleans in one pass. Distinct from a gate (gates trip
        // anti-burn / return block pages → different code path). GUARD: never remove a brand
        // that previously returned ads (ads_found > 0) — a one-off empty on a known
        // advertiser is a transient gate, not junk → keep it.
        backoffMin = SCHED_GAP_MIN
        if ((brand.ads_found ?? 0) > 0) {
          console.log(`  ∅ ${brand.term || brand.page_id}: empty now but had ${brand.ads_found} ads before — kept (transient, not junk)`)
        } else {
          removeBrand = true
        }
      } else if (m.adsDiscovered === 0) {
        backoffMin = GATE_RETRY_MIN
        console.warn(`  ⚠️ ${brand.term || brand.page_id}: 0 ads (gated) — retry in ${GATE_RETRY_MIN} min`)
      } else if (m.softGateSuspect) {
        // Only re-crawl soon when the result looks TRUNCATED/incomplete — NOT after
        // every productive haul (that was re-crawling at ~283/hr and burning IPRoyal).
        backoffMin = VERIFY_RETRY_MIN
        console.log(`  🔎 ${brand.term || brand.page_id}: ${m.adsDiscovered} ads, possibly soft-gate-truncated — verify-recrawl in ${VERIFY_RETRY_MIN} min`)
      } else {
        // Clean, complete haul (or incremental early-stop on known ads) → full 7-day cadence.
        backoffMin = SCHED_GAP_MIN
      }
      // A productive crawl records the real count.
      if (m.adsDiscovered > 0) update.ads_found = m.adsDiscovered

      // HARD-REMOVE confirmed-empty junk from the crawl list. We log term + page_id so the
      // removal is recoverable from the logs if ever needed, and since the brand produced
      // no ads nothing in discovery_ads_index is orphaned. `continue` skips the cadence
      // update (the row is gone).
      if (removeBrand) {
        // SOFT removal (was a hard DELETE). Deactivate + tag so the scheduler skips it
        // (all pickNextBrand selects require is_active=true) but the row STAYS, reviewable in
        // the admin "Removed" tab where a human can Restore a false-positive (a real brand that
        // was slow to load). The queue still self-cleans in one pass; nothing is lost.
        await (supabase as any).from('discovery_crawl_terms')
          .update({ is_active: false, notes: 'auto_removed_empty' })
          .eq('page_id', brand.page_id)
        console.log(`  🗑️  REMOVED (soft) from crawl list: "${brand.term}" (page_id=${brand.page_id}) — empty, no ad history`)
        continue
      }

      // B backfill: once a brand's deep crawl genuinely completes (not mid-resume), stamp
      // full_crawled_at so it reverts to fast incremental and the sweep advances to the next brand.
      if (isFull && !m.nextCursor && m.adsDiscovered > 0) update.full_crawled_at = new Date(now).toISOString()

      const lastCrawled = new Date(now - Math.max(0, SCHED_GAP_MIN - backoffMin) * 60_000).toISOString()
      await (supabase as any).from('discovery_crawl_terms')
        .update({ last_crawled_at: lastCrawled, ...update })
        .eq('page_id', brand.page_id)
      // Release the multi-droplet claim (migration 043). Best-effort + separate so a not-yet-applied
      // migration can't fail the cadence update above; a stale claim self-expires via the lease anyway.
      await (supabase as any).from('discovery_crawl_terms').update({ crawling_at: null }).eq('page_id', brand.page_id).then(() => {}, () => {})

      // Keep the admin Brands view in sync. It reads discovery_brand_crawl_state
      // (exhausted_at) to show "✅ Done — re-crawl in Nd" vs "Queued". The droplet
      // crawler is the real engine, so mirror our outcome there:
      //   • stable (settled to full cadence) → exhausted_at = now → "Done".
      //   • verify-recrawl (still filling) → exhausted_at = null → "Queued/in-progress".
      //   • gated (0 ads) → leave the row untouched (transient, will retry).
      if (m.adsDiscovered > 0) {
        const doneStable = backoffMin === SCHED_GAP_MIN
        // ads_indexed must be the CUMULATIVE total for this brand, not this run's count — else an
        // incremental run that adds 27 ads stomps the field to 27 (the "27 ads" list bug). Read the
        // real total from the index.
        const { count: realTotal } = await (supabase as any)
          .from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', brand.page_id)
        await (supabase as any).from('discovery_brand_crawl_state').upsert({
          page_id: brand.page_id,
          brand_name: brand.term || null,
          last_run_at: new Date(now).toISOString(),
          last_run_added: m.adsNew,
          ads_indexed: realTotal ?? m.adsDiscovered,
          exhausted_at: (doneStable && !m.nextCursor) ? new Date(now).toISOString() : null,
          cursor: m.nextCursor ?? null,   // resume point for big brands; null when fully crawled
        }, { onConflict: 'page_id' })
        // Record/clear soft-gate truncation (migration 044) for the admin filter. Separate +
        // best-effort so a not-yet-applied migration can't break the crawl_state upsert above.
        await (supabase as any).from('discovery_brand_crawl_state')
          .update({ soft_gate_at: m.softGateSuspect ? new Date(now).toISOString() : null })
          .eq('page_id', brand.page_id).then(() => {}, () => {})
      }
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
