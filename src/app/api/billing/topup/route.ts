/**
 * Buy a top-up credit pack (spec §3). POST { pack } → { url } (Stripe one-time Checkout).
 * Gated on the plan's canBuyCredits entitlement (Free can't buy → upsell). Uses inline price_data
 * (no pre-created Stripe price needed). Fulfillment (grant_topup_pack) happens in the webhook.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { TOPUP_PACKS } from '@/lib/plans'
import { requireFeature } from '@/lib/entitlements'

export const dynamic = 'force-dynamic'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })

  const admin = createAdminClient()
  // Plan gate: only paid plans can buy top-ups.
  const gate = await requireFeature(admin, user.id, 'canBuyCredits')
  if (gate) return NextResponse.json(gate, { status: 402 })

  const { pack } = await req.json().catch(() => ({}))
  const p = TOPUP_PACKS.find((x) => x.id === pack)
  if (!p) return NextResponse.json({ error: 'invalid_pack' }, { status: 400 })

  const { stripe } = await import('@/lib/stripe')
  const { data: sub } = await admin.from('subscriptions').select('stripe_customer_id').eq('owner_id', user.id).maybeSingle()
  let customerId = (sub as any)?.stripe_customer_id as string | undefined
  if (!customerId) {
    const c = await stripe.customers.create({ email: user.email || undefined, metadata: { owner_id: user.id } })
    customerId = c.id
    await admin.from('subscriptions').upsert({ owner_id: user.id, stripe_customer_id: customerId }, { onConflict: 'owner_id' })
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      quantity: 1,
      price_data: { currency: 'usd', unit_amount: p.priceUsd * 100, product_data: { name: `Self Made — ${p.credits} credit top-up` } },
    }],
    // The webhook reads this to grant the pack + create the FIFO purchase row.
    metadata: { owner_id: user.id, topup_pack: p.id, topup_credits: String(p.credits), amount_usd: String(p.priceUsd) },
    success_url: `${APP_URL}/pricing?topped_up=1`,
    cancel_url: `${APP_URL}/pricing`,
  })
  return NextResponse.json({ url: session.url })
}
