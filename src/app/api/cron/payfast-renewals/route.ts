/**
 * Daily PayFast subscription renewals. For each active PayFast subscription at/near its period end:
 *   1) If a recurring-charge endpoint is configured (PAYFAST_RECURRING_URL) + we have the card token,
 *      re-charge silently → extend the period + refill plan credits.
 *   2) Otherwise (or if the silent charge fails), email the founder a one-tap re-pay link, once per
 *      cycle, so no subscription lapses without warning.
 *   3) If it's been past due beyond the grace window and still unpaid, mark past_due.
 * Auth: CRON_SECRET. Idempotent via payfast_renewal_notified_at.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { chargeWithToken, makeBasketId, chargeAmount, CURRENCY } from '@/lib/payfast'
import { PLANS, type PlanId } from '@/lib/plans'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
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

  const { data: subs } = await admin.from('subscriptions')
    .select('owner_id, plan, billing_cycle, status, current_period_end, payfast_instrument_token, payfast_renewal_notified_at')
    .eq('provider', 'payfast').eq('status', 'active').lte('current_period_end', dueBy).limit(500)

  // Cancelled subscriptions that have reached period end → downgrade to Free now (access ran out).
  let downgraded = 0
  const { data: cancelled } = await admin.from('subscriptions')
    .select('owner_id, plan, current_period_end')
    .eq('provider', 'payfast').eq('status', 'canceled').neq('plan', 'free').lte('current_period_end', new Date(now).toISOString()).limit(500)
  for (const c of cancelled || []) {
    await admin.rpc('apply_plan', { p_user: c.owner_id, p_plan: 'free', p_reset: null }).then(() => {}, () => {})
    await admin.from('subscriptions').update({ plan: 'free', updated_at: new Date().toISOString() }).eq('owner_id', c.owner_id)
    await admin.from('user_profiles').update({ plan_id: 'free' }).eq('user_id', c.owner_id).then(() => {}, () => {})
    downgraded++
  }

  let charged = 0, emailed = 0, pastDue = 0
  for (const s of subs || []) {
    const plan = PLANS[s.plan as PlanId]
    if (!plan || s.plan === 'free' || s.plan === 'enterprise') continue
    const annual = s.billing_cycle === 'annual'
    const amount = chargeAmount(annual ? plan.priceAnnualMonthly * 12 : plan.priceMonthly)
    const periodEndMs = s.current_period_end ? new Date(s.current_period_end).getTime() : now

    // 1) Silent re-charge if we can.
    if (s.payfast_instrument_token) {
      const basketId = makeBasketId('REN')
      await admin.from('payfast_orders').insert({ basket_id: basketId, user_id: s.owner_id, kind: 'subscription', plan: s.plan, billing_cycle: s.billing_cycle, amount, currency: CURRENCY, status: 'pending' }).then(() => {}, () => {})
      const res = await chargeWithToken({ instrumentToken: s.payfast_instrument_token, basketId, amount, description: `Selfmade — ${plan.label} renewal` })
      if (res.ok) {
        const newEnd = new Date(Math.max(now, periodEndMs) + (annual ? 365 : 30) * 86400e3).toISOString()
        await admin.from('subscriptions').update({ current_period_end: newEnd, payfast_renewal_notified_at: null, updated_at: new Date().toISOString() }).eq('owner_id', s.owner_id)
        await admin.rpc('apply_plan', { p_user: s.owner_id, p_plan: s.plan, p_reset: newEnd }).then(() => {}, () => {})
        await admin.from('payfast_orders').update({ status: 'paid', transaction_id: res.transactionId, paid_at: new Date().toISOString() }).eq('basket_id', basketId)
        charged++
        continue
      }
      // else fall through to email (silent charge unavailable or declined)
      await admin.from('payfast_orders').update({ status: 'failed', err_code: res.needsSpec ? 'NO_ENDPOINT' : 'DECLINED' }).eq('basket_id', basketId)
    }

    // 3) Past grace and still unpaid → mark past_due (don't hard-wipe; keep it recoverable).
    if (periodEndMs < now - GRACE_DAYS * 86400e3) {
      await admin.from('subscriptions').update({ status: 'past_due', updated_at: new Date().toISOString() }).eq('owner_id', s.owner_id)
      pastDue++
      continue
    }

    // 2) Email a one-tap re-pay link — once per cycle.
    const alreadyNotified = s.payfast_renewal_notified_at && new Date(s.payfast_renewal_notified_at).getTime() > periodEndMs - 5 * 86400e3
    if (alreadyNotified) continue
    try {
      const { data: prof } = await admin.from('profiles').select('email').eq('id', s.owner_id).maybeSingle()
      const { data: authUser } = await admin.auth.admin.getUserById(s.owner_id).then((r: any) => ({ data: r?.data?.user }), () => ({ data: null }))
      const to = (prof as any)?.email || authUser?.email
      if (to) {
        const { sendEmail, emailShell } = await import('@/lib/email')
        await sendEmail(to, `Your Selfmade ${plan.label} plan renews soon`, emailShell({
          title: `Keep Mello working — renew your ${plan.label} plan`,
          intro: `Your ${plan.label} plan is up for renewal. Tap below to renew in a few seconds and keep your videos, brief, and campaign tools running without a gap.`,
          ctaText: 'Renew now', ctaUrl: `${APP_URL}/billing/renew`,
        }))
        await admin.from('subscriptions').update({ payfast_renewal_notified_at: new Date().toISOString() }).eq('owner_id', s.owner_id)
        emailed++
      }
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, considered: subs?.length || 0, charged, emailed, pastDue, downgraded })
}
