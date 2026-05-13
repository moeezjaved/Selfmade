/**
 * Diagnostic test — run the worker's Playwright extractor on one specific URL.
 *
 * Tests whether the SAME extraction code that worked yesterday still works
 * today on a known-good ad. Isolates "token" vs "environment" hypotheses.
 *
 * Usage:
 *   npx tsx src/test-playwright-extract.ts "<full snapshot URL>"
 */
import { extractCreative, getBrowser, closeBrowser } from './extract.js'

async function main() {
  const url = process.argv[2]
  if (!url) {
    console.error('Usage: npx tsx src/test-playwright-extract.ts "<snapshot URL>"')
    process.exit(1)
  }

  console.log(`Testing extraction on: ${url.slice(0, 80)}...`)
  console.log('Initializing browser...')

  await getBrowser()  // warm up Chromium with proxy

  console.log('\nRunning extractCreative()...\n')
  const t0 = Date.now()
  const result = await extractCreative(url, 30_000, 'test-ad-id')
  const dt = ((Date.now() - t0) / 1000).toFixed(1)

  console.log(`\n=== RESULT (${dt}s) ===`)
  console.log(`Page status: ${result.pageStatus}`)
  console.log(`Error: ${result.error || 'none'}`)
  console.log(`Images found: ${result.imageUrls.length}`)
  console.log(`Videos found: ${result.videoUrls.length}`)
  if (result.imageUrls.length) {
    console.log(`\nFirst image: ${result.imageUrls[0].slice(0, 120)}...`)
  }
  if (result.videoUrls.length) {
    console.log(`First video: ${result.videoUrls[0].slice(0, 120)}...`)
  }

  console.log('\n=== VERDICT ===')
  if (result.imageUrls.length > 0 || result.videoUrls.length > 0) {
    console.log('✅ SUCCESS — extractor works. Issue with new ads is the token, not environment.')
  } else if (result.error) {
    console.log(`❌ ERROR — ${result.error}`)
    console.log('Likely environment issue (proxy, IP, etc), not token.')
  } else {
    console.log('❌ NO CREATIVE FOUND — page loaded but Meta returned error page.')
    console.log('Either token is now invalid OR environment is detecting us as bot.')
  }

  await closeBrowser()
  process.exit(0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
