/**
 * GraphQL pagination replay engine.
 *
 * Takes a capture file from capture-graphql.ts, finds the first
 * GraphQL pagination request in it, and replays it with successive
 * cursors to walk the full ad list — bypassing scroll entirely.
 *
 * Why this works (theoretically):
 *   - Meta serves only 30 ads via scroll-triggered pagination to
 *     fingerprinted automation sessions
 *   - But the GraphQL POST endpoint accepts any cursor with a valid
 *     fb_dtsg + cookies and returns the next 30
 *   - We loop: cursor → POST → 30 ads + new cursor → POST → ...
 *
 * If this still hits a 30-ad ceiling per session, the limit is
 * enforced server-side per session_id, not per request — and we'd
 * need to rotate sessions (browser contexts) per pagination batch.
 *
 * Usage:
 *   docker run --rm --env-file .env \
 *     -v /tmp/captures:/captures \
 *     selfmade-worker \
 *     npx tsx src/replay-pagination.ts /captures/graphql-XXX.json [--max-pages=20]
 */
import { readFile } from 'node:fs/promises'
import { fetch as undiciFetch, ProxyAgent } from 'undici'
import { startProxyChain, proxyChainEnabled } from './proxy-chain.js'
import { randomBytes } from 'node:crypto'

const args = process.argv.slice(2)
const captureFile = args.find(a => !a.startsWith('--'))
const maxPagesArg = args.find(a => a.startsWith('--max-pages='))
const MAX_PAGES = maxPagesArg ? parseInt(maxPagesArg.split('=')[1], 10) : 20

if (!captureFile) {
  console.error('Usage: npx tsx src/replay-pagination.ts <capture.json> [--max-pages=20]')
  process.exit(1)
}

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  post_data: string | null
  post_data_parsed: Record<string, string> | null
  response: { status: number; headers: Record<string, string>; body: string } | null
  contains_cursor: boolean
  contains_ad_data: boolean
}

interface Capture {
  page_id: string
  cookies: Array<{ name: string; value: string; domain: string }>
  session: { fbDtsg?: string }
  requests: CapturedRequest[]
}

async function main() {
  console.log(`\n🔁 Pagination replay`)
  console.log(`   capture: ${captureFile}`)
  console.log()

  const cap: Capture = JSON.parse(await readFile(captureFile!, 'utf-8'))

  // ── Find the FIRST graphql POST that returned ads. We use that as the template.
  const template = cap.requests.find(r =>
    r.method === 'POST' &&
    r.url.includes('/api/graphql/') &&
    r.contains_ad_data
  ) ?? cap.requests.find(r =>
    r.method === 'POST' &&
    r.url.includes('/api/graphql/')
  )

  if (!template) {
    console.error('❌ No GraphQL POST found in capture. Pagination XHR never fired during capture.')
    console.error('   Try running capture-graphql.ts on a different brand or with --no-proxy to test.')
    console.error()
    console.error('   Available POST URLs in capture:')
    cap.requests.filter(r => r.method === 'POST').slice(0, 5).forEach(r => console.error(`     - ${r.url.slice(0, 120)}`))
    process.exit(1)
  }

  console.log(`✅ Found GraphQL template`)
  console.log(`   URL: ${template.url}`)
  console.log(`   POST body keys: ${template.post_data_parsed ? Object.keys(template.post_data_parsed).slice(0, 12).join(', ') : '(none parsed)'}`)
  console.log()

  // ── Extract initial cursor from template's response ──
  let cursor = extractEndCursor(template.response?.body ?? '')
  if (!cursor) {
    console.error('❌ Could not extract initial cursor from template response.')
    console.error('   The response body might not contain "endCursor". First 500 chars:')
    console.error(`   ${(template.response?.body ?? '').slice(0, 500)}`)
    process.exit(1)
  }
  console.log(`📍 Initial cursor: ${cursor.slice(0, 60)}...`)
  console.log()

  // ── Build header set + cookie string ──
  const cookieString = cap.cookies.map(c => `${c.name}=${c.value}`).join('; ')
  const baseHeaders: Record<string, string> = { ...template.headers }
  // Set/override critical headers for replay
  baseHeaders['cookie'] = cookieString
  baseHeaders['referer'] = `https://www.facebook.com/ads/library/?view_all_page_id=${cap.page_id}`
  baseHeaders['origin'] = 'https://www.facebook.com'
  // Drop Playwright-injected headers
  delete baseHeaders['accept-encoding']
  delete baseHeaders['content-length']

  // ── Set up proxy ──
  const sessionId = randomBytes(4).toString('hex').slice(0, 8)
  let proxy: { url: string; close: () => Promise<void> } | null = null
  let dispatcher: ProxyAgent | null = null
  if (proxyChainEnabled) {
    proxy = await startProxyChain({ sessionId, lifetime: '10m', country: 'us' })
    dispatcher = new ProxyAgent(proxy.url)
  }

  // ── Loop ──
  const allAdIds = new Set<string>()
  // Seed with ads from the initial template response too
  for (const id of extractAdIds(template.response?.body ?? '')) allAdIds.add(id)
  console.log(`📦 Initial template carried ${allAdIds.size} ad_ids`)
  console.log()

  let pageNum = 0
  while (cursor && pageNum < MAX_PAGES) {
    pageNum++
    // Build new POST body — replace cursor in the parsed body
    const newBody = buildBodyWithCursor(template.post_data ?? '', template.post_data_parsed, cursor)
    if (!newBody) {
      console.error(`❌ Could not splice cursor into POST body at page ${pageNum}. Stopping.`)
      break
    }

    try {
      const t0 = Date.now()
      const r = await undiciFetch(template.url, {
        method: 'POST',
        dispatcher: dispatcher ?? undefined,
        headers: baseHeaders,
        body: newBody,
        signal: AbortSignal.timeout(30_000),
      })
      const dt = Date.now() - t0
      const text = await r.text()

      const newAdIds = extractAdIds(text)
      const newCursor = extractEndCursor(text)
      const moreAvailable = hasNextPage(text)
      let added = 0
      for (const id of newAdIds) {
        if (!allAdIds.has(id)) { allAdIds.add(id); added++ }
      }
      console.log(`📄 Page ${pageNum}: HTTP ${r.status} | ${(text.length / 1024).toFixed(1)} KB | ${newAdIds.length} ads (${added} new) | has_next: ${moreAvailable} | ${dt}ms`)

      if (!r.ok || newAdIds.length === 0) {
        console.warn(`   ⚠️ Stopping — non-OK status or no ads in response`)
        break
      }
      if (!moreAvailable) {
        console.log(`   ✅ Reached end of pagination (has_next_page=false)`)
        break
      }
      if (added === 0) {
        console.warn(`   ⚠️ Stopping — no NEW ads (cursor may have looped)`)
        break
      }
      if (!newCursor) {
        console.log(`   ✅ Reached end of pagination (no next cursor)`)
        break
      }
      cursor = newCursor

      // Random delay between pages — match human pace, avoid burst rate-limit
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500))
    } catch (e: any) {
      console.error(`   ❌ Error at page ${pageNum}: ${e?.message ?? e}`)
      break
    }
  }

  console.log()
  console.log(`══════════════════════════════════════════`)
  console.log(`📊 SUMMARY`)
  console.log(`══════════════════════════════════════════`)
  console.log(`   Pages requested:  ${pageNum}`)
  console.log(`   Total ads:        ${allAdIds.size}`)
  console.log(`   Avg per page:     ${pageNum > 0 ? Math.round(allAdIds.size / pageNum) : 0}`)
  console.log()
  console.log(`If total > 30, cursor pagination WORKS — Meta limit was scroll-triggered only.`)
  console.log(`If total = 30, Meta enforces session limit server-side. Need session rotation.`)

  if (proxy) await proxy.close().catch(() => {})
}

function extractEndCursor(body: string): string | null {
  // Verified 2026-05-16: Meta returns "end_cursor" (snake_case, with underscore)
  // inside "page_info" object. The endCursor (camelCase) variant doesn't appear
  // in this endpoint's responses but kept as fallback for other endpoints.
  const m = body.match(/"end_cursor"\s*:\s*"([^"]+)"/) ||
            body.match(/"endCursor"\s*:\s*"([^"]+)"/)
  return m ? m[1] : null
}

function hasNextPage(body: string): boolean {
  // Meta also includes "has_next_page": true|false in page_info — gives us a
  // clean stop signal without needing to detect "no new ads".
  const m = body.match(/"has_next_page"\s*:\s*(true|false)/)
  return m ? m[1] === 'true' : true   // assume more if unknown
}

function extractAdIds(body: string): string[] {
  const ids = new Set<string>()
  const re = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) ids.add(m[1])
  return Array.from(ids)
}

/**
 * Splice a new cursor into a URL-encoded POST body. Meta's GraphQL
 * variables are JSON-encoded inside the URL-encoded `variables` field.
 * We parse, swap the cursor field, re-encode.
 */
function buildBodyWithCursor(
  rawBody: string,
  parsed: Record<string, string> | null,
  cursor: string,
): string | null {
  if (!parsed) return null
  const out: Record<string, string> = { ...parsed }
  if (out.variables) {
    try {
      const v = JSON.parse(out.variables)
      // Try common cursor field names
      if ('cursor' in v) v.cursor = cursor
      else if ('after' in v) v.after = cursor
      else if (v.input && typeof v.input === 'object') {
        if ('cursor' in v.input) v.input.cursor = cursor
        else if ('after' in v.input) v.input.after = cursor
      }
      // If none of the standard fields exist, inject 'after' as a guess
      if (!('cursor' in v) && !('after' in v) && !(v.input && ('cursor' in v.input || 'after' in v.input))) {
        v.after = cursor
      }
      out.variables = JSON.stringify(v)
    } catch (e) {
      console.warn(`   ⚠️ Could not splice cursor — variables not valid JSON: ${(e as Error).message}`)
      return null
    }
  } else {
    return null
  }
  // Re-encode as URL-encoded form
  return Object.entries(out).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
