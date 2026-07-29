'use client'
/**
 * startPayfastCheckout — client helper. Calls our checkout API, then builds a hidden form from the
 * returned field map and submits it, redirecting the browser to PayFast's hosted payment page.
 * Usage: await startPayfastCheckout({ kind:'topup', pack:'medium' })
 */
export async function startPayfastCheckout(body:
  | { kind: 'topup'; pack: string }
  | { kind: 'subscription'; plan: string; cycle?: 'monthly' | 'annual' }
): Promise<{ error?: string; message?: string }> {
  const res = await fetch('/api/billing/payfast/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({ error: 'network' }))

  if (!res?.postUrl || !res?.fields) return res || { error: 'checkout_failed' }

  const form = document.createElement('form')
  form.method = 'POST'
  form.action = res.postUrl
  form.style.display = 'none'
  for (const [k, v] of Object.entries(res.fields as Record<string, string>)) {
    const input = document.createElement('input')
    input.type = 'hidden'; input.name = k; input.value = String(v ?? '')
    form.appendChild(input)
  }
  document.body.appendChild(form)
  form.submit()
  return {}
}
