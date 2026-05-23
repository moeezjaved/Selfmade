/**
 * Standalone test for Proxy-Cheap (or any plain HTTP proxy with basic auth).
 *
 * Bypasses proxy-chain entirely — uses Playwright's native proxy support
 * which accepts plain user/pass without IPRoyal-style session modifiers.
 *
 * Reads creds from PROXYCHEAP_* env vars.
 *
 * Usage:
 *   docker run --rm \
 *     -e PROXYCHEAP_HOST=... \
 *     -e PROXYCHEAP_PORT=... \
 *     -e PROXYCHEAP_USER=... \
 *     -e PROXYCHEAP_PASS=... \
 *     selfmade-worker \
 *     npx tsx src/test-proxycheap.ts <page_id> [--max-pages=10]
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Request as PWRequest } from 'playwright'

chromiumExtra.use(StealthPlugin())

const HOST = process.env.PROXYCHEAP_HOST
const PORT = process.env.PROXYCHEAP_PORT
const USER = process.env.PROXYCHEAP_USER
const PASS = process.env.PROXYCHEAP_PASS

const args = process.argv.slice(2)
const pageId = args.find(a => /^\d+$/.test(a))
const maxPagesArg = args.find(a => a.startsWith('--max-pages='))
const MAX_PAGES = maxPagesArg ? parseInt(maxPagesArg.split('=')[1], 10) : 10

if (!HOST || !PORT || !USER || !PASS) {
  console.error('Missing PROXYCHEAP_* env vars')
  process.exit(1)
}
if (!pageId) {
  console.error('Usage: npx tsx src/test-proxycheap.ts <page_id> [--max-pages=10]')
  process.exit(1)
}

interface CapturedTemplate {
  url: string
  headers: Record<string, string>
  parsedBody: Record<string, string>
  initialAdIds: string[]
  initialCursor: string | null
}

async function main() {
  console.log(`\n🧪 Proxy-Cheap test`)
  console.log(`   proxy: ${HOST}:${PORT} (user=${USER!.slice(0, 4)}...)`)
  console.log(`   page_id: ${pageId}`)
  console.log(`   max_pages: ${MAX_PAGES}\n`)

  const browser = await chromiumExtra.launch({
    headless: false,
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
    ],
    proxy: {
      server: `http://${HOST}:${PORT}`,
      username: USER,
      password: PASS,
    },
  }) as unknown as Browser

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    })
    const page = await context.newPage()

    const state: { template: CapturedTemplate | null } = { template: null }
    page.on('request', (req: PWRequest) => {
      if (state.template) return
      if (req.method() !== 'POST' || !req.url().includes('/api/graphql/')) return
      const body = req.postData() ?? ''
      if (!body.includes('variables=')) return
      const parsed: Record<string, string> = {}
      for (const pair of body.split('&')) {
        const [k, ...v] = pair.split('=')
        if (k) parsed[decodeURIComponent(k)] = decodeURIComponent(v.join('=') ?? '')
      }
      const friendly = parsed.fb_api_req_friendly_name ?? ''
      if (!friendly.includes('PaginationQuery') && !friendly.includes('SearchResults')) return
      if (!parsed.variables) return
      state.template = { url: req.url(), headers: req.headers(), parsedBody: parsed, initialAdIds: [], initialCursor: null }
      console.log(`📡 Captured template (${friendly})`)
    })

    page.on('response', async (resp) => {
      const t = state.template
      if (!t || t.initialCursor) return
      if (!resp.url().includes('/api/graphql/')) return
      try {
        const body = await resp.text()
        const ids: string[] = []
        const re = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
        let m: RegExpExecArray | null
        while ((m = re.exec(body)) !== null) ids.push(m[1])
        const cur = body.match(/"end_cursor"\s*:\s*"([^"]+)"/)?.[1] ?? null
        if (ids.length > 0 || cur) {
          t.initialAdIds = ids
          t.initialCursor = cur
        }
      } catch { /* ignore */ }
    })

    const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId!)}`
    console.log(`🚀 Navigating: ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await new Promise(r => setTimeout(r, 5_000))

    console.log(`🖱️  Scrolling to trigger pagination...`)
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 }
    for (let i = 0; i < 20 && !state.template; i++) {
      await page.mouse.move(
        Math.floor(viewport.width * (0.3 + Math.random() * 0.4)),
        Math.floor(viewport.height * (0.4 + Math.random() * 0.3)),
      ).catch(() => {})
      await page.mouse.wheel(0, 1500 + Math.floor(Math.random() * 800)).catch(() => {})
      await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000))
    }
    await new Promise(r => setTimeout(r, 3_000))

    const template = state.template
    if (!template) {
      console.error('❌ No pagination POST captured. Meta did not paginate.')
      process.exit(1)
    }
    console.log(`✅ Template + ${template.initialAdIds.length} initial ads, cursor=${template.initialCursor ? 'yes' : 'no'}\n`)
    if (!template.initialCursor) process.exit(1)

    const evalScript = `
      (async () => {
        const tpl = ${JSON.stringify(template)};
        const maxPages = ${MAX_PAGES};
        const out = [];
        const seenIds = new Set(tpl.initialAdIds);
        let cursor = tpl.initialCursor;
        let reqCounter = parseInt(tpl.parsedBody.__req || '0', 10);
        const extractAdIds = (b) => { const r=[]; const re=/"ad_archive_id"\\s*:\\s*"(\\d{10,})"/g; let m; while ((m=re.exec(b))!==null) r.push(m[1]); return r; };
        const cursorRe = (b) => { const m = b.match(/"end_cursor"\\s*:\\s*"([^"]+)"/); return m ? m[1] : null; };
        const hasNext = (b) => { const m = b.match(/"has_next_page"\\s*:\\s*(true|false)/); return m ? m[1] === 'true' : false; };

        for (let p = 1; p <= maxPages && cursor; p++) {
          const params = Object.assign({}, tpl.parsedBody);
          try { const v = JSON.parse(params.variables); v.cursor = cursor; params.variables = JSON.stringify(v); }
          catch (e) { out.push({page: p, error: 'parse_vars'}); break; }
          reqCounter++;
          params.__req = String(reqCounter);
          params.__spin_t = String(Math.floor(Date.now()/1000));
          const body = Object.entries(params).map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
          const t0 = performance.now();
          try {
            const r = await fetch(tpl.url, { method: 'POST', credentials: 'include', headers: tpl.headers, body });
            const text = await r.text();
            const ids = extractAdIds(text);
            const nc = cursorRe(text);
            const more = hasNext(text);
            let added = 0;
            for (const id of ids) if (!seenIds.has(id)) { seenIds.add(id); added++; }
            out.push({ page: p, status: r.status, kb: Math.round(text.length/102.4)/10, ads: ids.length, newAds: added, hasNext: more, ms: Math.round(performance.now() - t0) });
            if (!r.ok || ids.length === 0 || !more || !nc) break;
            cursor = nc;
            await new Promise(res => setTimeout(res, 1200 + Math.random() * 800));
          } catch (e) {
            out.push({ page: p, error: (e && e.message) || String(e) });
            break;
          }
        }
        return { pages: out, totalUnique: seenIds.size };
      })()
    `
    const result = await page.evaluate<{ pages: any[]; totalUnique: number }>(evalScript)

    console.log(`\n══════════════════════════════════════════`)
    console.log(`📊 PAGINATION RESULTS`)
    console.log(`══════════════════════════════════════════`)
    for (const p of result.pages) {
      if (p.error) {
        console.log(`📄 Page ${p.page}: ERROR — ${p.error}`)
      } else {
        console.log(`📄 Page ${p.page}: HTTP ${p.status} | ${p.kb} KB | ${p.ads} ads (${p.newAds} new) | has_next=${p.hasNext} | ${p.ms}ms`)
      }
    }
    console.log(`\nTotal unique ads: ${result.totalUnique}`)
    console.log(`Pages requested:  ${result.pages.length}`)
    if (result.totalUnique > 30) console.log(`\n✅ PROXY-CHEAP WORKS for Meta scraping. Save ~60% vs IPRoyal.`)
    else if (result.totalUnique > 0) console.log(`\n⚠️ Captured ${result.totalUnique} ads — same as scroll cap. Meta gates this IP.`)
    else console.log(`\n❌ No ads captured. IP fully blocked by Meta.`)

    await context.close()
  } finally {
    await browser.close().catch(() => {})
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1) })
