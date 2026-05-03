import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const page = parseInt(request.nextUrl.searchParams.get('page') || '1')
  const search = request.nextUrl.searchParams.get('search') || ''
  const perPage = 50

  // List auth users with pagination
  const { data: authData } = await admin.auth.admin.listUsers({ page, perPage })
  const authUsers = authData?.users || []

  // Get profiles for these users
  const userIds = authUsers.map(u => u.id)
  const { data: profiles } = await admin
    .from('user_profiles')
    .select('user_id, full_name, subscription_status, created_at')
    .in('user_id', userIds)

  const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]))

  let users = authUsers.map(u => ({
    id: u.id,
    email: u.email || '',
    full_name: profileMap[u.id]?.full_name || '',
    subscription_status: profileMap[u.id]?.subscription_status || 'trialing',
    created_at: profileMap[u.id]?.created_at || u.created_at,
    last_sign_in_at: u.last_sign_in_at || null,
  }))

  if (search) {
    const q = search.toLowerCase()
    users = users.filter(u => u.email.toLowerCase().includes(q) || u.full_name.toLowerCase().includes(q))
  }

  return NextResponse.json({ users, total: authData?.total || 0 })
}
