/**
 * Indexer token pool — backed by the dedicated `indexer_tokens` table.
 *
 * ARCHITECTURAL ISOLATION: This pool intentionally does NOT touch
 * meta_accounts (which holds end-user OAuth tokens). The crawler/indexer
 * infrastructure is fully separate from the SaaS user data plane.
 *
 * Tokens are added manually by admin (paste from Facebook Graph API Explorer)
 * — no OAuth flow, no user signup, no shared state.
 *
 * Usage from a route:
 *   const pool = await loadTokenPool(admin)
 *   const token = pool.next()
 *   if (!token) throw new Error('All tokens cooling — abort')
 *   ... fetch with token.token ...
 *   if (rateLimitError) await pool.markCool(token.id)
 *   else await pool.markUsed(token.id)
 *
 * On a 613 the token is parked for 65 minutes (Meta's documented cooldown
 * window) and the next call to pool.next() returns a different one. If every
 * token is cooling, .next() returns null and the caller should abort cleanly.
 */
import { decryptToken } from './client'

export interface PoolToken {
  id: string
  token: string
  label: string
  lastUsedAt: string | null
  cooldownUntil: string | null
}

export interface TokenPool {
  /** Total active tokens in pool (excludes is_active=false). */
  size: number
  /** Number currently in cooldown. */
  cooling: number
  /** Pick the next available token by oldest last_used_at. Null if all cool. */
  next(): PoolToken | null
  /** Mark a token used right now (updates last_used_at). */
  markUsed(id: string): Promise<void>
  /** Park a token in cooldown for the next 65 minutes. */
  markCool(id: string, reason?: string): Promise<void>
}

const COOLDOWN_MINUTES = 65   // Meta's rate-limit window is ~60 min; add 5 min buffer.

/**
 * Load all active tokens into memory for this request. The route picks
 * tokens via in-memory rotation; mark-used/mark-cool persist to DB.
 */
export async function loadTokenPool(admin: any): Promise<TokenPool> {
  const { data: rows } = await (admin as any)
    .from('indexer_tokens')
    .select('id, label, access_token, last_used_at, cooldown_until')
    .eq('is_active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true })

  const now = Date.now()
  const tokens: PoolToken[] = []
  let cooling = 0

  for (const r of (rows || []) as any[]) {
    let plain = ''
    try { plain = decryptToken(r.access_token) } catch { continue }
    if (!plain) continue
    const cooldownMs = r.cooldown_until ? new Date(r.cooldown_until).getTime() : 0
    if (cooldownMs > now) cooling++
    tokens.push({
      id: r.id,
      token: plain,
      label: r.label,
      lastUsedAt: r.last_used_at,
      cooldownUntil: r.cooldown_until,
    })
  }

  // Track in-memory cooldowns set during THIS run so we don't keep handing
  // back a token we just marked cool inside the same loop.
  const localCooling = new Map<string, number>()

  function pickNext(): PoolToken | null {
    const now = Date.now()
    let best: PoolToken | null = null
    let bestAge = -Infinity
    for (const t of tokens) {
      const localCool = localCooling.get(t.id) ?? 0
      const dbCool = t.cooldownUntil ? new Date(t.cooldownUntil).getTime() : 0
      if (Math.max(localCool, dbCool) > now) continue   // still cooling
      const lastUsed = t.lastUsedAt ? new Date(t.lastUsedAt).getTime() : 0
      const age = now - lastUsed   // higher = older = pick first
      if (age > bestAge) { best = t; bestAge = age }
    }
    return best
  }

  return {
    size: tokens.length,
    cooling,
    next: pickNext,
    async markUsed(id: string) {
      const nowIso = new Date().toISOString()
      const t = tokens.find(x => x.id === id)
      if (t) t.lastUsedAt = nowIso
      await (admin as any)
        .from('indexer_tokens')
        .update({ last_used_at: nowIso })
        .eq('id', id)
    },
    async markCool(id: string, reason = 'rate_limit') {
      const until = new Date(Date.now() + COOLDOWN_MINUTES * 60_000).toISOString()
      localCooling.set(id, Date.now() + COOLDOWN_MINUTES * 60_000)
      const t = tokens.find(x => x.id === id)
      if (t) t.cooldownUntil = until
      cooling++
      await (admin as any)
        .from('indexer_tokens')
        .update({ cooldown_until: until })
        .eq('id', id)
      console.warn(`[token-pool] Token ${id} (${t?.label}) cooling until ${until} (${reason})`)
    },
  }
}
