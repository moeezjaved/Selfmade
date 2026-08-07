'use client'
/**
 * startPaypalCheckout — client helper. Calls our checkout API, then redirects the browser to the
 * PayPal approval page. Mirrors startPayfastCheckout's signature so call sites stay symmetric.
 * Usage: await startPaypalCheckout({ kind:'subscription', plan:'starter', cycle:'monthly' })
 */
export async function startPaypalCheckout(body:
  | { kind: 'topup'; pack: string }
  | { kind: 'subscription'; plan: string; cycle?: 'monthly' | 'annual' }
): Promise<{ error?: string; message?: string }> {
  const res = await fetch('/api/billing/paypal/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({ error: 'network' }))

  if (res?.url) { window.location.href = res.url; return {} }
  return res || { error: 'checkout_failed' }
}
