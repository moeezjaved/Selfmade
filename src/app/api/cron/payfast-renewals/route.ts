/**
 * Daily subscription renewals + period-end downgrades (PayPal).
 * (Filename kept as payfast-renewals for the existing Vercel cron schedule — PayFast is retired.)
 *   1) Cancelled subs (any provider) past period end → downgrade to Free.
 *   2) Active PayPal card subs near period end → silently charge the vaulted card → extend + refill.
 *      Past the grace window and still unpaid → mark past_due (recoverable).
 * Auth: CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { PLANS, type PlanId } from '@/lib/plans'
import { chargeVaultedCard, makeBasketId } from '@/lib/paypal'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const GRACE_DAYS = 3

function authorized(req: NextRequest): boolean {
  const s = process.env.CRON_SECRET
  if (!s) return false
  return req.headers.get('authorization') === `Bearer ${s}` || req.nextUrl.searchParams.get('secret') === s
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const now = Date.now()
  const dueBy = new Date(now + 3 * 86400e3).toISOString()   // renew within 3 days

  // ── Cancelled subscriptions (any provider) that reached period end → downgrade to Free now. ──
  let downgraded = 0
  const { data: cancelled } = await admin.from('subscriptions')
    .select('owner_id, plan, current_period_end')
    .eq('status', 'canceled').neq('plan', 'free').lte('current_period_end', new Date(now).toISOString()).limit(500)
  for (const c of cancelled || []) {
    await admin.rpc('apply_plan', { p_user: c.owner_id, p_plan: 'free', p_reset: null }).then(() => {}, () => {})
    await admin.from('subscriptions').update({ plan: 'free', updated_at: new Date().toISOString() }).eq('owner_id', c.owner_id)
    await admin.from('user_profiles').update({ plan_id: 'free' }).eq('user_id', c.owner_id).then(() => {}, () => {})
    downgraded++
  }

  // ── PayPal card (ACDC) auto-renewals — charge the vaulted card silently, no customer action. ──
  let cardCharged = 0, cardFailed = 0
  const { data: cardSubs } = await admin.from('subscriptions')
    .select('owner_id, plan, billing_cycle, current_period_end, paypal_vault_id')
    .eq('provider', 'paypal').eq('status', 'active').not('paypal_vault_id', 'is', null)
    .lte('current_period_end', dueBy).limit(500)
  for (const s of cardSubs || []) {
    const plan = PLANS[s.plan as PlanId]
    if (!plan || s.plan === 'free' || s.plan === 'enterprise') continue
    const annual = s.billing_cycle === 'annual'
    const usd = annual ? plan.priceAnnualMonthly * 12 : plan.priceMonthly
    const periodEndMs = s.current_period_end ? new Date(s.current_period_end).getTime() : now
    const basketId = makeBasketId('REN')
    await admin.from('paypal_orders').insert({ basket_id: basketId, user_id: s.owner_id, kind: 'subscription', plan: s.plan, billing_cycle: s.billing_cycle, amount: usd, currency: 'USD', status: 'pending' }).then(() => {}, () => {})
    const res = await chargeVaultedCard({ vaultId: s.paypal_vault_id as string, amountUsd: usd, customId: basketId, description: `Selfmade — ${plan.label} renewal` })
    if (res.ok) {
      const newEnd = new Date(Math.max(now, periodEndMs) + (annual ? 365 : 30) * 86400e3).toISOString()
      await admin.from('subscriptions').update({ current_period_end: newEnd, updated_at: new Date().toISOString() }).eq('owner_id', s.owner_id)
      await admin.rpc('apply_plan', { p_user: s.owner_id, p_plan: s.plan, p_reset: newEnd }).then(() => {}, () => {})
      await admin.from('paypal_orders').update({ status: 'paid', transaction_id: res.transactionId, paid_at: new Date().toISOString() }).eq('basket_id', basketId)
      cardCharged++
    } else {
      await admin.from('paypal_orders').update({ status: 'failed', err_code: 'DECLINED' }).eq('basket_id', basketId)
      if (periodEndMs < now - GRACE_DAYS * 86400e3) {
        await admin.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('owner_id', s.owner_id)
      }
      cardFailed++
    }
  }

  return NextResponse.json({ ok: true, downgraded, cardCharged, cardFailed })
}
