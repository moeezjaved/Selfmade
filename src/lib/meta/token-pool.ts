/**
 * Indexer token pool.
 *
 * Maintains a rotating pool of Meta user-access tokens so we can index 1000+
 * brands without hitting per-token rate limits (~200 calls/hour). Each Meta
 * account marked `is_indexer_pool=true` contributes its quota; with 5-10
 * pooled accounts we get 1k-2k calls/hour combined.
 *
 * Usage from a route:
 *   const pool = await loadTokenPool(admin)
 *   const token = pool.next()
 *   if (!token) throw new Error('All tokens cooling')
 *   const res = await fetchMeta(token.token, ...)
 *   if (res.error?.includes('#613')) await pool.markCool(token.id)
 *   else await pool.markUsed(token.id)
 *
 * On a 613 the token is parked for 65 minutes (Meta's documented window) and
 * the next call to pool.next() returns a different one. If every token is
 * cooling, .next() returns null and the caller should abort cleanly.
 */
import { decryptToken } from './client'

export interface PoolToken {
  id: string
  token: string
  lastUsedAt: string | null
  cooldownUntil: string | null
}

export interface TokenPool {
  /** Total accounts in pool (regardless of cooldown). */
  size: number
  /** Number currently in cooldown. */
  cooling: number
  /** Pick the next available token by oldest last_used_at. Null if all cool. */
  next(): PoolToken | null
  /** Mark a token used right now (updates last_used_at + counters). */
  markUsed(id: string): Promise<void>
  /** Park a token in cooldown for the next 65 minutes. */
  markCool(id: string, reason?: string): Promise<void>
}

const COOLDOWN_MINUTES = 65   // Meta's rate-limit window is ~60 min; add 5 min buffer.

/**
 * Load all pool-eligible tokens into memory for this request. The route
 * picks tokens via in-memory rotation; mark-used/mark-cool persist to DB.
 *
 * Why in-memory: a single cron run might rotate 50+ times — doing 50 SELECT
 * round trips would be slow. Better to snapshot once and update on writes.
 */
export async function loadTokenPool(admin: any): Promise<TokenPool> {
  const { data: rows } = await admin
    .from('meta_accounts')
    .select('id, access_token, last_used_at, cooldown_until')
    .eq('is_indexer_pool', true)
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
      lastUsedAt: r.last_used_at,
      cooldownUntil: r.cooldown_until,
    })
  }

  // Track in-memory cooldowns set during THIS run (so we don't keep handing
  // back a token we just marked cool inside the same loop).
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
      // Just update last_used_at — counters incremented in batches by /admin/tokens
      // page on demand (last_used_at is the only field the picker reads).
      await admin
        .from('meta_accounts')
        .update({ last_used_at: nowIso })
        .eq('id', id)
    },
    async markCool(id: string, reason = 'rate_limit') {
      const until = new Date(Date.now() + COOLDOWN_MINUTES * 60_000).toISOString()
      localCooling.set(id, Date.now() + COOLDOWN_MINUTES * 60_000)
      const t = tokens.find(x => x.id === id)
      if (t) t.cooldownUntil = until
      cooling++
      await admin
        .from('meta_accounts')
        .update({ cooldown_until: until })
        .eq('id', id)
      console.warn(`[token-pool] Token ${id} cooling until ${until} (${reason})`)
    },
  }
}

/**
 * Legacy fallback for routes that haven't been migrated to the pool yet.
 * Returns the first pool token (or undefined if pool empty).
 *
 * New code should use loadTokenPool() instead so it can rotate on 613.
 */
export async function getAnyPoolToken(admin: any): Promise<string | undefined> {
  const pool = await loadTokenPool(admin)
  return pool.next()?.token
}
