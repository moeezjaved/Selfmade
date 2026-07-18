/**
 * Admin — who subscribed to what. Joins user_profiles (plan) + subscriptions (status/cycle) +
 * credit_wallets (balances) + auth email. Admin-gated.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { getAuthUsers } from '@/lib/admin/users'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const { data: profiles } = await admin.from('user_profiles')
    .select('user_id, full_name, plan_id, subscription_status, created_at').limit(2000)
  const ids = (profiles || []).map((p: any) => p.user_id)
  if (ids.length === 0) return NextResponse.json({ rows: [] })

  const [authUsers, { data: wallets }, { data: subs }, { data: txns }] = await Promise.all([
    getAuthUsers(admin),
    admin.from('credit_wallets').select('owner_id, plan_credits_balance, topup_credits_balance').in('owner_id', ids),
    admin.from('subscriptions').select('owner_id, plan, status, billing_cycle, current_period_end').in('owner_id', ids),
    // Credits USED = sum of committed debits (negative deltas) from the ledger. Refunded/reserved excluded.
    admin.from('credit_transactions').select('user_id, delta').eq('status', 'committed').lt('delta', 0).in('user_id', ids),
  ])
  const emailMap = Object.fromEntries(Array.from(authUsers.entries()).map(([id, u]: any) => [id, u]))
  const walletMap = Object.fromEntries((wallets || []).map((w: any) => [w.owner_id, w]))
  const subMap = Object.fromEntries((subs || []).map((s: any) => [s.owner_id, s]))
  const usedMap: Record<string, number> = {}
  for (const t of (txns || []) as any[]) usedMap[t.user_id] = (usedMap[t.user_id] || 0) + Math.abs(t.delta || 0)

  const rows = (profiles || []).map((p: any) => {
    const s = subMap[p.user_id], w = walletMap[p.user_id], e = emailMap[p.user_id]
    return {
      user_id: p.user_id,
      email: e?.email || '',
      name: p.full_name || '',
      plan: s?.plan || p.plan_id || 'free',
      status: s?.status || p.subscription_status || 'active',
      cycle: s?.billing_cycle || 'monthly',
      plan_credits: w?.plan_credits_balance ?? 0,
      topup_credits: w?.topup_credits_balance ?? 0,
      credits_used: usedMap[p.user_id] || 0,
      renews: s?.current_period_end || null,
      last_active: e?.last_sign_in_at || null,
      joined: p.created_at || null,
    }
  }).sort((a: any, b: any) => (b.joined || '').localeCompare(a.joined || ''))

  const byPlan: Record<string, number> = {}
  for (const r of rows) byPlan[r.plan] = (byPlan[r.plan] || 0) + 1
  return NextResponse.json({ rows, byPlan, total: rows.length })
}
