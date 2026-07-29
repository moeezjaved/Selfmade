/**
 * POST /api/billing/payfast/checkout  { kind:'topup'|'subscription', pack?, plan?, cycle? }
 * Creates a pending payfast_orders row, gets a PayFast access token, and returns the hosted-checkout
 * POST URL + field map. The client auto-submits a hidden form → PayFast's payment page. Fulfillment
 * happens in the IPN callback (never here) so a closed tab can't drop a paid order.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireFeature } from '@/lib/entitlements'
import { TOPUP_PACKS, PLANS, type PlanId } from '@/lib/plans'
import { getAccessToken, buildTransactionFields, makeBasketId, usdToPkr, POST_URL } from '@/lib/payfast'

export const dynamic = 'force-dynamic'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const { kind, pack, plan, cycle } = await req.json().catch(() => ({}))

  // ── Resolve what's being bought → amount (PKR) + description + the grant payload. ──
  let amount: number, description: string, credits: number | null = null, planId: string | null = null
  if (kind === 'topup') {
    const gate = await requireFeature(admin, user.id, 'canBuyCredits')
    if (gate) return NextResponse.json(gate, { status: 402 })
    const p = TOPUP_PACKS.find((x) => x.id === pack)
    if (!p) return NextResponse.json({ error: 'invalid_pack' }, { status: 400 })
    amount = usdToPkr(p.priceUsd); credits = p.credits
    description = `Selfmade — ${p.credits} credit top-up`
  } else if (kind === 'subscription') {
    const pl = PLANS[plan as PlanId]
    if (!pl || plan === 'free' || plan === 'enterprise') return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })
    const annual = cycle === 'annual'
    amount = usdToPkr((annual ? pl.priceAnnualMonthly * 12 : pl.priceMonthly))
    planId = plan
    description = `Selfmade — ${pl.label} plan (${annual ? 'annual' : 'monthly'})`
  } else {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  }

  const basketId = makeBasketId(kind === 'topup' ? 'TOP' : 'SUB')

  // Persist the pending order BEFORE redirecting — the IPN reconciles against it.
  const { error: insErr } = await admin.from('payfast_orders').insert({
    basket_id: basketId, user_id: user.id, kind, ref: pack || plan || null,
    credits, plan: planId, billing_cycle: cycle === 'annual' ? 'annual' : 'monthly',
    amount, currency: 'PKR', status: 'pending',
  })
  if (insErr) return NextResponse.json({ error: 'order_failed', message: insErr.message }, { status: 500 })

  try {
    const token = await getAccessToken(basketId, amount, 'PKR')
    const fields = buildTransactionFields({
      token, basketId, amount, description,
      email: user.email || undefined,
      recurring: kind === 'subscription',   // tokenize so we can re-charge monthly
      successUrl: `${APP_URL}/billing/success?basket=${basketId}`,
      failureUrl: `${APP_URL}/billing/failure?basket=${basketId}`,
      checkoutUrl: `${APP_URL}/api/billing/payfast/callback`,
    })
    return NextResponse.json({ postUrl: POST_URL, fields })
  } catch (e: any) {
    await admin.from('payfast_orders').update({ status: 'failed', err_code: 'TOKEN' }).eq('basket_id', basketId)
    return NextResponse.json({ error: 'token_failed', message: String(e?.message || e) }, { status: 502 })
  }
}
