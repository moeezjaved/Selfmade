/**
 * Paid seat overage. POST { extra } → set the org's TOTAL extra (paid) seats to `extra`.
 *   - First purchase (no seat subscription yet) → returns { url } for a Stripe Checkout
 *     (subscription mode, per-seat price, quantity = extra). Webhook records extra_seats.
 *   - Adjust an existing seat subscription → updates its quantity in place, returns { ok, extra }.
 *   - extra = 0 with an existing seat sub → cancels it.
 * Only the org OWNER/ADMIN may buy seats; the charge lands on the OWNER's Stripe customer.
 * Requires STRIPE_PRICE_SEAT (a recurring per-seat price) in env.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg, canManage } from '@/lib/org'

export const dynamic = 'force-dynamic'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  const priceId = process.env.STRIPE_PRICE_SEAT
  if (!priceId) return NextResponse.json({ error: 'not_configured', message: 'Set STRIPE_PRICE_SEAT (a recurring per-seat price) in env.' }, { status: 503 })

  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  if (!canManage(org.role)) return NextResponse.json({ error: 'Only an owner or admin can buy seats.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const extra = Math.max(0, Math.min(100, Math.floor(Number(body.extra))))
  if (!Number.isFinite(extra)) return NextResponse.json({ error: 'extra (integer) required' }, { status: 400 })

  const { stripe } = await import('@/lib/stripe')
  // Seats always bill the OWNER's Stripe customer (the paying account), not the acting admin.
  const { data: sub } = await admin.from('subscriptions')
    .select('stripe_customer_id, seats_subscription_id').eq('owner_id', org.ownerId).maybeSingle()
  let customerId = (sub as any)?.stripe_customer_id as string | undefined
  const seatSubId = (sub as any)?.seats_subscription_id as string | undefined

  // ── Adjust an EXISTING seat subscription in place (no checkout needed) ──
  if (seatSubId) {
    if (extra === 0) {
      await stripe.subscriptions.cancel(seatSubId)
      await admin.from('subscriptions').update({ extra_seats: 0, seats_subscription_id: null }).eq('owner_id', org.ownerId)
      return NextResponse.json({ ok: true, extra: 0 })
    }
    const s = await stripe.subscriptions.retrieve(seatSubId)
    const itemId = s.items.data[0]?.id
    await stripe.subscriptions.update(seatSubId, { items: [{ id: itemId, quantity: extra }], proration_behavior: 'always_invoice' })
    await admin.from('subscriptions').update({ extra_seats: extra }).eq('owner_id', org.ownerId)
    return NextResponse.json({ ok: true, extra })
  }

  if (extra === 0) return NextResponse.json({ ok: true, extra: 0 })

  // ── First purchase → Checkout for a NEW seat subscription ──
  // Validate the stored customer exists in the current account (stale after an account switch) → recreate.
  if (customerId) {
    try { const ex = await stripe.customers.retrieve(customerId); if ((ex as any)?.deleted) customerId = undefined } catch { customerId = undefined }
  }
  if (!customerId) {
    const c = await stripe.customers.create({ email: user.email || undefined, metadata: { owner_id: org.ownerId } })
    customerId = c.id
    await admin.from('subscriptions').upsert({ owner_id: org.ownerId, stripe_customer_id: customerId }, { onConflict: 'owner_id' })
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: extra }],
    subscription_data: { metadata: { owner_id: org.ownerId, type: 'seats', seats: String(extra) } },
    metadata: { owner_id: org.ownerId, type: 'seats', seats: String(extra) },
    success_url: `${APP_URL}/team?seats=1`,
    cancel_url: `${APP_URL}/team`,
    allow_promotion_codes: true,
  })
  return NextResponse.json({ url: session.url })
}
