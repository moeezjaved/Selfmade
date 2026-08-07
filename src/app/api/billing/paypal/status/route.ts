/**
 * GET /api/billing/paypal/status?basket=...  — polled by /billing/success after PayPal returns.
 * Returns { status: 'pending'|'paid'|'failed' }. Self-heals: if the order is still pending it tries
 * to finalize (capture a top-up order / confirm an activated subscription) so the user sees "paid"
 * without waiting on the webhook. The webhook remains the authoritative, tab-close-safe path.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { captureOrder, getSubscription } from '@/lib/paypal'
import { grantPaypalOrder } from '@/lib/paypal/grant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const basket = req.nextUrl.searchParams.get('basket') || ''
  if (!basket) return NextResponse.json({ error: 'missing_basket' }, { status: 400 })

  const admin = createAdminClient()
  const { data: order } = await admin.from('paypal_orders').select('*').eq('basket_id', basket).eq('user_id', user.id).maybeSingle()
  if (!order) return NextResponse.json({ status: 'unknown' })
  if (order.status === 'paid') return NextResponse.json({ status: 'paid' })
  if (order.status === 'failed') return NextResponse.json({ status: 'failed' })

  // Still pending — try to finalize now (idempotent with the webhook).
  try {
    if (order.kind === 'topup' && order.paypal_order_id) {
      const cap = await captureOrder(order.paypal_order_id)
      if (cap.ok) { await grantPaypalOrder(admin, basket, { transactionId: cap.captureId, raw: cap }); return NextResponse.json({ status: 'paid' }) }
    } else if (order.kind === 'subscription' && order.paypal_subscription_id) {
      const sub = await getSubscription(order.paypal_subscription_id)
      if (sub?.status === 'ACTIVE') { await grantPaypalOrder(admin, basket, { subscriptionId: sub.id, transactionId: sub.id, raw: sub }); return NextResponse.json({ status: 'paid' }) }
    }
  } catch { /* leave pending — webhook will finalize */ }

  return NextResponse.json({ status: 'pending' })
}
