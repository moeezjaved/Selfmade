/**
 * Mello persistent memory — the notebook (facts/rules/preferences/goals/scars Mello learns about a
 * business), carried across every conversation. Read at the start of each agent turn (injected into
 * the system prompt) and written via the `remember` tool + the hiring interview.
 *
 * mig 110/111 deepen it: each memory now carries category + confidence and a pgvector embedding, so
 * we can recall by MEANING ("what did I say about discounts") not just recency. All best-effort:
 * memory never blocks the chat, and embedding failures just store the row without a vector.
 */
import { createAdminClient } from '@/lib/supabase/server'

export interface Memory { kind: string; content: string; category?: string | null; created_at?: string | null; source?: string | null }

const EMB_MODEL = 'text-embedding-3-small'

/** Embed a short text with OpenAI (1536-dim). Returns null on any failure — callers degrade to
 *  recency-only recall / no-vector storage. */
async function embed(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY
  const input = String(text || '').trim().slice(0, 1000)
  if (!key || !input) return null
  try {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMB_MODEL, input }),
    })
    if (!r.ok) return null
    const j = await r.json()
    const v = j?.data?.[0]?.embedding
    return Array.isArray(v) ? v : null
  } catch { return null }
}

/** Recent memories for a user (most recent first — the always-on context block). */
export async function getMemories(userId: string, limit = 40): Promise<Memory[]> {
  try {
    const admin = createAdminClient() as any
    const { data } = await admin.from('mello_memory')
      .select('kind, content, category, created_at, source').eq('user_id', userId).is('retired_at', null)
      .order('created_at', { ascending: false }).limit(limit)
    return (data || []) as Memory[]
  } catch { return [] }
}

/** Semantic recall — the memories most RELEVANT to a query (cosine over embeddings). Falls back to
 *  [] if embeddings/RPC are unavailable; pair with getMemories so the agent always has context. */
export async function recallMemories(userId: string, query: string, limit = 8): Promise<Memory[]> {
  try {
    const vec = await embed(query)
    if (!vec) return []
    const admin = createAdminClient() as any
    const { data } = await admin.rpc('match_mello_memory', { p_user: userId, p_embedding: vec, p_limit: limit })
    return (data || []).map((r: any) => ({ kind: r.kind, content: r.content, category: r.category, created_at: r.created_at, source: r.source })) as Memory[]
  } catch { return [] }
}

/** Store a fact Mello learned. Idempotent on (user_id, content). Embeds for semantic recall. */
export async function addMemory(
  userId: string,
  content: string,
  kind = 'fact',
  opts: { category?: string; confidence?: number; brandId?: string | null; source?: string } = {},
): Promise<void> {
  const c = String(content || '').trim().slice(0, 400)
  if (!c) return
  try {
    const admin = createAdminClient() as any
    const vec = await embed(c)
    const row: any = { user_id: userId, kind, content: c, source: opts.source || 'chat' }
    if (opts.category) row.category = opts.category
    if (typeof opts.confidence === 'number') row.confidence = Math.max(0, Math.min(100, Math.round(opts.confidence)))
    if (opts.brandId) row.brand_id = opts.brandId
    if (vec) row.embedding = vec
    await admin.from('mello_memory').upsert(row, { onConflict: 'user_id,content', ignoreDuplicates: false })
  } catch { /* best-effort */ }
}

/** Render memories as a compact system-prompt block, each stamped with WHEN and HOW it was learned so
 *  Mello can cite it ("as you told me on Jul 2" / "you decided this on…") — the day-30 trust device. */
export function renderMemories(mem: Memory[]): string {
  if (!mem.length) return '  (nothing remembered yet — use the `remember` tool when the user shares durable facts about their business, goals, or preferences)'
  const when = (iso?: string | null) => {
    if (!iso) return ''
    try { return `, learned ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` } catch { return '' }
  }
  const how = (s?: string | null) => s && s !== 'chat' ? ` via ${s === 'interview' ? 'the hiring interview' : s}` : ''
  return mem.map(m => `  - [${m.category || m.kind}${when(m.created_at)}${how(m.source)}] ${m.content}`).join('\n')
}
