/**
 * Admin: override a user's plan and/or grant credits (spec §5, §10 — support + Enterprise).
 * POST { userId, plan?, grantCredits?, monthlyCreditsOverride? } → applies via apply_plan + grant_credits.
 * Admin-token gated.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminToken } from '@/lib/admin/auth'
import { PLANS, type PlanId } from '@/lib/plans'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { userId, plan, grantCredits, monthlyCreditsOverride } = await req.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const admin = createAdminClient()

  if (plan) {
    if (!(plan in PLANS)) return NextResponse.json({ error: 'invalid_plan' }, { status: 400 })
    // Enterprise custom credits: store the override on the subscription, then apply.
    if (typeof monthlyCreditsOverride === 'number') {
      await admin.from('subscriptions').upsert({ owner_id: userId, plan, monthly_credits_override: monthlyCreditsOverride, status: 'active' }, { onConflict: 'owner_id' })
    } else {
      await admin.from('subscriptions').upsert({ owner_id: userId, plan, status: 'active' }, { onConflict: 'owner_id' })
    }
    await admin.rpc('apply_plan', { p_user: userId, p_plan: plan as PlanId, p_reset: null })
  }

  if (typeof grantCredits === 'number' && grantCredits !== 0) {
    await admin.rpc('grant_credits', { p_user: userId, p_credits: grantCredits, p_ref: 'admin_grant' })
  }

  const { data: wallet } = await admin.from('credit_wallets').select('plan_credits_balance, topup_credits_balance').eq('owner_id', userId).maybeSingle()
  const { data: prof } = await admin.from('user_profiles').select('plan_id').eq('user_id', userId).maybeSingle()
  return NextResponse.json({ ok: true, plan: (prof as any)?.plan_id, wallet })
}
