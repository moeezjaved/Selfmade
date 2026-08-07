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
  if (!orderId || !basket) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  const admin = createAdminClient()
  // Confirm the order belongs to this user before capturing.
  const { data: order } = await admin.from('paypal_orders').select('user_id, status').eq('basket_id', basket).maybeSingle()
  if (!order || order.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (order.status === 'paid') return NextResponse.json({ ok: true, status: 'paid' })

  const cap = await captureCardOrder(orderId)
  if (!cap.ok) {
    await admin.from('paypal_orders').update({ status: 'failed', err_code: (cap.error || 'CAPTURE').slice(0, 60) }).eq('basket_id', basket)
    return NextResponse.json({ error: 'capture_failed', message: cap.error || cap.status || 'declined' }, { status: 402 })
  }

  await grantPaypalOrder(admin, basket, {
    transactionId: cap.captureId, vaultId: cap.vaultId, customerId: cap.customerId,
    cardBrand: cap.cardBrand, cardLast4: cap.cardLast4, raw: cap,
  })
  return NextResponse.json({ ok: true, status: 'paid', card: cap.cardBrand && cap.cardLast4 ? `${cap.cardBrand} ····${cap.cardLast4}` : null })
}
