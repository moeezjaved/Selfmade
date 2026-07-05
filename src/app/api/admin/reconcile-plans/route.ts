/**
 * One-time (idempotent) reconcile of plan drift left by the pre-fix Stripe webhook, which didn't
 * sync `subscriptions.plan` on customer.subscription.updated (portal changes). Stripe is the source
 * of truth: for each subscription with a Stripe id, we read its CURRENT price → map to our tier via
 * planFromPriceId, and fix any row whose stored `plan` disagrees (+ apply_plan to refill entitlements).
 *
 *   GET  /api/admin/reconcile-plans        → DRY RUN: report drift, write nothing.
 *   POST /api/admin/reconcile-plans        → APPLY the fixes.
 *
 * Admin-only (admin_token cookie). Read-only for GET so it's safe to eyeball first.
 */
import { NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { stripe, planFromPriceId } from '@/lib/stripe'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function reconcile(apply: boolean) {
  const admin = createAdminClient() as any
  const { data: subs } = await admin
    .from('subscriptions')
    .select('owner_id, plan, status, stripe_subscription_id, current_period_end')
    .not('stripe_subscription_id', 'is', null)

  const drift: any[] = []
  const skipped: any[] = []
  let fixed = 0

  for (const s of (subs || []) as any[]) {
    // Only trust active/trialing subs; canceled/past_due are handled by their own webhook paths.
    if (!(s.status === 'active' || s.status === 'trialing')) { skipped.push({ owner_id: s.owner_id, reason: `status=${s.status}` }); continue }
    let stripeSub: any
    try { stripeSub = await stripe.subscriptions.retrieve(s.stripe_subscription_id) }
    catch (e: any) { skipped.push({ owner_id: s.owner_id, reason: `stripe: ${e?.message || e}` }); continue }

    // Ignore the seat add-on subscription — it isn't a plan.
    if (stripeSub.metadata?.type === 'seats') { skipped.push({ owner_id: s.owner_id, reason: 'seat add-on' }); continue }

    const priceId = stripeSub.items?.data?.[0]?.price?.id
    const truePlan = planFromPriceId(priceId)
    if (!truePlan) { skipped.push({ owner_id: s.owner_id, reason: `unknown price ${priceId}` }); continue }
    if (truePlan === s.plan) continue   // already correct

    drift.push({ owner_id: s.owner_id, from: s.plan, to: truePlan, priceId })
    if (apply) {
      await admin.from('subscriptions').update({ plan: truePlan, updated_at: new Date().toISOString() }).eq('owner_id', s.owner_id)
      await admin.rpc('apply_plan', { p_user: s.owner_id, p_plan: truePlan, p_reset: s.current_period_end || null })
      fixed++
    }
  }
  return { mode: apply ? 'applied' : 'dry_run', total: (subs || []).length, drift_count: drift.length, fixed, drift, skipped }
}

export async function GET() {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await reconcile(false))
}

export async function POST() {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await reconcile(true))
}
