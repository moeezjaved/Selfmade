/**
 * Local HTTP proxy chain — solves Chromium's ERR_PROXY_AUTH_UNSUPPORTED.
 *
 * Chromium does NOT cleanly handle proxy username modifiers like IPRoyal's
 * sticky-session format (USER_session-XXX_lifetime-1h_country-us). The HTTPS
 * CONNECT handshake fails auth negotiation.
 *
 * Workaround: run a tiny local HTTP proxy on the droplet. Chromium connects
 * to localhost (no auth needed). The local proxy forwards to IPRoyal,
 * injecting the full sticky-session credentials.
 *
 *   Chromium  →  localhost:NNNN  (no auth)
 *                     ↓
 *               proxy-chain
 *                     ↓
 *               IPRoyal:12321  (sticky session USER_session-XXX_lifetime-1h)
 *                     ↓
 *                  Meta
 *
 * Each call to startProxyChain() with a different sessionId returns a
 * unique localhost URL bound to that IPRoyal session — useful for browser
 * pools where each browser has its own dedicated residential IP.
 *
 * Reference: https://github.com/apify/proxy-chain (same library Apify uses)
 */
import { Server, anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain'

const PROXY_HOST = process.env.WORKER_PROXY_HOST || ''
const PROXY_PORT = process.env.WORKER_PROXY_PORT || '12321'
const PROXY_USER = process.env.WORKER_PROXY_USER || ''
const PROXY_PASS = process.env.WORKER_PROXY_PASS || ''

export const proxyChainEnabled = !!(PROXY_HOST && PROXY_USER && PROXY_PASS)

/**
 * Build IPRoyal sticky session PASSWORD (not username — verified via curl tests).
 *
 * IPRoyal expects the session modifiers in the PASSWORD field:
 *   USER:PASS_session-<8 chars>_lifetime-<duration>_country-<cc>
 *
 * This is counterintuitive but confirmed by their endpoint:
 *   - Modifier in username (USER_session-XXX:PASS)           → REJECTED
 *   - Modifier in password (USER:PASS_session-XXX)           → ACCEPTED
 *
 * @param sessionId  Any 8-character hex/alphanumeric string. Same id within
 *                   lifetime window = same residential IP.
 * @param lifetime   "1h" / "30m" / "1d" / etc. Max "7d".
 * @param country    Lowercase 2-char code (us/gb/ca/etc). Optional.
 */
export function buildStickyPassword(opts: { sessionId: string; lifetime?: string; country?: string }): string {
  const parts = [PROXY_PASS, `session-${opts.sessionId}`]
  if (opts.lifetime) parts.push(`lifetime-${opts.lifetime}`)
  if (opts.country) parts.push(`country-${opts.country}`)
  return parts.join('_')
}

/**
 * Start a local HTTP proxy that forwards everything to IPRoyal with the
 * given sticky-session username. Returns a localhost URL that Chromium can
 * use as proxy with NO auth required.
 *
 * Caller is responsible for calling .close() on the returned object when done.
 *
 * NOTE: anonymizeProxy() spawns its own server on a random localhost port.
 * That's the simplest API — we don't need to manage ports ourselves.
 */
export async function startProxyChain(opts: {
  sessionId: string
  lifetime?: string  // default '1h'
  country?: string   // default 'us'
}): Promise<{ url: string; close: () => Promise<void> }> {
  if (!proxyChainEnabled) {
    throw new Error('proxy-chain: WORKER_PROXY_* env vars not set')
  }
  const stickyPass = buildStickyPassword({
    sessionId: opts.sessionId,
    lifetime: opts.lifetime ?? '1h',
    country: opts.country ?? 'us',
  })
  const upstreamUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(stickyPass)}@${PROXY_HOST}:${PROXY_PORT}`
  const localhostUrl = await anonymizeProxy(upstreamUrl)
  return {
    url: localhostUrl,
    close: async () => {
      try { await closeAnonymizedProxy(localhostUrl, true) } catch { /* ignore */ }
    },
  }
}

/**
 * Lower-level: spin up a Server manually (gives more control, custom port, etc).
 * Useful if we want a long-lived proxy serving many sessions concurrently.
 */
export async function startProxyServer(opts: {
  port?: number
  sessionId: string
  lifetime?: string
  country?: string
}): Promise<{ url: string; close: () => Promise<void> }> {
  if (!proxyChainEnabled) {
    throw new Error('proxy-chain: WORKER_PROXY_* env vars not set')
  }
  const stickyPass = buildStickyPassword({
    sessionId: opts.sessionId,
    lifetime: opts.lifetime ?? '1h',
    country: opts.country ?? 'us',
  })
  const upstreamUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(stickyPass)}@${PROXY_HOST}:${PROXY_PORT}`
  const server = new Server({
    port: opts.port ?? 0,  // 0 = random free port
    verbose: false,
    prepareRequestFunction: () => ({ upstreamProxyUrl: upstreamUrl }),
  })
  await server.listen()
  const url = `http://127.0.0.1:${server.port}`
  return {
    url,
    close: async () => { try { await server.close(true) } catch { /* ignore */ } },
  }
}
