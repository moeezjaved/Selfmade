'use client'
/**
 * startPaypalCheckout — client helper. Sends the user to our embedded card checkout (/billing/card),
 * where they pay by card without a PayPal account (Advanced Card Payments).
 * Usage: await startPaypalCheckout({ kind:'subscription', plan:'starter', cycle:'monthly' })
 */
export async function startPaypalCheckout(body:
  | { kind: 'topup'; pack: string }
  | { kind: 'subscription'; plan: string; cycle?: 'monthly' | 'annual' }
): Promise<{ error?: string; message?: string }> {
  const qs = body.kind === 'topup'
    ? `kind=topup&pack=${encodeURIComponent(body.pack)}`
    : `kind=subscription&plan=${encodeURIComponent(body.plan)}&cycle=${encodeURIComponent(body.cycle || 'monthly')}`
  window.location.href = `/billing/card?${qs}`
  return {}
}
