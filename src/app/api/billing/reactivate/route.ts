/**
 * POST /api/billing/reactivate — undo a cancel-at-period-end. Our cancel is soft: it flips status to
 * 'canceled' but KEEPS the plan + current_period_end, so access runs to period end. Reactivating just
 * flips status back to 'active' — the subscription record is intact, nothing to re-charge, and the
 * renewals cron resumes. Only valid while still in the paid period (before the cron downgrades to Free).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBillingOwner } from '@/lib/org'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const owner = await resolveBillingOwner(admin, user.id)

  const { data: sub } = await admin.from('subscriptions').select('plan, status, current_period_end, provider, paypal_subscription_id').eq('owner_id', owner).maybeSingle()
  if (!sub || sub.plan === 'free') return NextResponse.json({ error: 'No paid plan to reactivate — pick a plan to subscribe.' }, { status: 400 })
  if (sub.status === 'active') return NextResponse.json({ ok: true, alreadyActive: true })

  // LIVE-AGREEMENT CHECK: our cancel calls PayPal's real cancel, so the agreement is usually DEAD after a
  // cancel. Only silent-resume (flip status) when PayPal confirms the subscription is still ACTIVE — else
  // the user would get the plan back with no way to bill them (free rider). If it's not live, tell the
  // client to run a FRESH PayPal checkout instead of flipping.
  let agreementLive = false
  if (sub.provider === 'paypal' && sub.paypal_subscription_id) {
    try {
      const { getSubscription } = await import('@/lib/paypal')
      const ps = await getSubscription(sub.paypal_subscription_id)
      agreementLive = String((ps as any)?.status || '').toUpperCase() === 'ACTIVE'
    } catch { agreementLive = false }
  }

  if (!agreementLive) {
    // No live billing agreement → must re-subscribe (fresh checkout). Do NOT grant access for free.
    return NextResponse.json({ needsCheckout: true, plan: sub.plan, message: 'Your billing was cancelled — reactivate by subscribing again.' })
  }

  // Live agreement still on file → safe to resume without a new charge.
  await admin.from('subscriptions').update({ status: 'active', updated_at: new Date().toISOString() }).eq('owner_id', owner)
  await admin.from('user_profiles').update({ subscription_status: 'active' }).eq('user_id', owner).then(() => {}, () => {})
  try {
    await admin.from('activity_logs').insert({ user_id: user.id, action_type: 'SUBSCRIPTION_REACTIVATED', entity_type: 'subscription', description: `Reactivated ${sub.plan} plan (live agreement)`, performed_by: 'user' })
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, plan: sub.plan })
}
