/**
 * One-off debugger — load an ad's snapshot URL with Playwright,
 * dump every <img> URL with classification.
 *
 * Run via:
 *   docker exec worker node dist/inspect.js <ad_id>
 */
import { supabase } from './db.js'
import { getBrowser, closeBrowser } from './extract.js'

function stpSize(url: string): number {
  const m = url?.match(/_s(\d+)x\d+/)
  return m ? parseInt(m[1]) : 0
}

function classify(src: string): string {
  if (!src) return 'empty'
  if (!src.includes('fbcdn') && !src.includes('scontent')) return 'non-fbcdn'
  if (src.includes('static.xx.fbcdn')) return '🚨 STATIC_UI'
  if (src.includes('/emoji')) return 'emoji'
  if (src.includes('hsts-pixel')) return 'hsts-pixel'
  if (src.match(/\/v\/t39\.35426-6\//)) return '✅ AD_CREATIVE_t39.35426-6'
  if (src.match(/\/v\/t39\.30808-6\//)) return '✅ AD_CREATIVE_t39.30808-6'
  if (src.match(/\/v\/t45\.5328-4\//)) return '✅ AD_CREATIVE_t45.5328-4'
  if (src.match(/\/v\/t1\.\d+/)) return '🚨 STATIC_UI_t1'
  if (src.match(/\/v\/t39\.\d+/)) return '⚠️ unknown_t39'
  return '⚠️ unclassified'
}

async function main() {
  const adId = process.argv[2]
  if (!adId) {
    console.error('Usage: node dist/inspect.js <ad_id>')
    process.exit(1)
  }

  console.log(`🔍 Inspecting ad ${adId}...`)

  const { data: ad } = await (supabase as any)
    .from('discovery_ads_index')
    .select('snapshot_url, thumbnail_url, video_url, page_name, format')
    .eq('ad_id', adId)
    .maybeSingle()

  if (!ad?.snapshot_url) {
    console.error(`❌ No snapshot_url for ad ${adId}`)
    process.exit(1)
  }

  console.log(`📋 ${ad.page_name} · ${ad.format}`)
  console.log(`📋 Snapshot: ${ad.snapshot_url.slice(0, 100)}…`)
  console.log(`📋 Currently stored thumb: ${ad.thumbnail_url || '(none)'}`)
  console.log(`📋 Currently stored video: ${ad.video_url || '(none)'}\n`)

  const browser = await getBrowser()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  await page.route('**/*', (route) => {
    const t = route.request().resourceType()
    if (t === 'font' || t === 'stylesheet') return route.abort()
    return route.continue()
  })

  console.log(`🌐 Loading page...`)
  const resp = await page.goto(ad.snapshot_url, { waitUntil: 'domcontentloaded', timeout: 15000 })
  console.log(`📄 HTTP ${resp?.status()}, title: "${await page.title()}"`)

  // Wait for content to render
  try {
    await page.waitForFunction(() => document.querySelectorAll('img').length > 5, { timeout: 6000 })
  } catch {}
  await new Promise(r => setTimeout(r, 2500))

  const data = await page.evaluate(() => {
    const allImgs = Array.from(document.querySelectorAll('img')).map(img => ({
      src: (img as HTMLImageElement).src,
      width: (img as HTMLImageElement).naturalWidth,
      height: (img as HTMLImageElement).naturalHeight,
    }))
    const allVideos = Array.from(document.querySelectorAll('video')).map(v => ({
      src: (v as HTMLVideoElement).src || (v as HTMLVideoElement).currentSrc,
      poster: (v as HTMLVideoElement).poster,
    }))
    return { allImgs, allVideos, htmlLen: document.documentElement.outerHTML.length }
  })

  console.log(`\n🖼  ${data.allImgs.length} <img> tags found, ${data.allVideos.length} <video> tags`)
  console.log(`📜 HTML size: ${data.htmlLen} bytes\n`)

  console.log(`══════════════════ IMAGES ══════════════════`)
  data.allImgs
    .filter((i: any) => i.src)
    .forEach((img: any, idx: number) => {
      const cls = classify(img.src)
      const sz = stpSize(img.src)
      console.log(`[${idx}] ${cls}  natural=${img.width}x${img.height}  stp=${sz}`)
      console.log(`     ${img.src.slice(0, 140)}${img.src.length > 140 ? '…' : ''}`)
    })

  if (data.allVideos.length > 0) {
    console.log(`\n══════════════════ VIDEOS ══════════════════`)
    data.allVideos.forEach((v: any, idx: number) => {
      console.log(`[${idx}] ${v.src ? v.src.slice(0, 150) : '(no src)'}`)
    })
  }

  // Summary
  const adCreatives = data.allImgs.filter((i: any) => classify(i.src).includes('AD_CREATIVE'))
  const staticUI = data.allImgs.filter((i: any) => classify(i.src).includes('STATIC_UI'))

  console.log(`\n══════════════════ SUMMARY ══════════════════`)
  console.log(`  ✅ Real ad creatives: ${adCreatives.length}`)
  console.log(`  🚨 Meta static UI:     ${staticUI.length}`)
  console.log(`  ⚠️  Unclassified:      ${data.allImgs.length - adCreatives.length - staticUI.length}`)

  if (staticUI.length > 0 && adCreatives.length === 0) {
    console.log(`\n💡 BUG CONFIRMED: This ad has only static UI images, no real ad creative.`)
    console.log(`   Worker is saving the wrong image. Need to filter out STATIC_UI paths.`)
  } else if (adCreatives.length > 0) {
    console.log(`\n💡 Real creative IS available. Filter should pick: AD_CREATIVE_*`)
  }

  await page.close()
  await context.close()
  await closeBrowser()
  process.exit(0)
}

main().catch(err => {
  console.error('💀 Fatal:', err)
  process.exit(1)
})
