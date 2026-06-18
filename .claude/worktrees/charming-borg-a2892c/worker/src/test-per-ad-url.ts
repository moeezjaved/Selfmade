/**
 * Test if visiting a single ad's public URL returns full creative data.
 *
 * Background: The listing URL (?view_all_page_id=X) returns ad_ids but a
 * "logged-out lite" snapshot with empty images[] / videos[]. We need to know
 * if per-ad URLs (?id=AD_ID) return richer data when accessed without login.
 *
 * Usage:
 *   npx tsx src/test-per-ad-url.ts <ad_id>
 *   npx tsx src/test-per-ad-url.ts 1575998776763996
 */
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { startProxyChain } from './proxy-chain.js'
import { randomBytes } from 'node:crypto'

chromium.use(StealthPlugin())

async function main() {
  const adId = process.argv[2]
  if (!adId) {
    console.error('Usage: npx tsx src/test-per-ad-url.ts <ad_id>')
    process.exit(1)
  }

  console.log(`Testing per-ad URL for ad_id ${adId}...`)

  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  const proxy = await startProxyChain({ sessionId, lifetime: '10m', country: 'us' })
  console.log(`Proxy: ${proxy.url}`)

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    proxy: { server: proxy.url },
  })
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  })
  const page = await ctx.newPage()

  const foundInResponses: { url: string; imgCount: number; vidCount: number; hasGatedField: boolean }[] = []

  page.on('response', async (r) => {
    try {
      const t = r.request().resourceType()
      if (!['xhr', 'fetch', 'document'].includes(t)) return
      const body = await r.body().catch(() => null)
      if (!body || body.length === 0) return
      const text = body.toString('utf-8')
      const imgs = text.match(/https:\\?\/\\?\/[^"]*fbcdn\.net[^"]*\.(?:jpg|jpeg|png|webp)/gi) || []
      const vids = text.match(/https:\\?\/\\?\/[^"]*\.(?:mp4|webm)[^"]*/gi) || []
      const hasGated = text.includes('"gated_type"')
      const isGatedLoggedOut = text.includes('"gated_type":"LOGGED_OUT"')
      if (imgs.length || vids.length || hasGated) {
        foundInResponses.push({
          url: r.url().slice(0, 120),
          imgCount: imgs.length,
          vidCount: vids.length,
          hasGatedField: hasGated && !isGatedLoggedOut ? false : isGatedLoggedOut,
        })
      }
    } catch { /* ignore */ }
  })

  const url = `https://www.facebook.com/ads/library/?id=${adId}`
  console.log(`Navigating to ${url}...`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await new Promise(r => setTimeout(r, 12_000))

  // Look at the DOM after JS render
  const visibleImgs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('img'))
      .map(i => (i as HTMLImageElement).src)
      .filter(s => s.includes('fbcdn') && !s.includes('static.xx.fbcdn') && !s.includes('emoji'))
  })
  const visibleVids = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('video'))
      .map(v => {
        const ve = v as HTMLVideoElement
        return ve.src || ve.currentSrc || (ve.querySelector('source') as HTMLSourceElement | null)?.src || ''
      })
      .filter(Boolean)
  })

  // Check if Meta showed "logged out" warning page
  const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '').catch(() => '')

  console.log('\n=== RESULTS ===')
  console.log(`Responses inspected: ${foundInResponses.length}`)
  console.log(`DOM <img> with fbcdn: ${visibleImgs.length}`)
  console.log(`DOM <video>: ${visibleVids.length}`)
  console.log(`Visible page text (first 500 chars):`)
  console.log(`  ${pageText.slice(0, 300)}`)
  if (visibleImgs.length > 0) {
    console.log(`\nFirst 3 image URLs in DOM:`)
    visibleImgs.slice(0, 3).forEach(u => console.log(`  ${u.slice(0, 150)}`))
  }
  if (visibleVids.length > 0) {
    console.log(`\nFirst video URL in DOM:`)
    console.log(`  ${visibleVids[0].slice(0, 150)}`)
  }

  console.log('\n=== VERDICT ===')
  if (visibleVids.length > 0 || visibleImgs.length > 1) {
    console.log('✅ Per-ad URL returns FULL creatives — can use this for extraction.')
  } else if (visibleImgs.length === 1) {
    console.log('⚠️ Only 1 image (likely just brand logo) — Meta is gating without login.')
  } else {
    console.log('❌ No creatives visible — Meta is hard-blocking. Need authenticated session.')
  }

  await browser.close()
  await proxy.close()
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
