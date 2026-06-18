/**
 * Shared proxy fetch helper for routes that hit Meta from Vercel.
 *
 * IMPLEMENTATION: Uses undici.fetch with undici.ProxyAgent. We tried
 * https-proxy-agent first but Vercels Edge runtime occasionally has issues
 * with native http.Agent integration. undici is what Next.js uses internally
 * for fetch on Vercel, so it's the most compatible.
 *
 * Auto-rotating: each fetch() call uses IPRoyal's plain rotating endpoint,
 * which assigns a different residential IP per request. Different from the
 * worker (which sticks one IP per ad context) — for stateless API calls,
 * rotating is the right pattern.
 *
 * Falls back to direct fetch if env vars aren't set, so local dev still works.
 *
 * Env vars:
 *   META_PROXY_HOST   = geo.iproyal.com
 *   META_PROXY_PORT   = 12321
 *   META_PROXY_USER   = ...
 *   META_PROXY_PASS   = ...
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

  // ProxyAgent constructor accepts a string URL (with embedded auth) OR options.
  // String form is the most compatible across undici versions. Encode credentials
  // to handle any special chars cleanly.
  const proxyUrl = `http://${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@${HOST}:${PORT}`
  _agent = new ProxyAgent(proxyUrl)
  return _agent
}

/**
 * Drop-in fetch replacement that routes through IPRoyal residential when
 * env vars are set, falls back to direct fetch otherwise.
 */
export async function proxyFetch(url: string, init?: any): Promise<Response> {
  const agent = getAgent()
  if (!agent) {
    return fetch(url, init)
  }

  try {
    const res = await undiciFetch(url, { ...init, dispatcher: agent } as any)
    return res as unknown as Response
  } catch (err: any) {
    // Diagnostic logging — surfaces underlying error code to Vercel logs.
    // err.cause is where undici stuffs the real socket-level error.
    const code = err?.code || err?.cause?.code || 'UNKNOWN'
    const msg = err?.message || err?.cause?.message || String(err)
    console.error(`[proxyFetch] FAILED url=${url.split('?')[0]} code=${code} msg=${msg.slice(0, 200)}`)
    if (err?.cause) {
      console.error(`[proxyFetch] cause:`, err.cause)
    }
    throw err
  }
}
