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

  const { data: sub } = await admin.from('subscriptions').select('plan, status, current_period_end').eq('owner_id', owner).maybeSingle()
  if (!sub || sub.plan === 'free') return NextResponse.json({ error: 'No paid plan to reactivate — pick a plan to subscribe.' }, { status: 400 })
  if (sub.status === 'active') return NextResponse.json({ ok: true, alreadyActive: true })
  // Period already lapsed → the paid access is gone; they need a fresh checkout, not a flip.
  if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
    return NextResponse.json({ error: 'Your paid period has ended — subscribe again to restore access.' }, { status: 400 })
  }

  await admin.from('subscriptions').update({ status: 'active', updated_at: new Date().toISOString() }).eq('owner_id', owner)
  await admin.from('user_profiles').update({ subscription_status: 'active' }).eq('user_id', owner).then(() => {}, () => {})
  try {
    await admin.from('activity_logs').insert({ user_id: user.id, action_type: 'SUBSCRIPTION_REACTIVATED', entity_type: 'subscription', description: `Reactivated ${sub.plan} plan`, performed_by: 'user' })
  } catch { /* non-fatal */ }

  return NextResponse.json({ ok: true, plan: sub.plan })
}
