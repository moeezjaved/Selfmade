/**
 * Brand Spy analytics engine — competitor ad-tracking, computed from the data the crawler
 * already collects in discovery_ads_index (no new scraper needed; that's our moat).
 *
 * GET /api/discovery/brand-spy/<pageId>  →  {
 *   brand: { pageId, name, picture },
 *   summary: { total, active, inactive, activePct, videoPct, imagePct, firstSeen, lastSeen },
 *   formatMix:        [{ format, count, pct }],          // Image / Video / Carousel / DCO
 *   launchesByMonth:  [{ month: "Apr '26", count }],     // ads launched per month (start_date)
 *   activeTrend:      [{ week, active, source }],        // reconstructed active-ad count over time
 *   topHooks:         [{ label, count }],                // AI hook_type — richer than GetHookd's landings
 *   topAngles:        [{ label, count }],
 * }
 *
 * The active trend is reconstructed from each ad's start_date..last_seen window — the same
 * "show history before you started tracking" trick GetHookd does with backfill_interpolated,
 * but from real captured data.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Ad = { ad_id: string; format: string | null; start_date: string | null; last_seen: string | null; is_active: boolean | null; days_running: number | null; hook_type: string | null; angle: string | null; body: string | null; snapshot_url: string | null; link_url: string | null }

const SELECT = 'ad_id, page_name, format, start_date, last_seen, is_active, days_running, hook_type, angle, body, snapshot_url, link_url'
// First line of the ad body = the "hook" (Foreplay groups ads by this).
const hookOf = (b: string | null) => (b || '').split('\n')[0].trim().replace(/\s+/g, ' ').slice(0, 140)
// Normalize a destination URL to host + path (drop query/tracking) for landing-page rollup.
const normUrl = (u: string | null): { url: string; host: string } | null => {
  const m = (u || '').match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(\/[^?#]*)?/i)
  if (!m) return null
  const host = m[1].toLowerCase()
  if (['facebook.com', 'instagram.com', 'fb.com', 'fb.me'].some((s) => host === s || host.endsWith('.' + s))) return null
  const path = (m[2] || '').replace(/\/$/, '')
  return { url: host + path, host }
}

const MONTH = (d: Date) => `${d.toLocaleString('en', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`
const tally = (xs: (string | null)[]) => {
  const m: Record<string, number> = {}
  for (const x of xs) { const k = (x || '').trim(); if (k) m[k] = (m[k] || 0) + 1 }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }))
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const admin = createAdminClient()

  // Pull this brand's ads (minimal columns, page_id is indexed → light for one brand).
  // No 8K truncation — a spied brand can have 14K+ ads (Atria shows Grüns at 14,448);
  // walk every page until the index is exhausted, with a generous safety ceiling so a
  // pathological brand can't blow the 30s serverless budget.
  const PAGE = 1000
  const MAX_ADS = 60_000
  const ads: Ad[] = []
  let name = ''
  for (let from = 0; from < MAX_ADS; from += PAGE) {
    const { data, error } = await admin
      .from('discovery_ads_index')
      .select(SELECT)
      .eq('page_id', pageId)
      .order('start_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.length) break
    if (!name && (data[0] as any).page_name) name = (data[0] as any).page_name
    ads.push(...(data as any))
    if (data.length < PAGE) break
  }
  const ownCount = ads.length

  // AFFILIATE / creator ads — other pages running ads that reference this brand's domain, tagged
  // `aff:<pageId>` by the crawler's affiliate-discovery pass. Merged into the brand view the way
  // Atria counts them toward the brand total. Needs the seed_terms GIN index (migration 041);
  // best-effort — if it errors (index not built yet) we just show own-page ads.
  const ownIds = new Set(ads.map((a) => a.ad_id))
  let affiliateCount = 0
  // Deferred for now — affiliate display is off until the seed_terms GIN index (migration 041)
  // is built and BRAND_SPY_AFFILIATES=1 is set. Without the index this query is a 1.4M-row scan
  // that would slow every dashboard open, so it stays gated.
  if (process.env.BRAND_SPY_AFFILIATES === '1') try {
    for (let from = 0; from < 20_000; from += PAGE) {
      const { data, error } = await admin
        .from('discovery_ads_index')
        .select(SELECT)
        .contains('seed_terms', [`aff:${pageId}`])
        .order('start_date', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) break
      if (!data?.length) break
      for (const a of data as any[]) { if (!ownIds.has(a.ad_id)) { ads.push(a); affiliateCount++ } }
      if (data.length < PAGE) break
    }
  } catch { /* index not ready — own-page only */ }

  if (ads.length === 0) {
    return NextResponse.json({ brand: { pageId, name: name || pageId, picture: null }, summary: { total: 0 }, formatMix: [], launchesByMonth: [], activeTrend: [], topHooks: [], topAngles: [] })
  }

  const total = ads.length
  const active = ads.filter((a) => a.is_active).length
  const norm = (f: string | null) => { const v = (f || '').toLowerCase(); if (v.includes('video')) return 'Video'; if (v.includes('carousel') || v.includes('dco')) return 'Carousel/DCO'; return 'Image' }

  // Format mix
  const fmt = tally(ads.map((a) => norm(a.format)))
  const formatMix = fmt.map((f) => ({ ...f, format: f.label, pct: Math.round((f.count / total) * 100) }))

  // Launches per month (from start_date), chronological, last 12 months with data
  const monthMap = new Map<string, { d: Date; count: number }>()
  for (const a of ads) {
    if (!a.start_date) continue
    const d = new Date(a.start_date); if (isNaN(+d)) continue
    const key = `${d.getFullYear()}-${d.getMonth()}`
    const cur = monthMap.get(key) || { d: new Date(d.getFullYear(), d.getMonth(), 1), count: 0 }
    cur.count++; monthMap.set(key, cur)
  }
  const launchesByMonth = Array.from(monthMap.values()).sort((a, b) => +a.d - +b.d).slice(-12).map((m) => ({ month: MONTH(m.d), count: m.count }))

  // Active-ad trend: weekly buckets over the last 26 weeks. An ad counts in week W if it
  // started on/before the week end AND was last seen on/after the week start.
  const now = Date.now()
  const WEEK = 7 * 864e5
  const spans = ads
    .map((a) => ({ s: a.start_date ? +new Date(a.start_date) : NaN, e: a.last_seen ? +new Date(a.last_seen) : (a.is_active ? now : NaN) }))
    .filter((x) => !isNaN(x.s) && !isNaN(x.e))
  const activeTrend: { week: string; active: number; source: 'real' }[] = []
  for (let i = 25; i >= 0; i--) {
    const wEnd = now - i * WEEK, wStart = wEnd - WEEK
    const active = spans.filter((x) => x.s <= wEnd && x.e >= wStart).length
    activeTrend.push({ week: MONTH(new Date(wEnd)) + ` w${Math.ceil((new Date(wEnd).getDate()) / 7)}`, active, source: 'real' })
  }

  // Creative Tests — group ads by launch DAY; a batch of >=2 launched together is a test.
  // survival = still-running / launched (Foreplay's A/B-test detection: high survival = winner).
  const dayMap = new Map<string, { launched: number; running: number }>()
  for (const a of ads) {
    if (!a.start_date) continue
    const day = a.start_date.slice(0, 10)
    const cur = dayMap.get(day) || { launched: 0, running: 0 }
    cur.launched++; if (a.is_active) cur.running++
    dayMap.set(day, cur)
  }
  const creativeTests = Array.from(dayMap.entries())
    .filter(([, t]) => t.launched >= 2)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 12)
    .map(([date, t]) => ({ date, launched: t.launched, running: t.running, survival: Math.round((t.running / t.launched) * 100) }))

  // Longest-running ACTIVE ads — Foreplay's core signal: run-duration ≈ profitability.
  const longestRunning = ads
    .filter((a) => a.is_active && (a.days_running || 0) > 0)
    .sort((a, b) => (b.days_running || 0) - (a.days_running || 0))
    .slice(0, 8)
    .map((a) => ({ adId: a.ad_id, days: a.days_running || 0, hook: ((a.body || a.hook_type || '').trim()).slice(0, 90), snapshot_url: a.snapshot_url }))

  // Self-heal the list count: crawl_state.ads_indexed stores only the last run's count, so
  // the directory can lag the real index total (the 357-vs-933 gruns mismatch). Sync the
  // true live count back so the list and this dashboard agree. Best-effort.
  const cOf = (k: string) => fmt.find((f) => f.label === k)?.count || 0
  admin.from('discovery_brand_crawl_state')
    .upsert({
      page_id: pageId, brand_name: name || pageId, ads_indexed: total,
      active_count: active, video_count: cOf('Video'), image_count: cOf('Image'), carousel_count: cOf('Carousel/DCO'),
      stats_at: new Date().toISOString(),
    }, { onConflict: 'page_id' })
    .then(() => {}, () => {})

  // LANDING PAGES — every destination funnel the brand drives to, with active/inactive counts
  // (Foreplay's Landing Pages tab). Grouped by host+path, sorted by total.
  const lpMap = new Map<string, { url: string; host: string; active: number; inactive: number }>()
  for (const a of ads) {
    const n = normUrl(a.link_url)
    if (!n) continue
    const cur = lpMap.get(n.url) || { url: n.url, host: n.host, active: 0, inactive: 0 }
    if (a.is_active) cur.active++; else cur.inactive++
    lpMap.set(n.url, cur)
  }
  const landingPages = Array.from(lpMap.values())
    .map((p) => ({ ...p, total: p.active + p.inactive, fullUrl: `https://${p.url}` }))
    .sort((a, b) => b.total - a.total).slice(0, 60)

  // HOOKS — the opening line of each ad, grouped, with the longest run time and a representative
  // creative (Foreplay's Hooks tab, sorted Longest Running).
  const hookMap = new Map<string, { text: string; count: number; days: number; adId: string; snapshot_url: string | null; active: boolean }>()
  for (const a of ads) {
    const text = hookOf(a.body)
    if (!text) continue
    const cur = hookMap.get(text) || { text, count: 0, days: 0, adId: a.ad_id, snapshot_url: a.snapshot_url, active: false }
    cur.count++
    if ((a.days_running || 0) > cur.days) { cur.days = a.days_running || 0; cur.adId = a.ad_id; cur.snapshot_url = a.snapshot_url }
    if (a.is_active) cur.active = true
    hookMap.set(text, cur)
  }
  const hooks = Array.from(hookMap.values()).sort((a, b) => b.days - a.days).slice(0, 80)

  const startsSorted = ads.map((a) => a.start_date).filter(Boolean).sort() as string[]
  const seenSorted = ads.map((a) => a.last_seen).filter(Boolean).sort() as string[]
  const dataAsOf = seenSorted[seenSorted.length - 1] || null   // freshest snapshot we hold
  return NextResponse.json({
    brand: { pageId, name: name || pageId, picture: null },
    summary: {
      total, active, inactive: total - active,
      ownCount, affiliateCount,   // own-page vs creator/affiliate split (total = own + affiliate)
      activePct: Math.round((active / total) * 100),
      videoPct: Math.round(((fmt.find((f) => f.label === 'Video')?.count || 0) / total) * 100),
      imagePct: Math.round(((fmt.find((f) => f.label === 'Image')?.count || 0) / total) * 100),
      firstSeen: startsSorted[0] || null, lastSeen: startsSorted[startsSorted.length - 1] || null,
      dataAsOf,
    },
    formatMix,
    launchesByMonth,
    activeTrend,
    creativeTests,
    longestRunning,
    landingPages,
    hooks,
    topHooks: tally(ads.map((a) => a.hook_type)).slice(0, 8),
    topAngles: tally(ads.map((a) => a.angle)).slice(0, 8),
  })
}
