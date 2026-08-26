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

  // ── Audit → activation funnel (the lead-magnet theater). Every completed public scan is stored in
  // audit_scans (no login). claimed_by fills in once that founder signs up + connects the domain, so an
  // UNCLAIMED scan = someone who completed the audit but never signed up. ──
  const { data: scans } = await admin
    .from('audit_scans')
    .select('domain, site_name, score, category, claimed_by, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  const allScans = scans || []
  const auditsCompleted = allScans.length
  const claimedIds = Array.from(new Set(allScans.filter((s: any) => s.claimed_by).map((s: any) => s.claimed_by)))
  const anonymousAudits = allScans
    .filter((s: any) => !s.claimed_by)
    .map((s: any) => ({ domain: s.domain, site_name: s.site_name, score: s.score, category: s.category, created_at: s.created_at }))

  // Activation among the founders who DID claim their audit.
  let connected = 0, generatedAd = 0, paidFromAudit = 0
  if (claimedIds.length) {
    const [storesR, metaR, creativesR, subsR] = await Promise.all([
      admin.from('shopify_stores').select('user_id').in('user_id', claimedIds),
      admin.from('meta_accounts').select('user_id').in('user_id', claimedIds).eq('status', 'active'),
      admin.from('creative_generations').select('user_id').in('user_id', claimedIds),
      admin.from('subscriptions').select('owner_id, status').in('owner_id', claimedIds),
    ])
    const connectedSet = new Set<string>()
    for (const r of (storesR.data || [])) connectedSet.add((r as any).user_id)
    for (const r of (metaR.data || [])) connectedSet.add((r as any).user_id)
    connected = connectedSet.size
    generatedAd = new Set((creativesR.data || []).map((r: any) => r.user_id)).size
    paidFromAudit = new Set((subsR.data || []).filter((r: any) => ['active', 'trialing'].includes(String(r.status))).map((r: any) => r.owner_id)).size
  }
  const signedUpFromAudit = claimedIds.length
  const pct = (n: number) => (auditsCompleted > 0 ? Math.round((n / auditsCompleted) * 100) : 0)

  return NextResponse.json({
    // Old M4 ads funnel (kept).
    steps: [
      { label: 'Signup', count: signups, pct: 100 },
      { label: 'Ad Plan', count: adPlan, pct: signups > 0 ? Math.round((adPlan / signups) * 100) : 0 },
      { label: 'Campaign Launched', count: launched, pct: signups > 0 ? Math.round((launched / signups) * 100) : 0 },
      { label: 'Scale', count: scaled, pct: signups > 0 ? Math.round((scaled / signups) * 100) : 0 },
      { label: 'Paid', count: paid, pct: signups > 0 ? Math.round((paid / signups) * 100) : 0 },
    ],
    // New audit → activation funnel.
    auditFunnel: [
      { label: 'Audit completed', count: auditsCompleted, pct: 100 },
      { label: 'Signed up', count: signedUpFromAudit, pct: pct(signedUpFromAudit) },
      { label: 'Connected store/Meta', count: connected, pct: pct(connected) },
      { label: 'Generated an ad', count: generatedAd, pct: pct(generatedAd) },
      { label: 'Paid', count: paidFromAudit, pct: pct(paidFromAudit) },
    ],
    anonymousAuditsCount: anonymousAudits.length,
    anonymousAudits: anonymousAudits.slice(0, 200),
  })
}
