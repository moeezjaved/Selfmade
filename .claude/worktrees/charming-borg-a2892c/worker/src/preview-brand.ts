/**
 * Brand preview tool — manual review workflow.
 *
 * Flow:
 *   1. You insert into discovery_crawl_terms with is_active=false:
 *      INSERT INTO discovery_crawl_terms (term, page_id, is_active)
 *      VALUES ('your_brand', '<PAGE_ID>', false);
 *
 *   2. Run this preview to verify the page_id is the correct brand:
 *      docker run --rm --env-file .env selfmade-worker \
 *        npx tsx src/preview-brand.ts <PAGE_ID>
 *
 *   3. The tool prints:
 *        - The brand's reported name from Meta
 *        - Sample of 10 ads with body text + thumbnail URLs you can click
 *        - The exact SQL to activate the brand if it's correct
 *
 *   4. Eyeball the ads. If correct, run the printed activation SQL.
 *      If not, delete the row and find the right page_id.
 *
 * The crawl is minimal — just the initial HTML page (~30 ads, ~700KB
 * bandwidth). No scrolling, no pagination, no DB writes to discovery_ads_index.
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Response } from 'playwright'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { randomBytes } from 'node:crypto'

chromiumExtra.use(StealthPlugin())

const pageId = process.argv[2]
if (!pageId || !/^\d+$/.test(pageId)) {
  console.error('Usage: npx tsx src/preview-brand.ts <PAGE_ID>')
  console.error('Example: npx tsx src/preview-brand.ts 355136938262536')
  process.exit(1)
}

interface PreviewAd {
  ad_archive_id: string
  page_name: string
  display_format?: string
  body_text?: string
  is_active?: boolean
  image_urls: string[]
  video_urls: string[]
}

async function main() {
  console.log(`\n🔍 Brand preview for page_id ${pageId}`)
  console.log(`   This will load the initial Ads Library page (~700KB) — no DB writes\n`)

  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  let proxy: { url: string; close: () => Promise<void> } | null = null
  let browser: Browser | null = null

  try {
    if (proxyChainEnabled) {
      proxy = await startProxyChain({ sessionId, lifetime: '5m', country: 'us' })
      console.log(`   Proxy session: ${sessionId}`)
    }

    browser = await chromiumExtra.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      proxy: proxy ? { server: proxy.url } : undefined,
    }) as unknown as Browser

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
    })
    const page = await context.newPage()

    const ads: PreviewAd[] = []
    let brandName = ''
    let totalBytes = 0

    page.on('response', async (response: Response) => {
      try {
        const t = response.request().resourceType()
        if (!['xhr', 'fetch', 'document'].includes(t)) return
        const text = await response.text().catch(() => '')
        if (!text || !text.includes('"ad_archive_id"')) return
        totalBytes += text.length

        // Brace-match each ad object (matches indexer behavior)
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
          let obj: any
          try { obj = JSON.parse(text.slice(start, end)) } catch { continue }
          if (!obj.ad_archive_id) continue
          if (ads.find(a => a.ad_archive_id === obj.ad_archive_id)) continue

          const snap = obj.snapshot || {}
          if (!brandName && snap.page_name) brandName = snap.page_name

          const imgs: string[] = []
          const vids: string[] = []
          if (Array.isArray(snap.images)) for (const i of snap.images) {
            if (i?.original_image_url) imgs.push(i.original_image_url)
          }
          if (Array.isArray(snap.videos)) for (const v of snap.videos) {
            if (v?.video_hd_url) vids.push(v.video_hd_url)
            else if (v?.video_sd_url) vids.push(v.video_sd_url)
          }
          if (Array.isArray(snap.cards)) for (const c of snap.cards) {
            if (c?.original_image_url) imgs.push(c.original_image_url)
            if (c?.video_hd_url) vids.push(c.video_hd_url)
          }

          ads.push({
            ad_archive_id: obj.ad_archive_id,
            page_name: snap.page_name || '',
            display_format: snap.display_format,
            body_text: snap.body?.text,
            is_active: !!obj.is_active,
            image_urls: imgs,
            video_urls: vids,
          })
        }
      } catch { /* ignore */ }
    })

    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${pageId}`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 8_000))

    await context.close()

    // ── Render report ──
    console.log(`\n══════════════════════════════════════════`)
    console.log(`📋 BRAND PREVIEW`)
    console.log(`══════════════════════════════════════════`)
    console.log(`   Brand name (from Meta):  ${brandName || '(not detected)'}`)
    console.log(`   Page ID:                 ${pageId}`)
    console.log(`   Sample ads found:        ${ads.length}`)
    console.log(`   Bandwidth used:          ${(totalBytes / 1024).toFixed(1)} KB`)

    if (ads.length === 0) {
      console.log(`\n   ⚠️  NO ADS FOUND. Either:`)
      console.log(`        - This page_id is wrong / doesn't exist`)
      console.log(`        - The brand has no ads in Meta's Ads Library`)
      console.log(`        - Meta is currently throttling this page`)
      console.log(`\n   Don't activate. Double-check the page_id.\n`)
      process.exit(1)
    }

    console.log(`\n📺 Sample ads (first 10):\n`)
    for (let i = 0; i < Math.min(10, ads.length); i++) {
      const a = ads[i]
      const status = a.is_active ? '🟢 ACTIVE' : '⚪ inactive'
      const fmt = a.display_format || 'UNKNOWN'
      console.log(`   ${i + 1}. ${status} | ${fmt}  (ad_id ${a.ad_archive_id})`)
      if (a.body_text) {
        const preview = a.body_text.replace(/\s+/g, ' ').slice(0, 120)
        console.log(`      body: "${preview}${a.body_text.length > 120 ? '…' : ''}"`)
      }
      if (a.image_urls.length > 0) console.log(`      🖼️  ${a.image_urls[0]}`)
      if (a.video_urls.length > 0) console.log(`      🎬 ${a.video_urls[0]}`)
      console.log()
    }

    console.log(`══════════════════════════════════════════`)
    console.log(`✅ NEXT STEPS`)
    console.log(`══════════════════════════════════════════`)
    console.log(`   If the brand name + ad samples above look CORRECT, activate by running this`)
    console.log(`   in Supabase SQL Editor:\n`)
    console.log(`   UPDATE discovery_crawl_terms SET is_active = true WHERE page_id = '${pageId}';`)
    console.log(`\n   The scheduler will pick it up on the next cycle (~3 min).\n`)
    console.log(`   If the brand is WRONG, delete the row and find the correct page_id:\n`)
    console.log(`   DELETE FROM discovery_crawl_terms WHERE page_id = '${pageId}';\n`)

    process.exit(0)
  } finally {
    await browser?.close().catch(() => {})
    if (proxy) await proxy.close().catch(() => {})
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
