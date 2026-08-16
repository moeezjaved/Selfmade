import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { getPlanId } from '@/lib/entitlements'
import { PLANS } from '@/lib/plans'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const userId = params.id

  const [authRes, profileRes, campaignsRes, draftsRes, scaleRes, errorsRes, followsRes, creativesRes, brandsRes, m4Res] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from('user_profiles').select('*').eq('user_id', userId).single(),
    admin.from('campaigns').select('id, name, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    admin.from('campaign_drafts').select('id, created_at').eq('user_id', userId).limit(1),
    admin.from('activity_logs').select('id').eq('user_id', userId).ilike('action_type', '%scale%').limit(1),
    admin.from('error_logs').select('id, error_message, page_url, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(20),
    // Brands this user follows (spy/alerts) + their AI creatives.
    admin.from('followed_brands').select('page_id, brand_name, email_alerts, created_at').eq('user_id', userId).order('created_at', { ascending: false }),
    admin.from('creative_generations').select('id, type, tier, media_type, status, prompt, image_url, brand_id, source_ad_id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(60),
    admin.from('brands').select('id, name').eq('user_id', userId),
    // Did they engage the M4 launch flow at all (even a failed attempt)? Newly tracked as an activity.
    admin.from('activity_logs').select('id').eq('user_id', userId).ilike('action_type', 'M4%').limit(1),
  ])

  const authUser = authRes.data?.user
  const profile = profileRes.data

  // The REAL plan the app grants (subscriptions.plan / user_profiles.plan_id, most-generous) — NOT the
  // raw `subscription_status` string, which is a status (trialing/active), not a plan. A user comped to
  // Creator kept showing "Trialing" because the admin read the status field instead of the entitlement.
  const planId = await getPlanId(admin, userId).catch(() => 'free' as const)
  const planLabel = PLANS[planId]?.label || 'Free'

  const campaigns = campaignsRes.data || []
  const launched = campaigns.some((c: any) => c.status === 'ACTIVE' || c.status === 'PAUSED')
  const scaleClicked = (scaleRes.data?.length || 0) > 0
  // "Clicked Ad Plan (M4)" = engaged the M4 launch flow at all: a saved draft, a tracked M4 attempt,
  // OR (for attempts before we tracked them) an M4-launch error in their logs. A user who tried to
  // launch — even one that failed on a missing creative — has clearly reached M4.
  const errs = errorsRes.data || []
  const m4Attempted = (m4Res.data?.length || 0) > 0 || errs.some((e: any) => /^M4 Launch/i.test(e.error_message || '') || String(e.page_url || '') === '/m4')
  const adPlanClicked = (draftsRes.data?.length || 0) > 0 || m4Attempted

  // Map brand_id → name so each creative shows which brand it belongs to.
  const brandNames = new Map<string, string>((brandsRes.data || []).map((b: any) => [b.id, b.name]))
  const creatives = (creativesRes.data || []).map((c: any) => ({
    ...c,
    brand_name: c.brand_id ? brandNames.get(c.brand_id) || null : null,
  }))
  const follows = followsRes.data || []

  return NextResponse.json({
    id: userId,
    email: authUser?.email || '',
    full_name: profile?.full_name || '',
    subscription_status: profile?.subscription_status || 'trialing',
    plan: planId,            // resolved entitlement id (e.g. 'starter')
    plan_label: planLabel,   // human label (e.g. 'Creator') — the true plan, for the admin "Plan" row
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
    follows,
    creatives,
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
