/**
 * SEO Keyword & Content brain (SEO Phase 2). Discovers the real searches the brand's buyers type, clusters
 * them by topic + intent, and writes a content brief for any of them.
 *
 * DEPENDENCY-LIGHT: keyword discovery uses Google Autocomplete (free, no key) — the ACTUAL queries people
 * type, expanded from the brand's category + buyer terms + products. Clustering + intent + briefs are one
 * LLM call each. Volumes/difficulty need a paid API (DataForSEO/Serper) — added later; until then keywords
 * are real but unscored (labelled as such), never invented numbers.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describeBrand } from '@/lib/geo/understand'

export type KwCluster = { label: string; intent: string; keywords: string[]; why: string }
export type KwResult = { hasData: boolean; clusters: KwCluster[]; total: number; note?: string; scored: boolean }
export type Brief = { id: string | null; keyword: string; title: string; body_markdown: string; status: string }

const UA = 'Selfmade-SEO/1.0 (+https://tryselfmade.ai)'

// Google Autocomplete — real related searches for a query. Free, no key.
async function autocomplete(q: string): Promise<string[]> {
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(6000) })
    const j: any = await r.json()
    return Array.isArray(j?.[1]) ? j[1].map((s: any) => String(s).trim()).filter(Boolean) : []
  } catch { return [] }
}

function seedQueries(category: string, buyerTerms: string[]): string[] {
  const base = Array.from(new Set([category, ...buyerTerms].map((s) => String(s || '').trim().toLowerCase()).filter((s) => s.length >= 3))).slice(0, 5)
  const out: string[] = []
  for (const s of base) {
    out.push(s, `best ${s}`, `${s} for`, `${s} vs`, `how to ${s}`, `${s} alternatives`, `${s} reviews`)
  }
  return Array.from(new Set(out)).slice(0, 18)   // cap the number of autocomplete calls
}

async function clusterKeywords(keywords: string[], brand: string, category: string): Promise<KwCluster[]> {
  try {
    const { llm } = await import('@/lib/llm')
    const sys = `Group these real search queries for a ${category} brand into 4-7 topic clusters a content team would target. For each cluster give: a short label, the dominant search INTENT (informational | commercial | transactional), the queries in it, and one line on why it's worth targeting. Drop irrelevant/off-topic queries. Return ONLY JSON {"clusters":[{"label","intent","keywords":[...],"why"}]}.`
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1200, temperature: 0.3, messages: [{ role: 'user', content: `${sys}\n\nQUERIES:\n${JSON.stringify(keywords.slice(0, 80))}` }] })
    const txt = res?.content?.[0]?.text || ''
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
    return (parsed?.clusters || []).map((c: any) => ({ label: String(c.label || 'Topic'), intent: String(c.intent || 'informational'), keywords: (c.keywords || []).map((k: any) => String(k)).slice(0, 12), why: String(c.why || '') })).filter((c: KwCluster) => c.keywords.length)
  } catch { return [] }
}

export async function runKeywordResearch(admin: SupabaseClient, userId: string, brandId: string | null): Promise<KwResult> {
  const u = await describeBrand(admin, userId, brandId)
  if (!u) return { hasData: false, clusters: [], total: 0, scored: false, note: 'Add a brand first.' }
  const category = u.category || 'this product'

  const seeds = seedQueries(category, u.buyerTerms || [])
  const found = new Set<string>()
  for (const s of seeds) { for (const kw of await autocomplete(s)) found.add(kw.toLowerCase()) }
  const keywords = Array.from(found).slice(0, 120)
  if (!keywords.length) return { hasData: false, clusters: [], total: 0, scored: false, note: 'Couldn’t pull keyword suggestions just now — try again.' }

  const clusters = await clusterKeywords(keywords, u.brandName, category)

  // persist (dedupe by keyword) — real keywords, volume/difficulty null until a paid API is added
  try {
    if (brandId) { let del = (admin as any).from('seo_keywords').delete().eq('user_id', userId); del = del.eq('brand_id', brandId); await del }
    const rows = clusters.flatMap((c) => c.keywords.map((k) => ({ brand_id: brandId, user_id: userId, keyword: k, intent: c.intent, cluster: c.label, source: 'autocomplete' })))
    if (rows.length) await (admin as any).from('seo_keywords').insert(rows.slice(0, 200))
  } catch { /* best-effort */ }

  return { hasData: true, clusters, total: clusters.reduce((s, c) => s + c.keywords.length, 0), scored: false }
}

export async function loadKeywords(admin: SupabaseClient, userId: string, brandId: string | null): Promise<KwResult> {
  try {
    let q = (admin as any).from('seo_keywords').select('keyword, intent, cluster').eq('user_id', userId).limit(200)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q
    const rows = (data || []) as any[]
    if (!rows.length) return { hasData: false, clusters: [], total: 0, scored: false }
    const byCluster = new Map<string, KwCluster>()
    for (const r of rows) {
      const label = r.cluster || 'Topic'
      const cur: KwCluster = byCluster.get(label) || { label, intent: r.intent || 'informational', keywords: [], why: '' }
      if (!cur.keywords.includes(r.keyword)) cur.keywords.push(r.keyword)
      byCluster.set(label, cur)
    }
    const clusters = Array.from(byCluster.values())
    return { hasData: true, clusters, total: rows.length, scored: false }
  } catch { return { hasData: false, clusters: [], total: 0, scored: false } }
}

export async function generateBrief(admin: SupabaseClient, userId: string, brandId: string | null, keyword: string): Promise<Brief> {
  const u = await describeBrand(admin, userId, brandId)
  const brand = u?.brandName || 'the brand'
  const category = u?.category || 'this product'
  let title = keyword, body = ''
  try {
    const { llm } = await import('@/lib/llm')
    const sys = `Write a CONTENT BRIEF an SEO writer can execute to rank ${brand} (a ${category} brand) for the target keyword. Clean Markdown: the working title, the search intent, a recommended H2/H3 outline, the key points + questions the page must answer, entities/terms to include, a suggested word count, and 2-3 internal-link ideas. Practical and specific. Do NOT write the full article — just the brief. Do NOT invent stats.`
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1100, temperature: 0.4, messages: [{ role: 'user', content: `${sys}\n\nTARGET KEYWORD: "${keyword}"` }] })
    const txt = res?.content?.[0]?.text || ''
    if (txt.trim()) { body = txt.trim(); const h = /^#\s*(.+)/m.exec(body); if (h) title = h[1].trim().slice(0, 160) }
  } catch { /* fall through */ }
  const status = body ? 'draft' : 'failed'
  let id: string | null = null
  try {
    const { data } = await (admin as any).from('seo_pages').insert({ brand_id: brandId, user_id: userId, kind: 'brief', title, target_keyword: keyword, body_markdown: body, status }).select('id').maybeSingle()
    id = data?.id ? String(data.id) : null
  } catch { /* best-effort */ }
  return { id, keyword, title, body_markdown: body, status }
}

export async function listBriefs(admin: SupabaseClient, userId: string, brandId: string | null): Promise<Brief[]> {
  try {
    let q = (admin as any).from('seo_pages').select('id, target_keyword, title, body_markdown, status').eq('user_id', userId).eq('kind', 'brief').order('created_at', { ascending: false }).limit(20)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q
    return ((data || []) as any[]).map((p) => ({ id: String(p.id), keyword: p.target_keyword || '', title: p.title || p.target_keyword || 'Brief', body_markdown: p.body_markdown || '', status: p.status || 'draft' }))
  } catch { return [] }
}
