/**
 * GEO Visibility Monitor — the Phase-A engine. For a brand's target buyer questions, ask each available
 * AI engine and record whether the brand (and which rivals) got cited. Roll it up into a share-of-voice
 * score + the answer gaps to fix. Everything is REALLY checked and stored with the answer excerpt — never
 * asserted. Runs are user-triggered (metered cost); a full sweep = prompts × available engines calls.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { availableEngines, askEngine, ENGINE_LABEL, ENGINE_COST, estimateCost, type GeoEngine } from './engines'
import { fold } from '@/lib/mello/own-brand'

export type PromptResult = {
  promptId: string | null
  prompt: string
  engines: { engine: GeoEngine; label: string; cited: boolean; grounded: boolean; competitorsCited: string[]; excerpt: string }[]
  youCited: boolean            // cited in at least one engine
  rivalsCited: number          // distinct rivals cited across engines
}
export type GeoStatus = {
  hasData: boolean
  brandName: string | null
  score: number                // 0-100 (share of voice)
  shareOfVoice: number         // 0..1
  promptsChecked: number
  engines: { engine: GeoEngine; label: string }[]
  availableEngines: { engine: GeoEngine; label: string }[]
  results: PromptResult[]
  gaps: { prompt: string; rivals: string[] }[]
  history: { date: string; score: number }[]
  lastRun: string | null
  lastRunCalls?: number      // engine calls made in the last sweep
  estCostUsd?: number        // ~cost of the last sweep (estimate)
  perCheckEstUsd?: number    // ~cost of running a check now (available engines × prompt count)
  note?: string
}

const DEFAULT_PROMPTS = (niche: string) => [
  `What is the best ${niche}?`,
  `What are the best alternatives for ${niche}?`,
  `How do I choose a ${niche}?`,
  `What is the most recommended ${niche} brand?`,
  `Best ${niche} for beginners?`,
  `What do people recommend for ${niche}?`,
]

/** LLM-derive ~8 category buyer questions (no brand name — questions where we WANT the brand recommended). */
async function derivePrompts(brandName: string, niche: string, competitors: string[]): Promise<string[]> {
  try {
    const { llm } = await import('@/lib/llm')
    const sys = 'You write the exact questions a potential customer types into ChatGPT or Perplexity when researching a purchase — the questions where a brand would love to be recommended. Return ONLY JSON {"prompts":[...]}. Give 8 questions. Mix "best X", "X alternatives", "how to choose X", "X for [use case]". Do NOT include any brand name — these are category questions. Keep them natural and specific to the niche.'
    const user = JSON.stringify({ niche: niche || 'this product category', example_brands: [brandName, ...competitors].filter(Boolean).slice(0, 6) })
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 500, temperature: 0.4, messages: [{ role: 'user', content: `${sys}\n\n${user}` }] })
    const txt = res?.content?.[0]?.text || ''
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
    const prompts = (parsed?.prompts || []).map((p: any) => String(p).trim()).filter(Boolean).slice(0, 8)
    if (prompts.length >= 4) return prompts
  } catch { /* fall back to templates */ }
  return DEFAULT_PROMPTS(niche || 'this product')
}

/** Was the brand cited? Which competitors? — diacritic-insensitive substring match on folded names. */
function detect(text: string, brandName: string, competitors: string[]) {
  const t = fold(text)
  const cited = brandName.length >= 3 && t.includes(fold(brandName))
  const competitorsCited = competitors.filter((c) => c && c.length >= 3 && t.includes(fold(c)))
  return { cited, competitorsCited }
}

async function resolveBrand(admin: SupabaseClient, userId: string, brandId: string | null): Promise<{ brandName: string; niche: string; competitors: string[] } | null> {
  try {
    let b: any = null
    if (brandId) { const { data } = await (admin as any).from('brands').select('name, brand_type').eq('id', brandId).maybeSingle(); b = data }
    if (!b) { const { data } = await (admin as any).from('brands').select('name, brand_type').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(); b = data }
    if (!b?.name) return null
    let cq = (admin as any).from('followed_brands').select('brand_name, brand_id').eq('user_id', userId)
    const { data: cs } = await cq
    const competitors = ((cs || []) as any[])
      .filter((r) => r.brand_name && (!brandId || !r.brand_id || String(r.brand_id) === brandId))
      .map((r) => String(r.brand_name)).filter((n) => n && !/^\d+$/.test(n))
    const niche = b.brand_type && b.brand_type !== 'physical' ? String(b.brand_type) : ''
    return { brandName: String(b.name), niche, competitors: Array.from(new Set(competitors)).slice(0, 12) }
  } catch { return null }
}

/** Run a full sweep: derive/reuse prompts × available engines, record checks, roll up an audit. */
export async function runGeoSweep(admin: SupabaseClient, userId: string, brandId: string | null): Promise<GeoStatus> {
  const engines = availableEngines()
  const brand = await resolveBrand(admin, userId, brandId)
  if (!brand) return emptyStatus(engines, 'Add a brand first so I know who to check for.')
  if (!engines.length) return emptyStatus(engines, 'No AI engine is configured yet — add an OpenAI, Gemini or Perplexity key to run the check.')

  // reuse this brand's active prompts, or derive + store a fresh set
  let prompts: { id: string | null; text: string }[] = []
  try {
    let q = (admin as any).from('geo_prompts').select('id, prompt_text').eq('user_id', userId).eq('active', true)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q.limit(10)
    prompts = ((data || []) as any[]).map((r) => ({ id: String(r.id), text: r.prompt_text }))
  } catch { /* table may be empty */ }
  if (!prompts.length) {
    const derived = await derivePrompts(brand.brandName, brand.niche, brand.competitors)
    for (const text of derived) {
      try { const { data } = await (admin as any).from('geo_prompts').insert({ brand_id: brandId, user_id: userId, prompt_text: text }).select('id').maybeSingle(); prompts.push({ id: data?.id ? String(data.id) : null, text }) }
      catch { prompts.push({ id: null, text }) }
    }
  }

  const results: PromptResult[] = []
  const checkRows: any[] = []
  for (const p of prompts) {
    const per: PromptResult['engines'] = []
    for (const engine of engines) {
      const ans = await askEngine(engine, p.text)
      if (!ans) continue
      const { cited, competitorsCited } = detect(ans.text, brand.brandName, brand.competitors)
      per.push({ engine, label: ENGINE_LABEL[engine], cited, grounded: ans.grounded, competitorsCited, excerpt: (ans.text || '').slice(0, 280) })
      checkRows.push({ brand_id: brandId, user_id: userId, prompt_id: p.id, prompt_text: p.text, engine, cited, grounded: ans.grounded, competitors_cited: competitorsCited, answer_excerpt: (ans.text || '').slice(0, 500) })
    }
    const youCited = per.some((e) => e.cited)
    const rivalsCited = new Set(per.flatMap((e) => e.competitorsCited)).size
    results.push({ promptId: p.id, prompt: p.text, engines: per, youCited, rivalsCited })
  }

  try { if (checkRows.length) await (admin as any).from('geo_checks').insert(checkRows) } catch { /* best-effort persist */ }

  const totalChecks = results.reduce((s, r) => s + r.engines.length, 0)
  const youChecks = results.reduce((s, r) => s + r.engines.filter((e) => e.cited).length, 0)
  const shareOfVoice = totalChecks > 0 ? youChecks / totalChecks : 0
  const score = Math.round(shareOfVoice * 100)
  const gaps = results.filter((r) => !r.youCited && r.rivalsCited > 0).map((r) => ({ prompt: r.prompt, rivals: Array.from(new Set(r.engines.flatMap((e) => e.competitorsCited))).slice(0, 4) }))

  try {
    await (admin as any).from('geo_audit').insert({ brand_id: brandId, user_id: userId, score, share_of_voice: shareOfVoice, prompts_checked: results.length, engines, gaps })
  } catch { /* best-effort */ }

  const history = await loadHistory(admin, userId, brandId)
  const estCostUsd = checkRows.reduce((s, r) => s + (ENGINE_COST[r.engine as GeoEngine] || 0.02), 0)
  return {
    hasData: true, brandName: brand.brandName, score, shareOfVoice, promptsChecked: results.length,
    engines: engines.map((e) => ({ engine: e, label: ENGINE_LABEL[e] })),
    availableEngines: engines.map((e) => ({ engine: e, label: ENGINE_LABEL[e] })),
    results, gaps, history, lastRun: new Date().toISOString(),
    lastRunCalls: checkRows.length, estCostUsd, perCheckEstUsd: estimateCost(engines, results.length || 8),
  }
}

/** Read the latest stored snapshot (no engine calls) for the dashboard. */
export async function loadGeoStatus(admin: SupabaseClient, userId: string, brandId: string | null): Promise<GeoStatus> {
  const engines = availableEngines()
  const brand = await resolveBrand(admin, userId, brandId)
  try {
    let aq = (admin as any).from('geo_audit').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
    if (brandId) aq = aq.eq('brand_id', brandId)
    const { data: audit } = await aq.maybeSingle()
    if (!audit) return emptyStatus(engines, undefined, brand?.brandName || null)

    // hydrate the per-prompt view from the most recent day of checks
    let cq = (admin as any).from('geo_checks').select('prompt_text, engine, cited, grounded, competitors_cited, answer_excerpt, checked_on').eq('user_id', userId).order('created_at', { ascending: false }).limit(120)
    if (brandId) cq = cq.eq('brand_id', brandId)
    const { data: checks } = await cq
    const byPrompt = new Map<string, PromptResult>()
    for (const c of ((checks || []) as any[])) {
      const key = c.prompt_text || ''
      const cur: PromptResult = byPrompt.get(key) || { promptId: null, prompt: key, engines: [], youCited: false, rivalsCited: 0 }
      if (!cur.engines.some((e) => e.engine === c.engine)) {
        cur.engines.push({ engine: c.engine, label: ENGINE_LABEL[c.engine as GeoEngine] || c.engine, cited: !!c.cited, grounded: !!c.grounded, competitorsCited: c.competitors_cited || [], excerpt: (c.answer_excerpt || '').slice(0, 280) })
      }
      byPrompt.set(key, cur)
    }
    const results = Array.from(byPrompt.values()).slice(0, 10).map((r) => ({ ...r, youCited: r.engines.some((e) => e.cited), rivalsCited: new Set(r.engines.flatMap((e) => e.competitorsCited)).size }))
    return {
      hasData: true, brandName: brand?.brandName || null, score: audit.score || 0, shareOfVoice: Number(audit.share_of_voice) || 0,
      promptsChecked: audit.prompts_checked || results.length,
      engines: (audit.engines || []).map((e: GeoEngine) => ({ engine: e, label: ENGINE_LABEL[e] || e })),
      availableEngines: engines.map((e) => ({ engine: e, label: ENGINE_LABEL[e] })),
      results, gaps: audit.gaps || [], history: await loadHistory(admin, userId, brandId), lastRun: audit.created_at,
      lastRunCalls: (audit.prompts_checked || results.length) * ((audit.engines || []).length || engines.length),
      estCostUsd: estimateCost((audit.engines || engines) as GeoEngine[], audit.prompts_checked || results.length),
      perCheckEstUsd: estimateCost(engines, audit.prompts_checked || 8),
    }
  } catch { return emptyStatus(engines, undefined, brand?.brandName || null) }
}

async function loadHistory(admin: SupabaseClient, userId: string, brandId: string | null): Promise<{ date: string; score: number }[]> {
  try {
    let q = (admin as any).from('geo_audit').select('score, created_at').eq('user_id', userId).order('created_at', { ascending: true }).limit(30)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q
    return ((data || []) as any[]).map((a) => ({ date: String(a.created_at).slice(0, 10), score: a.score || 0 }))
  } catch { return [] }
}

function emptyStatus(engines: GeoEngine[], note?: string, brandName: string | null = null): GeoStatus {
  return {
    hasData: false, brandName, score: 0, shareOfVoice: 0, promptsChecked: 0,
    engines: [], availableEngines: engines.map((e) => ({ engine: e, label: ENGINE_LABEL[e] })),
    results: [], gaps: [], history: [], lastRun: null, perCheckEstUsd: estimateCost(engines, 8), note,
  }
}
