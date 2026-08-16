/**
 * POST /api/billing/paypal/card/capture  { orderId, basket }
 * Called by the client's onApprove after the card + 3-D Secure succeed. Captures the order, reads the
 * vault token + card display bits, and grants the plan/credits (idempotent via paypal_orders.status).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { captureCardOrder } from '@/lib/paypal'
import { grantPaypalOrder } from '@/lib/paypal/grant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId, basket } = await req.json().catch(() => ({}))
  if (!basket) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  const admin = createAdminClient()
  // Confirm the order belongs to this user; use the PayPal order id we stored at create-time so we
  // don't depend on the client sending it (the SDK field name varies: orderID vs orderId).
  const { data: order } = await admin.from('paypal_orders').select('user_id, status, paypal_order_id').eq('basket_id', basket).maybeSingle()
  if (!order || order.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (order.status === 'paid') return NextResponse.json({ ok: true, status: 'paid' })

  const oid = orderId || order.paypal_order_id
  if (!oid) return NextResponse.json({ error: 'missing_order' }, { status: 400 })
  const cap = await captureCardOrder(oid)
  if (!cap.ok) {
    await admin.from('paypal_orders').update({ status: 'failed', err_code: (cap.error || 'CAPTURE').slice(0, 60) }).eq('basket_id', basket)
    try { const { logError } = await import('@/lib/admin/logError'); void logError({ user_id: order.user_id || user.id, user_email: user.email || null, error_message: `Payment capture failed — ${cap.error || cap.status || 'declined'}`, page_url: '/billing', extra: { kind: 'payment_failed', stage: 'capture' } }) } catch { /* never block */ }
    return NextResponse.json({ error: 'capture_failed', message: cap.error || cap.status || 'declined' }, { status: 402 })
  }

  await grantPaypalOrder(admin, basket, {
    transactionId: cap.captureId, vaultId: cap.vaultId, customerId: cap.customerId,
    cardBrand: cap.cardBrand, cardLast4: cap.cardLast4, raw: cap,
  })
  return NextResponse.json({ ok: true, status: 'paid', card: cap.cardBrand && cap.cardLast4 ? `${cap.cardBrand} ····${cap.cardLast4}` : null })
}
