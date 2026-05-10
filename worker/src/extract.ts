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
  imageUrls: string[]      // ALL fbcdn images (carousel slides), largest first
  videoUrls: string[]      // ALL videos (rare to have multiple)
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

    // Filter images: keep only "creative-sized" (stp param ≥ 200) — drops
    // profile pic icons (s60x60), keeps actual ad slides (s600x600+).
    function stpSize(url: string): number {
      const m = url.match(/_s(\d+)x\d+/)
      return m ? parseInt(m[1], 10) : 0
    }
    const creativeImages = (data.allImgSrcs || [])
      .filter((u) => u.includes('fbcdn'))
      .filter((u) => {
        const sz = stpSize(u)
        // No stp param = original (no resize), keep it
        // s200+ = real creative slide, keep it
        // smaller = profile/icon, drop
        return sz === 0 || sz >= 200
      })

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
