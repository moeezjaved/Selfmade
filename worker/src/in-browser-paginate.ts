/**
 * In-browser GraphQL pagination.
 *
 * Why this approach:
 *   External replay (undici from droplet) failed — Meta returns
 *   "Your Request Couldn't be Processed" because the session-bound
 *   tokens (__hs, __csr, __req counter, lsd, jazoest) don't validate
 *   when the request comes from outside the originating session.
 *
 *   This tool runs the pagination INSIDE the same Playwright session
 *   that made the initial pagination XHR. From Meta's perspective the
 *   replay POSTs come from the exact same authenticated session — same
 *   cookies, same TLS fingerprint, same script context.
 *
 * Flow:
 *   1. Open ads-library page (stealth + new-headless + IPRoyal)
 *   2. Watch for first GraphQL pagination POST. Capture URL + headers + body.
 *   3. Inside the browser context, fetch() the same URL with a swapped
 *      cursor in `variables`, incremented __req counter, refreshed __spin_t.
 *   4. Parse response → extract ad_ids + next cursor + has_next_page.
 *   5. Loop until has_next_page=false or hit max pages.
 *
 * Usage:
 *   docker run --rm --env-file .env \
 *     -v /tmp/captures:/captures \
 *     selfmade-worker \
 *     npx tsx src/in-browser-paginate.ts <page_id> [--max-pages=30] [--no-proxy]
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Page, Request as PWRequest } from 'playwright'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { randomBytes } from 'node:crypto'

chromiumExtra.use(StealthPlugin())

const args = process.argv.slice(2)
const pageId = args.find(a => /^\d+$/.test(a))
const maxPagesArg = args.find(a => a.startsWith('--max-pages='))
const noProxyFlag = args.includes('--no-proxy')
const MAX_PAGES = maxPagesArg ? parseInt(maxPagesArg.split('=')[1], 10) : 30

if (!pageId) {
  console.error('Usage: npx tsx src/in-browser-paginate.ts <page_id> [--max-pages=30] [--no-proxy]')
  process.exit(1)
}

interface CapturedTemplate {
  url: string
  headers: Record<string, string>
  body: string                                 // raw URL-encoded POST body
  parsedBody: Record<string, string>           // key → value parsed
  initialAdIds: string[]
  initialCursor: string | null
}

async function main() {
  console.log(`\n🌐 In-browser GraphQL pagination`)
  console.log(`   page_id:   ${pageId}`)
  console.log(`   max_pages: ${MAX_PAGES}`)
  console.log(`   proxy:     ${noProxyFlag ? 'NONE' : (proxyChainEnabled ? 'IPRoyal' : 'unavailable')}`)
  console.log()

  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  let proxy: { url: string; close: () => Promise<void> } | null = null
  let browser: Browser | null = null

  try {
    if (proxyChainEnabled && !noProxyFlag) {
      proxy = await startProxyChain({ sessionId, lifetime: '15m', country: 'us' })
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
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    })
    const page = await context.newPage()

    // ── Capture the first GraphQL pagination POST ──
    // Wrapped in object so closures can mutate without TS narrowing weirdness
    const state: { template: CapturedTemplate | null } = { template: null }

    page.on('request', (req: PWRequest) => {
      if (state.template) return
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
      if (!parsed.fb_api_req_friendly_name?.includes('AdLibrary') && !parsed.variables.includes('viewAllPageID')) return

      state.template = {
        url: req.url(),
        headers: req.headers(),
        body,
        parsedBody: parsed,
        initialAdIds: [],
        initialCursor: null,
      }
      console.log(`📡 Captured pagination request template (${parsed.fb_api_req_friendly_name ?? 'unknown query'})`)
    })

    page.on('response', async (resp) => {
      const t = state.template
      if (!t || t.initialCursor) return
      if (!resp.url().includes('/api/graphql/')) return
      try {
        const body = await resp.text()
        const ids = extractAdIds(body)
        const cur = extractEndCursor(body)
        if (ids.length > 0 || cur) {
          t.initialAdIds = ids
          t.initialCursor = cur
        }
      } catch { /* ignore */ }
    })

    // ── Navigate ──
    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId!)}`
    console.log(`🚀 Navigating: ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 5_000))

    // ── Trigger initial pagination via mouse wheel (so we capture template) ──
    console.log(`🖱️  Triggering initial pagination via scrolls...`)
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 }
    for (let i = 0; i < 8 && !state.template; i++) {
      await page.mouse.move(
        Math.floor(viewport.width * (0.3 + Math.random() * 0.4)),
        Math.floor(viewport.height * (0.4 + Math.random() * 0.3)),
      ).catch(() => {})
      await page.mouse.wheel(0, 1500 + Math.floor(Math.random() * 800)).catch(() => {})
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000))
    }
    await new Promise(r => setTimeout(r, 3_000))

    const template = state.template
    if (!template) {
      console.error('❌ No pagination POST captured. Meta did not paginate from this session.')
      console.error('   This might mean Meta is gating us at the scroll-trigger level.')
      process.exit(1)
    }

    console.log(`✅ Template captured. Initial response: ${template.initialAdIds.length} ads, cursor=${template.initialCursor ? 'yes' : 'no'}`)
    console.log()

    if (!template.initialCursor) {
      console.warn('⚠️ No initial cursor — Meta returned only one page. Cannot paginate further.')
      process.exit(1)
    }

    // ── Replay pagination INSIDE the browser ──
    const allIds = new Set<string>(template.initialAdIds)

    const result = await page.evaluate(async ({ tpl, startCursor, maxPages }) => {
      const out: Array<{
        page: number
        status: number
        bodySize: number
        ads: number
        newAds: number
        cursor: string | null
        hasNext: boolean
        elapsedMs: number
        error?: string
        bodyPreview?: string
      }> = []

      const seenIds = new Set<string>(tpl.initialAdIds)
      let cursor: string | null = startCursor
      let reqCounter = parseInt(tpl.parsedBody.__req || '0', 10)

      function extractAdIdsB(body: string): string[] {
        const ids: string[] = []
        const re = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
        let m: RegExpExecArray | null
        while ((m = re.exec(body)) !== null) ids.push(m[1])
        return ids
      }
      function extractEndCursorB(body: string): string | null {
        const m = body.match(/"end_cursor"\s*:\s*"([^"]+)"/)
        return m ? m[1] : null
      }
      function hasNextB(body: string): boolean {
        const m = body.match(/"has_next_page"\s*:\s*(true|false)/)
        return m ? m[1] === 'true' : false
      }

      for (let pageNum = 1; pageNum <= maxPages && cursor; pageNum++) {
        const t0 = performance.now()

        // Build new body — splice cursor, increment __req, refresh __spin_t
        const params: Record<string, string> = { ...tpl.parsedBody }
        try {
          const v = JSON.parse(params.variables)
          v.cursor = cursor
          params.variables = JSON.stringify(v)
        } catch (e: any) {
          out.push({ page: pageNum, status: 0, bodySize: 0, ads: 0, newAds: 0, cursor: null, hasNext: false, elapsedMs: 0, error: 'cant parse variables: ' + e.message })
          break
        }
        reqCounter++
        params.__req = String(reqCounter)
        params.__spin_t = String(Math.floor(Date.now() / 1000))

        const newBody = Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')

        try {
          const r = await fetch(tpl.url, {
            method: 'POST',
            credentials: 'include',
            headers: tpl.headers,
            body: newBody,
          })
          const text = await r.text()
          const ids = extractAdIdsB(text)
          const nextCursor = extractEndCursorB(text)
          const more = hasNextB(text)
          let added = 0
          for (const id of ids) if (!seenIds.has(id)) { seenIds.add(id); added++ }

          out.push({
            page: pageNum,
            status: r.status,
            bodySize: text.length,
            ads: ids.length,
            newAds: added,
            cursor: nextCursor,
            hasNext: more,
            elapsedMs: Math.round(performance.now() - t0),
            ...(text.length < 5000 ? { bodyPreview: text.slice(0, 800) } : {}),
          })

          if (!r.ok || ids.length === 0) break
          if (!more || !nextCursor) break
          cursor = nextCursor

          // Polite spacing — match user-like cadence
          await new Promise(res => setTimeout(res, 1200 + Math.random() * 800))
        } catch (e: any) {
          out.push({ page: pageNum, status: 0, bodySize: 0, ads: 0, newAds: 0, cursor: null, hasNext: false, elapsedMs: Math.round(performance.now() - t0), error: e?.message ?? String(e) })
          break
        }
      }

      return { pages: out, totalUnique: seenIds.size }
    }, { tpl: template, startCursor: template.initialCursor, maxPages: MAX_PAGES })

    // ── Print results ──
    console.log()
    console.log(`══════════════════════════════════════════`)
    console.log(`📊 PAGINATION RESULTS`)
    console.log(`══════════════════════════════════════════`)
    for (const p of result.pages) {
      const sizeKB = (p.bodySize / 1024).toFixed(1)
      console.log(`📄 Page ${p.page}: HTTP ${p.status} | ${sizeKB} KB | ${p.ads} ads (${p.newAds} new) | next=${p.cursor ? 'yes' : 'no'} | has_next=${p.hasNext} | ${p.elapsedMs}ms${p.error ? ' | ❌ ' + p.error : ''}`)
      if (p.bodyPreview) console.log(`   body preview: ${p.bodyPreview.replace(/\n/g, ' ').slice(0, 400)}`)
    }
    for (const id of result.pages.flatMap(_ => [])) allIds.add(id)
    console.log()
    console.log(`══════════════════════════════════════════`)
    console.log(`Total unique ads: ${result.totalUnique}`)
    console.log(`Pages requested:  ${result.pages.length}`)
    console.log(`Initial template: ${template.initialAdIds.length} ads`)
    console.log()
    if (result.totalUnique > 30) {
      console.log(`✅ PAGINATION WORKS. Cursor-based replay succeeded inside browser context.`)
    } else if (result.pages.some(p => p.status === 200 && p.bodyPreview?.includes('Couldn'))) {
      console.log(`❌ Meta still rejected requests. Need to investigate which token is invalidating.`)
    } else {
      console.log(`⚠️ Captured fewer than 30 ads. Inspect page output above for clues.`)
    }

    await context.close()
  } finally {
    await browser?.close().catch(() => {})
    if (proxy) await proxy.close().catch(() => {})
  }
}

function extractAdIds(body: string): string[] {
  const ids: string[] = []
  const re = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) ids.push(m[1])
  return ids
}
function extractEndCursor(body: string): string | null {
  const m = body.match(/"end_cursor"\s*:\s*"([^"]+)"/)
  return m ? m[1] : null
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
