/**
 * Shopify OAuth (the one-click "Connect Shopify" door). Standard authorization-code grant against the
 * merchant's store; the resulting offline access_token lands in shopify_stores exactly like the BYO door,
 * so every downstream agent is door-agnostic. Requires a Partner app: SHOPIFY_API_KEY + SHOPIFY_API_SECRET.
 *
 * Flow: init → redirect to {shop}/admin/oauth/authorize → Shopify redirects back to /callback with
 * code+hmac+state → verify hmac (API secret) + state nonce → exchange code for token → save + sync.
 */
import crypto from 'node:crypto'
import { SHOPIFY_REQUIRED_SCOPES } from '@/lib/shopify/client'

export const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || ''
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || ''

export function shopifyOAuthConfigured(): boolean {
  return !!(SHOPIFY_API_KEY && SHOPIFY_API_SECRET)
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
}

export function redirectUri(): string {
  return `${appBaseUrl()}/api/shopify/oauth/callback`
}

export function newNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

/** The URL to send the merchant to, to approve the requested scopes. */
export function buildAuthorizeUrl(shop: string, state: string): string {
  // Offline access is the default (no grant_options[]=per-user) → a lasting token for background agents.
  const params = new URLSearchParams({
    client_id: SHOPIFY_API_KEY,
    scope: SHOPIFY_REQUIRED_SCOPES.join(','),
    redirect_uri: redirectUri(),
    state,
  })
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`
}

/**
 * Verify the HMAC Shopify appends to every callback/redirect. Removes hmac (and legacy signature), sorts
 * the remaining params, and compares an HMAC-SHA256 of the canonical query string against the provided hmac.
 */
export function verifyHmac(params: URLSearchParams): boolean {
  if (!SHOPIFY_API_SECRET) return false
  const provided = params.get('hmac') || ''
  if (!provided) return false
  const pairs: string[] = []
  params.forEach((v, k) => { if (k !== 'hmac' && k !== 'signature') pairs.push(`${k}=${v}`) })
  pairs.sort()
  const message = pairs.join('&')
  const digest = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex')
  try {
    const a = Buffer.from(digest, 'utf8'); const b = Buffer.from(provided, 'utf8')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch { return false }
}

/** Exchange the one-time code for a lasting (offline) Admin API access token. */
export async function exchangeCodeForToken(shop: string, code: string): Promise<{ access_token: string; scope: string }> {
  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ client_id: SHOPIFY_API_KEY, client_secret: SHOPIFY_API_SECRET, code }),
    signal: AbortSignal.timeout(20000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(j?.error_description || j?.error || `Token exchange failed (${r.status})`)
  return { access_token: j.access_token, scope: j.scope || '' }
}
