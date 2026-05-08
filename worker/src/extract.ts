/**
 * Playwright extractor — loads Meta's render_ad URL in real Chrome,
 * extracts the raw fbcdn.net image and video CDN URLs from the DOM.
 *
 * One Browser instance is shared across all workers (memory-efficient).
 * Each ad gets its own BrowserContext (isolated cookies/cache).
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright'

let _browser: Browser | null = null

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser
  _browser = await chromium.launch({
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
  })
  console.log('✅ Chromium launched')
  return _browser
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
  }
}

export interface ExtractResult {
  imageUrl: string | null
  videoUrl: string | null
  pageStatus: number
  error?: string
}

/**
 * Extract image + video CDN URLs from a Meta snapshot URL.
 * Uses a fresh BrowserContext per ad to avoid cross-ad cache pollution.
 */
export async function extractCreative(snapshotUrl: string, timeoutMs = 25_000): Promise<ExtractResult> {
  const browser = await getBrowser()
  let context: BrowserContext | null = null
  let page: Page | null = null

  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
    })
    page = await context.newPage()

    // Block fonts/CSS for speed (we only need DOM, not rendering quality)
    await page.route('**/*', (route) => {
      const t = route.request().resourceType()
      if (t === 'font' || t === 'stylesheet') return route.abort()
      return route.continue()
    })

    let pageStatus = 0
    const resp = await page.goto(snapshotUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    })
    pageStatus = resp ? resp.status() : 0

    // Wait up to 8s for an actual ad creative to appear
    try {
      await page.waitForFunction(
        () => {
          const img = Array.from(document.querySelectorAll('img'))
            .some((i) => i.src && i.src.includes('fbcdn') && /_s\d{3,}x\d{3,}/.test(i.src))
          const vid = !!document.querySelector('video[src]') ||
                      !!document.querySelector('video source[src]')
          return img || vid
        },
        { timeout: 8_000 }
      )
    } catch {
      /* timeout — still try to extract whatever's in DOM */
    }

    // Extra delay so video src has time to attach
    await page.waitForTimeout(1500)

    const data = await page.evaluate(() => {
      // Video URL
      let videoUrl: string | null = null
      const videoEl = document.querySelector('video') as HTMLVideoElement | null
      if (videoEl) {
        videoUrl = videoEl.src || videoEl.currentSrc || null
        if (!videoUrl) {
          const src = videoEl.querySelector('source') as HTMLSourceElement | null
          if (src) videoUrl = src.getAttribute('src')
        }
      }

      // All fbcdn image srcs (server picks largest by stp param)
      const allImgSrcs = Array.from(document.querySelectorAll('img'))
        .map((img) => (img as HTMLImageElement).src)
        .filter(
          (src) =>
            !!src &&
            (src.includes('fbcdn.net') || src.includes('scontent')) &&
            !src.includes('hsts-pixel') &&
            !src.includes('/emoji'),
        )

      return { videoUrl, allImgSrcs }
    })

    // Pick largest image by stp size param: _s600x600 → 600, _s60x60 → 60
    function stpSize(url: string): number {
      const m = url.match(/_s(\d+)x\d+/)
      return m ? parseInt(m[1], 10) : 0
    }
    const fbImgs = (data.allImgSrcs || []).filter((u) => u.includes('fbcdn'))
    fbImgs.sort((a, b) => stpSize(b) - stpSize(a))
    const imageUrl = fbImgs[0] || null

    return {
      imageUrl: imageUrl && imageUrl.includes('fbcdn') ? imageUrl : null,
      videoUrl: data.videoUrl && data.videoUrl.includes('fbcdn') ? data.videoUrl : null,
      pageStatus,
    }
  } catch (err) {
    return {
      imageUrl: null,
      videoUrl: null,
      pageStatus: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    await page?.close().catch(() => {})
    await context?.close().catch(() => {})
  }
}
