/**
 * Research script — tests whether Meta's /ads/archive/render_ad/ URL returns
 * creative URLs in the server-rendered HTML, OR if they only appear after
 * JavaScript runs (which would force us to keep Playwright).
 *
 * Usage on droplet:
 *   docker exec -it worker node dist/test-http-extract.js <ad_id>
 *   OR run locally:
 *   npx tsx src/test-http-extract.ts <ad_id> <access_token>
 *
 * What we want to see:
 *   - HTML contains fbcdn.net image URLs matching /v/t39.*-6/ pattern → SUCCESS
 *   - HTML contains fbcdn.net video URLs → SUCCESS
 *   - HTML contains only static.xx.fbcdn.net (UI placeholders) → FAIL, need JS
 */
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { config, proxyEnabled } from './config.js'
import { supabase } from './db.js'

interface ExtractResult {
  url: string
  bytesDownloaded: number
  htmlSnippet: string
  realImagesFound: string[]
  realVideosFound: string[]
  staticImagesFound: number
  totalImagesInHtml: number
  status: 'SUCCESS' | 'FAIL_NO_REAL_CREATIVE' | 'ERROR'
  error?: string
}

async function fetchSnapshot(url: string): Promise<{ html: string; bytes: number }> {
  let dispatcher: ProxyAgent | undefined
  if (proxyEnabled) {
    const proxyUrl = `http://${encodeURIComponent(config.proxy.user)}:${encodeURIComponent(config.proxy.pass)}@${config.proxy.host}:${config.proxy.port}`
    dispatcher = new ProxyAgent(proxyUrl)
  }

  const res = await undiciFetch(url, {
    dispatcher,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
    },
    signal: AbortSignal.timeout(15_000),
  } as any)

  const html = await res.text()
  return { html, bytes: html.length }
}

async function testExtract(adId: string): Promise<ExtractResult> {
  // Look up the snapshot_url from DB
  const { data: ad, error } = await (supabase as any)
    .from('discovery_ads_index')
    .select('ad_id, snapshot_url')
    .eq('ad_id', adId)
    .single()

  if (error || !ad?.snapshot_url) {
    return {
      url: '', bytesDownloaded: 0, htmlSnippet: '',
      realImagesFound: [], realVideosFound: [],
      staticImagesFound: 0, totalImagesInHtml: 0,
      status: 'ERROR', error: `Ad not found in DB: ${error?.message || 'no snapshot_url'}`,
    }
  }

  try {
    const { html, bytes } = await fetchSnapshot(ad.snapshot_url)

    // Find all fbcdn-style URLs
    const allFbcdnUrls = html.match(/https?:\/\/[^"'\s<>\\]+(?:scontent|fbcdn)[^"'\s<>\\]*/gi) || []
    const allImages = allFbcdnUrls.filter(u => /\.(jpg|jpeg|png|webp)/i.test(u))
    const allVideos = allFbcdnUrls.filter(u => /\.(mp4|webm)/i.test(u))

    // Real ad creatives are on /v/t39.*-6/ or /v/t45.*-4/ paths
    const realCreativeRegex = /\/v\/t39\.\d+-6\/|\/v\/t45\.\d+-4\//
    const realImages = Array.from(new Set(allImages.filter(u => realCreativeRegex.test(u))))
    const realVideos = Array.from(new Set(allVideos.filter(u => u.includes('fbcdn'))))

    // Count UI placeholder images (these should be filtered)
    const staticCount = allImages.filter(u => u.includes('static.xx.fbcdn') || u.includes('static.fbcdn')).length

    const status: ExtractResult['status'] = (realImages.length > 0 || realVideos.length > 0)
      ? 'SUCCESS'
      : 'FAIL_NO_REAL_CREATIVE'

    return {
      url: ad.snapshot_url,
      bytesDownloaded: bytes,
      htmlSnippet: html.slice(0, 500),
      realImagesFound: realImages.slice(0, 5),
      realVideosFound: realVideos.slice(0, 3),
      staticImagesFound: staticCount,
      totalImagesInHtml: allImages.length,
      status,
    }
  } catch (err: any) {
    return {
      url: ad.snapshot_url, bytesDownloaded: 0, htmlSnippet: '',
      realImagesFound: [], realVideosFound: [],
      staticImagesFound: 0, totalImagesInHtml: 0,
      status: 'ERROR', error: err.message ?? String(err),
    }
  }
}

async function main() {
  const adIds = process.argv.slice(2)
  if (adIds.length === 0) {
    console.error('Usage: node test-http-extract.js <ad_id> [<ad_id> ...]')
    process.exit(1)
  }

  console.log(`Testing HTTP extraction on ${adIds.length} ad(s)...`)
  console.log(`Proxy: ${proxyEnabled ? `${config.proxy.host}:${config.proxy.port}` : 'DIRECT (no proxy)'}\n`)

  let totalBytes = 0
  let successes = 0
  for (const adId of adIds) {
    console.log(`\n=== Ad ${adId} ===`)
    const r = await testExtract(adId)
    if (r.status === 'ERROR') {
      console.log(`❌ ERROR: ${r.error}`)
      continue
    }
    totalBytes += r.bytesDownloaded
    console.log(`HTML downloaded: ${(r.bytesDownloaded / 1024).toFixed(1)} KB`)
    console.log(`Total <img> URLs found: ${r.totalImagesInHtml}`)
    console.log(`  - Static UI images: ${r.staticImagesFound}`)
    console.log(`  - Real creative images: ${r.realImagesFound.length}`)
    console.log(`Real creative videos: ${r.realVideosFound.length}`)
    console.log(`Status: ${r.status === 'SUCCESS' ? '✅ SUCCESS' : '❌ ' + r.status}`)
    if (r.realImagesFound.length > 0) {
      console.log(`First real image: ${r.realImagesFound[0].slice(0, 100)}...`)
    }
    if (r.realVideosFound.length > 0) {
      console.log(`First real video: ${r.realVideosFound[0].slice(0, 100)}...`)
    }
    if (r.status === 'FAIL_NO_REAL_CREATIVE') {
      console.log(`HTML preview (500 chars): ${r.htmlSnippet}`)
    }
    if (r.status === 'SUCCESS') successes++
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`Success rate: ${successes}/${adIds.length} (${((successes / adIds.length) * 100).toFixed(0)}%)`)
  console.log(`Avg bytes/ad: ${(totalBytes / adIds.length / 1024).toFixed(1)} KB`)
  console.log(`\nVerdict:`)
  if (successes / adIds.length >= 0.8) {
    console.log(`✅ HTTP-only extraction is VIABLE — proceed with worker integration`)
  } else if (successes / adIds.length >= 0.3) {
    console.log(`⚠️  PARTIAL viability — use HTTP-first, fall back to Playwright`)
  } else {
    console.log(`❌ HTTP-only NOT viable — Meta requires JS rendering, keep Playwright`)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
