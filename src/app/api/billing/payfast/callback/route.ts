/**
 * POST /api/billing/payfast/callback — PayFast's IPN (server-to-server) hits this on every
 * transaction. We VERIFY the validation hash (SHA256 basket_id|secured_key|merchant_id|err_code),
 * then on err_code '000' grant the order exactly once (idempotent) and store the recurring
 * instrument_token. No user session here — the hash is the auth. Always 200 on a received IPN
 * (per PayFast spec) unless the hash is invalid.
 *
 * Also accepts GET (some gateways probe the URL) → 200 OK.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashMatches } from '@/lib/payfast'
import { PLANS, type PlanId } from '@/lib/plans'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() { return NextResponse.json({ ok: true }) }

export async function POST(req: NextRequest) {
  // PayFast may send form-encoded or query-string params — read both.
  const params: Record<string, string> = {}
  req.nextUrl.searchParams.forEach((v, k) => { params[k] = v })
  try {
    const ct = req.headers.get('content-type') || ''
    if (ct.includes('application/json')) Object.assign(params, await req.json())
    else {
      const form = await req.formData()
      form.forEach((v, k) => { params[k] = String(v) })
    }
  } catch { /* query-string only */ }

  const basketId = params.basket_id || params.BASKET_ID || ''
  const errCode = params.err_code || params.ERR_CODE || ''
  const received = params.validation_hash || params.VALIDATION_HASH || ''
  const txnId = params.transaction_id || params.TRANSACTION_ID || null
  const token = params.Instrument_token || params.instrument_token || params.token || null

  if (!basketId || !errCode) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  // Integrity gate — reject anything whose hash we can't reproduce.
  if (!hashMatches(basketId, errCode, received)) {
    console.warn(`⚠️ PayFast IPN hash mismatch for ${basketId} (err ${errCode})`)
    return NextResponse.json({ error: 'invalid_hash' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin.from('payfast_orders').select('*').eq('basket_id', basketId).maybeSingle()
  if (!order) return NextResponse.json({ received: true, note: 'unknown_basket' })
  if (order.status === 'paid') return NextResponse.json({ received: true, note: 'already_paid' })  // idempotent

  const success = errCode === '000'
  if (!success) {
    await admin.from('payfast_orders').update({ status: 'failed', err_code: errCode, transaction_id: txnId, raw: params }).eq('basket_id', basketId)
    return NextResponse.json({ received: true })
  }

  // ── Grant, exactly once. ──
  try {
    if (order.kind === 'topup' && order.credits) {
      await admin.rpc('grant_topup_pack', { p_user: order.user_id, p_credits: order.credits, p_amount: Number(order.amount), p_stripe: `payfast:${txnId || basketId}` })
    } else if (order.kind === 'subscription' && order.plan) {
      const pl = PLANS[order.plan as PlanId]
      const now = new Date()
      const periodEnd = new Date(now.getTime() + (order.billing_cycle === 'annual' ? 365 : 30) * 86400e3)
      await admin.from('subscriptions').upsert({
        owner_id: order.user_id, plan: order.plan, billing_cycle: order.billing_cycle,
        status: 'active', current_period_end: periodEnd.toISOString(),
        payfast_instrument_token: token || null, provider: 'payfast', updated_at: now.toISOString(),
      }, { onConflict: 'owner_id' })
      await admin.rpc('apply_plan', { p_user: order.user_id, p_plan: order.plan, p_reset: periodEnd.toISOString() })
      void pl
    }
    await admin.from('payfast_orders').update({ status: 'paid', err_code: errCode, transaction_id: txnId, instrument_token: token, paid_at: new Date().toISOString(), raw: params }).eq('basket_id', basketId)
    try {
      await admin.from('activity_logs').insert({ user_id: order.user_id, action_type: 'PAYMENT_SUCCESS', entity_type: 'payfast_order', description: `PayFast ${order.kind} paid — ${order.amount} PKR (${basketId})`, performed_by: 'payfast' })
    } catch { /* non-fatal */ }
  } catch (e: any) {
    // Grant failed AFTER a real payment — do NOT mark paid; leave pending + alert so it can be fixed.
    console.error(`PayFast grant failed for ${basketId}:`, e?.message)
    try {
      const { sendAdminAlert } = await import('@/lib/email')
      await sendAdminAlert(`⚠️ PayFast paid but grant failed — ${basketId}`, `<p>User <b>${order.user_id}</b> paid (${order.amount} PKR, txn ${txnId}) but the credit/plan grant threw:</p><p>${String(e?.message).slice(0, 300)}</p><p>Reconcile manually.</p>`)
    } catch { /* best-effort */ }
    return NextResponse.json({ received: true, note: 'grant_deferred' })
  }

  return NextResponse.json({ received: true })
}
