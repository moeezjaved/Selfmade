/**
 * POST /api/billing/paypal/checkout  { kind:'topup'|'subscription', pack?, plan?, cycle? }
 * Creates a pending paypal_orders row, then a PayPal Subscription (recurring) or Order (one-time
 * top-up), and returns the PayPal approval URL. The client redirects there. Fulfillment happens in
 * the webhook (subscriptions) / capture (top-ups), never here — a closed tab can't drop a paid order.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireFeature } from '@/lib/entitlements'
import { TOPUP_PACKS, PLANS, type PlanId } from '@/lib/plans'
import { paypalConfigured, planId as resolvePlanId, planEnvKey, makeBasketId, createSubscription, createOrder } from '@/lib/paypal'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!paypalConfigured()) return NextResponse.json({ error: 'not_configured', message: 'PayPal isn’t configured yet.' }, { status: 402 })
  const admin = createAdminClient()

  const { kind, pack, plan, cycle } = await req.json().catch(() => ({}))
  const billingCycle = cycle === 'annual' ? 'annual' : 'monthly'

  // ── Resolve what's being bought → amount (USD) + description + the grant payload. ──
  let amount: number, description: string, credits: number | null = null, planTier: string | null = null
  let ppPlanId: string | undefined

  if (kind === 'topup') {
    const gate = await requireFeature(admin, user.id, 'canBuyCredits')
    if (gate) return NextResponse.json(gate, { status: 402 })
    const p = TOPUP_PACKS.find((x) => x.id === pack)
    if (!p) return NextResponse.json({ error: 'invalid_pack' }, { status: 400 })
    amount = p.priceUsd; credits = p.credits
    description = `Selfmade — ${p.credits} credit top-up`
  } else if (kind === 'subscription') {
    const pl = PLANS[plan as PlanId]
    if (!pl || plan === 'free' || plan === 'enterprise') return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })
    ppPlanId = resolvePlanId(plan, billingCycle)
    if (!ppPlanId) return NextResponse.json({ error: 'not_configured', message: `Missing ${planEnvKey(plan, billingCycle)} — run the PayPal setup once.` }, { status: 402 })
    amount = billingCycle === 'annual' ? pl.priceAnnualMonthly * 12 : pl.priceMonthly
    planTier = plan
    description = `Selfmade — ${pl.label} plan (${billingCycle})`
  } else {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  }

  const basketId = makeBasketId(kind === 'topup' ? 'TOP' : 'SUB')

  // Persist the pending order BEFORE redirecting — the webhook/capture reconciles against it.
  const { error: insErr } = await admin.from('paypal_orders').insert({
    basket_id: basketId, user_id: user.id, kind, ref: pack || plan || null,
    credits, plan: planTier, billing_cycle: billingCycle,
    amount, currency: 'USD', status: 'pending',
  })
  if (insErr) return NextResponse.json({ error: 'order_failed', message: insErr.message }, { status: 500 })

  const returnUrl = `${APP_URL}/billing/success?basket=${basketId}&provider=paypal`
  const cancelUrl = `${APP_URL}/billing/failure?basket=${basketId}`

  try {
    if (kind === 'subscription') {
      const { id, approveUrl } = await createSubscription({ planId: ppPlanId!, customId: basketId, returnUrl, cancelUrl, email: user.email || undefined })
      await admin.from('paypal_orders').update({ paypal_subscription_id: id }).eq('basket_id', basketId)
      return NextResponse.json({ url: approveUrl })
    } else {
      const { id, approveUrl } = await createOrder({ amountUsd: amount, customId: basketId, returnUrl, cancelUrl, description })
      await admin.from('paypal_orders').update({ paypal_order_id: id }).eq('basket_id', basketId)
      return NextResponse.json({ url: approveUrl })
    }
  } catch (e: any) {
    await admin.from('paypal_orders').update({ status: 'failed', err_code: 'CREATE' }).eq('basket_id', basketId)
    try { const { logError } = await import('@/lib/admin/logError'); void logError({ user_id: user?.id || null, user_email: user?.email || null, error_message: `Checkout order failed — ${String(e?.message || e)}`, page_url: '/billing', extra: { kind: 'payment_failed', stage: 'checkout' } }) } catch { /* never block */ }
    return NextResponse.json({ error: 'paypal_failed', message: String(e?.message || e) }, { status: 502 })
  }
}
