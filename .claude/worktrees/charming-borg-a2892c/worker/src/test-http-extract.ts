/**
 * Research script — tests whether Meta's /ads/archive/render_ad/ URL returns
 * creative URLs in server-rendered HTML.
 *
 * Standalone script — no Supabase dependency. Pass snapshot URLs directly.
 *
 * Usage:
 *   npx tsx src/test-http-extract.ts "URL1" "URL2" "URL3"
 *
 * Get URLs from SQL editor first:
 *   SELECT snapshot_url FROM discovery_ads_index
 *   WHERE thumbnail_url LIKE '%r2.dev%' LIMIT 5;
 */
import { fetch as undiciFetch, ProxyAgent, Dispatcher } from 'undici'

// Read proxy config directly from env (no config.ts dependency to keep this standalone)
const HOST = process.env.WORKER_PROXY_HOST || ''
const PORT = process.env.WORKER_PROXY_PORT || '12321'
const USER = process.env.WORKER_PROXY_USER || ''
const PASS = process.env.WORKER_PROXY_PASS || ''
const proxyEnabled = !!(HOST && USER && PASS)

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
  let dispatcher: Dispatcher | undefined
  if (proxyEnabled) {
    const proxyUrl = `http://${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@${HOST}:${PORT}`
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

async function testExtract(url: string): Promise<ExtractResult> {
  try {
    const { html, bytes } = await fetchSnapshot(url)

    const allFbcdnUrls = html.match(/https?:\/\/[^"'\s<>\\]+(?:scontent|fbcdn)[^"'\s<>\\]*/gi) || []
    const allImages = allFbcdnUrls.filter(u => /\.(jpg|jpeg|png|webp)/i.test(u))
    const allVideos = allFbcdnUrls.filter(u => /\.(mp4|webm)/i.test(u))

    const realCreativeRegex = /\/v\/t39\.\d+-6\/|\/v\/t45\.\d+-4\//
    const realImages = Array.from(new Set(allImages.filter(u => realCreativeRegex.test(u))))
    const realVideos = Array.from(new Set(allVideos.filter(u => u.includes('fbcdn'))))

    const staticCount = allImages.filter(u => u.includes('static.xx.fbcdn') || u.includes('static.fbcdn')).length

    const status: ExtractResult['status'] = (realImages.length > 0 || realVideos.length > 0)
      ? 'SUCCESS'
      : 'FAIL_NO_REAL_CREATIVE'

    return {
      url,
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
      url, bytesDownloaded: 0, htmlSnippet: '',
      realImagesFound: [], realVideosFound: [],
      staticImagesFound: 0, totalImagesInHtml: 0,
      status: 'ERROR', error: err.message ?? String(err),
    }
  }
}

async function main() {
  const urls = process.argv.slice(2)
  if (urls.length === 0) {
    console.error('Usage: npx tsx src/test-http-extract.ts "<snapshot_url>" ["<snapshot_url>" ...]')
    console.error('\nGet URLs from Supabase SQL editor:')
    console.error('  SELECT snapshot_url FROM discovery_ads_index WHERE thumbnail_url LIKE \'%r2.dev%\' LIMIT 5;')
    process.exit(1)
  }

  console.log(`Testing HTTP extraction on ${urls.length} ad(s)...`)
  console.log(`Proxy: ${proxyEnabled ? `${HOST}:${PORT}` : 'DIRECT (no proxy)'}\n`)

  let totalBytes = 0
  let successes = 0
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    console.log(`\n=== Ad ${i + 1}/${urls.length} ===`)
    console.log(`URL: ${url.slice(0, 80)}...`)
    const r = await testExtract(url)
    if (r.status === 'ERROR') {
      console.log(`❌ ERROR: ${r.error}`)
      continue
    }
    totalBytes += r.bytesDownloaded
    console.log(`HTML downloaded: ${(r.bytesDownloaded / 1024).toFixed(1)} KB`)
    console.log(`Total fbcdn image URLs in HTML: ${r.totalImagesInHtml}`)
    console.log(`  - Static UI images (filtered): ${r.staticImagesFound}`)
    console.log(`  - Real creative images: ${r.realImagesFound.length}`)
    console.log(`Real creative videos: ${r.realVideosFound.length}`)
    console.log(`Status: ${r.status === 'SUCCESS' ? '✅ SUCCESS' : '❌ ' + r.status}`)
    if (r.realImagesFound.length > 0) {
      console.log(`First real image: ${r.realImagesFound[0].slice(0, 120)}...`)
    }
    if (r.realVideosFound.length > 0) {
      console.log(`First real video: ${r.realVideosFound[0].slice(0, 120)}...`)
    }
    if (r.status === 'FAIL_NO_REAL_CREATIVE') {
      console.log(`HTML preview (500 chars): ${r.htmlSnippet}`)
    }
    if (r.status === 'SUCCESS') successes++
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`Success rate: ${successes}/${urls.length} (${((successes / urls.length) * 100).toFixed(0)}%)`)
  console.log(`Avg bytes/ad: ${(totalBytes / urls.length / 1024).toFixed(1)} KB`)
  console.log(`\nVerdict:`)
  if (successes / urls.length >= 0.8) {
    console.log(`✅ HTTP-only extraction is VIABLE — proceed with worker integration`)
  } else if (successes / urls.length >= 0.3) {
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
