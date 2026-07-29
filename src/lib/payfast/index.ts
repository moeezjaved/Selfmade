/**
 * PayFast Pakistan (payfast.pk / APPS-Bank Alfalah) integration.
 *
 * Flow: getAccessToken() → the client POSTs a hidden form to the hosted PostTransaction page →
 * user pays → PayFast POSTs an IPN to our CHECKOUT_URL callback → we verify the validation hash and
 * grant. Currency is PKR. Recurring is supported via RECURRING_TXN=TRUE → PayFast returns an
 * Instrument_token we store to re-charge monthly.
 *
 * Env (falls back to PayFast's shared UAT sandbox creds so it works before real onboarding):
 *   PAYFAST_ENV=uat|live · PAYFAST_MERCHANT_ID · PAYFAST_SECURED_KEY · PAYFAST_USD_PKR (rate)
 */
import { createHash } from 'crypto'

const ENV = (process.env.PAYFAST_ENV || 'uat').toLowerCase()
const IS_LIVE = ENV === 'live'

// UAT shared sandbox credentials (public, from PayFast's sample) — overridden by env in production.
export const MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID || '102'
const SECURED_KEY = process.env.PAYFAST_SECURED_KEY || 'zWHjBp2AlttNu1sK'

const BASE = IS_LIVE ? 'https://ipg1.apps.net.pk' : 'https://ipguat.apps.net.pk'
export const TOKEN_URL = `${BASE}/Ecommerce/api/Transaction/GetAccessToken`
export const POST_URL = `${BASE}/Ecommerce/api/Transaction/PostTransaction`

/**
 * Charge currency. We deal in USD, so default to USD — the amount is sent as-is. If a merchant is
 * PKR-only, set PAYFAST_CURRENCY=PKR and we convert USD→PKR at PAYFAST_USD_PKR. One switch, no code
 * change. (Confirm with PayFast that USD is enabled on the live account before going live in USD.)
 */
export const CURRENCY = (process.env.PAYFAST_CURRENCY || 'USD').toUpperCase()
export const USD_PKR = Number(process.env.PAYFAST_USD_PKR || '280')
export const usdToPkr = (usd: number) => Math.max(1, Math.round(usd * USD_PKR))
/** The amount to actually charge, in the configured currency, from a USD price. */
export const chargeAmount = (usd: number) => (CURRENCY === 'PKR' ? usdToPkr(usd) : usd)

/** A unique basket id per checkout — the key that ties the IPN back to our order row. */
export function makeBasketId(prefix = 'SM'): string {
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rnd}`
}

/** Step 1 — exchange merchant creds + basket for a one-time ACCESS_TOKEN. */
export async function getAccessToken(basketId: string, amount: number, currency = 'PKR'): Promise<string> {
  const body = new URLSearchParams({
    MERCHANT_ID, SECURED_KEY, BASKET_ID: basketId, TXNAMT: String(amount), CURRENCY_CODE: currency,
  }).toString()
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(20000),
  })
  const j = await r.json().catch(() => ({} as any))
  if (!j?.ACCESS_TOKEN) throw new Error(`PayFast token failed: ${JSON.stringify(j).slice(0, 200)}`)
  return j.ACCESS_TOKEN as string
}

/**
 * The validation hash PayFast sends on the IPN, recomputed our side to prove integrity.
 * SHA256 of `basket_id|secured_key|merchant_id|err_code` (pipe-delimited, exact order). Verified
 * against PayFast's own sample vector in tests.
 */
export function validationHash(basketId: string, errCode: string): string {
  return createHash('sha256').update(`${basketId}|${SECURED_KEY}|${MERCHANT_ID}|${errCode}`).digest('hex')
}

/** Constant-ish comparison for the received vs computed hash. */
export function hashMatches(basketId: string, errCode: string, received: string): boolean {
  const expected = validationHash(basketId, errCode)
  const a = Buffer.from(expected); const b = Buffer.from(String(received || '').toLowerCase())
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Charge a previously-tokenized card WITHOUT the user present (subscription auto-renewal).
 * PayFast returns an Instrument_token on the first RECURRING_TXN=TRUE payment; this re-charges it
 * server-to-server. The exact recurring endpoint isn't in the shared docs — set PAYFAST_RECURRING_URL
 * (+ the field names PayFast specifies) once they provide it, and auto-renewal goes fully hands-free.
 * Until then this returns { ok:false, needsSpec:true } and the cron falls back to an email re-pay link.
 */
export async function chargeWithToken(opts: { instrumentToken: string; basketId: string; amount: number; currency?: string; description?: string }): Promise<{ ok: boolean; transactionId?: string; error?: string; needsSpec?: boolean }> {
  const url = process.env.PAYFAST_RECURRING_URL
  if (!url) return { ok: false, needsSpec: true, error: 'PAYFAST_RECURRING_URL not set — awaiting PayFast recurring-charge endpoint' }
  try {
    const body = new URLSearchParams({
      MERCHANT_ID, SECURED_KEY, BASKET_ID: opts.basketId, TXNAMT: String(opts.amount),
      CURRENCY_CODE: opts.currency || CURRENCY, TOKEN: opts.instrumentToken, RECURRING_TXN: 'TRUE',
      TXNDESC: opts.description || 'Selfmade subscription renewal',
    }).toString()
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(30000) })
    const j = await r.json().catch(() => ({} as any))
    const code = j.err_code || j.ERR_CODE
    if (code === '000') return { ok: true, transactionId: j.transaction_id || j.TRANSACTION_ID }
    return { ok: false, error: j.err_msg || `err_code ${code}` }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}

/** Build the full field map the client form POSTs to POST_URL. */
export function buildTransactionFields(opts: {
  token: string; basketId: string; amount: number; currency?: string; description: string
  email?: string; mobile?: string; recurring?: boolean; successUrl: string; failureUrl: string; checkoutUrl: string
}): Record<string, string> {
  return {
    CURRENCY_CODE: opts.currency || CURRENCY,
    MERCHANT_ID,
    MERCHANT_NAME: 'Selfmade',
    TOKEN: opts.token,
    BASKET_ID: opts.basketId,
    TXNAMT: String(opts.amount),
    ORDER_DATE: new Date().toISOString().slice(0, 19).replace('T', ' '),
    SUCCESS_URL: opts.successUrl,
    FAILURE_URL: opts.failureUrl,
    CHECKOUT_URL: opts.checkoutUrl,
    CUSTOMER_EMAIL_ADDRESS: opts.email || '',
    CUSTOMER_MOBILE_NO: opts.mobile || '',
    SIGNATURE: 'SELFMADE',
    VERSION: 'SELFMADE-1.0',
    TXNDESC: opts.description,
    PROCCODE: '00',
    TRAN_TYPE: 'ECOMM_PURCHASE',
    RECURRING_TXN: opts.recurring ? 'TRUE' : '',
  }
}
