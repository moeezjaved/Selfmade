/**
 * Playwright extractor — loads Meta's render_ad URL in real Chrome,
 * extracts the raw fbcdn.net image and video CDN URLs from the DOM.
 *
 * One Browser instance is shared across all workers (memory-efficient).
 * Each ad gets its own BrowserContext with a STICKY proxy session
 * (one IPRoyal residential IP for the full ad lifecycle ~10-30s).
 *
 * Why sticky-per-ad: Meta's bot detection flags page loads where the
 * HTML, JS, XHRs, and CDN downloads come from different IPs (looks like
 * IP-hopping). Pinning one residential IP per ad mimics a normal user
 * browsing session and dramatically improves success rate.
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { config, proxyEnabled } from './config.js'

let _browser: Browser | null = null

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser

  // ── Proxy set at BROWSER LAUNCH (not per-context) ──
  // Why launch-level: Playwright + Chromium has a documented bug where
  // per-context HTTP proxy auth fails with ERR_PROXY_AUTH_UNSUPPORTED on
  // HTTPS targets. Setting auth at launch time (chromium.launch({ proxy }))
  // pre-authenticates the browser process so subsequent context creation
  // doesn't renegotiate. Also the only path that works reliably with
  // Chromium — SOCKS5 with auth is NOT supported by Chromium at all.
  //
  // Trade-off: ALL contexts share the same proxy URL, so sticky-per-ad
  // sessions aren't possible at this layer. With IPRoyal's plain rotating
  // residential pool (32M IPs), each request gets a different IP anyway.
  // For true sticky-per-ad we'd need to launch multiple browsers, each
  // pre-authenticated to a different IPRoyal session — Phase 2 work.
  const launchOpts: Parameters<typeof chromium.launch>[0] = {
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
  if (proxyEnabled) {
    launchOpts.proxy = {
      server: `http://${config.proxy.host}:${config.proxy.port}`,
      username: config.proxy.user,
      password: config.proxy.pass,
    }
  }
  _browser = await chromium.launch(launchOpts)
  if (proxyEnabled) {
    console.log(`✅ Chromium launched (proxy: ${config.proxy.host}:${config.proxy.port}, country=${config.proxy.country}, rotating)`)
  } else {
    console.log('✅ Chromium launched (no proxy — direct connection, will be blocked by Meta at scale)')
  }
  return _browser
}

/**
 * NO-OP — proxy is now set at browser launch, not per-context.
 * Kept for compatibility with the extractCreative call site; returns undefined
 * so newContext() doesn't override the launch-level proxy.
 */
function buildProxyForAd(_adId: string): undefined {
  return undefined
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
 * Extract image + video CDN URLs from a Meta snapshot URL.
 * Uses a fresh BrowserContext per ad with its own sticky proxy session
 * so all sub-requests (HTML, JS, XHRs, CDN) come from one residential IP.
 *
 * @param snapshotUrl  Meta render_ad URL
 * @param timeoutMs    overall timeout
 * @param adId         ad_archive_id — used as the IPRoyal sticky session key
 *                      so each ad gets its own dedicated IP
 */
export async function extractCreative(snapshotUrl: string, timeoutMs = 25_000, adId?: string): Promise<ExtractResult> {
  const browser = await getBrowser()
  let context: BrowserContext | null = null
  let page: Page | null = null

  try {
    // Per-ad sticky proxy session — same IP for the full ad lifecycle.
    // Falls back to no proxy if env vars aren't set.
    const proxy = buildProxyForAd(adId || `noid-${Date.now()}`)

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      ...(proxy ? { proxy } : {}),
    })
    page = await context.newPage()

    // Block fonts/CSS for speed (we only need DOM, not rendering quality)
    await page.route('**/*', (route) => {
      const t = route.request().resourceType()
      if (t === 'font' || t === 'stylesheet') return route.abort()
      return route.continue()
    })

    // Page load — aggressive timeout. Most live ads load in 3-5s.
    let pageStatus = 0
    const resp = await page.goto(snapshotUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 8_000,
    })
    pageStatus = resp ? resp.status() : 0

    // Wait for an ACTUAL ad creative — not Meta's static UI bundle.
    // Real ad media is on /v/t39.*-6/ or /v/t45.*-4/ paths and loads
    // via JS after the initial page shell. Old code proceeded as soon
    // as any fbcdn image appeared (= the static UI bundle), missing the
    // real creative entirely.
    let creativeFound = false
    try {
      await page.waitForFunction(
        () => {
          const isRealCreative = (s: string) =>
            !!s &&
            !s.includes('static.xx.fbcdn') &&
            !s.includes('static.fbcdn') &&
            !!(s.match(/\/v\/t39\.\d+-6\//) ||
               s.match(/\/v\/t45\.\d+-4\//))
          const img = Array.from(document.querySelectorAll('img'))
            .some((i) => isRealCreative((i as HTMLImageElement).src))
          const vid = Array.from(document.querySelectorAll('video'))
            .some((v) => {
              const ve = v as HTMLVideoElement
              const src = ve.src || ve.currentSrc
              return !!src && src.includes('fbcdn')
            })
          return img || vid
        },
        { timeout: 6_000 } // 6s wait for JS-rendered creative
      )
      creativeFound = true
    } catch {
      /* timeout — dead ad, skip */
    }

    // Give video src + carousel slides time to fully attach
    if (creativeFound) {
      await new Promise(r => setTimeout(r, 800))
    }

    const data = await page.evaluate(() => {
      // ALL videos (multi-video carousels are rare but possible)
      const allVideos: string[] = []
      const videoEls = document.querySelectorAll('video')
      videoEls.forEach((v) => {
        const ve = v as HTMLVideoElement
        let url = ve.src || ve.currentSrc || ''
        if (!url) {
          const src = ve.querySelector('source') as HTMLSourceElement | null
          if (src) url = src.getAttribute('src') || ''
        }
        if (url) allVideos.push(url)
      })

      // ALL fbcdn image URLs in DOM order (carousel slide order)
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

    // Strict filter — only KEEP images that look like real ad creatives.
    // Reject Meta UI placeholders (static.xx.fbcdn.net + /v/t1.* paths).
    const isAdCreative = (u: string): boolean => {
      if (!u) return false
      // 🚨 Reject Meta static UI assets (cause of placeholder bug)
      if (u.includes('static.xx.fbcdn')) return false
      if (u.includes('static.fbcdn')) return false
      if (u.match(/\/v\/t1\.\d+/)) return false
      // ✅ Known ad creative paths in Meta CDN
      if (u.match(/\/v\/t39\.\d+-6\//)) return true
      if (u.match(/\/v\/t45\.\d+-4\//)) return true
      // Profile / page picture / cover paths — reject
      if (u.match(/\/v\/t39\.\d+-1\//)) return false
      if (u.match(/profile_pic|cover_photo/i)) return false
      // For unknown paths: only accept if it's clearly large (likely a creative)
      const sz = stpSize(u)
      if (sz >= 600) return true
      // Otherwise reject — too risky to assume
      return false
    }
    const creativeImages = (data.allImgSrcs || []).filter(isAdCreative)

    // Dedup by URL — same image sometimes appears multiple times in DOM
    const uniqueImages = Array.from(new Set(creativeImages))

    // Sort: largest first (so carousel position 0 = main hero image)
    uniqueImages.sort((a, b) => stpSize(b) - stpSize(a))

    const uniqueVideos = Array.from(new Set(
      (data.allVideos || []).filter((u) => u.includes('fbcdn')),
    ))

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
  }
}
