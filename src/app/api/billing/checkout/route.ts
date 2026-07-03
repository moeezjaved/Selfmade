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

  const { stripe } = await import('@/lib/stripe')
  const admin = createAdminClient()

  // Reuse or create the Stripe customer.
  const { data: sub } = await admin.from('subscriptions').select('stripe_customer_id').eq('owner_id', user.id).maybeSingle()
  let customerId = (sub as any)?.stripe_customer_id as string | undefined
  if (!customerId) {
    const c = await stripe.customers.create({ email: user.email || undefined, metadata: { owner_id: user.id } })
    customerId = c.id
    await admin.from('subscriptions').upsert({ owner_id: user.id, stripe_customer_id: customerId }, { onConflict: 'owner_id' })
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { trial_period_days: 7, metadata: { owner_id: user.id, plan: planId, cycle: billingCycle } },
    metadata: { owner_id: user.id, plan: planId, cycle: billingCycle },
    success_url: `${APP_URL}/pricing?upgraded=1`,
    cancel_url: `${APP_URL}/pricing`,
    allow_promotion_codes: true,
  })
  return NextResponse.json({ url: session.url })
}
