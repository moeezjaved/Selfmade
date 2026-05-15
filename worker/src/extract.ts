/**
 * Playwright extractor — loads Meta's public Ads Library per-ad URL
 * (https://www.facebook.com/ads/library/?id=AD_ID) in a FRESH stealth Chrome
 * per ad, extracts the raw fbcdn.net image and video CDN URLs from the DOM.
 *
 * Architecture (mirrors test-per-ad-url.ts which extracts 30+ creatives/ad):
 *   PER AD:
 *     1. Spin up proxy-chain sticky session keyed on ad_id → localhost URL
 *     2. Launch a FRESH chromium with stealth, proxy at launch level
 *     3. New context (clean cookies/TLS) → page → goto → wait 12s → extract
 *     4. Close browser AND close proxy-chain server
 *
 * Why fresh-browser-per-ad (the bug we just fixed):
 *   A shared chromium across ads leaks state Meta uses for bot detection:
 *     - Cookies/localStorage from previous ad pages persist
 *     - TLS session resumption reveals "same client"
 *     - JS heap state (timers, refs to old ad pages) builds up
 *   Verified: same ad via shared-browser worker = 0 creatives, page=200 gated.
 *   Same ad via fresh-browser test script = 32 images + 31 videos.
 *
 * Cost: ~1.5-2s extra per ad for browser cold start. At concurrency=2 on an
 * 8GB droplet, two browsers in parallel uses ~600 MB RAM — fine.
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, BrowserContext, Page } from 'playwright'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { proxyEnabled } from './config.js'

chromiumExtra.use(StealthPlugin())

let _bannerLogged = false
function logBannerOnce() {
  if (_bannerLogged) return
  _bannerLogged = true
  if (proxyChainEnabled) {
    console.log('✅ Worker mode: fresh stealth chromium per ad + per-ad proxy-chain sticky sessions')
  } else if (proxyEnabled) {
    console.log('⚠️ Fresh stealth chromium per ad — proxy-chain DISABLED (set WORKER_PROXY_HOST/USER/PASS)')
  } else {
    console.log('⚠️ Fresh stealth chromium per ad — NO proxy (will be blocked at scale)')
  }
}

/**
 * No-op kept for backward compat with index.ts's existing imports.
 * The browser lifecycle is now per-ad and managed inside extractCreative.
 */
export async function getBrowser(): Promise<void> {
  logBannerOnce()
}

export async function closeBrowser(): Promise<void> {
  // No global browser to close — each extractCreative call manages its own.
}

export interface ExtractedAsset {
  url: string
  buffer: Buffer
  contentType: string
}

export interface ExtractResult {
  imageUrls: string[]              // ALL fbcdn images (carousel slides), largest first
  videoUrls: string[]              // ALL videos (rare to have multiple)
  imageAssets: ExtractedAsset[]    // already downloaded inside browser context (proxy+cookies carried)
  videoAssets: ExtractedAsset[]
  pageStatus: number
  error?: string
}

/**
 * Build an 8-char IPRoyal sticky-session key from the ad_id. Same ad always
 * gets the same residential IP within the proxy lifetime window.
 */
function sessionIdFor(adId: string): string {
  const clean = adId.replace(/\D/g, '')
  return clean.length >= 8 ? clean.slice(-8) : clean.padStart(8, '0')
}

/**
 * Extract image + video CDN URLs from a Meta per-ad URL.
 * Each call launches a fresh chromium instance and tears it down at the end.
 *
 * @param snapshotUrl  Meta Ads Library per-ad URL (?id=AD_ID)
 * @param timeoutMs    overall budget (default 35s — needs to cover proxy
 *                     latency + ~12s render wait + DOM eval)
 * @param adId         ad_archive_id — used as the proxy-chain sticky session key
 */
export async function extractCreative(
  snapshotUrl: string,
  timeoutMs = 35_000,
  adId?: string,
): Promise<ExtractResult> {
  logBannerOnce()

  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null
  let proxy: { url: string; close: () => Promise<void> } | null = null

  try {
    // Per-ad sticky session — same residential IP for HTML + JS + CDN of this ad.
    if (proxyChainEnabled) {
      const sid = adId ? sessionIdFor(adId) : Math.random().toString(36).slice(2, 10)
      proxy = await startProxyChain({ sessionId: sid, lifetime: '10m', country: 'us' })
    }

    // Fresh chromium per ad — proxy at LAUNCH level (proven path from
    // test-per-ad-url.ts). The localhost URL has no auth so this works
    // without ERR_PROXY_AUTH_UNSUPPORTED issues.
    const launchOpts: Parameters<typeof chromiumExtra.launch>[0] = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    }
    if (proxy) {
      launchOpts.proxy = { server: proxy.url }
    }
    browser = (await chromiumExtra.launch(launchOpts)) as unknown as Browser

    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    })

    page = await context.newPage()

    let pageStatus = 0
    const resp = await page.goto(snapshotUrl, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(20_000, timeoutMs - 13_000),
    })
    pageStatus = resp ? resp.status() : 0

    // Always wait a fixed window for Meta's React frontend to hydrate +
    // load the creative bundle. Matches test-per-ad-url.ts pattern exactly
    // (no waitForFunction polling — that interacts badly with bot detection).
    const waitMs = Math.min(12_000, Math.max(8_000, timeoutMs - 12_000))
    await new Promise((r) => setTimeout(r, waitMs))

    const data = await page.evaluate(() => {
      const allVideos: string[] = []
      document.querySelectorAll('video').forEach((v) => {
        const ve = v as HTMLVideoElement
        let url = ve.src || ve.currentSrc || ''
        if (!url) {
          const src = ve.querySelector('source') as HTMLSourceElement | null
          if (src) url = src.getAttribute('src') || ''
        }
        if (url) allVideos.push(url)
      })

      const allImgSrcs = Array.from(document.querySelectorAll('img'))
        .map((img) => (img as HTMLImageElement).src)
        .filter(
          (src) =>
            !!src &&
            (src.includes('fbcdn.net') || src.includes('scontent')) &&
            !src.includes('hsts-pixel') &&
            !src.includes('/emoji'),
        )

      return { allVideos, allImgSrcs }
    })

    function stpSize(url: string): number {
      const m = url.match(/_s(\d+)x\d+/)
      return m ? parseInt(m[1], 10) : 0
    }

    const isAdCreative = (u: string): boolean => {
      if (!u) return false
      if (u.includes('static.xx.fbcdn')) return false
      if (u.includes('static.fbcdn')) return false
      if (u.match(/\/v\/t1\.\d+/)) return false
      if (u.match(/\/v\/t39\.\d+-6\//)) return true
      if (u.match(/\/v\/t45\.\d+-4\//)) return true
      if (u.match(/\/v\/t39\.\d+-1\//)) return false
      if (u.match(/profile_pic|cover_photo/i)) return false
      const sz = stpSize(u)
      if (sz >= 600) return true
      return false
    }

    const creativeImages = (data.allImgSrcs || []).filter(isAdCreative)
    const uniqueImages = Array.from(new Set(creativeImages))
    uniqueImages.sort((a, b) => stpSize(b) - stpSize(a))

    const uniqueVideos = Array.from(
      new Set((data.allVideos || []).filter((u) => u.includes('fbcdn'))),
    )

    // ── Download creatives INSIDE the browser context ──
    // Critical: bare Node fetch() from the droplet's direct IP gets a 1087-byte
    // placeholder from Meta's CDN ("not authorized to view this image"). Using
    // page.context().request inherits the per-ad sticky proxy + session cookies
    // that were used to load the page in the first place, so the CDN serves
    // the real bytes.
    const ctxRequest = context.request
    async function fetchAsset(url: string, contentType: string): Promise<ExtractedAsset | null> {
      try {
        const r = await ctxRequest.fetch(url, {
          timeout: 25_000,
          headers: {
            'Referer': 'https://www.facebook.com/',
            'Accept': contentType.startsWith('video') ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8',
          },
        })
        if (!r.ok()) return null
        const buf = Buffer.from(await r.body())
        if (buf.byteLength < 2000) return null  // placeholder
        return { url, buffer: buf, contentType }
      } catch {
        return null
      }
    }

    const imageAssets = (
      await Promise.all(uniqueImages.map((u) => fetchAsset(u, 'image/jpeg')))
    ).filter((a): a is ExtractedAsset => a !== null)

    const videoAssets = (
      await Promise.all(uniqueVideos.map((u) => fetchAsset(u, 'video/mp4')))
    ).filter((a): a is ExtractedAsset => a !== null)

    return {
      imageUrls: uniqueImages,
      videoUrls: uniqueVideos,
      imageAssets,
      videoAssets,
      pageStatus,
    }
  } catch (err) {
    return {
      imageUrls: [],
      videoUrls: [],
      imageAssets: [],
      videoAssets: [],
      pageStatus: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await page?.close().catch(() => {})
    await context?.close().catch(() => {})
    await browser?.close().catch(() => {})
    if (proxy) await proxy.close().catch(() => {})
  }
}
