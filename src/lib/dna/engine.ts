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
  'body, title, thumbnail_url, raw_image_urls, snapshot_url, ' +
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

const thumbOf = (a: AdRow): string | null => {
  const imgs = a.raw_image_urls as string[] | null
  const u = (a.thumbnail_url as string) || imgs?.[0] || null
  if (!u) return null
  if (/weserv\.nl|r2\.|cloudflarestorage/.test(u)) return u
  return `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}&w=240&output=webp`
}

export type WinnerExample = {
  adId: string; brand: string; daysRunning: number; hook: string; format: string | null; thumb: string | null
}

export type WinnerDna = {
  dist: DnaDist
  sampleSize: number
  winnerCount: number
  examples: WinnerExample[]   // longest-running, for the LLM + UI
}

// ── L1: Winner DNA — the DNA of ads that survive (days_running ≥ 90) across these pages/niche ──
export async function winnerDna(pageIds: string[], niche?: string | null): Promise<WinnerDna> {
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

  const winners = rows.filter((r) => (r.days_running as number) >= WINNER_DAYS)
  const examples: WinnerExample[] = rows.slice(0, 6).map((a) => ({
    adId: String(a.ad_id),
    brand: String(a.page_name || ''),
    daysRunning: (a.days_running as number) || 0,
    hook: ((a.body as string) || (a.title as string) || '').split('\n')[0].trim().slice(0, 160),
    format: (a.format_style as string) || (a.format as string) || null,
    thumb: thumbOf(a),
  }))

  return { dist: rollup(rows), sampleSize: rows.length, winnerCount: winners.length, examples }
}

export type OwnDna = { dist: DnaDist; totalAds: number; activeAds: number; found: boolean }

// ── the visitor's own DNA (their public ads live in the same index → no Meta connection needed) ──
export async function ownDna(pageId: string | null): Promise<OwnDna> {
  if (!pageId) return { dist: {}, totalAds: 0, activeAds: 0, found: false }
  const db = createAdminClient()
  const { data } = await db.from('discovery_ads_index').select(SELECT)
    .eq('page_id', pageId).limit(1000)
  const rows = (data as AdRow[]) || []
  const active = rows.filter((r) => r.is_active === true).length
  return { dist: rollup(rows), totalAds: rows.length, activeAds: active, found: rows.length > 0 }
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

// ── Orchestrator with R2 cache (no migration needed). Keyed by the competitor set + own page. ──
const cacheKey = (pageIds: string[], ownPage: string | null) =>
  `dna-reports/${createHash('sha256').update([...pageIds].sort().join(',') + '|' + (ownPage || '')).digest('hex').slice(0, 24)}.json`

export type FullDnaResult = { winners: WinnerDna; own: OwnDna; gaps: Gap[]; report: DnaReport; score: Score; cached: boolean }

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

  const [winners, own] = await Promise.all([winnerDna(competitorPageIds, niche), ownDna(ownPageId)])
  const gaps = dnaDiff(own, winners)
  const report = await synthesize({ brandName, niche, own, winners, gaps })
  const score = scoreDna(own, winners, gaps)
  const result: FullDnaResult = { winners, own, gaps, report, score, cached: false }

  try { await uploadBufferToR2(Buffer.from(JSON.stringify(result)), key, 'application/json') } catch { /* cache best-effort */ }
  return result
}
