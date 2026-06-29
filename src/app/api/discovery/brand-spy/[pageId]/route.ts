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

type Ad = { ad_id: string; format: string | null; start_date: string | null; last_seen: string | null; is_active: boolean | null; days_running: number | null; hook_type: string | null; angle: string | null; body: string | null; title?: string | null; snapshot_url: string | null; link_url?: string | null; thumbnail_url?: string | null; raw_image_urls?: string[] | null; raw_video_preview_urls?: string[] | null; performance_score?: number | null; persona?: string | null; usp?: string | null; desire?: string | null; emotion?: string[] | null; themes?: string[] | null; topics?: string[] | null; cta?: string | null }

// link_url (migration 045) feeds the Landing Pages tab. RESILIENT: if the column isn't applied yet
// the select falls back to SELECT_BASE so the dashboard never 500s on deploy/migration ordering.
// The classifier DNA columns (persona/usp/desire/emotion/themes/cta/title) power the Atria-style
// SELECT_BASE = SELECT minus ONLY link_url (the one genuinely-optional, migration-gated column).
// CRITICAL: the DNA columns (persona/usp/desire/emotion/themes/cta/title/topics) MUST live in the
// base too — they all exist. The old base omitted them, so when SELECT errored on a missing link_url
// the fallback silently stripped ALL DNA → every Overview/USPs/Desires/Emotions/Themes panel rendered
// empty even though the data was in the DB. Only link_url may be absent; nothing else gets dropped.
const SELECT = 'ad_id, page_name, format, start_date, last_seen, is_active, days_running, hook_type, angle, body, title, snapshot_url, thumbnail_url, raw_image_urls, raw_video_preview_urls, performance_score, link_url, persona, usp, desire, emotion, themes, topics, cta'
const SELECT_BASE = 'ad_id, page_name, format, start_date, last_seen, is_active, days_running, hook_type, angle, body, title, snapshot_url, thumbnail_url, raw_image_urls, raw_video_preview_urls, performance_score, persona, usp, desire, emotion, themes, topics, cta'

// Real thumbnail (image) for a hook/card — the crawler's captured media, proxied through weserv
// (hotlink-safe). snapshot_url is a LIBRARY LINK, not an image, so it can't be used as a thumbnail.
const thumbOf = (a: Ad): string | null => {
  const u = a.thumbnail_url || (a.raw_image_urls?.[0]) || (a.raw_video_preview_urls?.[0]) || null
  if (!u) return null
  if (u.includes('weserv.nl') || u.includes('r2.') || u.includes('cloudflarestorage')) return u
  return `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}&w=200&output=webp`
}
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
const tally = (xs: (string | null | undefined)[]) => {
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
  let cols = SELECT   // drops to SELECT_BASE on the first page if link_url isn't applied yet
  for (let from = 0; from < MAX_ADS; from += PAGE) {
    let { data, error } = await admin
      .from('discovery_ads_index')
      .select(cols)
      .eq('page_id', pageId)
      .order('start_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error && cols === SELECT) {
      // link_url column missing (migration 045 not applied) → retry this page without it, and use
      // the base select for the rest. Landing Pages stays empty until the migration lands.
      cols = SELECT_BASE
      ;({ data, error } = await admin.from('discovery_ads_index').select(cols).eq('page_id', pageId).order('start_date', { ascending: true }).range(from, from + PAGE - 1))
    }
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

  // ── Creative-DNA aggregates (Atria-style Overview) — the brand's playbook from the classifier.
  const tallyArr = (xs: (string[] | null | undefined)[]) => tally(xs.flatMap((a) => Array.isArray(a) ? a : []))
  const topPersonas = tally(ads.map((a) => a.persona)).slice(0, 40)
  const topAnglesDNA = tally(ads.map((a) => a.angle)).slice(0, 40)
  const topUSPs = tally(ads.map((a) => a.usp)).slice(0, 40)
  const topDesires = tally(ads.map((a) => a.desire)).slice(0, 40)
  const topEmotions = tallyArr(ads.map((a) => a.emotion)).slice(0, 40)
  // Themes panel: the AI classifier writes `topics`, while `themes` is the heuristic column (often
  // empty). Prefer themes per-ad, fall back to topics, so the panel is populated either way.
  const topThemes = tallyArr(ads.map((a) => (a.themes && a.themes.length ? a.themes : a.topics))).slice(0, 40)
  const topCTAs = tally(ads.map((a) => a.cta)).slice(0, 40)
  // Distinct-count tiles (Hooks / Ad copy / Headlines / Landing pages), like Atria's overview row.
  const distinct = (xs: (string | null | undefined)[]) => new Set(xs.map((x) => (x || '').trim()).filter(Boolean)).size
  const counts = {
    hooks: distinct(ads.map((a) => a.hook_type)),
    adCopy: distinct(ads.map((a) => (a.body || '').trim().slice(0, 200))),
    headlines: distinct(ads.map((a) => a.title)),
    landingPages: distinct(ads.map((a) => a.link_url)),
  }
  // Trend header (Atria: "N ads were live in last 30 days, including M new ads (±X%)").
  const nowMs = Date.now(), d30 = nowMs - 30 * 864e5, d60 = nowMs - 60 * 864e5
  const liveLast30 = ads.filter((a) => a.last_seen && Date.parse(a.last_seen) >= d30).length
  const newLast30 = ads.filter((a) => a.start_date && Date.parse(a.start_date) >= d30).length
  const newPrev30 = ads.filter((a) => a.start_date && Date.parse(a.start_date) >= d60 && Date.parse(a.start_date) < d30).length
  const trend = { liveLast30, newLast30, pctChange: newPrev30 > 0 ? Math.round(((newLast30 - newPrev30) / newPrev30) * 100) : null }

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
    const n = normUrl(a.link_url ?? null)
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
  const hookMap = new Map<string, { text: string; count: number; days: number; adId: string; snapshot_url: string | null; thumb: string | null; active: boolean }>()
  for (const a of ads) {
    const text = hookOf(a.body)
    if (!text) continue
    const cur = hookMap.get(text) || { text, count: 0, days: 0, adId: a.ad_id, snapshot_url: a.snapshot_url, thumb: thumbOf(a), active: false }
    cur.count++
    if ((a.days_running || 0) > cur.days) { cur.days = a.days_running || 0; cur.adId = a.ad_id; cur.snapshot_url = a.snapshot_url; cur.thumb = thumbOf(a) }
    if (a.is_active) cur.active = true
    hookMap.set(text, cur)
  }
  const hooks = Array.from(hookMap.values()).sort((a, b) => b.days - a.days).slice(0, 80)

  // TOP ADS by performance score (rollup-backed) — the Timeline page's "best ads" panel.
  const topAds = ads
    .filter((a) => a.performance_score != null)
    .sort((a, b) => (b.performance_score || 0) - (a.performance_score || 0))
    .slice(0, 10)
    .map((a) => ({ adId: a.ad_id, score: Math.round(a.performance_score || 0), days: a.days_running || 0, active: !!a.is_active, hook: hookOf(a.body) || '(no text)', thumb: thumbOf(a), snapshot_url: a.snapshot_url }))

  // Swap the displayed thumbnails (hooks + topAds only — ~90 ads max) to PERMANENT R2 copies where
  // available. thumbOf() resolves the raw fbcdn.net URL, which is signed + EXPIRES → broken images on
  // older ads. We resolve R2 for just the shown ad_ids (bounded), keeping the raw URL as fallback.
  const shownIds = Array.from(new Set([...hooks.map((h) => h.adId), ...topAds.map((t) => t.adId)]))
  if (shownIds.length) {
    const { data: cre } = await admin
      .from('discovery_creatives')
      .select('ad_id, asset_type, r2_url, poster_url, position')
      .in('ad_id', shownIds)
      .order('position', { ascending: true })
    const r2thumb = new Map<string, string>()
    for (const c of (cre || []) as any[]) {
      if (r2thumb.has(c.ad_id)) continue
      const t = c.poster_url || (c.asset_type !== 'video' ? c.r2_url : null)
      if (t) r2thumb.set(c.ad_id, t)
    }
    for (const h of hooks) { const t = r2thumb.get(h.adId); if (t) h.thumb = t }
    for (const t of topAds) { const r = r2thumb.get(t.adId); if (r) t.thumb = r }
  }

  const startsSorted = ads.map((a) => a.start_date).filter(Boolean).sort() as string[]
  const seenSorted = ads.map((a) => a.last_seen).filter(Boolean).sort() as string[]
  const dataAsOf = seenSorted[seenSorted.length - 1] || null   // freshest snapshot we hold
  // Auto-classify-on-spy: if this brand has ads but NO AI-DNA yet (its ads aren't classified),
  // enqueue it so the droplet spy-classify-worker fills Personas/USPs/Desires/Emotions/Themes within
  // minutes — no manual run, no waiting on the global backlog. Idempotent + best-effort (the enqueue
  // RPC no-ops if already pending/processing, and a failure here must never break the page).
  const dnaEmpty = !topUSPs.length && !topDesires.length && !topEmotions.length && !topThemes.length && !topPersonas.length
  if (dnaEmpty && total > 0) {
    try { await admin.rpc('enqueue_spy_classify', { p_page_id: pageId }) } catch { /* best-effort */ }
  }

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
    topAds,
    topHooks: tally(ads.map((a) => a.hook_type)).slice(0, 8),
    topAngles: tally(ads.map((a) => a.angle)).slice(0, 8),
    // Atria-style Overview DNA
    topPersonas, topAnglesDNA, topUSPs, topDesires, topEmotions, topThemes, topCTAs, counts, trend,
  })
}
