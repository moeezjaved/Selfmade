/**
 * Per-ad media fetcher test.
 *
 * For ads that came out of the crawl WITHOUT media URLs, fetch each ad's
 * individual Ad Library page (facebook.com/ads/library/?id=<ad_archive_id>)
 * and see if we can extract the image/video URLs directly.
 *
 * If this works, it's the bulletproof fallback: any media-less ad can be
 * backfilled with one cheap per-ad fetch — independent of the deep cursor-walk.
 *
 * Usage:
 *   docker run --rm \
 *     -e PROXYCHEAP_HOST=.. -e PROXYCHEAP_PORT=.. -e PROXYCHEAP_USER=.. -e PROXYCHEAP_PASS=.. \
 *     selfmade-worker npx tsx src/per-ad-fetch.ts <adId1> <adId2> ...
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser } from 'playwright'

chromiumExtra.use(StealthPlugin())

const HOST = process.env.PROXYCHEAP_HOST
const PORT = process.env.PROXYCHEAP_PORT
const USER = process.env.PROXYCHEAP_USER
const PASS = process.env.PROXYCHEAP_PASS
const adIds = process.argv.slice(2).filter(a => /^\d{8,}$/.test(a))

if (!adIds.length) { console.error('Pass ad_archive_ids as args'); process.exit(1) }

function findMedia(text: string): { images: number; videos: number; sample: string | null } {
  const imgs = new Set<string>(), vids = new Set<string>()
  const imgRe = /"(?:original_image_url|resized_image_url)"\s*:\s*"(https:[^"]*fbcdn[^"]*)"/g
  const vidRe = /"(?:video_hd_url|video_sd_url)"\s*:\s*"(https:[^"]*fbcdn[^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = imgRe.exec(text)) !== null) imgs.add(m[1].replace(/\\\//g, '/'))
  while ((m = vidRe.exec(text)) !== null) vids.add(m[1].replace(/\\\//g, '/'))
  const sample = imgs.size ? [...imgs][0] : (vids.size ? [...vids][0] : null)
  return { images: imgs.size, videos: vids.size, sample }
}

async function main() {
  const browser = await chromiumExtra.launch({
    headless: false,
    args: ['--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--disable-gpu'],
    proxy: HOST ? { server: `http://${HOST}:${PORT}`, username: USER, password: PASS } : undefined,
  }) as unknown as Browser

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York',
    })
    const page = await context.newPage()

    for (const adId of adIds) {
      let best = { images: 0, videos: 0, sample: null as string | null }
      const onResp = async (resp: any) => {
        try {
          if (!resp.url().includes('/api/graphql/') && !resp.url().includes('/ads/library')) return
          const t = await resp.text()
          if (!t.includes('fbcdn')) return
          const m = findMedia(t)
          if (m.images + m.videos > best.images + best.videos) best = m
        } catch { /* ignore */ }
      }
      page.on('response', onResp)
      try {
        await page.goto(`https://www.facebook.com/ads/library/?id=${adId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await new Promise(r => setTimeout(r, 6_000))
      } catch (e: any) { console.log(`  ${adId}: nav error ${e?.message?.slice(0,60)}`) }
      page.off('response', onResp)
      const ok = best.images + best.videos > 0
      console.log(`${ok ? '✅' : '❌'} ${adId}: images=${best.images} videos=${best.videos}${best.sample ? ' | ' + best.sample.slice(0, 70) : ''}`)
    }
    await context.close()
  } finally {
    await browser.close().catch(() => {})
  }
}
main().catch(e => { console.error('Fatal:', e); process.exit(1) })
