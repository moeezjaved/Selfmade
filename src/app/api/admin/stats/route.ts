import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [totalRes, todayRes, activeRes, trialRes] = await Promise.all([
    admin.from('user_profiles').select('id', { count: 'exact', head: true }),
    admin.from('user_profiles').select('id', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
    admin.from('user_profiles').select('id', { count: 'exact', head: true }).eq('subscription_status', 'active'),
    admin.from('user_profiles').select('id', { count: 'exact', head: true }).eq('subscription_status', 'trialing'),
  ])

  const totalUsers = totalRes.count || 0
  const newToday = todayRes.count || 0
  const payingUsers = activeRes.count || 0   // only truly paid, not trialing
  const trialUsers = trialRes.count || 0
  const mrr = payingUsers * 99

  return NextResponse.json({ totalUsers, newToday, payingUsers, trialUsers, mrr })
}
