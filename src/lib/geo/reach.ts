/**
 * GEO Off-site Reach (Phase C, cluster 5) — the "get mentioned where buyers actually ask" agent.
 * Inspired by agent-reach's capability-layer idea: a multi-source finder with fallbacks. It FINDS real
 * discussions (Reddit now; Exa semantic search across Quora/forums/blogs when a key exists), READS the
 * thread (Jina Reader — free, no key), and DRAFTS a genuinely-helpful reply that earns the brand a mention.
 *
 * HONESTY IS NON-NEGOTIABLE: draft-only (the founder reviews + posts themselves — we never auto-post),
 * never fake reviews / astroturf, and the draft prompt is told to SKIP rather than write spam if the brand
 * doesn't truly fit. Each draft is stored as a geo_assets row (kind 'offsite').
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describeBrand } from './understand'

export type ReachSource = 'reddit' | 'exa'
export type Thread = { source: ReachSource; title: string; url: string; snippet: string; score?: number }
export type ReachItem = { source: string; title: string; url: string; snippet: string; reply: string }

export function reachSources(): ReachSource[] {
  const s: ReachSource[] = ['reddit']            // public JSON, no key
  if (process.env.EXA_API_KEY) s.push('exa')     // semantic web search — the best finder, when configured
  return s
}

const UA = 'Selfmade-GEO/1.0 (+https://tryselfmade.ai)'

async function searchReddit(query: string): Promise<Thread[]> {
  try {
    const r = await fetch(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=8&type=link`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(9000) })
    const j: any = await r.json()
    return ((j?.data?.children || []) as any[]).map((c) => ({ source: 'reddit' as const, title: c?.data?.title || '', url: c?.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : (c?.data?.url || ''), snippet: String(c?.data?.selftext || '').slice(0, 300), score: c?.data?.score })).filter((t) => t.title && t.url)
  } catch { return [] }
}

async function searchExa(query: string): Promise<Thread[]> {
  try {
    const r = await fetch('https://api.exa.ai/search', {
      method: 'POST', headers: { 'x-api-key': process.env.EXA_API_KEY || '', 'content-type': 'application/json' },
      body: JSON.stringify({ query, numResults: 8, type: 'auto', contents: { text: { maxCharacters: 400 } } }), signal: AbortSignal.timeout(12000),
    })
    const j: any = await r.json()
    return ((j?.results || []) as any[]).map((x) => ({ source: 'exa' as const, title: x?.title || '', url: x?.url || '', snippet: String(x?.text || '').slice(0, 300) })).filter((t) => t.title && t.url)
  } catch { return [] }
}

// Read a page's readable content via Jina Reader (free, handles JS-heavy pages). Falls back to '' on error.
async function readThread(url: string): Promise<string> {
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { 'user-agent': UA, 'x-return-format': 'text' }, signal: AbortSignal.timeout(12000) })
    return (await r.text()).replace(/\s+/g, ' ').trim().slice(0, 6000)
  } catch { return '' }
}

async function draftReply(thread: Thread, content: string, brand: string, category: string): Promise<string> {
  try {
    const { llm } = await import('@/lib/llm')
    const sys = `You draft a reply the FOUNDER of ${brand} will PERSONALLY review and post to a real ${thread.source === 'reddit' ? 'Reddit' : 'online'} discussion. Non-negotiable rules:
- Be GENUINELY helpful FIRST — actually answer the person's question well. Communities downvote/delete promo; you have to earn any mention.
- Mention ${brand} ONLY if it truly fits the question, and disclose honestly ("full disclosure, I work on ${brand}"). Never pose as a neutral stranger hiding an affiliation.
- NO fake claims, NO fake reviews, NO astroturfing. If mentioning ${brand} here would be spammy or forced, reply with exactly "SKIP" and nothing else.
- Match the platform's tone; be concise and real.
${brand} is a ${category} brand. Return only the reply text, or "SKIP".`
    const user = `THREAD: ${thread.title}\n\nCONTENT:\n${content.slice(0, 3500)}`
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 500, temperature: 0.6, messages: [{ role: 'user', content: `${sys}\n\n${user}` }] })
    const txt = String(res?.content?.[0]?.text || '').trim()
    return /^skip\b/i.test(txt) ? '' : txt
  } catch { return '' }
}

export async function runReach(admin: SupabaseClient, userId: string, brandId: string | null): Promise<{ items: ReachItem[]; sources: string[]; note?: string }> {
  const sources = reachSources()
  const u = await describeBrand(admin, userId, brandId)
  if (!u) return { items: [], sources, note: 'Add a brand first.' }
  const brand = u.brandName, category = u.category || 'this product'

  // queries: the category + the strongest buyer terms (the questions where a mention would help)
  const queries = Array.from(new Set([category, ...(u.buyerTerms || [])].map((q) => String(q || '').trim()).filter(Boolean))).slice(0, 3)

  // FIND across sources (fallback-friendly: whatever's configured)
  const found: Thread[] = []
  for (const q of queries) {
    for (const src of sources) {
      const hits = src === 'reddit' ? await searchReddit(q) : await searchExa(q)
      found.push(...hits)
    }
  }
  // dedupe by url, prefer higher score, cap to keep cost sane
  const seen = new Set<string>()
  const threads = found.filter((t) => { const k = t.url.split('?')[0]; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6)
  if (!threads.length) return { items: [], sources, note: 'No relevant discussions found yet — try again, or add an Exa key to search Quora/forums too.' }

  // READ + DRAFT (only keep the ones where a genuine, non-spammy reply makes sense)
  const items: ReachItem[] = []
  for (const t of threads) {
    const content = await readThread(t.url)
    const reply = await draftReply(t, content || t.snippet, brand, category)
    if (!reply) continue
    items.push({ source: t.source, title: t.title, url: t.url, snippet: t.snippet, reply })
    try { await (admin as any).from('geo_assets').insert({ brand_id: brandId, user_id: userId, kind: 'offsite', title: t.title, target_prompt: t.url, body_markdown: reply, status: 'draft' }) } catch { /* best-effort */ }
    if (items.length >= 4) break   // a focused, high-quality few beats a spammy many
  }
  return { items, sources, note: items.length ? undefined : 'Found discussions, but none where a mention would be genuinely helpful — that’s the honest call.' }
}
