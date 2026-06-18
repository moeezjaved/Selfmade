import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const [signupRes, adPlanRes, launchRes, scaleRes, paidRes] = await Promise.all([
    // Signup = all users
    admin.from('user_profiles').select('id', { count: 'exact', head: true }),
    // Ad Plan = users who started M4 wizard (have a campaign_draft)
    admin.from('campaign_drafts').select('user_id', { count: 'exact', head: true }),
    // Campaign Launched = users with at least 1 campaign
    admin.from('campaigns').select('user_id', { count: 'exact', head: true }),
    // Scale = users who clicked scale (activity_log)
    admin.from('activity_logs').select('user_id', { count: 'exact', head: true }).ilike('action_type', '%scale%'),
    // Paid = active subscribers
    admin.from('user_profiles').select('id', { count: 'exact', head: true }).eq('subscription_status', 'active'),
  ])

  // Get distinct user counts for launch and scale (the count above counts rows, not distinct users)
  const [distinctLaunchRes, distinctScaleRes, distinctAdPlanRes] = await Promise.all([
    admin.from('campaigns').select('user_id').then((r: { data: { user_id: string }[] | null }) => new Set((r.data || []).map(x => x.user_id)).size),
    admin.from('activity_logs').select('user_id').ilike('action_type', '%scale%').then((r: { data: { user_id: string }[] | null }) => new Set((r.data || []).map(x => x.user_id)).size),
    admin.from('campaign_drafts').select('user_id').then((r: { data: { user_id: string }[] | null }) => new Set((r.data || []).map(x => x.user_id)).size),
  ])

  const signups = signupRes.count || 0
  const adPlan = distinctAdPlanRes
  const launched = distinctLaunchRes
  const scaled = distinctScaleRes
  const paid = paidRes.count || 0

  return NextResponse.json({
    steps: [
      { label: 'Signup', count: signups, pct: 100 },
      { label: 'Ad Plan', count: adPlan, pct: signups > 0 ? Math.round((adPlan / signups) * 100) : 0 },
      { label: 'Campaign Launched', count: launched, pct: signups > 0 ? Math.round((launched / signups) * 100) : 0 },
      { label: 'Scale', count: scaled, pct: signups > 0 ? Math.round((scaled / signups) * 100) : 0 },
      { label: 'Paid', count: paid, pct: signups > 0 ? Math.round((paid / signups) * 100) : 0 },
    ],
  })
}
