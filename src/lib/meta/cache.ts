/**
 * Tiny in-process TTL cache for Meta Graph results. The brief card, opportunities card, and Reports
 * all re-fetch live on every load / account switch — times 7 accounts, that blows the app's Graph
 * rate limit (Meta error 17, "too many calls from this app"). Caching per (user, account, range) for
 * a few minutes collapses the redundant re-fetches without making the data meaningfully stale.
 *
 * In-process (per serverless instance) is intentional: it needs no migration, and Vercel keeps
 * instances warm long enough that back-to-back requests (brief → opportunities → account switch) share
 * one instance and hit the cache. Durable cross-instance caching can come later if needed.
 */
type Entry = { v: any; exp: number }
const store = new Map<string, Entry>()

export function cacheGet<T = any>(key: string): T | null {
  const e = store.get(key)
  if (e && e.exp > Date.now()) return e.v as T
  if (e) store.delete(key)
  return null
}

export function cacheSet(key: string, v: any, ttlMs: number) {
  store.set(key, { v, exp: Date.now() + ttlMs })
  if (store.size > 800) { const now = Date.now(); store.forEach((e, k) => { if (e.exp < now) store.delete(k) }) }
}

/** Drop everything under a prefix — e.g. after an action changes an account, so the next read is fresh. */
export function cacheInvalidate(prefix: string) {
  Array.from(store.keys()).forEach((k) => { if (k.startsWith(prefix)) store.delete(k) })
}
