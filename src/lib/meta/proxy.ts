/**
 * Shared proxy fetch helper for routes that hit Meta from Vercel.
 *
 * Why: Vercel's egress IPs get rate-limited / IP-blocked by Meta the same way
 * our droplet did. Routing every Meta call through IPRoyal residential
 * distributes traffic across the 32M-IP pool so no single IP accumulates
 * enough volume to flag.
 *
 * Auto-rotating: each fetch() call uses IPRoyal's plain rotating endpoint,
 * which assigns a different residential IP per request. Different from the
 * worker (which sticks one IP per ad context) — for stateless API calls,
 * rotating is the right pattern.
 *
 * Falls back to direct fetch if env vars aren't set, so local dev still works.
 *
 * Env vars (set on Vercel + droplet for parity):
 *   META_PROXY_HOST   = geo.iproyal.com
 *   META_PROXY_PORT   = 12321
 *   META_PROXY_USER   = ...
 *   META_PROXY_PASS   = ...
 *   META_PROXY_COUNTRY = us  (optional, used in IPRoyal username modifier)
 *
 * Note: keep META_PROXY_* separate from WORKER_PROXY_* so we can tune them
 * independently — different rate limits, different per-request retry policies.
 */
import { fetch as undiciFetch, ProxyAgent } from 'undici'

const HOST = process.env.META_PROXY_HOST || ''
const PORT = process.env.META_PROXY_PORT || '12321'
const USER = process.env.META_PROXY_USER || ''
const PASS = process.env.META_PROXY_PASS || ''

export const metaProxyEnabled = !!(HOST && USER && PASS)

let _agent: ProxyAgent | undefined
function getAgent(): ProxyAgent | undefined {
  if (!metaProxyEnabled) return undefined
  if (_agent) return _agent
  // Use explicit token option instead of URL-embedded auth. Special chars in
  // IPRoyal passwords (e.g. uppercase/lowercase mix, digits) sometimes don't
  // survive undicis URL parser cleanly, even with encodeURIComponent. The
  // `token` option bypasses URL parsing entirely — it goes straight into the
  // Proxy-Authorization header as Basic auth.
  const basicAuth = Buffer.from(`${USER}:${PASS}`).toString('base64')
  _agent = new ProxyAgent({
    uri: `http://${HOST}:${PORT}`,
    token: `Basic ${basicAuth}`,
    requestTls: { rejectUnauthorized: false },
  } as any)
  return _agent
}

/**
 * Drop-in fetch replacement that routes through IPRoyal residential when
 * env vars are set, falls back to direct fetch otherwise.
 *
 * Returns the same Response shape as global fetch, so existing callers
 * that do `await res.json()` etc. work unchanged.
 *
 * On proxy errors, logs the error with context so we can diagnose without
 * leaking the full error to the user.
 */
export async function proxyFetch(url: string, init?: any): Promise<Response> {
  const agent = getAgent()
  if (!agent) {
    // No proxy configured — direct fetch (local dev / fallback)
    return fetch(url, init)
  }
  try {
    const res = await undiciFetch(url, { ...init, dispatcher: agent } as any)
    return res as unknown as Response
  } catch (err: any) {
    // Diagnostic: log proxy errors so we can see what's failing in Vercel logs
    console.error(`[proxyFetch] failed for ${url.split('?')[0]}:`, err?.code, err?.message)
    throw err
  }
}
