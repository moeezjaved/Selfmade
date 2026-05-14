/**
 * Playwright extractor — loads Meta's public Ads Library per-ad URL
 * (https://www.facebook.com/ads/library/?id=AD_ID) in real Chrome with
 * stealth, extracts the raw fbcdn.net image and video CDN URLs from the DOM.
 *
 * Architecture (matches the indexer's bot-detection posture):
 *   1. ONE shared chromium browser launched WITHOUT a proxy (cheap to keep alive)
 *   2. PER-AD: spin up a proxy-chain sticky session keyed on ad_id → localhost URL
 *   3. PER-AD: fresh BrowserContext that points to that localhost proxy
 *   4. After extraction: close context AND close the proxy-chain server
 *
 * Why this works (and why the old version didn't):
 *   - StealthPlugin masks navigator.webdriver, plugins, languages, WebGL, etc.
 *   - Sticky session per ad = HTML, JS, CDN all egress from one residential IP
 *     (Meta's bot heuristics flag IP-hopping within a single page load)
 *   - Fresh context per ad = clean cookies + TLS = looks like a distinct user
 *   - Localhost proxy URL has no auth → bypasses Chromium's per-context auth bug
 *
 * Verified by `test-per-ad-url.ts`: this exact pattern returned 11 images +
 * 13 videos for a Hims ad in 14 seconds. Production worker now mirrors it.
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, BrowserContext, Page } from 'playwright'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { proxyEnabled } from './config.js'

chromiumExtra.use(StealthPlugin())

let _browser: Browser | null = null

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser

  // No launch-level proxy. Each context gets its own per-ad sticky-session
  // proxy via proxy-chain (localhost URL, no auth needed at this layer).
  _browser = await chromiumExtra.launch({
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
  }) as unknown as Browser

  if (proxyChainEnabled) {
    console.log('✅ Chromium launched with stealth (per-ad proxy-chain sticky sessions)')
  } else if (proxyEnabled) {
    console.log('⚠️ Chromium launched with stealth — proxy-chain DISABLED (set WORKER_PROXY_HOST/USER/PASS), falling back to direct')
  } else {
    console.log('✅ Chromium launched with stealth (no proxy — direct connection, will be blocked at scale)')
  }
  return _browser
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
}

export interface ExtractResult {
  imageUrls: string[]      // ALL fbcdn images (carousel slides), largest first
  videoUrls: string[]      // ALL videos (rare to have multiple)
  pageStatus: number
  error?: string
}

/**
 * Apply request blocking to a context. Saves ~20-30% bandwidth without
 * affecting fingerprinting (these are static UI assets, never the real
 * ad creative).
 */
async function applyBlockingRules(ctx: BrowserContext) {
  await ctx.route('**/*', (route) => {
    const req = route.request()
    const url = req.url()
    const t = req.resourceType()
    if (t === 'font' || t === 'stylesheet') return route.abort()
    if (t === 'image' && url.includes('static.xx.fbcdn.net')) return route.abort()
    if (url.includes('/ajax/bz?') || url.includes('/log_clientside_error')) return route.abort()
    return route.continue()
  })
}

/**
 * Build a sessionId from the ad_id. Same ad always gets the same residential
 * IP within the proxy lifetime window (good for retries — same IP tried
 * again won't look like fresh probing).
 *
 * IPRoyal session IDs need 8 alphanumeric chars; ad_ids are numeric and
 * usually 16+ digits, so we slice the last 8.
 */
function sessionIdFor(adId: string): string {
  const clean = adId.replace(/\D/g, '')
  return clean.length >= 8 ? clean.slice(-8) : clean.padStart(8, '0')
}

/**
 * Extract image + video CDN URLs from a Meta per-ad URL.
 *
 * @param snapshotUrl  Meta Ads Library per-ad URL (?id=AD_ID)
 * @param timeoutMs    overall timeout (default 25s, increased to 35s for proxy latency)
 * @param adId         ad_archive_id — used as the proxy-chain sticky session key
 */
export async function extractCreative(
  snapshotUrl: string,
  timeoutMs = 35_000,
  adId?: string,
): Promise<ExtractResult> {
  const browser = await getBrowser()
  let context: BrowserContext | null = null
  let page: Page | null = null
  let proxy: { url: string; close: () => Promise<void> } | null = null

  try {
    // Per-ad sticky session — same residential IP for HTML + JS + CDN of this ad.
    if (proxyChainEnabled) {
      const sid = adId ? sessionIdFor(adId) : Math.random().toString(36).slice(2, 10)
      proxy = await startProxyChain({ sessionId: sid, lifetime: '10m', country: 'us' })
    }

    const contextOpts: Parameters<Browser['newContext']>[0] = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    }
    if (proxy) {
      contextOpts.proxy = { server: proxy.url }
    }
    context = await browser.newContext(contextOpts)
    await applyBlockingRules(context)
    page = await context.newPage()

    let pageStatus = 0
    const resp = await page.goto(snapshotUrl, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(20_000, timeoutMs - 5_000),
    })
    pageStatus = resp ? resp.status() : 0

    // Wait for an ACTUAL ad creative — not Meta's static UI bundle.
    // Real ad media is on /v/t39.*-6/ or /v/t45.*-4/ paths and loads
    // via JS after the initial page shell.
    let creativeFound = false
    try {
      await page.waitForFunction(
        () => {
          const isRealCreative = (s: string) =>
            !!s &&
            !s.includes('static.xx.fbcdn') &&
            !s.includes('static.fbcdn') &&
            !!(s.match(/\/v\/t39\.\d+-6\//) || s.match(/\/v\/t45\.\d+-4\//))
          const img = Array.from(document.querySelectorAll('img')).some((i) =>
            isRealCreative((i as HTMLImageElement).src),
          )
          const vid = Array.from(document.querySelectorAll('video')).some((v) => {
            const ve = v as HTMLVideoElement
            const src = ve.src || ve.currentSrc
            return !!src && src.includes('fbcdn')
          })
          return img || vid
        },
        { timeout: Math.min(12_000, timeoutMs - 8_000) },
      )
      creativeFound = true
    } catch {
      /* timeout — dead ad, gated, or bot-detected; skip */
    }

    if (creativeFound) {
      // Give carousel slides + video src time to fully attach
      await new Promise((r) => setTimeout(r, 800))
    }

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

    return {
      imageUrls: uniqueImages,
      videoUrls: uniqueVideos,
      pageStatus,
    }
  } catch (err) {
    return {
      imageUrls: [],
      videoUrls: [],
      pageStatus: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await page?.close().catch(() => {})
    await context?.close().catch(() => {})
    if (proxy) await proxy.close().catch(() => {})
  }
}
