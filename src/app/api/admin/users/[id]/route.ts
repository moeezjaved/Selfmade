import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const userId = params.id

  const [authRes, profileRes, campaignsRes, draftsRes, scaleRes, errorsRes] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from('user_profiles').select('*').eq('user_id', userId).single(),
    admin.from('campaigns').select('id, name, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    admin.from('campaign_drafts').select('id, created_at').eq('user_id', userId).limit(1),
    admin.from('activity_logs').select('id').eq('user_id', userId).ilike('action_type', '%scale%').limit(1),
    admin.from('error_logs').select('id, error_message, page_url, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
  ])

  const authUser = authRes.data?.user
  const profile = profileRes.data

  const campaigns = campaignsRes.data || []
  const launched = campaigns.some((c: any) => c.status === 'ACTIVE' || c.status === 'PAUSED')
  const adPlanClicked = (draftsRes.data?.length || 0) > 0
  const scaleClicked = (scaleRes.data?.length || 0) > 0

  return NextResponse.json({
    id: userId,
    email: authUser?.email || '',
    full_name: profile?.full_name || '',
    subscription_status: profile?.subscription_status || 'trialing',
    created_at: profile?.created_at || authUser?.created_at,
    last_sign_in_at: authUser?.last_sign_in_at || null,
    business_type: profile?.business_type || '',
    niche: profile?.niche || '',
    experience_level: profile?.experience_level || '',
    trial_ends_at: profile?.trial_ends_at || null,
    // Funnel
    ad_plan_clicked: adPlanClicked,
    campaign_launched: launched,
    scale_clicked: scaleClicked,
    campaigns_count: campaigns.length,
    campaigns,
    errors: errorsRes.data || [],
  })
}

// PATCH — admin actions on a user. Currently: extend trial.
//   body: { action: 'extend_trial', days: number }
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const userId = params.id
  const body = await request.json().catch(() => ({}))

  if (body.action === 'extend_trial') {
    const days = parseInt(String(body.days), 10)
    if (!days || days < 1 || days > 365) {
      return NextResponse.json({ error: 'days must be between 1 and 365' }, { status: 400 })
    }
    // Extend from the LATER of now or the current trial end, so extending an
    // active trial adds time, and extending an expired one starts fresh from now.
    const { data: prof } = await admin
      .from('user_profiles').select('trial_ends_at').eq('user_id', userId).single()
    const now = Date.now()
    const currentEnd = prof?.trial_ends_at ? new Date(prof.trial_ends_at).getTime() : now
    const base = Math.max(now, currentEnd)
    const newEnd = new Date(base + days * 86_400_000).toISOString()

    const { error } = await admin
      .from('user_profiles')
      .update({ trial_ends_at: newEnd, subscription_status: 'trialing' })
      .eq('user_id', userId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, trial_ends_at: newEnd, days_added: days })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
