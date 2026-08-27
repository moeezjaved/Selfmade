/**
 * GEO Answer Content agent (Phase B) — writes the page an AI answer engine will CITE for a buyer question
 * the brand is currently missing. GEO-optimized structure: a direct answer first (LLMs lift the first clear
 * answer), an honest why, a fair comparison vs the rivals who currently win it, quotable bullets, a short FAQ.
 *
 * DRAFT-FIRST + HONEST: stores a draft in geo_assets; the founder reviews/edits before anything publishes.
 * The prompt forbids invented stats/claims. Publishing to the Shopify blog is a later step (needs OAuth) —
 * this fills body_markdown; shopify_article_id/published_url stay null until then.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveBrand } from './monitor'

export type GeoAsset = { id: string | null; kind: string; title: string; target_prompt: string; body_markdown: string; status: string; published_url: string | null; created_at?: string }

export async function writeAnswerPage(
  admin: SupabaseClient, userId: string, brandId: string | null, opts: { prompt: string; rivals?: string[] },
): Promise<GeoAsset> {
  const prompt = String(opts.prompt || '').trim()
  const brand = await resolveBrand(admin, userId, brandId)
  const brandName = brand?.brandName || 'the brand'
  const rivals = (opts.rivals && opts.rivals.length ? opts.rivals : brand?.competitors || []).slice(0, 5)

  const sys = `You are a GEO (Generative Engine Optimization) content writer. You write the web page that AI answer engines like ChatGPT and Perplexity will CITE when someone asks the buyer question. Rules:
- OPEN with a direct, quotable one-sentence answer to the question (engines lift the first clear answer).
- Then: why ${brandName} is a strong answer — honest, specific, benefit-led.
- A short, FAIR comparison of where ${brandName} fits vs the alternatives (${rivals.join(', ') || 'the main options'}) — never trash them; acknowledge what each is good for.
- 3 quotable, scannable bullet points.
- A short FAQ (3 questions and clear answers).
- HARD RULE: do NOT invent specific statistics, prices, study results, or claims you cannot support. Where a precise number would be needed, speak generally and truthfully. It is better to be accurate than impressive.
Return ONLY JSON: {"title":"…","markdown":"# …"} — clean Markdown, ~500–750 words.`

  const user = JSON.stringify({ buyer_question: prompt, brand: brandName, niche: brand?.niche || undefined, alternatives_currently_cited: rivals })

  let title = prompt || 'Answer page'
  let markdown = ''
  try {
    const { llm } = await import('@/lib/llm')
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1800, temperature: 0.5, messages: [{ role: 'user', content: `${sys}\n\n${user}` }] })
    const txt = res?.content?.[0]?.text || ''
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
    if (parsed?.title) title = String(parsed.title).slice(0, 160)
    if (parsed?.markdown) markdown = String(parsed.markdown)
  } catch { /* fall through — empty markdown becomes a failed draft */ }

  const status = markdown ? 'draft' : 'failed'
  let id: string | null = null
  try {
    const { data } = await (admin as any).from('geo_assets').insert({
      brand_id: brandId, user_id: userId, kind: 'answer_page', title, target_prompt: prompt, body_markdown: markdown, status,
    }).select('id, created_at').maybeSingle()
    id = data?.id ? String(data.id) : null
  } catch { /* best-effort persist */ }

  return { id, kind: 'answer_page', title, target_prompt: prompt, body_markdown: markdown, status, published_url: null }
}

/** Minimal, dependency-free Markdown → HTML for GEO answer pages (headings, bold/italic, links, lists,
 *  paragraphs) — enough for the clean Markdown writeAnswerPage produces. Publishing needs HTML, not MD. */
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  const out: string[] = []
  let inUl = false, inOl = false
  const closeLists = () => { if (inUl) { out.push('</ul>'); inUl = false } if (inOl) { out.push('</ol>'); inOl = false } }
  for (const raw of String(md || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { closeLists(); continue }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { closeLists(); const n = Math.min(h[1].length, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line)
    if (ul) { if (!inUl) { closeLists(); out.push('<ul>'); inUl = true } out.push(`<li>${inline(ul[1])}</li>`); continue }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line)
    if (ol) { if (!inOl) { closeLists(); out.push('<ol>'); inOl = true } out.push(`<li>${inline(ol[1])}</li>`); continue }
    closeLists(); out.push(`<p>${inline(line)}</p>`)
  }
  closeLists()
  return out.join('\n')
}

export async function listAnswerPages(admin: SupabaseClient, userId: string, brandId: string | null): Promise<GeoAsset[]> {
  try {
    let q = (admin as any).from('geo_assets').select('id, kind, title, target_prompt, body_markdown, status, published_url, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(30)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q
    return ((data || []) as any[]).map((a) => ({ id: String(a.id), kind: a.kind, title: a.title || a.target_prompt || 'Answer page', target_prompt: a.target_prompt || '', body_markdown: a.body_markdown || '', status: a.status || 'draft', published_url: a.published_url || null, created_at: a.created_at }))
  } catch { return [] }
}
