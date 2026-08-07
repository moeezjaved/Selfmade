/**
 * PayPal integration — Subscriptions (recurring plans) + Orders (one-time credit top-ups).
 *
 * Why PayPal: PayFast (Pakistan) can't accept international cards; PayPal bills in USD worldwide.
 * This mirrors the PayFast lib shape so the app can switch rails with NEXT_PUBLIC_PAYMENTS_PROVIDER.
 *
 * Flow (subscription): createSubscription() → redirect user to the approve link → user approves →
 * PayPal fires the BILLING.SUBSCRIPTION.ACTIVATED webhook → our callback grants the plan (once).
 * Flow (top-up): createOrder() → redirect to approve → user approves → we capture on return AND on
 * the PAYMENT.CAPTURE.COMPLETED webhook (both idempotent) → grant credits.
 *
 * Env:
 *   PAYPAL_ENV=sandbox|live   (default sandbox — safe until real go-live)
 *   PAYPAL_CLIENT_ID · PAYPAL_SECRET      (REST app credentials)
 *   PAYPAL_WEBHOOK_ID          (the webhook's id, used to verify signatures)
 *   PAYPAL_PLAN_<PLAN>_<CYCLE> (billing-plan ids, e.g. PAYPAL_PLAN_STARTER_MONTHLY — created by
 *                               the one-time /api/billing/paypal/setup route)
 */

const ENV = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase()
export const IS_LIVE = ENV === 'live'
export const PAYPAL_BASE = IS_LIVE ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || ''
const SECRET = process.env.PAYPAL_SECRET || ''
export const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || ''

/** True once the REST credentials are present — routes 402 with a clear message otherwise. */
export function paypalConfigured(): boolean {
  return !!(CLIENT_ID && SECRET)
}

/** The env var holding a plan's PayPal billing-plan id, e.g. PAYPAL_PLAN_STARTER_MONTHLY. */
export function planEnvKey(plan: string, cycle: 'monthly' | 'annual'): string {
  return `PAYPAL_PLAN_${plan.toUpperCase()}_${cycle.toUpperCase()}`
}
export function planId(plan: string, cycle: 'monthly' | 'annual'): string | undefined {
  return process.env[planEnvKey(plan, cycle)]
}

/** A unique basket id per checkout — the custom_id we hand PayPal and reconcile the webhook against. */
export function makeBasketId(prefix = 'PP'): string {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rnd}`
}

// ── Access token (client_credentials), cached in-memory per warm instance. ──
let tokenCache: { token: string; exp: number } | null = null
export async function getAccessToken(): Promise<string> {
  if (!paypalConfigured()) throw new Error('PayPal not configured (PAYPAL_CLIENT_ID / PAYPAL_SECRET missing)')
  if (tokenCache && tokenCache.exp > Date.now() + 30_000) return tokenCache.token
  const auth = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64')
  const r = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20000),
  })
  const j = await r.json().catch(() => ({} as any))
  if (!j?.access_token) throw new Error(`PayPal token failed: ${JSON.stringify(j).slice(0, 200)}`)
  tokenCache = { token: j.access_token, exp: Date.now() + (Number(j.expires_in || 3000) * 1000) }
  return j.access_token as string
}

/** Authenticated PayPal API call. Throws on non-2xx with the body for diagnostics. */
export async function paypalFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getAccessToken()
  const r = await fetch(`${PAYPAL_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(30000),
  })
  const text = await r.text()
  const body = text ? JSON.parse(text) : {}
  if (!r.ok) throw new Error(`PayPal ${path} → ${r.status}: ${text.slice(0, 300)}`)
  return body
}

const approveLink = (links: any[]): string | undefined =>
  links?.find((l) => l.rel === 'approve')?.href || links?.find((l) => l.rel === 'payer-action')?.href

// ── Subscriptions ──────────────────────────────────────────────────────────

/** Create a subscription against a pre-created billing plan. Returns the id + the approve URL. */
export async function createSubscription(opts: {
  planId: string; customId: string; returnUrl: string; cancelUrl: string; email?: string
}): Promise<{ id: string; approveUrl: string }> {
  const body = await paypalFetch('/v1/billing/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: opts.planId,
      custom_id: opts.customId,
      subscriber: opts.email ? { email_address: opts.email } : undefined,
      application_context: {
        brand_name: 'Selfmade',
        user_action: 'SUBSCRIBE_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    }),
  })
  const approveUrl = approveLink(body.links)
  if (!approveUrl) throw new Error('PayPal subscription: no approve link')
  return { id: body.id, approveUrl }
}

export async function getSubscription(id: string): Promise<any> {
  return paypalFetch(`/v1/billing/subscriptions/${id}`, { method: 'GET' })
}

/** Cancel a subscription at PayPal (stops all future billing). Returns true on success. */
export async function cancelSubscription(id: string, reason = 'Cancelled by customer'): Promise<boolean> {
  try {
    // 204 No Content on success — paypalFetch returns {} and doesn't throw.
    await paypalFetch(`/v1/billing/subscriptions/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) })
    return true
  } catch (e: any) {
    // Already cancelled / not found → treat as done so the app state can proceed.
    const m = String(e?.message || '')
    if (m.includes('SUBSCRIPTION_STATUS_INVALID') || m.includes('RESOURCE_NOT_FOUND') || m.includes('422') || m.includes('404')) return true
    return false
  }
}

// ── Orders (one-time top-ups) ────────────────────────────────────────────────

export async function createOrder(opts: {
  amountUsd: number; customId: string; returnUrl: string; cancelUrl: string; description: string
}): Promise<{ id: string; approveUrl: string }> {
  const body = await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: opts.customId,
        description: opts.description.slice(0, 127),
        amount: { currency_code: 'USD', value: opts.amountUsd.toFixed(2) },
      }],
      application_context: {
        brand_name: 'Selfmade',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    }),
  })
  const approveUrl = approveLink(body.links)
  if (!approveUrl) throw new Error('PayPal order: no approve link')
  return { id: body.id, approveUrl }
}

/** Capture an approved order. Idempotent-safe: an already-captured order returns its capture data. */
export async function captureOrder(orderId: string): Promise<{ ok: boolean; captureId?: string; customId?: string; status?: string }> {
  try {
    const body = await paypalFetch(`/v2/checkout/orders/${orderId}/capture`, { method: 'POST' })
    const cap = body?.purchase_units?.[0]?.payments?.captures?.[0]
    return { ok: body?.status === 'COMPLETED', captureId: cap?.id, customId: body?.purchase_units?.[0]?.custom_id, status: body?.status }
  } catch (e: any) {
    // ORDER_ALREADY_CAPTURED → fetch the order to read the capture (idempotent replays).
    if (String(e?.message || '').includes('ALREADY_CAPTURED') || String(e?.message || '').includes('422')) {
      try {
        const o = await paypalFetch(`/v2/checkout/orders/${orderId}`, { method: 'GET' })
        const cap = o?.purchase_units?.[0]?.payments?.captures?.[0]
        return { ok: cap?.status === 'COMPLETED', captureId: cap?.id, customId: o?.purchase_units?.[0]?.custom_id, status: o?.status }
      } catch { /* fall through */ }
    }
    return { ok: false }
  }
}

// ── Webhook signature verification ────────────────────────────────────────────

/**
 * Verify a webhook came from PayPal by asking PayPal to check the signature against our WEBHOOK_ID.
 * Returns true only on verification_status === 'SUCCESS'. Without a WEBHOOK_ID we cannot verify → false.
 */
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  if (!WEBHOOK_ID) return false
  let event: any
  try { event = JSON.parse(rawBody) } catch { return false }
  const payload = {
    auth_algo: headers.get('paypal-auth-algo'),
    cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'),
    webhook_id: WEBHOOK_ID,
    webhook_event: event,
  }
  try {
    const r = await paypalFetch('/v1/notifications/verify-webhook-signature', { method: 'POST', body: JSON.stringify(payload) })
    return r?.verification_status === 'SUCCESS'
  } catch {
    return false
  }
}

// ── One-time plan setup (called by /api/billing/paypal/setup) ──────────────────

/** Create a PayPal Product (the umbrella all billing plans hang off). Returns the product id. */
export async function createProduct(name = 'Selfmade', description = 'Selfmade subscription'): Promise<string> {
  const body = await paypalFetch('/v1/catalogs/products', {
    method: 'POST',
    body: JSON.stringify({ name, description, type: 'SERVICE', category: 'SOFTWARE' }),
  })
  return body.id
}

/**
 * Create a recurring billing plan. `totalUsd` is the amount charged each cycle
 * (monthly → per month; annual → the full year's price billed once).
 */
export async function createPlan(opts: {
  productId: string; name: string; cycle: 'monthly' | 'annual'; totalUsd: number
}): Promise<string> {
  const body = await paypalFetch('/v1/billing/plans', {
    method: 'POST',
    body: JSON.stringify({
      product_id: opts.productId,
      name: opts.name,
      status: 'ACTIVE',
      billing_cycles: [{
        frequency: { interval_unit: opts.cycle === 'annual' ? 'YEAR' : 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0, // 0 = until cancelled
        pricing_scheme: { fixed_price: { value: opts.totalUsd.toFixed(2), currency_code: 'USD' } },
      }],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CANCEL',
        payment_failure_threshold: 2,
      },
    }),
  })
  return body.id
}
