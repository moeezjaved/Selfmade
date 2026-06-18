/**
 * GraphQL request/response capture tool.
 *
 * Runs Playwright against Meta's ads-library page with FULL network
 * instrumentation. Saves every XHR/fetch request and response to disk
 * as a HAR-style JSON archive.
 *
 * Used to:
 *   1. Reverse-engineer Meta's GraphQL pagination request format
 *   2. Capture doc_id, fb_dtsg, variables structure, headers
 *   3. Provide replayable templates for cursor-based pagination
 *   4. Diff against manual Chrome HAR exports to find session
 *      fidelity differences (the suspected root cause of the 30-ad limit)
 *
 * Usage:
 *   docker run --rm --env-file .env \
 *     -v /tmp/captures:/captures \
 *     selfmade-worker \
 *     npx tsx src/capture-graphql.ts <page_id> [--output=/captures/file.json]
 *
 * Output JSON shape:
 *   {
 *     captured_at: ISO,
 *     page_id: string,
 *     final_url: string,
 *     cookies: [{ name, value, domain, ... }],
 *     local_storage: { ... },
 *     session_storage: { ... },
 *     fb_dtsg: string|null,           // CSRF token from initial HTML
 *     navigator_info: { userAgent, language, platform, ... },
 *     requests: [{
 *       url, method, resource_type, headers, post_data,
 *       response: { status, headers, body, body_size_bytes }
 *     }]
 *   }
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Request as PWRequest, Response as PWResponse } from 'playwright'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

chromiumExtra.use(StealthPlugin())

const args = process.argv.slice(2)
const pageId = args.find(a => /^\d+$/.test(a))
const outputArg = args.find(a => a.startsWith('--output='))
const noProxyFlag = args.includes('--no-proxy')

if (!pageId) {
  console.error('Usage: npx tsx src/capture-graphql.ts <page_id> [--output=/path/file.json] [--no-proxy]')
  process.exit(1)
}

const OUTPUT = outputArg ? outputArg.split('=')[1] : `/tmp/captures/graphql-${pageId}-${Date.now()}.json`

interface CapturedRequest {
  url: string
  method: string
  resource_type: string
  is_xhr_or_fetch: boolean
  headers: Record<string, string>
  post_data: string | null
  post_data_parsed: Record<string, string> | null   // best-effort URL-encoded parse
  response: {
    status: number
    status_text: string
    headers: Record<string, string>
    body: string                                     // truncated to MAX_BODY_BYTES
    body_size_bytes: number
    body_truncated: boolean
  } | null
  timing_ms: number
  contains_ad_data: boolean                          // body has "ad_archive_id" string
  contains_cursor: boolean                           // body has "endCursor" / "end_cursor" string
}

const MAX_BODY_BYTES = 2_000_000   // 2 MB per body (truncate larger)

async function main() {
  console.log(`\n🔬 GraphQL Capture Tool`)
  console.log(`   page_id: ${pageId}`)
  console.log(`   output:  ${OUTPUT}`)
  console.log(`   proxy:   ${noProxyFlag ? 'NONE (--no-proxy)' : (proxyChainEnabled ? 'IPRoyal' : 'unavailable')}`)
  console.log()

  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  let proxy: { url: string; close: () => Promise<void> } | null = null
  let browser: Browser | null = null

  try {
    if (proxyChainEnabled && !noProxyFlag) {
      proxy = await startProxyChain({ sessionId, lifetime: '10m', country: 'us' })
    }

    browser = await chromiumExtra.launch({
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
    }) as unknown as Browser

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    })

    const page = await context.newPage()

    // Map request → start time for timing
    const requestTimings = new Map<PWRequest, number>()
    const captured: CapturedRequest[] = []

    page.on('request', (req: PWRequest) => {
      requestTimings.set(req, Date.now())
    })

    page.on('response', async (resp: PWResponse) => {
      const req = resp.request()
      const t0 = requestTimings.get(req) ?? Date.now()
      const timing_ms = Date.now() - t0

      const url = resp.url()
      const method = req.method()
      const resource_type = req.resourceType()
      const isXhrOrFetch = ['xhr', 'fetch', 'document'].includes(resource_type)

      // Only deeply capture XHR/fetch/document — others are noise
      if (!isXhrOrFetch) return

      let bodyText = ''
      let bodySize = 0
      let truncated = false
      try {
        const buf = await resp.body().catch(() => null)
        if (buf) {
          bodySize = buf.length
          if (bodySize > MAX_BODY_BYTES) {
            bodyText = buf.subarray(0, MAX_BODY_BYTES).toString('utf-8')
            truncated = true
          } else {
            bodyText = buf.toString('utf-8')
          }
        }
      } catch { /* ignore */ }

      // Parse POST body if URL-encoded
      const postData = req.postData() || null
      let postDataParsed: Record<string, string> | null = null
      if (postData && postData.includes('=')) {
        postDataParsed = {}
        try {
          for (const pair of postData.split('&')) {
            const [k, ...v] = pair.split('=')
            if (k) postDataParsed[decodeURIComponent(k)] = decodeURIComponent((v.join('=') || ''))
          }
        } catch { postDataParsed = null }
      }

      captured.push({
        url,
        method,
        resource_type,
        is_xhr_or_fetch: isXhrOrFetch,
        headers: req.headers(),
        post_data: postData,
        post_data_parsed: postDataParsed,
        response: {
          status: resp.status(),
          status_text: resp.statusText(),
          headers: resp.headers(),
          body: bodyText,
          body_size_bytes: bodySize,
          body_truncated: truncated,
        },
        timing_ms,
        contains_ad_data: bodyText.includes('ad_archive_id'),
        contains_cursor: bodyText.includes('endCursor') || bodyText.includes('end_cursor'),
      })
    })

    // ── Navigate ──
    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId!)}`
    console.log(`📡 Navigating to ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 5_000))   // initial render

    // ── Aggressive scrolls to try to trigger pagination ──
    console.log(`🖱️  Scrolling to attempt pagination...`)
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 }
    for (let i = 0; i < 15; i++) {
      await page.mouse.move(
        Math.floor(viewport.width * (0.3 + Math.random() * 0.4)),
        Math.floor(viewport.height * (0.4 + Math.random() * 0.3)),
      ).catch(() => {})
      await page.mouse.wheel(0, 1500 + Math.floor(Math.random() * 800)).catch(() => {})
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000))
    }
    await new Promise(r => setTimeout(r, 3_000))   // settle

    // ── Snapshot session state ──
    const finalUrl = page.url()
    const cookies = await context.cookies()

    // Read fb_dtsg and other session tokens from page state
    const pageState = await page.evaluate(() => {
      const fbDtsg = (document.querySelector('input[name="fb_dtsg"]') as HTMLInputElement)?.value
        ?? (window as any).require?.('DTSGInitialData')?.token
        ?? null
      const localStorage: Record<string, string> = {}
      try {
        for (let i = 0; i < window.localStorage.length; i++) {
          const k = window.localStorage.key(i)
          if (k) localStorage[k] = window.localStorage.getItem(k) ?? ''
        }
      } catch { /* may be blocked */ }
      const sessionStorage: Record<string, string> = {}
      try {
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i)
          if (k) sessionStorage[k] = window.sessionStorage.getItem(k) ?? ''
        }
      } catch { /* may be blocked */ }
      return {
        fbDtsg,
        localStorage,
        sessionStorage,
        navigator: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          languages: Array.from(navigator.languages),
          platform: navigator.platform,
          vendor: navigator.vendor,
          hardwareConcurrency: navigator.hardwareConcurrency,
          deviceMemory: (navigator as any).deviceMemory,
          webdriver: navigator.webdriver,
        },
        userAgentData: (navigator as any).userAgentData ? {
          brands: (navigator as any).userAgentData.brands,
          mobile: (navigator as any).userAgentData.mobile,
          platform: (navigator as any).userAgentData.platform,
        } : null,
      }
    }).catch(() => ({}) as any)

    await context.close()

    // ── Save ──
    await mkdir(dirname(OUTPUT), { recursive: true })
    const out = {
      captured_at: new Date().toISOString(),
      tool_version: 1,
      page_id: pageId,
      final_url: finalUrl,
      proxy_used: !!proxy,
      session: pageState,
      cookies: cookies.map(c => ({
        name: c.name, value: c.value, domain: c.domain,
        path: c.path, expires: c.expires, httpOnly: c.httpOnly,
        secure: c.secure, sameSite: c.sameSite,
      })),
      requests: captured,
      summary: {
        total_requests: captured.length,
        ad_data_responses: captured.filter(c => c.contains_ad_data).length,
        cursor_responses: captured.filter(c => c.contains_cursor).length,
        graphql_requests: captured.filter(c => c.url.includes('/api/graphql/')).length,
        avg_body_size_kb: Math.round(captured.reduce((s, c) => s + (c.response?.body_size_bytes ?? 0), 0) / Math.max(1, captured.length) / 1024),
      },
    }
    await writeFile(OUTPUT, JSON.stringify(out, null, 2))
    console.log()
    console.log(`✅ Captured ${captured.length} requests`)
    console.log(`   ${out.summary.ad_data_responses} contain ad_archive_id`)
    console.log(`   ${out.summary.cursor_responses} contain a cursor`)
    console.log(`   ${out.summary.graphql_requests} are POSTs to /api/graphql/`)
    console.log(`   fb_dtsg captured: ${pageState.fbDtsg ? 'yes' : 'NO (will limit pagination replay)'}`)
    console.log(`   cookies: ${cookies.length}`)
    console.log()
    console.log(`📁 Output: ${OUTPUT}`)
    console.log(`   File size: ${(JSON.stringify(out).length / 1024).toFixed(1)} KB`)
    console.log()
    console.log(`Next: copy this file to laptop with:`)
    console.log(`   scp root@24.199.113.41:${OUTPUT} ~/Desktop/`)
    console.log(`Then inspect with: jq '.summary' ~/Desktop/$(basename ${OUTPUT})`)
  } finally {
    await browser?.close().catch(() => {})
    if (proxy) await proxy.close().catch(() => {})
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
