/**
 * POST /api/billing/paypal/callback — PayPal webhook (server-to-server). We VERIFY the signature
 * against PAYPAL_WEBHOOK_ID, then act on the event:
 *   BILLING.SUBSCRIPTION.ACTIVATED   → grant the plan (once), by custom_id = our basket id
 *   PAYMENT.SALE.COMPLETED           → recurring renewal → extend the subscription period
 *   BILLING.SUBSCRIPTION.CANCELLED / EXPIRED / SUSPENDED → downgrade to free
 *   PAYMENT.CAPTURE.COMPLETED        → top-up captured → grant credits (backup to return-capture)
 * Grants are idempotent (paypal_orders.status='paid'). Always 200 on a verified event so PayPal
 * stops retrying; 400 only on a signature we can't verify.
 *
 * GET → 200 (PayPal probes the URL).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyWebhook } from '@/lib/paypal'
import { grantPaypalOrder } from '@/lib/paypal/grant'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() { return NextResponse.json({ ok: true }) }

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const ok = await verifyWebhook(req.headers, raw)
  if (!ok) {
    console.warn('⚠️ PayPal webhook signature verification failed')
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 })
  }

  let event: any
  try { event = JSON.parse(raw) } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }) }
  const type: string = event?.event_type || ''
  const res = event?.resource || {}
  const admin = createAdminClient()

  try {
    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      const basketId = res.custom_id
      if (basketId) await grantPaypalOrder(admin, basketId, { subscriptionId: res.id, transactionId: res.id, raw: res })
    } else if (type === 'PAYMENT.CAPTURE.COMPLETED') {
      // One-time top-up capture. custom_id rides on the capture resource.
      const basketId = res.custom_id
      if (basketId) await grantPaypalOrder(admin, basketId, { transactionId: res.id, raw: res })
    } else if (type === 'PAYMENT.SALE.COMPLETED') {
      // Recurring renewal — extend the period end for the matching subscription.
      const subId = res.billing_agreement_id
      if (subId) {
        const { data: sub } = await admin.from('subscriptions').select('owner_id, billing_cycle, plan').eq('paypal_subscription_id', subId).maybeSingle()
        if (sub) {
          const days = sub.billing_cycle === 'annual' ? 365 : 30
          const periodEnd = new Date(Date.now() + days * 86400e3)
          await admin.from('subscriptions').update({ status: 'active', current_period_end: periodEnd.toISOString(), updated_at: new Date().toISOString() }).eq('paypal_subscription_id', subId)
          await admin.rpc('apply_plan', { p_user: sub.owner_id, p_plan: sub.plan, p_reset: periodEnd.toISOString() })
        }
      }
    } else if (type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      // Cancelled/suspended → KEEP access until the current period ends (they paid for this cycle).
      // Mark canceled; the renewals cron downgrades to Free once current_period_end passes.
      const subId = res.id
      if (subId) await admin.from('subscriptions').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('paypal_subscription_id', subId)
    } else if (type === 'BILLING.SUBSCRIPTION.EXPIRED') {
      // Fully ended → downgrade to Free now.
      const subId = res.id
      if (subId) {
        const { data: sub } = await admin.from('subscriptions').select('owner_id').eq('paypal_subscription_id', subId).maybeSingle()
        if (sub) {
          await admin.from('subscriptions').update({ status: 'canceled', plan: 'free', updated_at: new Date().toISOString() }).eq('paypal_subscription_id', subId)
          await admin.rpc('apply_plan', { p_user: sub.owner_id, p_plan: 'free', p_reset: null })
        }
      }
    }
  } catch (e: any) {
    // A verified event whose grant threw — do NOT 500 (PayPal would retry forever). Alert + 200.
    console.error(`PayPal webhook ${type} handler failed:`, e?.message)
    try {
      const { sendAdminAlert } = await import('@/lib/email')
      await sendAdminAlert(`⚠️ PayPal webhook ${type} failed`, `<p>Event ${event?.id} threw:</p><p>${String(e?.message).slice(0, 300)}</p><p>Reconcile manually.</p>`)
    } catch { /* best-effort */ }
    return NextResponse.json({ received: true, note: 'handler_deferred' })
  }

  return NextResponse.json({ received: true })
}
