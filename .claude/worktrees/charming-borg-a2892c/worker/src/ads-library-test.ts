/**
 * Ads Library Scraper MVP — reverse-engineering phase.
 *
 * Goal: validate that we can scrape the public Facebook Ads Library WITHOUT
 * any access_token, by intercepting GraphQL XHRs from Meta's React frontend.
 *
 * SCOPE FOR TONIGHT:
 *   1 browser, 1 page, 1 session — NO concurrency, NO scaling logic.
 *   Pure observability + capture. We need to UNDERSTAND the network layer
 *   before we build the pipeline.
 *
 * Captures (everything saved to /tmp/ads-library-capture/<timestamp>/):
 *   - HAR file (full network archive — replayable)
 *   - All XHR/fetch/document responses with bodies
 *   - All request + response headers for GraphQL endpoints
 *   - cookies / localStorage / sessionStorage after page load
 *   - Index of which responses contain ad_archive_id values
 *   - Any detected pagination cursors (end_cursor, after, paging)
 *   - Page screenshot (was the page actually loaded properly?)
 *
 * Usage:
 *   npx tsx src/ads-library-test.ts <page_id>
 *
 * Examples:
 *   Gymshark:    129669023798560
 *   Hims:        355136938262536
 *   Nike:        15087023444
 *
 * After first success, run on 3-4 different verticals to ensure response
 * structure is consistent (fashion vs supplements vs B2B etc).
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'

// Apply stealth plugin to Chromium — masks automation flags Meta uses to
// detect Playwright/Puppeteer (navigator.webdriver, plugin mismatch, etc).
chromium.use(StealthPlugin())

const PROXY_HOST = process.env.WORKER_PROXY_HOST || ''
const PROXY_PORT = process.env.WORKER_PROXY_PORT || '12321'
const PROXY_USER = process.env.WORKER_PROXY_USER || ''
const PROXY_PASS = process.env.WORKER_PROXY_PASS || ''

interface CapturedResponse {
  seq: number
  url: string
  method: string
  status: number
  bytesIn: number
  contentType: string
  category: 'graphql' | 'ads' | 'relay' | 'batch' | 'other'
  containsAdData: boolean
  containsCursor: boolean
  reqHeaders?: Record<string, string>
  resHeaders?: Record<string, string>
  bodySavedTo?: string
  adIdsExtracted?: string[]
  cursorsExtracted?: string[]
}

const RUN_TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUTPUT_DIR = `/tmp/ads-library-capture/${RUN_TS}`

function categorize(url: string): CapturedResponse['category'] {
  if (url.includes('/api/graphql') || url.includes('/graphql')) return 'graphql'
  if (url.includes('/ads/library/async')) return 'ads'
  if (url.includes('/relay/')) return 'relay'
  if (url.includes('/batch/')) return 'batch'
  if (url.includes('ads')) return 'ads'
  return 'other'
}

/** Try to find ad_archive_id values anywhere in a JSON-ish blob. */
function extractAdIds(text: string): string[] {
  const found = new Set<string>()
  // Matches "ad_archive_id":"123456789" or "adArchiveID":"123456789"
  const re = /"ad_?archive_?[Ii]d"\s*:\s*"?(\d{10,})"?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[1]) found.add(m[1])
  }
  return Array.from(found).slice(0, 50)
}

/** Pagination cursors Meta typically uses. */
function extractCursors(text: string): string[] {
  const cursors: string[] = []
  const patterns = [
    /"end_?cursor"\s*:\s*"([^"]+)"/g,
    /"after"\s*:\s*"([^"]+)"/g,
    /"forwardCursor"\s*:\s*"([^"]+)"/g,
    /"page_?info"\s*:\s*\{[^}]*"end_?cursor"\s*:\s*"([^"]+)"/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[1] && !cursors.includes(m[1])) cursors.push(m[1])
    }
  }
  return cursors.slice(0, 10)
}

async function main() {
  const pageId = process.argv[2]
  if (!pageId) {
    console.error('Usage: npx tsx src/ads-library-test.ts <page_id>')
    console.error('Example (Gymshark): npx tsx src/ads-library-test.ts 129669023798560')
    process.exit(1)
  }

  if (!existsSync(OUTPUT_DIR)) await mkdir(OUTPUT_DIR, { recursive: true })

  // Sticky session via local proxy-chain — Chromium connects to localhost
  // (no auth needed), proxy-chain forwards to IPRoyal with the full
  // sticky-session credentials. Same residential IP for entire run.
  const sessionId = randomBytes(4).toString('hex').slice(0, 8)

  console.log(`🚀 Ads Library Scraper MVP`)
  console.log(`   Run ID: ${RUN_TS}`)
  console.log(`   Target page_id: ${pageId}`)
  console.log(`   Sticky session: ${sessionId} (1h lifetime, US)`)
  console.log(`   Output: ${OUTPUT_DIR}`)
  console.log()

  let localProxyHandle: { url: string; close: () => Promise<void> } | null = null
  let proxyConfig: { server: string } | undefined

  if (proxyChainEnabled) {
    localProxyHandle = await startProxyChain({ sessionId, lifetime: '1h', country: 'us' })
    proxyConfig = { server: localProxyHandle.url }
    console.log(`✅ Proxy chain: ${localProxyHandle.url} → IPRoyal (sticky session ${sessionId})`)
  } else {
    console.log(`⚠️  No proxy configured — using direct connection`)
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
    proxy: proxyConfig,
  })
  console.log(`✅ Stealth Chromium launched`)

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // HAR — full HTTP archive, replayable in Chrome DevTools or har-viewer
    recordHar: { path: path.join(OUTPUT_DIR, 'session.har'), content: 'embed' },
  })

  const page = await context.newPage()
  const captured: CapturedResponse[] = []
  let seq = 0

  // ========== Response interception ==========
  page.on('response', async (response) => {
    try {
      const url = response.url()
      const resourceType = response.request().resourceType()
      // Only capture data requests, skip static assets
      if (!['xhr', 'fetch', 'document'].includes(resourceType)) return
      // Skip Meta's static CDN (UI assets, not data)
      if (url.includes('static.xx.fbcdn') || url.includes('/v/t39') || url.includes('/v/t45')) return

      const contentType = response.headers()['content-type'] || ''
      const status = response.status()
      const method = response.request().method()
      const category = categorize(url)

      let body: Buffer | null = null
      try { body = await response.body() } catch { /* unavailable */ }
      const bytesIn = body?.byteLength || 0
      const bodyText = body?.toString('utf-8') || ''

      const adIds = extractAdIds(bodyText)
      const cursors = extractCursors(bodyText)
      const containsAdData = adIds.length > 0 || /\/v\/t39\.\d+-6\//.test(bodyText) || bodyText.includes('snapshot_url')
      const containsCursor = cursors.length > 0

      seq++
      const record: CapturedResponse = {
        seq,
        url: url.slice(0, 200),
        method,
        status,
        bytesIn,
        contentType: contentType.slice(0, 80),
        category,
        containsAdData,
        containsCursor,
        adIdsExtracted: adIds.length ? adIds : undefined,
        cursorsExtracted: cursors.length ? cursors : undefined,
      }

      // Save body + headers for anything interesting
      const isInteresting = category !== 'other' || containsAdData || containsCursor
      if (isInteresting && body && bytesIn > 0) {
        const tag = containsAdData ? 'AD' : containsCursor ? 'CUR' : category.toUpperCase()
        const filename = `${String(seq).padStart(4, '0')}_${tag}_${bytesIn}b.json`
        await writeFile(path.join(OUTPUT_DIR, filename), body)
        record.bodySavedTo = filename

        // Also save headers for GraphQL requests (useful for replaying request)
        if (category === 'graphql' || containsAdData) {
          const reqHeaders = response.request().headers()
          const resHeaders = response.headers()
          await writeFile(
            path.join(OUTPUT_DIR, `${String(seq).padStart(4, '0')}_HEADERS.json`),
            JSON.stringify({ url, method, status, reqHeaders, resHeaders }, null, 2),
          )
          record.reqHeaders = reqHeaders
          record.resHeaders = resHeaders
        }
      }
      captured.push(record)
    } catch (err: any) {
      console.warn(`  ⚠️ response handler error: ${err.message?.slice(0, 100)}`)
    }
  })

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`  [page error] ${msg.text().slice(0, 150)}`)
    }
  })

  // ========== Navigate ==========
  // active_status=all = include both running + ended ads
  // country=ALL       = no geo filter (max coverage)
  const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${pageId}`
  console.log(`\n🌐 Navigating to:\n   ${url}\n`)

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    console.log(`✅ Page loaded — waiting 15s for XHRs to settle...`)
  } catch (err: any) {
    console.error(`❌ Navigation failed: ${err.message}`)
    await context.close()
    await browser.close()
    process.exit(1)
  }

  // Let React hydrate + initial GraphQL fire
  await new Promise(r => setTimeout(r, 15_000))

  // Trigger pagination by scrolling (random delay between scrolls)
  console.log(`📜 Scrolling to trigger pagination GraphQL...`)
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 1500))
    const delay = 2000 + Math.random() * 4000
    await new Promise(r => setTimeout(r, delay))
  }

  // Capture page state for diagnosis
  const pageTitle = await page.title().catch(() => 'unknown')
  const visibleText = await page.evaluate(() => document.body?.innerText?.slice(0, 800) || '').catch(() => '')
  const screenshotPath = path.join(OUTPUT_DIR, 'page.png')
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {})

  // Save cookies + storage state for replay
  const storageState = await context.storageState().catch(() => null)
  if (storageState) {
    await writeFile(path.join(OUTPUT_DIR, 'storage-state.json'), JSON.stringify(storageState, null, 2))
  }

  // localStorage / sessionStorage from the page
  const browserStorage = await page.evaluate(() => {
    const ls: Record<string, string> = {}
    const ss: Record<string, string> = {}
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; ls[k] = localStorage.getItem(k)! } } catch {}
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i)!; ss[k] = sessionStorage.getItem(k)! } } catch {}
    return { localStorage: ls, sessionStorage: ss }
  }).catch(() => ({ localStorage: {}, sessionStorage: {} }))
  await writeFile(path.join(OUTPUT_DIR, 'browser-storage.json'), JSON.stringify(browserStorage, null, 2))

  await context.close()
  await browser.close()
  if (localProxyHandle) await localProxyHandle.close()

  // ========== Analysis ==========
  console.log(`\n${'='.repeat(72)}`)
  console.log(`📊 CAPTURE SUMMARY`)
  console.log(`${'='.repeat(72)}`)
  console.log(`Page title: "${pageTitle}"`)
  console.log(`Total data responses: ${captured.length}`)
  console.log(`Total bytes captured: ${(captured.reduce((s, c) => s + c.bytesIn, 0) / 1024).toFixed(1)} KB`)
  console.log()

  const byCategory = captured.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log(`Responses by category: ${JSON.stringify(byCategory)}`)

  const adDataRecords = captured.filter(c => c.containsAdData)
  const cursorRecords = captured.filter(c => c.containsCursor)
  const allAdIds = new Set<string>()
  const allCursors = new Set<string>()
  captured.forEach(c => {
    c.adIdsExtracted?.forEach(id => allAdIds.add(id))
    c.cursorsExtracted?.forEach(cur => allCursors.add(cur))
  })

  console.log()
  console.log(`Responses with ad data: ${adDataRecords.length}`)
  console.log(`Responses with cursors: ${cursorRecords.length}`)
  console.log(`Unique ad_archive_ids extracted: ${allAdIds.size}`)
  console.log(`Unique cursors extracted: ${allCursors.size}`)
  console.log()

  if (allAdIds.size > 0) {
    console.log(`First 10 ad_archive_ids found:`)
    Array.from(allAdIds).slice(0, 10).forEach(id => console.log(`  - ${id}`))
  }
  if (allCursors.size > 0) {
    console.log(`\nCursors found (for pagination):`)
    Array.from(allCursors).slice(0, 5).forEach(c => console.log(`  - ${c.slice(0, 80)}...`))
  }

  console.log()
  console.log(`Top 10 interesting responses (saved to disk):`)
  captured.filter(c => c.bodySavedTo).slice(0, 10).forEach((r) => {
    const tags = []
    if (r.containsAdData) tags.push('AD')
    if (r.containsCursor) tags.push('CUR')
    tags.push(r.category)
    console.log(`  #${r.seq} [${tags.join(',')}] ${r.method} ${r.status} ${(r.bytesIn / 1024).toFixed(1)}KB`)
    console.log(`    ${r.url}`)
    console.log(`    saved: ${r.bodySavedTo}`)
  })

  // Index file for easy review
  await writeFile(
    path.join(OUTPUT_DIR, 'INDEX.json'),
    JSON.stringify({
      run_id: RUN_TS,
      target_page_id: pageId,
      page_title: pageTitle,
      total_responses: captured.length,
      total_bytes: captured.reduce((s, c) => s + c.bytesIn, 0),
      unique_ad_ids: allAdIds.size,
      unique_cursors: allCursors.size,
      ad_ids: Array.from(allAdIds),
      cursors: Array.from(allCursors),
      responses: captured,
    }, null, 2),
  )

  console.log()
  console.log(`💾 Files saved to ${OUTPUT_DIR}/:`)
  console.log(`   - session.har         — full network archive (open in DevTools)`)
  console.log(`   - storage-state.json  — cookies/localStorage`)
  console.log(`   - browser-storage.json — page localStorage/sessionStorage`)
  console.log(`   - page.png            — screenshot of loaded page`)
  console.log(`   - INDEX.json          — summary of all captured responses`)
  console.log(`   - NNNN_*.json         — individual response bodies`)
  console.log(`   - NNNN_HEADERS.json   — req/resp headers for GraphQL`)

  console.log()
  if (allAdIds.size >= 5) {
    console.log(`🎯 VERDICT: ✅ ARCHITECTURE VIABLE`)
    console.log(`   Captured ${allAdIds.size} unique ad_archive_ids from public web`)
    console.log(`   No token used. No API call. Just intercepted GraphQL.`)
    console.log(`   Next: build full Playwright indexer using captured response shapes.`)
  } else if (allAdIds.size > 0) {
    console.log(`🎯 VERDICT: ⚠️ PARTIAL — found ${allAdIds.size} ad IDs but expected more`)
    console.log(`   Could be: scrolling didn't trigger pagination, page partially rendered,`)
    console.log(`   or this brand has few ads. Inspect ${OUTPUT_DIR} to understand.`)
  } else {
    console.log(`🎯 VERDICT: ❌ NO AD DATA CAPTURED`)
    console.log(`   Page text preview: ${visibleText.slice(0, 300)}`)
    console.log(`   Likely Meta is blocking us. Check page.png — what does the page look like?`)
  }
  console.log(`${'='.repeat(72)}\n`)

  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
