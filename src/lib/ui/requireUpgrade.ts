/**
 * requireUpgrade — the client-side paywall gate. The audit's issues are shown FREE inside the app, but the
 * moment a free user clicks a "Fix it" / agent action, we send them to /upgrade (the employment agreement
 * → PayPal checkout). Paid users pass straight through.
 *
 * Usage in a click handler:  if (await requireUpgrade()) return   // free → sent to /upgrade, stop here
 */
let cachedFree: boolean | null = null

/** True if the signed-in user is on the Free plan (cached for the session; refresh clears it). */
export async function isFreePlan(): Promise<boolean> {
  if (cachedFree !== null) return cachedFree
  try {
    const j = await fetch('/api/credits/balance', { cache: 'no-store' }).then((r) => r.json())
    const plan = String(j?.plan || '').toLowerCase()
    cachedFree = !plan || plan === 'free'   // only the FREE plan is gated; a paid trial passes through
  } catch { cachedFree = false }   // fail OPEN — never block a paying user on a hiccup
  return cachedFree
}

/** Free user → redirect to /upgrade and return true (caller should stop). Paid → return false (proceed). */
export async function requireUpgrade(): Promise<boolean> {
  if (await isFreePlan()) {
    try { window.location.href = '/upgrade' } catch { /* ignore */ }
    return true
  }
  return false
}
