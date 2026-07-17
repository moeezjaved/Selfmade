/**
 * Billing health — one call that answers "can this Stripe account actually charge, and are we wired
 * to the right account?" Built while debugging a live checkout that reached Stripe, showed the
 * "verify you're human" screen, then bounced back with NO payment. Reports:
 *   • which sk_live account we're on (confirms Shopauranow vs the old SmartBiz mismatch),
 *   • charges_enabled / payouts_enabled / details_submitted,
 *   • Stripe's outstanding requirements (currently_due / past_due / disabled_reason) — the exact
 *     "Action required" items that restrict charges on a new account,
 *   • whether STRIPE_WEBHOOK_SECRET + the per-plan price ids are set (so fulfilment can fire).
 *
 * GET /api/billing/health  — admin/authed only. No secrets are returned (key is masked).
 */
import { NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.STRIPE_SECRET_KEY || ''
  if (!key) return NextResponse.json({ ok: false, error: 'STRIPE_SECRET_KEY not set' }, { status: 503 })

  const mode = key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unknown'
  const keyMask = key ? `${key.slice(0, 11)}…${key.slice(-4)}` : null

  // Which per-plan prices + webhook secret are configured (fulfilment needs these).
  const priceEnvs: Record<string, boolean> = {}
  for (const p of ['STARTER', 'PRO', 'BUSINESS']) for (const c of ['MONTHLY', 'ANNUAL'])
    priceEnvs[`${p}_${c}`] = !!process.env[`STRIPE_PRICE_${p}_${c}`]

  try {
    const { stripe } = await import('@/lib/stripe')
    // The Account object carries charges/payouts flags + the requirements that gate a new account.
    const acct: any = await stripe.accounts.retrieve()
    const req = acct.requirements || {}
    return NextResponse.json({
      ok: true,
      mode,
      key: keyMask,
      account: {
        id: acct.id,
        business_name: acct.business_profile?.name || acct.settings?.dashboard?.display_name || null,
        country: acct.country,
        default_currency: acct.default_currency,
        charges_enabled: acct.charges_enabled,     // ← false ⇒ live checkout will bounce
        payouts_enabled: acct.payouts_enabled,
        details_submitted: acct.details_submitted,
      },
      // The "Action required" items. Anything in currently_due/past_due is what to complete in the
      // Stripe dashboard; disabled_reason (if set) is why charges/payouts are being held.
      requirements: {
        disabled_reason: req.disabled_reason || null,
        current_deadline: req.current_deadline || null,
        currently_due: req.currently_due || [],
        past_due: req.past_due || [],
        eventually_due: req.eventually_due || [],
        pending_verification: req.pending_verification || [],
      },
      config: {
        webhook_secret_set: !!process.env.STRIPE_WEBHOOK_SECRET,
        prices: priceEnvs,
      },
      verdict: acct.charges_enabled
        ? '✅ Charges enabled — the account can accept live payments. If checkout still bounces, it is Radar/human-check on repeated test clicks, not the account.'
        : `🚨 charges_enabled is FALSE — Stripe is restricting charges. Complete requirements.currently_due/past_due in the dashboard (Action required task). disabled_reason: ${req.disabled_reason || 'n/a'}`,
    })
  } catch (e: any) {
    const msg = e?.raw?.message || e?.message || String(e)
    return NextResponse.json({ ok: false, mode, key: keyMask, error: msg, code: e?.code || null }, { status: 400 })
  }
}
