/**
 * Lightweight HTTP server for brand previews.
 *
 * Vercel calls this from the admin /api/admin/brands/preview route to get
 * a brand's sample ads. The droplet uses the same Playwright + IPRoyal
 * residential session that the indexer uses, so Meta accepts the request
 * (it rejects bare-fetch from cloud IPs with HTTP 403).
 *
 *   GET /preview?page_id=NNNNNNNNNNNN
 *   Headers:
 *     X-Preview-Secret: <PREVIEW_SECRET env var>
 *
 *   Response: { page, ads, total_returned } — same shape as the
 *   Vercel route's old (broken) Meta Graph API response.
 *
 * Run as its own container alongside worker + scheduler:
 *   docker run -d --name preview-server --restart unless-stopped \
 *     --env-file .env -p 8787:8787 \
 *     selfmade-worker npx tsx src/preview-server.ts
 *
 * Required env:
 *   PREVIEW_SECRET   — long random string shared with Vercel
 *   PREVIEW_PORT     — optional, default 8787
 *   WORKER_PROXY_*   — same IPRoyal credentials the indexer uses
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Response as PlaywrightResponse } from 'playwright'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { randomBytes } from 'node:crypto'

chromiumExtra.use(StealthPlugin())

const PORT = parseInt(process.env.PREVIEW_PORT ?? '8787', 10)
const SECRET = process.env.PREVIEW_SECRET ?? ''

if (!SECRET) {
  console.error('❌ PREVIEW_SECRET env var required')
  process.exit(1)
}
if (SECRET.length < 16) {
  console.error('❌ PREVIEW_SECRET must be at least 16 characters')
  process.exit(1)
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

interface PreviewAd {
  ad_id: string
  body: string
  title: string
  page_name: string
  snapshot_url: string
  start_date: string | null
  stop_date: string | null
  is_active: boolean
  display_format: string | null
  image_urls: string[]
  video_urls: string[]
  video_preview_urls: string[]
}

// Render a URL at desktop + mobile viewports and return above-the-fold JPEGs (base64) for the CRO
// vision audit. Above-the-fold is where 5-second-clarity / CTA / hero-trust live — and it keeps the
// images small for the vision model.
// A page that came back as a bot-block / challenge rather than the real product page.
const BLOCK_RE = /Robot Check|not a robot|to discuss automated access|enter the characters you see|Type the characters|captcha|503\s*-?\s*Service Unavailable|Service Unavailable Error|Access Denied|Request blocked|cf-browser-verification|Just a moment\.\.\.|Attention Required|Please Wait\.\.\. \| Cloudflare/i
function looksBlocked(status: number, html: string): boolean {
  if (status === 503 || status === 429 || status === 403) return true
  if (!html || html.length < 800) return true
  return BLOCK_RE.test(html.slice(0, 8000))
}

// ── Amazon: the desktop /dp/ page is captcha-gated for datacenter+residential IPs, but the MOBILE
// product page (/gp/aw/d/<ASIN>) serves the full product with far weaker bot defense. We rewrite to it,
// then extract the product straight from the live DOM (the mobile page carries NO JSON-LD / og-tags, so
// generic parsers get nothing). Images come from Amazon's public CDN, downloaded direct (never proxied). ──
const AMZ_ASIN_RE = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i
export function isAmazonUrl(u: string): boolean { try { return /(^|\.)amazon\.[a-z.]+$/i.test(new URL(u).hostname) } catch { return false } }
function amazonAsin(u: string): string | null { try { const m = AMZ_ASIN_RE.exec(new URL(u).pathname); return m ? m[1].toUpperCase() : null } catch { return null } }
function amazonMobileUrl(u: string): string { const a = amazonAsin(u); return a ? `https://www.amazon.com/gp/aw/d/${a}` : u }

type ExtractedProduct = { title?: string; price?: string; images: string[]; features: string[] }
// Runs in the page. Pulls title/price/image/features from Amazon's mobile DOM and upscales thumbnails to
// full resolution (strip the `._AC_SX425_` size token → base image). Kept dependency-free (page context).
async function extractAmazonProduct(page: any): Promise<ExtractedProduct | null> {
  try {
    return await page.evaluate(() => {
      const txt = (sel: string) => { const el = document.querySelector(sel) as HTMLElement | null; return el ? (el.innerText || '').trim() : '' }
      const full = (s: string) => s.replace(/\._[A-Z0-9,_-]+_\.(jpg|jpeg|png|webp)(\b|$)/i, '.$1')
      const title = txt('#productTitle') || txt('#title')
      const price = txt('.a-price .a-offscreen') || txt('#priceblock_ourprice') || txt('#corePrice_feature_div .a-offscreen')
      const imgs = new Set<string>()
      const push = (s?: string | null) => { if (s && /\/images\/I\//.test(s)) imgs.add(full(s.split(' ')[0])) }
      push((document.querySelector('#landingImage') as HTMLImageElement | null)?.currentSrc)
      push((document.querySelector('#landingImage') as HTMLImageElement | null)?.getAttribute('data-old-hires'))
      push((document.querySelector('#imgBlkFront') as HTMLImageElement | null)?.src)
      const dyn = (document.querySelector('#landingImage') as HTMLElement | null)?.getAttribute('data-a-dynamic-image')
      if (dyn) { try { Object.keys(JSON.parse(dyn)).forEach(push) } catch {} }
      document.querySelectorAll('#altImages img, #main-image-container img, li.image img').forEach((e) => push((e as HTMLImageElement).src))
      const features = Array.from(document.querySelectorAll('#feature-bullets li, #feature-bullets .a-list-item'))
        .map((e) => (e as HTMLElement).innerText.trim())
        .filter((t) => t && t.length > 8 && !/image (un)?available|not available for/i.test(t))
      return { title, price, images: Array.from(imgs).slice(0, 8), features: features.slice(0, 8) }
    })
  } catch { return null }
}

// Load a URL in a real (stealth) browser through the IPRoyal residential session and return the rendered
// DOM. Used by the Page Builder's URL importer for sites that block bare/proxied HTTP fetch. Retries with
// a FRESH residential session (new IP) on a bot-block/challenge — the hostile sites (Amazon) 503 a given
// IP but usually let a different one through.
async function fetchRenderedHtml(target: string, attempts = 3): Promise<{ html: string | null; error?: string; product?: ExtractedProduct }> {
  let lastErr: string | undefined
  const amazon = isAmazonUrl(target)
  const nav = amazon ? amazonMobileUrl(target) : target   // Amazon → reliable mobile product page
  for (let i = 0; i < attempts; i++) {
    const sessionId = randomBytes(4).toString('hex').slice(0, 8)   // new session id → new residential IP
    let proxy: { url: string; close: () => Promise<void> } | null = null
    let browser: Browser | null = null
    try {
      if (proxyChainEnabled) proxy = await startProxyChain({ sessionId, lifetime: '5m', country: 'us' })
      browser = await chromiumExtra.launch({
        headless: false,
        args: ['--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--disable-gpu'],
        proxy: proxy ? { server: proxy.url } : undefined,
      }) as unknown as Browser
      const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-US' })
      const page = await ctx.newPage()
      try {
        const resp = await page.goto(nav, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(1600)   // let JSON-LD + client-rendered product data settle
        const html = await page.content()
        const status = resp?.status() ?? 0
        if (!looksBlocked(status, html)) {
          // Amazon's mobile DOM has no JSON-LD/og-tags — extract the product here while we hold the page.
          const product = amazon ? (await extractAmazonProduct(page)) ?? undefined : undefined
          return { html: html.slice(0, 3_000_000), ...(product?.title ? { product } : {}) }
        }
        lastErr = `blocked (status=${status})`
        console.log(`[fetch-html] attempt ${i + 1}/${attempts} ${lastErr} — retrying with a fresh session`)
      } finally { await ctx.close().catch(() => {}) }
    } catch (e: any) {
      lastErr = String(e?.message || e).slice(0, 160)
    } finally {
      if (proxy) await proxy.close().catch(() => {})
      if (browser) await browser.close().catch(() => {})
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 700 + Math.random() * 1100))   // brief backoff
  }
  return { html: null, error: lastErr || 'blocked' }
}

async function captureShots(target: string): Promise<{ desktop: string | null; mobile: string | null; error?: string }> {
  let browser: Browser | null = null
  try {
    browser = await chromiumExtra.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
    const grab = async (width: number, height: number, isMobile: boolean, ua: string): Promise<string | null> => {
      const ctx = await browser!.newContext({ viewport: { width, height }, userAgent: ua, deviceScaleFactor: 1, isMobile })
      const page = await ctx.newPage()
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(1800)   // let the hero + images paint
        const buf = await page.screenshot({ type: 'jpeg', quality: 68, fullPage: false })
        return Buffer.from(buf).toString('base64')
      } finally { await ctx.close().catch(() => {}) }
    }
    const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    const desktop = await grab(1280, 900, false, UA).catch(() => null)
    const mobile = await grab(390, 844, true, MOBILE_UA).catch(() => null)
    return { desktop, mobile }
  } catch (e: any) {
    return { desktop: null, mobile: null, error: String(e?.message || e).slice(0, 160) }
  } finally { if (browser) await browser.close().catch(() => {}) }
}

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

// Full-page capture SLICED into viewport-height sections (desktop 1440 + mobile 390), for the CRO
// evidence pass — so vision can map the WHOLE customer journey, not just above the fold ("your offer
// isn't understood until section 4"). Section 0 is the above-the-fold shot. Capped at 6 sections/device.
async function captureSectioned(target: string): Promise<{ desktop: string[]; mobile: string[]; aboveFold: { desktop: string | null; mobile: string | null }; error?: string }> {
  let browser: Browser | null = null
  try {
    browser = await chromiumExtra.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
    const grabSections = async (width: number, height: number, isMobile: boolean, ua: string): Promise<string[]> => {
      const ctx = await browser!.newContext({ viewport: { width, height }, userAgent: ua, deviceScaleFactor: 1, isMobile })
      const page = await ctx.newPage()
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(1800)
        const total = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)).catch(() => height)
        const n = Math.max(1, Math.min(6, Math.ceil((total || height) / height)))
        const out: string[] = []
        for (let i = 0; i < n; i++) {
          await page.evaluate((y) => window.scrollTo(0, y), i * height).catch(() => {})
          await page.waitForTimeout(400)   // let lazy images/sections paint on scroll
          const buf = await page.screenshot({ type: 'jpeg', quality: 64, fullPage: false })
          out.push(Buffer.from(buf).toString('base64'))
        }
        return out
      } finally { await ctx.close().catch(() => {}) }
    }
    const desktop = await grabSections(1440, 900, false, UA).catch(() => [] as string[])
    const mobile = await grabSections(390, 844, true, MOBILE_UA).catch(() => [] as string[])
    return { desktop, mobile, aboveFold: { desktop: desktop[0] || null, mobile: mobile[0] || null } }
  } catch (e: any) {
    return { desktop: [], mobile: [], aboveFold: { desktop: null, mobile: null }, error: String(e?.message || e).slice(0, 160) }
  } finally { if (browser) await browser.close().catch(() => {}) }
}

const server = createServer(async (req, res) => {
  // CORS for browser-direct testing (admin UI calls go through the Vercel
  // route, which is server-side, so CORS doesn't apply there).
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'X-Preview-Secret, Content-Type')

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // Health check (no auth) — used by uptime monitors
    if (url.pathname === '/health') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ ok: true, ts: Date.now() }))
      return
    }

    if (url.pathname !== '/preview' && url.pathname !== '/search' && url.pathname !== '/screenshot' && url.pathname !== '/fetch-html') {
      res.statusCode = 404
      res.end('not found')
      return
    }

    // Auth
    const auth = req.headers['x-preview-secret']
    if (auth !== SECRET) {
      res.statusCode = 401
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    // ── Keyword search across the whole Ad Library (advertiser DISCOVERY) ──
    if (url.pathname === '/search') {
      const q = (url.searchParams.get('q') || '').trim()
      if (!q) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'q (query) required' }))
        return
      }
      const country = (url.searchParams.get('country') || 'ALL').toUpperCase().replace(/[^A-Z]/g, '') || 'ALL'
      const cap = Math.min(parseInt(url.searchParams.get('limit') || '60', 10), 120)
      console.log(`[search] "${q}" country=${country} cap=${cap}`)
      const data = await fetchSearch(q, country, cap)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
      return
    }

    // ── Screenshot a store page (desktop + mobile) for the CRO vision audit ──
    if (url.pathname === '/screenshot') {
      const target = (url.searchParams.get('url') || '').trim()
      if (!/^https?:\/\//.test(target)) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'url required (http/https)' }))
        return
      }
      const wantSections = url.searchParams.get('sections') === '1'
      console.log(`[screenshot] ${target}${wantSections ? ' (sectioned)' : ''}`)
      const shots = wantSections ? await captureSectioned(target) : await captureShots(target)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(shots))
      return
    }

    // ── Render a page's HTML through a real browser (Playwright + IPRoyal + stealth) for the Page
    // Builder's URL importer — the last-resort fallback for sites that block bare/proxied fetch
    // (Amazon, Cloudflare-protected Shopify Plus). Returns the DOM after JS runs, so JSON-LD +
    // client-rendered product data are present. HTML only — never downloads the page's images/video. ──
    if (url.pathname === '/fetch-html') {
      const target = (url.searchParams.get('url') || '').trim()
      if (!/^https?:\/\//.test(target)) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'url required (http/https)' }))
        return
      }
      console.log(`[fetch-html] ${target}`)
      const out = await fetchRenderedHtml(target)
      res.statusCode = out.html ? 200 : 502
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(out))
      return
    }

    const pageId = url.searchParams.get('page_id')
    if (!pageId || !/^\d+$/.test(pageId)) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'page_id required (numeric)' }))
      return
    }
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10), 30)

    console.log(`[preview] ${pageId} (limit=${limit})`)
    const data = await fetchPreview(pageId, limit)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
  } catch (err: any) {
    console.error('[preview]', err)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: err?.message || 'internal error' }))
  }
})

server.listen(PORT, () => {
  console.log(`✅ preview-server listening on :${PORT}`)
  console.log(`   proxy_chain_enabled=${proxyChainEnabled}`)
})

// ───────────────────────────────────────────

async function fetchPreview(pageId: string, limit: number) {
  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  let proxy: { url: string; close: () => Promise<void> } | null = null
  let browser: Browser | null = null

  try {
    if (proxyChainEnabled) {
      proxy = await startProxyChain({ sessionId, lifetime: '5m', country: 'us' })
    }

    browser = await chromiumExtra.launch({
      // Chromium new-headless (--headless=new) — much harder for Meta to
      // detect than old headless. See playwright-indexer.ts for context.
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
      userAgent: UA,
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
    })

    // Targeted blocking — kill bandwidth hogs but allow Meta's React to
    // render properly. Preview doesn't need pagination so blocking images
    // is safer here than in the indexer, but we still allow them just in
    // case future preview improvements need to scroll.
    await context.route('**/*', (route) => {
      const url = route.request().url()
      if (url.includes('static.xx.fbcdn.net')) return route.abort()
      if (url.includes('/ajax/bz?') || url.includes('/log_clientside_error')) return route.abort()
      if (url.includes('/groups/') || url.includes('/messenger/') || url.includes('/marketplace/')) return route.abort()
      return route.continue()
    })

    const page = await context.newPage()

    const adObjects: any[] = []

    page.on('response', async (response: PlaywrightResponse) => {
      try {
        const t = response.request().resourceType()
        if (!['xhr', 'fetch', 'document'].includes(t)) return
        const text = await response.text().catch(() => '')
        if (!text || !text.includes('"ad_archive_id"')) return
        const found = extractAdsBraceMatched(text)
        for (const obj of found) {
          if (!adObjects.find(a => a.ad_archive_id === obj.ad_archive_id)) {
            adObjects.push(obj)
          }
          if (adObjects.length >= limit + 5) return  // stop early
        }
      } catch { /* ignore parse errors */ }
    })

    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId)}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 8_000))

    await context.close()

    if (adObjects.length === 0) {
      return {
        page: null,
        ads: [],
        total_returned: 0,
        warning: 'No ads found. Either the page_id is wrong, the brand has no ads, or Meta is currently throttling this lookup.',
      }
    }

    const firstSnap = adObjects[0]?.snapshot || {}
    const pageInfo = {
      page_id: pageId,
      name: firstSnap.page_name || null,
      category: Array.isArray(firstSnap.page_categories) ? firstSnap.page_categories[0] : null,
      follower_count: typeof firstSnap.page_like_count === 'number' ? firstSnap.page_like_count : null,
      picture: firstSnap.page_profile_picture_url || null,
      website: firstSnap.page_profile_uri || null,
      link: firstSnap.page_profile_uri || null,
      verified: false,
    }

    const ads: PreviewAd[] = adObjects.slice(0, limit).map((obj: any) => {
      const snap = obj.snapshot || {}
      const media = extractMediaUrls(snap)
      return {
        ad_id: String(obj.ad_archive_id),
        body: snap.body?.text || '',
        title: snap.title || snap.link_description || '',
        page_name: snap.page_name || '',
        snapshot_url: `https://www.facebook.com/ads/library/?id=${obj.ad_archive_id}`,
        start_date: obj.start_date_string || (obj.start_date ? new Date(obj.start_date * 1000).toISOString() : null),
        stop_date: obj.end_date_string || (obj.end_date ? new Date(obj.end_date * 1000).toISOString() : null),
        is_active: !!obj.is_active,
        display_format: snap.display_format || null,
        image_urls: media.images,
        video_urls: media.videos,
        video_preview_urls: media.videoPreviews,
      }
    })

    return {
      page: pageInfo,
      ads,
      total_returned: ads.length,
      total_found: adObjects.length,
    }
  } finally {
    await browser?.close().catch(() => {})
    if (proxy) await proxy.close().catch(() => {})
  }
}

/**
 * Keyword search across the ENTIRE Ad Library (all advertisers), grouped by page.
 * This is how we DISCOVER in-niche competitors Google organic misses — same Playwright + IPRoyal
 * session as the preview, but the search URL + a few scrolls to load more results.
 */
async function fetchSearch(query: string, country: string, cap: number) {
  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  let proxy: { url: string; close: () => Promise<void> } | null = null
  let browser: Browser | null = null
  try {
    if (proxyChainEnabled) proxy = await startProxyChain({ sessionId, lifetime: '5m', country: 'us' })
    browser = await chromiumExtra.launch({
      headless: false,
      args: ['--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--disable-gpu'],
      proxy: proxy ? { server: proxy.url } : undefined,
    }) as unknown as Browser
    const context = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    await context.route('**/*', (route) => {
      const u = route.request().url()
      if (u.includes('static.xx.fbcdn.net')) return route.abort()
      if (u.includes('/ajax/bz?') || u.includes('/log_clientside_error')) return route.abort()
      if (u.includes('/groups/') || u.includes('/messenger/') || u.includes('/marketplace/')) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    const adObjects: any[] = []
    page.on('response', async (response: PlaywrightResponse) => {
      try {
        const t = response.request().resourceType()
        if (!['xhr', 'fetch', 'document'].includes(t)) return
        const text = await response.text().catch(() => '')
        if (!text || !text.includes('"ad_archive_id"')) return
        for (const obj of extractAdsBraceMatched(text)) {
          if (!adObjects.find(a => a.ad_archive_id === obj.ad_archive_id)) adObjects.push(obj)
        }
      } catch { /* ignore */ }
    })
    const searchUrl = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${encodeURIComponent(country)}&q=${encodeURIComponent(query)}&search_type=keyword_unordered&media_type=all`
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 6_000))
    // Scroll to trigger more result batches until we hit the cap or stop growing.
    let last = 0, stable = 0
    for (let i = 0; i < 12 && adObjects.length < cap && stable < 3; i++) {
      await page.mouse.wheel(0, 4000).catch(() => {})
      await new Promise(r => setTimeout(r, 2_500))
      if (adObjects.length === last) stable++; else { stable = 0; last = adObjects.length }
    }
    await context.close()

    // Group by advertiser page.
    const byPage = new Map<string, { page_id: string; page_name: string; domain: string | null; ads: any[] }>()
    for (const obj of adObjects) {
      const snap = obj.snapshot || {}
      const pid = String(obj.page_id || snap.page_id || '')
      if (!pid) continue
      const media = extractMediaUrls(snap)
      const link = snap.link_url || snap.caption || snap.page_profile_uri || ''
      let domain: string | null = null
      try { const h = new URL(link.startsWith('http') ? link : `https://${link}`).hostname.replace(/^www\./, '').toLowerCase(); if (h && !h.includes('facebook.com') && !h.includes('fb.com')) domain = h } catch { /* skip */ }
      const entry = byPage.get(pid) || { page_id: pid, page_name: snap.page_name || '', domain: null, ads: [] as any[] }
      if (!entry.page_name && snap.page_name) entry.page_name = snap.page_name
      if (!entry.domain && domain) entry.domain = domain
      if (entry.ads.length < 6) entry.ads.push({
        ad_id: String(obj.ad_archive_id), body: snap.body?.text || '', title: snap.title || snap.link_description || '',
        is_active: !!obj.is_active, image_urls: media.images, video_urls: media.videos, video_preview_urls: media.videoPreviews, link,
      })
      byPage.set(pid, entry)
    }
    return { query, country, total_ads: adObjects.length, advertisers: Array.from(byPage.values()) }
  } finally {
    await browser?.close().catch(() => {})
    if (proxy) await proxy.close().catch(() => {})
  }
}

function extractAdsBraceMatched(text: string): any[] {
  const found: any[] = []
  const adIdRegex = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
  const positions: number[] = []
  let m: RegExpExecArray | null
  while ((m = adIdRegex.exec(text)) !== null) positions.push(m.index)
  for (const pos of positions) {
    let start = pos
    while (start > 0 && text[start] !== '{') start--
    let depth = 0, end = start
    for (let i = start; i < text.length && i < start + 250_000; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    if (end === start) continue
    try {
      const obj = JSON.parse(text.slice(start, end))
      if (obj.ad_archive_id) found.push(obj)
    } catch { /* malformed slice */ }
  }
  return found
}

function extractMediaUrls(snap: any): { images: string[]; videos: string[]; videoPreviews: string[] } {
  const images = new Set<string>()
  const videos = new Set<string>()
  const videoPreviews = new Set<string>()
  const pushImg = (...c: any[]) => {
    for (const v of c) if (typeof v === 'string' && v.startsWith('http') && v.includes('fbcdn')) { images.add(v); return }
  }
  const pushVid = (...c: any[]) => {
    for (const v of c) if (typeof v === 'string' && v.startsWith('http') && v.includes('fbcdn')) { videos.add(v); return }
  }
  const pushPrev = (...c: any[]) => {
    for (const v of c) if (typeof v === 'string' && v.startsWith('http') && v.includes('fbcdn')) { videoPreviews.add(v); return }
  }
  if (Array.isArray(snap?.images)) for (const i of snap.images) pushImg(i?.original_image_url, i?.resized_image_url)
  if (Array.isArray(snap?.videos)) for (const v of snap.videos) {
    pushVid(v?.video_hd_url, v?.video_sd_url)
    pushPrev(v?.video_preview_image_url)
  }
  if (Array.isArray(snap?.cards)) for (const c of snap.cards) {
    pushImg(c?.original_image_url, c?.resized_image_url)
    pushVid(c?.video_hd_url, c?.video_sd_url)
    pushPrev(c?.video_preview_image_url)
  }
  return { images: [...images], videos: [...videos], videoPreviews: [...videoPreviews] }
}
