/**
 * The DNA Engine — turns the creative DNA we already extracted for 3M+ ads
 * (discovery_ads_index: hook_type, angle, persona, desire, emotion[], themes[], usp,
 *  problem, offer, cta_style, format, format_style, visual_style, days_running, …)
 * into JUDGMENT: what the winners in a niche share (L1), what a brand is missing (L2),
 * and a prescription of ads to make (L3).
 *
 * Cost discipline (see docs/dna-engine plan):
 *   L1 winnerDna + L2 dnaDiff  → pure SQL/JS over columns we already paid to fill. FREE.
 *   L3 synthesize              → ONE cached LLM call. Cached in R2 by (pageIds) hash.
 * "Real or silent": L3 may only speak from the diff we hand it — never invent a gap.
 *
 * Scope note: currently wired ONLY into onboarding. Not surfaced elsewhere yet.
 */
import { createAdminClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'
import { createHash } from 'crypto'

// Winner threshold — longevity is our proof-of-conversion signal. An ad a brand has paid to keep
// live for 90+ days is, by revealed preference, converting. That filter is the whole edge over
// "top hooks" (which counts noise too).
const WINNER_DAYS = 90

// The DNA dimensions we roll up. `arr:true` = the column is text[] (tally each element).
const DIMS = [
  { key: 'hook_type', label: 'Hook', arr: false },
  { key: 'angle', label: 'Angle', arr: false },
  { key: 'persona', label: 'Persona', arr: false },
  { key: 'desire', label: 'Desire', arr: false },
  { key: 'emotion', label: 'Emotion', arr: true },
  { key: 'themes', label: 'Theme', arr: true },
  { key: 'usp', label: 'USP', arr: false },
  { key: 'problem', label: 'Problem', arr: false },
  { key: 'offer', label: 'Offer', arr: false },
  { key: 'format_style', label: 'Format', arr: false },   // UGC / Studio / Graphic
  { key: 'visual_style', label: 'Visual style', arr: false },
  { key: 'cta_style', label: 'CTA style', arr: false },
] as const

type DimKey = (typeof DIMS)[number]['key']
export type Tally = { label: string; count: number; pct: number }
export type DnaDist = Partial<Record<DimKey, Tally[]>>

type AdRow = Record<string, unknown>

const SELECT =
  'ad_id, page_id, page_name, format, days_running, is_active, has_creative, performance_score, ' +
  'body, title, thumbnail_url, raw_image_urls, snapshot_url, start_date, link_url, ' +
  'discovery_creatives(asset_type, r2_url, poster_url, position), ' +
  DIMS.map((d) => d.key).join(', ')

// ── rollup: rows → distribution per dimension (single + array columns) ──
function rollup(rows: AdRow[]): DnaDist {
  const out: DnaDist = {}
  for (const { key, arr } of DIMS) {
    const counts: Record<string, number> = {}
    let total = 0
    for (const r of rows) {
      const v = r[key]
      const vals = arr ? (Array.isArray(v) ? v : []) : v != null ? [v] : []
      for (const raw of vals as unknown[]) {
        const label = String(raw || '').trim()
        if (!label || label.toLowerCase() === 'none' || label.toLowerCase() === 'n/a') continue
        counts[label] = (counts[label] || 0) + 1
        total++
      }
    }
    if (total === 0) continue
    out[key] = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, count]) => ({ label, count, pct: Math.round((count / rows.length) * 100) }))
  }
  return out
}

// Strip Meta dynamic-template placeholders ({{product.brand}} etc.) + collapse whitespace, so ad hooks
// read like real copy, not raw template source.
const cleanText = (s: string): string => (s || '').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim()

// Dominant writing system of a string — used to keep rivals in the same language as the brand.
function scriptOf(s: string): 'latin' | 'cyrillic' | 'cjk' | 'arabic' | 'other' {
  const counts = { latin: 0, cyrillic: 0, cjk: 0, arabic: 0 }
  for (const ch of s || '') {
    const c = ch.codePointAt(0) || 0
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) counts.latin++
    else if (c >= 0x400 && c <= 0x4ff) counts.cyrillic++
    else if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3040 && c <= 0x30ff) || (c >= 0xac00 && c <= 0xd7af)) counts.cjk++
    else if (c >= 0x600 && c <= 0x6ff) counts.arabic++
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return top && top[1] > 0 ? (top[0] as 'latin' | 'cyrillic' | 'cjk' | 'arabic') : 'other'
}

const thumbOf = (a: AdRow): string | null => {
  // Prefer OUR permanent R2 copy (crawled into discovery_creatives) — fbcdn thumbnail_url / raw_image_urls
  // are hotlink-protected and expire, so they 404 through the weserv proxy and the grid shows blanks.
  const cres = (a.discovery_creatives as { asset_type?: string; r2_url?: string | null; poster_url?: string | null; position?: number }[]) || []
  const cre = cres.slice().sort((x, y) => (x.position || 0) - (y.position || 0)).find((c) => c.r2_url || c.poster_url)
  if (cre) { const r2 = (cre.asset_type === 'video' ? cre.poster_url : cre.r2_url) || cre.r2_url || cre.poster_url; if (r2) return String(r2) }
  const imgs = a.raw_image_urls as string[] | null
  const u = (a.thumbnail_url as string) || imgs?.[0] || null
  if (!u) return null
  if (/weserv\.nl|r2\.|cloudflarestorage/.test(u)) return u
  return `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}&w=240&output=webp`
}

export type WinnerExample = {
  adId: string; brand: string; daysRunning: number; hook: string; format: string | null; thumb: string | null
}

// Media mix (Video / Carousel / Image) from the raw `format` column — the headline bar on Brand Spy.
function mediaMix(rows: AdRow[]): Tally[] {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const f = String(r.format || '').trim(); if (!f) continue
    const k = /video/i.test(f) ? 'Video' : /carousel|dco|dpa/i.test(f) ? 'Carousel/DCO' : /image|static/i.test(f) ? 'Image' : f
    counts[k] = (counts[k] || 0) + 1
  }
  const tot = rows.length || 1
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count, pct: Math.round((count / tot) * 100) }))
}

export type WinnerDna = {
  dist: DnaDist
  media: Tally[]
  sampleSize: number
  winnerCount: number
  examples: WinnerExample[]   // longest-running, for the LLM + UI
}

// ── L1: Winner DNA — the DNA of ads that survive (days_running ≥ 90) across these pages/niche ──
export async function winnerDna(pageIds: string[], niche?: string | null, brandName?: string | null): Promise<WinnerDna> {
  const db = createAdminClient()
  let rows: AdRow[] = []

  if (pageIds.length) {
    const { data } = await db.from('discovery_ads_index').select(SELECT)
      .in('page_id', pageIds).eq('has_creative', true)
      .gte('days_running', WINNER_DAYS).order('days_running', { ascending: false }).limit(1500)
    rows = (data as AdRow[]) || []
    // Too few proven winners? fall back to the longest-running ads these brands run, so we still
    // describe *their strongest*, and flag lower confidence via sampleSize.
    if (rows.length < 15) {
      const { data: d2 } = await db.from('discovery_ads_index').select(SELECT)
        .in('page_id', pageIds).eq('has_creative', true)
        .order('days_running', { ascending: false }).limit(400)
      rows = (d2 as AdRow[]) || rows
    }
  } else if (niche) {
    const { data } = await db.from('discovery_ads_index').select(SELECT)
      .eq('niche', niche).eq('has_creative', true)
      .gte('days_running', WINNER_DAYS).order('days_running', { ascending: false }).limit(1500)
    rows = (data as AdRow[]) || []
  }

  // Relevance: keep rivals in the SAME writing system as the brand (a Cyrillic/CJK store is not a
  // believable peer for a Latin-script brand). Broad niches like "Health & Wellness" otherwise surface
  // whatever foreign brand has the most/longest-running ads. Fall back to all rows if the same-language
  // pool is too thin to describe a playbook.
  if (brandName) {
    const want = scriptOf(brandName)
    if (want !== 'other') {
      const same = rows.filter((r) => scriptOf(cleanText(String((r.body as string) || (r.title as string) || ''))) === want)
      if (same.length >= 15) rows = same
    }
  }

  const winners = rows.filter((r) => (r.days_running as number) >= WINNER_DAYS)
  // Prefer examples that actually have a thumbnail so the rivals grid is full of real ads, not blanks.
  const withThumb = rows.filter((r) => thumbOf(r))
  const examples: WinnerExample[] = (withThumb.length ? withThumb : rows).slice(0, 24).map((a) => ({
    adId: String(a.ad_id),
    brand: String(a.page_name || ''),
    daysRunning: (a.days_running as number) || 0,
    hook: cleanText((a.body as string) || (a.title as string) || '').split('\n')[0].trim().slice(0, 160),
    format: (a.format_style as string) || (a.format as string) || null,
    thumb: thumbOf(a),
  }))

  return { dist: rollup(rows), media: mediaMix(rows), sampleSize: rows.length, winnerCount: winners.length, examples }
}

// ── The $100k → $1M maturity model. A $100k brand runs ads; a $1M brand builds a creative+conversion
// SYSTEM (high ad volume, weekly creative velocity, every format, a persona per avatar, a PDP per angle).
// We score each measurable axis starter → scaling → elite from data we already hold. ──
export type BenchAxis = { key: string; label: string; you: number; unit: string; tier: 'starter' | 'scaling' | 'elite'; pct: number; target: string }
const HOSTS_SKIP = /facebook|instagram|fb\.me|fb\.com/
function benchmark(rows: AdRow[], dist: DnaDist): { axes: BenchAxis[]; systemScore: number } {
  const active = rows.filter((r) => r.is_active === true).length
  const now = Date.now()
  const newLast30 = rows.filter((r) => { const d = Date.parse(String(r.start_date || '')); return !!d && (now - d) < 30 * 864e5 }).length
  const landings = new Set<string>()
  for (const r of rows) { const m = String(r.link_url || '').match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(\/[^?#]*)?/i); if (m && !HOSTS_SKIP.test(m[1])) landings.add(m[1].toLowerCase() + (m[2] || '').replace(/\/$/, '')) }
  const formats = new Set([...(dist.format_style || []), ...(dist.visual_style || [])].map((t) => t.label.toLowerCase())).size
  const personas = (dist.persona || []).length
  const angles = new Set([...(dist.angle || []), ...(dist.hook_type || [])].map((t) => t.label.toLowerCase())).size
  const mk = (key: string, label: string, you: number, unit: string, scaleAt: number, eliteAt: number, target: string): BenchAxis =>
    ({ key, label, you, unit, tier: you >= eliteAt ? 'elite' : you >= scaleAt ? 'scaling' : 'starter', pct: Math.min(100, Math.round((you / eliteAt) * 100)), target })
  const axes = [
    mk('volume', 'Ad volume', active, 'active ads', 50, 300, '$1M brands run 300–750 active'),
    mk('velocity', 'Creative velocity', newLast30, 'new / 30d', 8, 40, '$1M brands ship 50+ a week'),
    mk('formats', 'Format diversity', formats, 'formats', 4, 8, '$1M brands run every format'),
    mk('personas', 'Persona breadth', personas, 'personas', 3, 6, '$1M brands build one per persona'),
    mk('angles', 'Angle diversity', angles, 'angles', 4, 8, '$1M brands run 8+ angles'),
    mk('funnel', 'Funnel depth', landings.size, 'landing pages', 2, 5, '$1M brands build a PDP per angle'),
  ]
  return { axes, systemScore: Math.round(axes.reduce((s, a) => s + a.pct, 0) / axes.length) }
}

export type OwnDna = { dist: DnaDist; media: Tally[]; totalAds: number; activeAds: number; found: boolean; bench: BenchAxis[]; systemScore: number; examples: WinnerExample[] }

// ── the visitor's own DNA (their public ads live in the same index → no Meta connection needed) ──
export async function ownDna(pageId: string | null): Promise<OwnDna> {
  if (!pageId) return { dist: {}, media: [], totalAds: 0, activeAds: 0, found: false, bench: [], systemScore: 0, examples: [] }
  const db = createAdminClient()
  const { data } = await db.from('discovery_ads_index').select(SELECT)
    .eq('page_id', pageId).eq('has_creative', true).order('days_running', { ascending: false }).limit(1000)
  const rows = (data as AdRow[]) || []
  const active = rows.filter((r) => r.is_active === true).length
  const b = benchmark(rows, rollup(rows))
  // Their real ad thumbnails — for the "reading your ads" grid + the you-vs-winners strip. Prefer ones
  // that actually have an image so the grid isn't full of blanks.
  const examples: WinnerExample[] = rows.filter((r) => thumbOf(r)).slice(0, 24).map((a) => ({
    adId: String(a.ad_id),
    brand: String(a.page_name || ''),
    daysRunning: (a.days_running as number) || 0,
    hook: cleanText((a.body as string) || (a.title as string) || '').split('\n')[0].trim().slice(0, 160),
    format: (a.format_style as string) || (a.format as string) || null,
    thumb: thumbOf(a),
  }))
  return { dist: rollup(rows), media: mediaMix(rows), totalAds: rows.length, activeAds: active, found: rows.length > 0, bench: b.axes, systemScore: b.systemScore, examples }
}

export type Gap = { dimension: string; label: string; winnerPct: number; yourPct: number; kind: 'missing' | 'underweight' | 'overused' }

// ── L2: the diff — winners' DNA vs yours, per dimension. Pure function, no AI. ──
export function dnaDiff(own: OwnDna, winners: WinnerDna): Gap[] {
  const gaps: Gap[] = []
  for (const { key, label } of DIMS) {
    const w = winners.dist[key] || []
    const o = own.dist[key] || []
    const oMap = new Map(o.map((t) => [t.label.toLowerCase(), t.pct]))
    // winning traits you're missing or under-indexed on
    for (const t of w) {
      if (t.pct < 15) continue // only surface traits that are genuinely common among winners
      const yours = oMap.get(t.label.toLowerCase()) || 0
      if (yours === 0) gaps.push({ dimension: label, label: t.label, winnerPct: t.pct, yourPct: 0, kind: 'missing' })
      else if (t.pct - yours >= 25) gaps.push({ dimension: label, label: t.label, winnerPct: t.pct, yourPct: yours, kind: 'underweight' })
    }
    // traits you lean on that winners have abandoned
    const wMap = new Map(w.map((t) => [t.label.toLowerCase(), t.pct]))
    for (const t of o) {
      if (t.pct >= 40 && (wMap.get(t.label.toLowerCase()) || 0) < 10) {
        gaps.push({ dimension: label, label: t.label, winnerPct: wMap.get(t.label.toLowerCase()) || 0, yourPct: t.pct, kind: 'overused' })
      }
    }
  }
  // biggest gaps first
  return gaps.sort((a, b) => (b.winnerPct - b.yourPct) - (a.winnerPct - a.yourPct)).slice(0, 12)
}

export type Prescription = {
  title: string
  hook: string; angle: string; persona: string; offer: string; format: string
  rationale: string
}
export type DnaReport = {
  findings: { type: 'gap' | 'strength' | 'note'; title: string; detail: string }[]
  prescriptions: Prescription[]
  confidence: 'high' | 'medium' | 'low'
}

let _oai: OpenAI | null = null
const oai = () => (_oai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

// ── L3: synthesis — ONE cached LLM call. Speaks ONLY from the diff + winner DNA we pass in. ──
export async function synthesize(input: {
  brandName: string; niche?: string | null; own: OwnDna; winners: WinnerDna; gaps: Gap[]
}): Promise<DnaReport> {
  const { brandName, niche, own, winners, gaps } = input
  const confidence: DnaReport['confidence'] = winners.winnerCount >= 30 ? 'high' : winners.winnerCount >= 8 ? 'medium' : 'low'

  const sys = `You are Selfmade's ad strategist. You are given the DNA of PROVEN winning ads (ads running 90+ days = converting) in a niche, a brand's own ad DNA, and a computed GAP list.
RULES:
- Speak ONLY from the data provided. Never invent a gap, stat, or trait not in the input. If data is thin, say so.
- Findings: short, concrete, plain English a non-marketer understands.
- Prescriptions: each is a specific ad to make, grounded in a real winning trait the brand lacks. Fill hook/angle/persona/offer/format from the winner DNA.
Return JSON: {findings:[{type,title,detail}], prescriptions:[{title,hook,angle,persona,offer,format,rationale}]}. Max 5 findings, 3 prescriptions.`

  const user = JSON.stringify({
    brand: brandName, niche: niche || null,
    winnerDna: winners.dist, winnerSample: winners.sampleSize, provenWinners: winners.winnerCount,
    yourDna: own.found ? own.dist : 'NO ADS FOUND — this brand runs no ads we can see',
    yourAdCount: own.totalAds,
    gaps,
  })

  try {
    const res = await oai().chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    })
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}')
    return {
      findings: Array.isArray(parsed.findings) ? parsed.findings.slice(0, 5) : [],
      prescriptions: Array.isArray(parsed.prescriptions) ? parsed.prescriptions.slice(0, 3) : [],
      confidence,
    }
  } catch {
    // Fail silent-but-honest: hand back the raw gaps as findings so the UI still has truth.
    return {
      findings: gaps.slice(0, 5).map((g) => ({
        type: 'gap' as const,
        title: `${g.dimension}: ${g.label}`,
        detail: g.kind === 'overused'
          ? `You lean on "${g.label}" (${g.yourPct}% of your ads) but only ${g.winnerPct}% of winners use it.`
          : `${g.winnerPct}% of winning ads use "${g.label}" — you're at ${g.yourPct}%.`,
      })),
      prescriptions: [],
      confidence,
    }
  }
}

// ── Ad Presence Score — deterministic, honest. Subscores with missing signals are null (excluded),
// never faked ("real or silent"). ──
export type Subscore = { key: string; label: string; value: number | null; note: string }
export type Score = { total: number; band: 'Poor' | 'Needs work' | 'Fair' | 'Strong'; subscores: Subscore[] }

const distinct = (d: DnaDist, ...keys: DimKey[]) => {
  const s = new Set<string>()
  for (const k of keys) for (const t of d[k] || []) s.add(t.label.toLowerCase())
  return s
}

export function scoreDna(own: OwnDna, winners: WinnerDna, gaps: Gap[]): Score {
  const subs: Subscore[] = []

  // Coverage — are you even in the game (absolute, honest bands on active ads)
  const a = own.activeAds
  const coverage = !own.found ? 0 : a >= 20 ? 95 : a >= 11 ? 80 : a >= 6 ? 60 : a >= 3 ? 40 : a >= 1 ? 20 : 0
  subs.push({ key: 'coverage', label: 'Coverage', value: coverage, note: own.found ? `${a} active ad${a === 1 ? '' : 's'}.` : "You're running no ads we can see." })

  // Format mix — of the formats winners use, how many do you? (null if you run nothing)
  if (own.found) {
    const wF = new Set((winners.dist.format_style || []).map((t) => t.label.toLowerCase()))
    const oF = new Set((own.dist.format_style || []).map((t) => t.label.toLowerCase()))
    const overlap = wF.size ? Array.from(wF).filter((f) => oF.has(f)).length / wF.size : 0
    subs.push({ key: 'format', label: 'Format mix', value: Math.round(overlap * 100), note: `You use ${oF.size} of the ${wF.size} formats winners run.` })
  } else subs.push({ key: 'format', label: 'Format mix', value: null, note: 'No ads to compare.' })

  // Angle diversity — distinct hooks+angles you run vs winners
  if (own.found) {
    const w = distinct(winners.dist, 'hook_type', 'angle').size || 1
    const o = distinct(own.dist, 'hook_type', 'angle').size
    subs.push({ key: 'angles', label: 'Angle diversity', value: Math.min(100, Math.round((o / w) * 100)), note: `${o} distinct angles vs ${w} among winners.` })
  } else subs.push({ key: 'angles', label: 'Angle diversity', value: null, note: 'No ads to compare.' })

  // Opportunity — inverse of the gap count (always available)
  subs.push({ key: 'gaps', label: 'Playbook coverage', value: Math.max(0, 100 - gaps.length * 8), note: `${gaps.length} winning tactic${gaps.length === 1 ? '' : 's'} you're missing.` })

  const scored = subs.filter((s) => s.value != null) as (Subscore & { value: number })[]
  const total = scored.length ? Math.round(scored.reduce((n, s) => n + s.value, 0) / scored.length) : 0
  const band: Score['band'] = total < 40 ? 'Poor' : total < 60 ? 'Needs work' : total < 80 ? 'Fair' : 'Strong'
  return { total, band, subscores: subs }
}

// ── "What it costs you" — an HONEST estimate (we can't see spend from outside; that's the invisible half
// the benchmark names). We model annual spend from active-ad count × an industry-average per-ad spend,
// then the fraction leaking because winning tactics are missing. Flagged estimated + needsMeta so the UI
// says "connect Meta for your real number." ──
export type CostEstimate = { lostPerYear: number; activeAds: number; monthlyPerAd: number; leakPct: number; estimated: true; needsMeta: true }
export function estimateCost(own: OwnDna, gaps: Gap[], score: Score): CostEstimate {
  const monthlyPerAd = 400 // conservative industry-average spend per active creative / month
  const activeAds = own.activeAds
  const annualSpend = activeAds * monthlyPerAd * 12
  const leak = Math.min(0.4, gaps.length * 0.03 + (Math.max(0, 100 - score.total) / 100) * 0.15)
  return { lostPerYear: Math.round(annualSpend * leak), activeAds, monthlyPerAd, leakPct: Math.round(leak * 100), estimated: true, needsMeta: true }
}

// ── Orchestrator with R2 cache (no migration needed). Keyed by the competitor set + own page. `v2` =
// added own.examples (ad thumbnails) + cost; bumping the key bypasses caches that predate those fields. ──
const cacheKey = (pageIds: string[], ownPage: string | null) =>
  `dna-reports/${createHash('sha256').update([...pageIds].sort().join(',') + '|' + (ownPage || '') + '|v4').digest('hex').slice(0, 24)}.json`

export type FullDnaResult = { winners: WinnerDna; own: OwnDna; gaps: Gap[]; report: DnaReport; score: Score; cost: CostEstimate; cached: boolean }

export async function runDnaEngine(opts: {
  brandName: string; competitorPageIds: string[]; ownPageId?: string | null; niche?: string | null; force?: boolean
}): Promise<FullDnaResult> {
  const { brandName, competitorPageIds, ownPageId = null, niche = null, force = false } = opts
  const key = cacheKey(competitorPageIds, ownPageId)

  const publicUrl = r2PublicUrl(key)
  if (!force && publicUrl) {
    try {
      const r = await fetch(publicUrl, { cache: 'no-store' })
      if (r.ok) return { ...(await r.json()), cached: true }
    } catch { /* miss → compute */ }
  }

  const [winners, own] = await Promise.all([winnerDna(competitorPageIds, niche, brandName), ownDna(ownPageId)])
  const gaps = dnaDiff(own, winners)
  const report = await synthesize({ brandName, niche, own, winners, gaps })
  const score = scoreDna(own, winners, gaps)
  const cost = estimateCost(own, gaps, score)
  const result: FullDnaResult = { winners, own, gaps, report, score, cost, cached: false }

  try { await uploadBufferToR2(Buffer.from(JSON.stringify(result)), key, 'application/json') } catch { /* cache best-effort */ }
  return result
}
