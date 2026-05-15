/**
 * Brand onboarding tool.
 *
 * Takes a brand search term (or comma-separated list), resolves each to its
 * Meta Ads Library page_id by intercepting the search-page GraphQL response,
 * and inserts it into discovery_crawl_terms (active=true) so the indexer
 * scheduler picks it up on the next cycle.
 *
 * Usage:
 *   docker run --rm --env-file .env selfmade-worker \
 *     npx tsx src/add-brand.ts gymshark glossier oliveandjune
 *
 *   docker run --rm --env-file .env selfmade-worker \
 *     npx tsx src/add-brand.ts "olive and june"
 *
 *   docker run --rm --env-file .env selfmade-worker \
 *     npx tsx src/add-brand.ts --dry-run gymshark    # don't write to DB
 *
 * Each lookup runs in its own browser context with a fresh sticky proxy
 * session — same anti-detection posture as the indexer itself.
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, BrowserContext, Response } from 'playwright'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { supabase } from './db.js'
import { randomBytes } from 'node:crypto'

chromiumExtra.use(StealthPlugin())

interface BrandHit {
  page_id: string
  name: string
  category?: string
  likes?: number
  verified?: boolean
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const terms = args.filter(a => !a.startsWith('--'))

if (terms.length === 0) {
  console.error('Usage: npx tsx src/add-brand.ts [--dry-run] <brand1> [brand2] ...')
  console.error('Examples:')
  console.error('  npx tsx src/add-brand.ts gymshark glossier')
  console.error('  npx tsx src/add-brand.ts "olive and june"')
  process.exit(1)
}

async function main() {
  console.log(`\n🔎 Brand onboarding — looking up ${terms.length} term(s)`)
  console.log(`   ${dryRun ? '(dry run, no DB writes)' : '(will insert into discovery_crawl_terms)'}\n`)

  const browser = await chromiumExtra.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }) as unknown as Browser

  const results: { term: string; hit: BrandHit | null; error?: string }[] = []

  for (const term of terms) {
    console.log(`──────────────────────────────────────────`)
    console.log(`🌐 ${term}`)
    try {
      const hit = await lookupBrand(browser, term)
      results.push({ term, hit })
      if (hit) {
        console.log(`   ✅ ${hit.name} → page_id=${hit.page_id}` +
          (hit.likes ? ` | ${hit.likes.toLocaleString()} likes` : '') +
          (hit.category ? ` | ${hit.category}` : '') +
          (hit.verified ? ' | ✓ verified' : ''))
      } else {
        console.log(`   ⚠️  no match found`)
      }
    } catch (e: any) {
      console.log(`   ❌ ${e?.message ?? e}`)
      results.push({ term, hit: null, error: e?.message })
    }
  }

  await browser.close()

  // ── Insert into DB ──
  if (!dryRun) {
    console.log(`\n💾 Inserting into discovery_crawl_terms...`)
    for (const { term, hit } of results) {
      if (!hit) continue
      const { error } = await (supabase as any)
        .from('discovery_crawl_terms')
        .upsert({
          term: hit.name.toLowerCase(),
          page_id: hit.page_id,
          is_active: true,
          last_crawled_at: null,    // null = never crawled, scheduler picks up next
        }, { onConflict: 'page_id' })
      if (error) console.warn(`   ⚠️  ${term}: ${error.message}`)
      else console.log(`   ✅ ${term} → ${hit.name} (${hit.page_id})`)
    }
  }

  // ── Summary ──
  console.log(`\n══════════════════════════════════════════`)
  console.log(`📊 Summary`)
  console.log(`══════════════════════════════════════════`)
  const ok = results.filter(r => r.hit).length
  const failed = results.length - ok
  console.log(`   Resolved:  ${ok}/${results.length}`)
  if (failed > 0) {
    console.log(`   Failed:`)
    results.filter(r => !r.hit).forEach(r => console.log(`     - ${r.term}${r.error ? ` (${r.error})` : ''}`))
  }

  process.exit(0)
}

async function lookupBrand(browser: Browser, term: string): Promise<BrandHit | null> {
  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  let proxy: { url: string; close: () => Promise<void> } | null = null
  let context: BrowserContext | null = null

  try {
    if (proxyChainEnabled) {
      proxy = await startProxyChain({ sessionId, lifetime: '5m', country: 'us' })
    }

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      proxy: proxy ? { server: proxy.url } : undefined,
    })

    const page = await context.newPage()
    const hits: BrandHit[] = []

    // Capture the GraphQL search response
    page.on('response', async (response: Response) => {
      try {
        const t = response.request().resourceType()
        if (!['xhr', 'fetch', 'document'].includes(t)) return
        const text = await response.text().catch(() => '')
        if (!text || (!text.includes('page_id') && !text.includes('"id"'))) return

        // Brand-search results live in collation cards. Each result has:
        //   { page_id, name, page_likes_count, verification_status, page_categories, ... }
        // Walk every JSON object that has both page_id AND name.
        const re = /"page_id"\s*:\s*"(\d{6,})"[^}]*?"name"\s*:\s*"([^"]+)"/g
        let m: RegExpExecArray | null
        while ((m = re.exec(text)) !== null) {
          const page_id = m[1]
          const name = m[2]
          if (hits.find(h => h.page_id === page_id)) continue
          // Pull likes + category + verified from a small window around the match
          const window = text.slice(Math.max(0, m.index - 200), Math.min(text.length, m.index + 800))
          const likesMatch = window.match(/"page_likes_count"\s*:\s*(\d+)/)
          const verifiedMatch = window.match(/"verification_status"\s*:\s*"(BLUE|GRAY|UNVERIFIED)"/)
          const catMatch = window.match(/"page_categories"\s*:\s*\[\s*"([^"]+)"/)
          hits.push({
            page_id,
            name,
            likes: likesMatch ? parseInt(likesMatch[1], 10) : undefined,
            verified: verifiedMatch && verifiedMatch[1] !== 'UNVERIFIED' ? true : false,
            category: catMatch?.[1],
          })
        }
      } catch { /* ignore parse errors */ }
    })

    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&q=${encodeURIComponent(term)}&search_type=keyword_unordered`
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 8_000))

    // Pick the best match — prefer verified, then highest likes, then exact-name match
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const want = norm(term)
    const ranked = hits
      .map(h => ({
        ...h,
        score:
          (norm(h.name) === want ? 1000 : 0) +
          (h.verified ? 100 : 0) +
          (h.likes ? Math.log10(h.likes + 1) : 0),
      }))
      .sort((a, b) => b.score - a.score)

    return ranked[0] ?? null
  } finally {
    await context?.close().catch(() => {})
    if (proxy) await proxy.close().catch(() => {})
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
