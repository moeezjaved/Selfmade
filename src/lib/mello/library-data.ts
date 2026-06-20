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
  'creative_reuse_count, brand_active_ads, performance_tier, performance_score, is_active, thumbnail_url'

function clean(s: any): string | null {
  if (!s) return null
  const t = String(s).trim()
  return t && t.toLowerCase() !== 'n/a' && t.toLowerCase() !== 'unknown' ? t : null
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
    days_running: a.days_running ?? null,
    reuse_count: a.creative_reuse_count ?? 0,
    tier: a.performance_tier || null,
    is_active: a.is_active,
    thumbnail_url: a.thumbnail_url || null,
  }
}

// ── Competitor / brand deep-dive ─────────────────────────────
export interface CompetitorParams { brand?: string; niche?: string; active_only?: boolean; limit?: number }

export async function getCompetitorAds(params: CompetitorParams) {
  const admin = createAdminClient()
  const limit = Math.min(Math.max(params.limit || 12, 1), 24)
  let q = admin.from('discovery_ads_index').select(SELECT_COLS)
    .or(HAS_CREATIVE)
    .order('performance_score', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (params.brand) { const b = params.brand.replace(/[%,()]/g, ' ').trim(); if (b) q = q.ilike('page_name', `%${b}%`) }
  if (params.niche) q = q.ilike('niche', `%${params.niche}%`)
  if (params.active_only) q = q.eq('is_active', true)

  const { data, error } = await q
  if (error) throw new Error(`Ad library: ${error.message}`)
  return { count: (data || []).length, ads: (data || []).map(mapAd) }
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
