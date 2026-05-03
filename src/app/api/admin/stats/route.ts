import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [totalRes, todayRes, payingRes] = await Promise.all([
    admin.from('user_profiles').select('id', { count: 'exact', head: true }),
    admin.from('user_profiles').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
    admin.from('user_profiles').select('id', { count: 'exact', head: true }).in('subscription_status', ['active', 'trialing']),
  ])

  const totalUsers = totalRes.count || 0
  const newToday = todayRes.count || 0
  const payingUsers = payingRes.count || 0
  const mrr = payingUsers * 99

  return NextResponse.json({ totalUsers, newToday, payingUsers, mrr })
}
