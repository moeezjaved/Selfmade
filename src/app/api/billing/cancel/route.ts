/**
 * POST /api/billing/cancel — cancel the PayFast subscription. There's no card auto-charging yet, so
 * "cancel" means: mark the subscription cancelled, stop renewal reminders, and KEEP access until the
 * current period ends (then the renewals cron downgrades to Free). Charged to the billing owner.
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

  const { data: sub } = await admin.from('subscriptions').select('plan, status, current_period_end, provider').eq('owner_id', owner).maybeSingle()
  if (!sub || sub.plan === 'free' || sub.status === 'canceled') {
    return NextResponse.json({ ok: true, alreadyCancelled: true })
  }

  // Mark cancelled but leave the plan + period end intact — access runs out at period end, when the
  // payfast-renewals cron downgrades to Free. Stops renewal reminders (cron only nudges 'active').
  await admin.from('subscriptions').update({
    status: 'canceled', payfast_renewal_notified_at: null, updated_at: new Date().toISOString(),
  }).eq('owner_id', owner)
  await admin.from('user_profiles').update({ subscription_status: 'canceled' }).eq('user_id', owner).then(() => {}, () => {})
  try {
    await admin.from('activity_logs').insert({ user_id: user.id, action_type: 'SUBSCRIPTION_CANCELLED', entity_type: 'subscription', description: `Cancelled ${sub.plan} plan — access until period end`, performed_by: 'user' })
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, accessUntil: sub.current_period_end })
}
