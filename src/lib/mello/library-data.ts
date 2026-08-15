/**
 * Mello's ad-intelligence tools over discovery_ads_index (our crawl corpus).
 * Everything here is grounded in REAL, populated columns:
 *   niche, performance_tier ('winning'|'optimized'|'growing'|'scaling'|'testing'),
 *   performance_score, creative_reuse_count, brand_active_ads, format, format_style
 *   (UGC|Studio|Graphic|Mixed), visual_style, visual_scene, on_screen_text,
 *   problem, mechanism, offer, cta_style (soft|hard|none), days_running.
 * No external data sources, no fabrication.
 */
import { createAdminClient } from '@/lib/supabase/server'

const WINNER_TIERS = ['winning', 'optimized']
const HAS_CREATIVE = 'thumbnail_url.like.%r2.dev%,video_url.like.%r2.dev%'

const SELECT_COLS =
  'ad_id, page_name, page_id, title, body, format, format_style, visual_style, visual_scene, ' +
  'on_screen_text, problem, mechanism, offer, cta_style, niche, days_running, ' +
  'creative_reuse_count, brand_active_ads, performance_tier, performance_score, is_active, thumbnail_url, ' +
  'start_date, stop_date, last_seen'

function clean(s: any): string | null {
  if (!s) return null
  const t = String(s).trim()
  return t && t.toLowerCase() !== 'n/a' && t.toLowerCase() !== 'unknown' ? t : null
}

// days_running is DERIVED, not trusted from storage: the crawler captures Facebook's real start_date
// (and stop_date) correctly, but the stored days_running is left 0 (the nightly rollup only recomputes
// a narrow recent window). For an active ad longevity grows daily, so a stored value is always stale.
// Compute it from the real dates: active → now − start; ended → stop − start. Clamp [0, 3650].
function deriveDays(a: any): number | null {
  const startMs = a.start_date ? Date.parse(a.start_date) : NaN
  if (!Number.isFinite(startMs)) return (typeof a.days_running === 'number' && a.days_running > 0) ? a.days_running : null
  const stopMs = a.stop_date ? Date.parse(a.stop_date) : NaN
  const endMs = a.is_active ? Date.now() : (Number.isFinite(stopMs) ? stopMs : (a.last_seen ? Date.parse(a.last_seen) : Date.now()))
  const d = Math.floor((endMs - startMs) / 86400000)
  return Number.isFinite(d) ? Math.max(0, Math.min(d, 3650)) : null
}

function mapAd(a: any) {
  return {
    brand: a.page_name,
    headline: clean(a.title),
    copy: (a.body || '').slice(0, 240),
    on_screen_text: clean(a.on_screen_text),
    format: a.format,
    format_style: clean(a.format_style),       // UGC / Studio / Graphic / Mixed
    visual: clean(a.visual_scene) || clean(a.visual_style),
    problem: clean(a.problem),
    mechanism: clean(a.mechanism),
    offer: clean(a.offer),
    cta_style: clean(a.cta_style),
    niche: clean(a.niche),
    days_running: deriveDays(a),
    reuse_count: a.creative_reuse_count ?? 0,
    tier: a.performance_tier || null,
    is_active: a.is_active,
    thumbnail_url: a.thumbnail_url || null,
  }
}

// ── Competitor / brand deep-dive ─────────────────────────────
// page_id is the RELIABLE way to fetch a watched competitor's ads. Matching by display name
// (`page_name ILIKE '%name%'`) silently returned 0 for real competitors whenever the stored name didn't
// substring-match the crawled page (diacritics "Füm"≠"Fum", suffixes " - The Good Habit") — bug #2.
export interface CompetitorParams { page_id?: string; brand?: string; niche?: string; active_only?: boolean; limit?: number }

export async function getCompetitorAds(params: CompetitorParams) {
  const admin = createAdminClient()
  const limit = Math.min(Math.max(params.limit || 12, 1), 24)
  let q = admin.from('discovery_ads_index').select(SELECT_COLS)
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (params.page_id) {
    // Reliable path: match by page_id and gate on the has_creative BOOLEAN — the SAME gate the Competitor
    // Feed uses — so Mello sees exactly what the product shows (not the stricter %r2.dev% URL subset).
    q = q.eq('page_id', String(params.page_id)).eq('has_creative', true)
  } else {
    q = q.or(HAS_CREATIVE)
    if (params.brand) { const b = params.brand.replace(/[%,()]/g, ' ').trim(); if (b) q = q.ilike('page_name', `%${b}%`) }
    if (params.niche) q = q.ilike('niche', `%${params.niche}%`)
  }
  if (params.active_only) q = q.eq('is_active', true)

  const { data, error } = await q
  if (error) throw new Error(`Ad library: ${error.message}`)
  const ads = (data || []).map(mapAd)

  // Useful "I don't know" (Phase 2.2): when a page_id lookup finds nothing, distinguish "not indexed yet"
  // from "indexed but no hosted creative / all inactive" so Mello reports the real state and NEVER invents
  // absence ("this competitor has no active ads").
  let note: string | undefined
  if (ads.length === 0 && params.page_id) {
    try {
      const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', String(params.page_id))
      note = (count && count > 0)
        ? `${count} ad(s) are indexed for this competitor but none has a fetched creative available right now (some may be inactive or awaiting media). Report what IS available and offer to re-check — do NOT tell the founder this competitor has no ads.`
        : `This competitor is not in the crawl index yet — their crawl may not have completed. Say exactly that and offer to prioritize their crawl; do NOT claim they have no ads.`
    } catch { /* leave note undefined */ }
  }
  return { count: ads.length, ads, ...(note ? { note } : {}) }
}

// ── Niche pattern analysis (aggregated in Node) ──────────────
export interface NichePatternParams { niche?: string; query?: string; sample?: number }

function topCounts(rows: any[], key: string, n: number) {
  const m = new Map<string, number>()
  for (const r of rows) { const v = clean(r[key]); if (v) m.set(v, (m.get(v) || 0) + 1) }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, count]) => ({ value, count }))
}
function dist(rows: any[], key: string) {
  const m = new Map<string, number>()
  for (const r of rows) { const v = clean(r[key]) || 'unspecified'; m.set(v, (m.get(v) || 0) + 1) }
  const total = rows.length || 1
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count, pct: Math.round((count / total) * 100) }))
}

export async function analyzeNichePatterns(params: NichePatternParams) {
  const admin = createAdminClient()
  const sample = Math.min(Math.max(params.sample || 400, 50), 800)
  let q = admin.from('discovery_ads_index')
    .select('page_name, format, format_style, cta_style, problem, mechanism, offer, visual_style, days_running, performance_tier, is_active, niche')
    .or(HAS_CREATIVE)
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(sample)
  if (params.niche) q = q.ilike('niche', `%${params.niche}%`)
  if (params.query) { const t = params.query.replace(/[%,()]/g, ' ').trim(); if (t) q = q.or(`page_name.ilike.%${t}%,body.ilike.%${t}%,title.ilike.%${t}%,niche.ilike.%${t}%`) }

  const { data, error } = await q
  if (error) throw new Error(`Ad library: ${error.message}`)
  const rows = data || []
  if (rows.length === 0) return { sampled: 0, note: 'No ads matched. Try a broader niche or keyword.' }

  const days = rows.map((r: any) => r.days_running ?? 0).filter((d: number) => d > 0).sort((a: number, b: number) => a - b)
  const median = days.length ? days[Math.floor(days.length / 2)] : 0
  const p75 = days.length ? days[Math.floor(days.length * 0.75)] : 0
  const winners = rows.filter((r: any) => WINNER_TIERS.includes(r.performance_tier)).length

  return {
    sampled: rows.length,
    active_share_pct: Math.round((rows.filter((r: any) => r.is_active).length / rows.length) * 100),
    winning_share_pct: Math.round((winners / rows.length) * 100),
    longevity_days: { median, p75, max: days.length ? days[days.length - 1] : 0 },
    format_mix: dist(rows, 'format'),
    creative_style_mix: dist(rows, 'format_style'),   // UGC vs Studio vs Graphic
    cta_style_mix: dist(rows, 'cta_style'),
    top_problems: topCounts(rows, 'problem', 8),
    top_mechanisms: topCounts(rows, 'mechanism', 8),
    top_offers: topCounts(rows, 'offer', 8),
    top_visual_styles: topCounts(rows, 'visual_style', 6),
    top_brands: topCounts(rows, 'page_name', 10),
  }
}

// ── Proven winners ───────────────────────────────────────────
export interface WinnerParams { niche?: string; query?: string; format?: 'image' | 'video' | 'carousel'; min_days_active?: number; limit?: number }

export async function findWinningAds(params: WinnerParams) {
  const admin = createAdminClient()
  const limit = Math.min(Math.max(params.limit || 10, 1), 24)
  let q = admin.from('discovery_ads_index').select(SELECT_COLS)
    .or(HAS_CREATIVE)
    .in('performance_tier', WINNER_TIERS)
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (params.niche) q = q.ilike('niche', `%${params.niche}%`)
  if (params.query) { const t = params.query.replace(/[%,()]/g, ' ').trim(); if (t) q = q.or(`page_name.ilike.%${t}%,body.ilike.%${t}%,title.ilike.%${t}%`) }
  if (params.format) q = q.ilike('format', `%${params.format}%`)
  if (params.min_days_active) q = q.gte('days_running', params.min_days_active)

  const { data, error } = await q
  if (error) throw new Error(`Ad library: ${error.message}`)
  return { count: (data || []).length, ads: (data || []).map(mapAd) }
}
