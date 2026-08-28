/**
 * grantPaypalOrder — fulfil a paid PayPal order exactly once (idempotent via status='paid').
 * Shared by the webhook (subscriptions + top-up capture events) and the return-page capture route,
 * so whichever lands first grants, and the other is a no-op. Grants to the BILLING OWNER (shared org
 * wallet), mirroring the PayFast callback.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { PLANS, type PlanId } from '@/lib/plans'

export async function grantPaypalOrder(
  admin: SupabaseClient,
  basketId: string,
  meta: {
    transactionId?: string | null; subscriptionId?: string | null; raw?: any
    vaultId?: string | null; customerId?: string | null; cardBrand?: string | null; cardLast4?: string | null
  } = {},
): Promise<{ ok: boolean; note?: string }> {
  const { data: order } = await admin.from('paypal_orders').select('*').eq('basket_id', basketId).maybeSingle()
  if (!order) return { ok: false, note: 'unknown_basket' }
  if (order.status === 'paid') return { ok: true, note: 'already_paid' } // idempotent

  const { resolveBillingOwner } = await import('@/lib/org')
  const owner = await resolveBillingOwner(admin, order.user_id)

  if (order.kind === 'topup' && order.credits) {
    await admin.rpc('grant_topup_pack', {
      p_user: owner, p_credits: order.credits, p_amount: Number(order.amount),
      p_stripe: `paypal:${meta.transactionId || basketId}`,
    })
  } else if (order.kind === 'subscription' && order.plan) {
    const pl = PLANS[order.plan as PlanId]
    const now = new Date()
    const periodEnd = new Date(now.getTime() + (order.billing_cycle === 'annual' ? 365 : 30) * 86400e3)
    await admin.from('subscriptions').upsert({
      owner_id: owner, plan: order.plan, billing_cycle: order.billing_cycle,
      status: 'active', current_period_end: periodEnd.toISOString(),
      paypal_subscription_id: meta.subscriptionId || order.paypal_subscription_id || null,
      // Card (ACDC) path: store the vault token so the renewals cron can auto-charge monthly.
      ...(meta.vaultId ? { paypal_vault_id: meta.vaultId, paypal_customer_id: meta.customerId || null, card_brand: meta.cardBrand || null, card_last4: meta.cardLast4 || null } : {}),
      provider: 'paypal', updated_at: now.toISOString(),
    }, { onConflict: 'owner_id' })
    await admin.rpc('apply_plan', { p_user: owner, p_plan: order.plan, p_reset: periodEnd.toISOString() })
    void pl
    // They went PAID → stop the audit nurture drip (convert the lead). Match by the buyer's email.
    try {
      const { data: u } = await admin.auth.admin.getUserById(order.user_id)
      const email = u?.user?.email || ''
      if (email) { const { convertAuditLeads } = await import('@/lib/audit/leads'); await convertAuditLeads(admin, email, order.user_id) }
    } catch { /* best-effort */ }
  }

  await admin.from('paypal_orders').update({
    status: 'paid', transaction_id: meta.transactionId || null,
    ...(meta.vaultId ? { paypal_vault_id: meta.vaultId, card_brand: meta.cardBrand || null, card_last4: meta.cardLast4 || null } : {}),
    paid_at: new Date().toISOString(), raw: meta.raw || {},
  }).eq('basket_id', basketId)

  try {
    await admin.from('activity_logs').insert({
      user_id: order.user_id, action_type: 'PAYMENT_SUCCESS', entity_type: 'paypal_order',
      description: `PayPal ${order.kind} paid — $${order.amount} (${basketId})`, performed_by: 'paypal',
    })
  } catch { /* non-fatal */ }

  return { ok: true }
}
