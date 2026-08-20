import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { PLANS, type PlanId } from '@/lib/plans'
import type { User } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const page = parseInt(request.nextUrl.searchParams.get('page') || '1')
  const search = request.nextUrl.searchParams.get('search') || ''
  const perPage = 50

  // List auth users with pagination
  const { data: authData } = await admin.auth.admin.listUsers({ page, perPage })
  const authUsers: User[] = authData?.users || []

  // Get profiles for these users
  const userIds = authUsers.map((u: User) => u.id)
  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, full_name, subscription_status, plan_id, created_at')
    .in('user_id', userIds)

  type Profile = { user_id: string; full_name: string | null; subscription_status: string | null; plan_id: string | null; created_at: string | null }
  const profileMap = Object.fromEntries((profiles || []).map((p: Profile) => [p.user_id, p]))

  // Facebook-connected? Count active Meta ad accounts per user so the list shows who's linked (and how
  // many accounts) at a glance — the thing you want to see next to every user.
  const { data: metaRows } = await admin
    .from('meta_accounts')
    .select('user_id, status')
    .in('user_id', userIds)
  const metaCount: Record<string, number> = {}
  for (const m of (metaRows || [])) {
    if (String((m as any).status) === 'active') metaCount[(m as any).user_id] = (metaCount[(m as any).user_id] || 0) + 1
  }

  let users = authUsers.map((u: User) => {
    const planId = (profileMap[u.id]?.plan_id || 'free') as PlanId
    return {
    id: u.id,
    email: u.email || '',
    full_name: profileMap[u.id]?.full_name || '',
    subscription_status: profileMap[u.id]?.subscription_status || 'trialing',
    plan_id: planId,
    plan_label: PLANS[planId]?.label || planId,   // Free / Creator / Agency / … — the REAL plan
    created_at: profileMap[u.id]?.created_at || u.created_at,
    last_sign_in_at: u.last_sign_in_at || null,
    meta_accounts: metaCount[u.id] || 0,
    meta_connected: (metaCount[u.id] || 0) > 0,
    }
  })

  if (search) {
    const q = search.toLowerCase()
    users = users.filter(u => u.email.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q))
  }

  return NextResponse.json({ users, total: authData?.total || 0 })
}
