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

    if (url.pathname !== '/preview') {
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
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      proxy: proxy ? { server: proxy.url } : undefined,
    }) as unknown as Browser

    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
    })

    // Aggressive blocking — preview only needs the JSON in the initial HTML.
    // Loading Meta's full UI (JS bundles, fonts, images, videos) would burn
    // ~3-5 MB IPRoyal per preview call. With blocking: ~150 KB per preview.
    await context.route('**/*', (route) => {
      const t = route.request().resourceType()
      const url = route.request().url()
      if (t === 'font' || t === 'stylesheet' || t === 'image' || t === 'media') return route.abort()
      if (url.includes('static.xx.fbcdn.net')) return route.abort()
      if (url.includes('/ajax/bz?') || url.includes('/log_clientside_error')) return route.abort()
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
