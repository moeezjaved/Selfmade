/**
 * Per-ad media backfill daemon.
 *
 * Continuously finds ads that came out of the crawl WITHOUT media URLs
 * (raw_image_urls + raw_video_urls both null) and recovers them by fetching
 * each ad's individual Ad Library page. Once the URLs are populated, the
 * normal worker (index.ts) downloads the creatives.
 *
 * Why this exists: the deep cursor-walk on huge brands occasionally drops
 * media for some ads. Rather than perfecting the walk, we backfill — Meta
 * reliably serves an ad's media on its single-ad page (verified: 5/5 recovered).
 *
 * Proxy: rotates across the DB proxy pool (LRU) exactly like crawls/downloads,
 * so per-ad fetches spread evenly and never hammer one IP. Falls back to the
 * PROXYCHEAP_* env vars (single IP) when the pool is disabled.
 *
 * Runs as its own container alongside scheduler + worker.
 */
import { chromium as chromiumExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type { Browser, Page } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { pickProxy, recordEvent, proxyPoolEnabled } from './proxy-pool.js'

chromiumExtra.use(StealthPlugin())

const SUPABASE_URL = process.env.SUPABASE_URL!
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(SUPABASE_URL, SRK, { auth: { persistSession: false } })

const BATCH = parseInt(process.env.BACKFILL_BATCH || '15', 10)        // ads per browser session
const EMPTY_SLEEP_MS = parseInt(process.env.BACKFILL_EMPTY_SLEEP_MS || '60000', 10)
const BETWEEN_AD_MS = parseInt(process.env.BACKFILL_BETWEEN_AD_MS || '1500', 10)
const PAGE_WAIT_MS = parseInt(process.env.BACKFILL_PAGE_WAIT_MS || '6000', 10)

// Fallback single-IP creds (used only if the DB pool is off)
const FALLBACK = process.env.PROXYCHEAP_HOST ? {
  host: process.env.PROXYCHEAP_HOST!, port: Number(process.env.PROXYCHEAP_PORT),
  username: process.env.PROXYCHEAP_USER!, password: process.env.PROXYCHEAP_PASS!,
} : null

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface AdRow { ad_id: string }

function extractMedia(text: string): { images: string[]; videos: string[] } {
  const imgs = new Set<string>(), vids = new Set<string>()
  const imgRe = /"(?:original_image_url|resized_image_url)"\s*:\s*"(https:[^"]*fbcdn[^"]*)"/g
  const vidRe = /"(?:video_hd_url|video_sd_url)"\s*:\s*"(https:[^"]*fbcdn[^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = imgRe.exec(text)) !== null) imgs.add(m[1].replace(/\\\//g, '/'))
  while ((m = vidRe.exec(text)) !== null) vids.add(m[1].replace(/\\\//g, '/'))
  return { images: [...imgs], videos: [...vids] }
}

/** Claim a batch of ads needing backfill, marking them attempted so parallel
 *  daemons don't double-process. */
async function claimBatch(): Promise<AdRow[]> {
  const { data } = await supabase
    .from('discovery_ads_index')
    .select('ad_id')
    .is('raw_image_urls', null)
    .is('raw_video_urls', null)
    .is('media_backfill_attempted_at', null)
    .order('indexed_at', { ascending: false })
    .limit(BATCH)
  const rows = (data || []) as AdRow[]
  if (rows.length) {
    // mark attempted up-front (so a no-media ad isn't retried forever, and
    // concurrent daemons skip these)
    await supabase.from('discovery_ads_index')
      .update({ media_backfill_attempted_at: new Date().toISOString() })
      .in('ad_id', rows.map(r => r.ad_id))
  }
  return rows
}

async function fetchAdMedia(page: Page, adId: string): Promise<{ images: string[]; videos: string[]; sawAdData: boolean }> {
  const best = { images: [] as string[], videos: [] as string[] }
  let sawAdData = false   // did the ad page actually load real ad content (vs a block/challenge)?
  const onResp = async (resp: any) => {
    try {
      const u = resp.url()
      if (!u.includes('/api/graphql/') && !u.includes('/ads/library')) return
      const t = await resp.text()
      if (t.includes('"snapshot"') || t.includes('ad_archive_id')) sawAdData = true
      if (!t.includes('fbcdn')) return
      const m = extractMedia(t)
      if (m.images.length + m.videos.length > best.images.length + best.videos.length) {
        best.images = m.images; best.videos = m.videos
      }
    } catch { /* ignore */ }
  }
  page.on('response', onResp)
  try {
    await page.goto(`https://www.facebook.com/ads/library/?id=${adId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await sleep(PAGE_WAIT_MS)
  } catch { /* nav error — leave best empty */ }
  page.off('response', onResp)
  return { ...best, sawAdData }
}

async function processBatch(rows: AdRow[]): Promise<{ recovered: number; empty: number; transient: number }> {
  // pick a pool proxy (LRU) for this batch; fall back to single IP
  let proxyCfg: { server: string; username: string; password: string } | undefined
  let poolId: string | null = null
  const p = proxyPoolEnabled ? await pickProxy() : null
  if (p) { proxyCfg = { server: `http://${p.host}:${p.port}`, username: p.username, password: p.password }; poolId = p.id }
  else if (FALLBACK) proxyCfg = { server: `http://${FALLBACK.host}:${FALLBACK.port}`, username: FALLBACK.username, password: FALLBACK.password }

  const browser = await chromiumExtra.launch({
    headless: false,
    args: ['--headless=new', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled', '--disable-gpu'],
    proxy: proxyCfg,
  }) as unknown as Browser

  let recovered = 0, empty = 0, transient = 0
  try {
    const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/New_York' })
    const page = await ctx.newPage()
    for (const row of rows) {
      const media = await fetchAdMedia(page, row.ad_id)
      if (media.images.length || media.videos.length) {
        // recovered — populate URLs (ad leaves the media-less set)
        await supabase.from('discovery_ads_index').update({
          raw_image_urls: media.images.length ? media.images : null,
          raw_video_urls: media.videos.length ? media.videos : null,
        }).eq('ad_id', row.ad_id)
        recovered++
      } else if (media.sawAdData) {
        // page loaded real ad content but it genuinely has no media — leave
        // the attempted-timestamp set so we don't retry forever.
        empty++
      } else {
        // no ad data seen → blocked / throttled / nav error. RESET the
        // attempted-timestamp so this ad is retried on a future batch
        // (hopefully on a non-throttled IP).
        await supabase.from('discovery_ads_index')
          .update({ media_backfill_attempted_at: null }).eq('ad_id', row.ad_id)
        transient++
      }
      await sleep(BETWEEN_AD_MS)
    }
    await ctx.close()
  } finally {
    await browser.close().catch(() => {})
  }
  if (poolId) recordEvent({ proxyId: poolId, kind: 'asset', brandPageId: 'backfill' })
  return { recovered, empty, transient }
}

async function main() {
  console.log('🩹 Per-ad media backfill daemon started')
  console.log(`   batch=${BATCH} | proxy_pool=${proxyPoolEnabled} | fallback=${!!FALLBACK}`)
  let lifetimeRecovered = 0
  for (;;) {
    const rows = await claimBatch()
    if (rows.length === 0) {
      // how many still pending?
      const { count } = await supabase.from('discovery_ads_index')
        .select('ad_id', { count: 'exact', head: true })
        .is('raw_image_urls', null).is('raw_video_urls', null).is('media_backfill_attempted_at', null)
      console.log(`💤 No ads need backfill (pending=${count ?? 0}). Sleeping ${EMPTY_SLEEP_MS / 1000}s…`)
      await sleep(EMPTY_SLEEP_MS)
      continue
    }
    const t0 = Date.now()
    const { recovered, empty, transient } = await processBatch(rows)
    lifetimeRecovered += recovered
    console.log(`✅ batch: ${recovered} recovered, ${empty} no-media, ${transient} retry-later | ${rows.length} ads in ${((Date.now() - t0) / 1000).toFixed(1)}s | lifetime recovered: ${lifetimeRecovered}`)
    if (recovered === 0 && transient === rows.length) {
      console.log(`   ⚠️ whole batch blocked (likely throttled IP) — backing off 30s`)
      await sleep(30_000)
    }
  }
}
main().catch(e => { console.error('Fatal:', e); process.exit(1) })
