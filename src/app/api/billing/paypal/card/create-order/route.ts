/**
 * POST /api/billing/paypal/card/create-order  { kind:'subscription'|'topup', plan?, cycle?, pack? }
 * Called by the client card-fields SDK's createOrder callback. Creates a pending paypal_orders row and
 * a PayPal Order (for subscriptions we ask PayPal to VAULT the card on success → monthly auto-charge).
 * Returns { orderId, basket }. The client then submits the card + 3-D Secure; we capture separately.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireFeature } from '@/lib/entitlements'
import { TOPUP_PACKS, PLANS, type PlanId } from '@/lib/plans'
import { paypalConfigured, makeBasketId, createCardOrder } from '@/lib/paypal'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!paypalConfigured()) return NextResponse.json({ error: 'not_configured' }, { status: 402 })
  const admin = createAdminClient()

  const { kind, plan, cycle, pack } = await req.json().catch(() => ({}))
  const billingCycle = cycle === 'annual' ? 'annual' : 'monthly'

  let amount: number, description: string, credits: number | null = null, planTier: string | null = null, vault = false
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
    amount = billingCycle === 'annual' ? pl.priceAnnualMonthly * 12 : pl.priceMonthly
    planTier = plan; vault = true   // save the card so we can auto-charge next month
    description = `Selfmade — ${pl.label} plan (${billingCycle})`
  } else {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  }

  const basketId = makeBasketId(kind === 'topup' ? 'TOP' : 'SUB')
  const { error: insErr } = await admin.from('paypal_orders').insert({
    basket_id: basketId, user_id: user.id, kind, ref: pack || plan || null,
    credits, plan: planTier, billing_cycle: billingCycle, amount, currency: 'USD', status: 'pending',
  })
  if (insErr) return NextResponse.json({ error: 'order_failed', message: insErr.message }, { status: 500 })

  try {
    const { id } = await createCardOrder({ amountUsd: amount, customId: basketId, description, vault })
    await admin.from('paypal_orders').update({ paypal_order_id: id }).eq('basket_id', basketId)
    return NextResponse.json({ orderId: id, basket: basketId })
  } catch (e: any) {
    await admin.from('paypal_orders').update({ status: 'failed', err_code: 'CREATE' }).eq('basket_id', basketId)
    return NextResponse.json({ error: 'paypal_failed', message: String(e?.message || e) }, { status: 502 })
  }
}
