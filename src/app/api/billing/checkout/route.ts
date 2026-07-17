/**
 * Start a Stripe Checkout for a plan upgrade (spec §5). POST { plan, cycle } → { url }.
 * Reads the per-plan/cycle Stripe price id from env: STRIPE_PRICE_<PLAN>_<CYCLE> (e.g.
 * STRIPE_PRICE_PRO_MONTHLY). Returns { error: 'not_configured' } if the price id isn't set, so the
 * pricing page can degrade gracefully. Fulfillment (plan flip + credit grant) happens in the webhook.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PLANS, type PlanId } from '@/lib/plans'

export const dynamic = 'force-dynamic'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const { plan, cycle } = await req.json().catch(() => ({}))
  const planId = plan as PlanId
  if (!planId || !(planId in PLANS) || planId === 'free' || planId === 'enterprise')
    return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })
  const billingCycle = cycle === 'annual' ? 'annual' : 'monthly'

  const priceId = process.env[`STRIPE_PRICE_${planId.toUpperCase()}_${billingCycle.toUpperCase()}`]
  if (!priceId) return NextResponse.json({ error: 'not_configured', message: `Set STRIPE_PRICE_${planId.toUpperCase()}_${billingCycle.toUpperCase()} in env.` }, { status: 503 })

  try {
    const { stripe } = await import('@/lib/stripe')
    const admin = createAdminClient()

    // Reuse or create the Stripe customer. A STALE customer id (e.g. a test-mode customer saved while
    // a LIVE key is now in use) makes checkout throw "No such customer" → recreate it in that case.
    const { data: sub } = await admin.from('subscriptions').select('stripe_customer_id').eq('owner_id', user.id).maybeSingle()
    let customerId = (sub as any)?.stripe_customer_id as string | undefined
    if (customerId) {
      try { const ex = await stripe.customers.retrieve(customerId); if ((ex as any)?.deleted) customerId = undefined } catch { customerId = undefined }
    }
    if (!customerId) {
      const c = await stripe.customers.create({ email: user.email || undefined, metadata: { owner_id: user.id } })
      customerId = c.id
      await admin.from('subscriptions').upsert({ owner_id: user.id, stripe_customer_id: customerId }, { onConflict: 'owner_id' })
    }

    // Pricing model v2: NO free trial — subscribe = pay now, full credits immediately. The low-friction
    // "try it" path is pay-as-you-go (the $9 top-up pack), not a trial. This also removes the confusing
    // partial-credit trial and the day-7 surprise-charge dispute risk.
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { owner_id: user.id, plan: planId, cycle: billingCycle } },
      metadata: { owner_id: user.id, plan: planId, cycle: billingCycle },
      success_url: `${APP_URL}/pricing?upgraded=1`,
      cancel_url: `${APP_URL}/pricing`,
      allow_promotion_codes: true,
    })
    return NextResponse.json({ url: session.url })
  } catch (e: any) {
    // Surface Stripe's real reason (bad price id, test/live key mismatch, …) as JSON instead of a
    // bare 500 — the client was getting "Unexpected end of JSON input" from an empty error body.
    const msg = e?.raw?.message || e?.message || 'checkout_failed'
    console.error('billing/checkout error:', e?.type, e?.code, msg, `price=${priceId}`)
    return NextResponse.json({ error: 'checkout_failed', message: msg, code: e?.code || null }, { status: 400 })
  }
}
