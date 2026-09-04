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

  // ── Audit → activation funnel. Since the Aug-2026 "signup-first / audit IS onboarding" refactor, the
  // audit writes `audit_leads` (email + brand + domain, then converted_user_id on signup) — NOT the
  // retired anonymous audit_scans/ads_audit_scans. So the funnel reads audit_leads: every row = someone
  // who ran the audit and entered their details; status='converted' (converted_user_id set) = signed up. ──
  const { data: leadsRaw } = await admin
    .from('audit_leads')
    .select('email, domain, brand_name, status, converted_user_id, created_at')
    .order('created_at', { ascending: false })
    .limit(2000)
  const leads = leadsRaw || []

  // ALSO include the OLD anonymous audits (pre-refactor audit_scans / ads_audit_scans) so the funnel keeps
  // the full history — the brands that scanned before the signup-first flow existed. Merged with the new
  // audit_leads below, they form one complete "who audited" picture.
  const [{ data: seoScans }, { data: adsScans }] = await Promise.all([
    admin.from('audit_scans').select('domain, site_name, score, category, claimed_by, created_at').order('created_at', { ascending: false }).limit(1000),
    admin.from('ads_audit_scans').select('page_id, brand_name, niche, score, claimed_by, created_at').order('created_at', { ascending: false }).limit(1000),
  ])
  const oldSeo = seoScans || [], oldAds = adsScans || []

  const auditsCompleted = leads.length + oldSeo.length + oldAds.length
  const adsCompleted = leads.filter((l: any) => !l.domain).length + oldAds.length

  // signup-first flow: a lead's email == their account email. `converted_user_id` is only set on
  // PAYMENT (see paypal grant), so resolve "signed up" by matching the lead email to a registered
  // account — otherwise everyone who signed up but hasn't paid wrongly shows as a non-signup.
  const emailToId = new Map<string, string>()
  let allUsers: any[] = []
  try {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
    allUsers = list?.users || []
    for (const u of allUsers) if (u.email) emailToId.set(String(u.email).toLowerCase(), u.id)
  } catch { /* best-effort */ }
  const leadUserId = (l: any): string | null => l.converted_user_id || emailToId.get(String(l.email || '').toLowerCase()) || null

  // Signed-up = new leads that resolved to an account + old scans that were claimed.
  const convertedIds = Array.from(new Set([
    ...leads.map(leadUserId).filter(Boolean),
    ...oldSeo.filter((s: any) => s.claimed_by).map((s: any) => s.claimed_by),
    ...oldAds.filter((s: any) => s.claimed_by).map((s: any) => s.claimed_by),
  ])) as string[]

  // Everyone who audited but hasn't signed up — the hot-lead list ("which brands/sites are auditing").
  // New leads (with a captured email) + old anonymous SEO/ADS scans that were never claimed.
  const anonymousAudits = [
    ...leads.filter((l: any) => !leadUserId(l)).map((l: any) => ({
      type: l.domain ? 'seo' : 'ads', domain: l.domain, page_id: null,
      site_name: l.brand_name || l.domain || l.email, score: null, category: null,
      email: l.email, status: l.status, created_at: l.created_at,
    })),
    ...oldSeo.filter((s: any) => !s.claimed_by).map((s: any) => ({
      type: 'seo', domain: s.domain, page_id: null, site_name: s.site_name, score: s.score, category: s.category,
      email: null, status: null, created_at: s.created_at,
    })),
    ...oldAds.filter((s: any) => !s.claimed_by).map((s: any) => ({
      type: 'ads', domain: null, page_id: s.page_id, site_name: s.brand_name, score: s.score, category: s.niche,
      email: null, status: null, created_at: s.created_at,
    })),
  ].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))

  // Activation among the founders whose audit lead CONVERTED to an account.
  let connected = 0, generatedAd = 0, paidFromAudit = 0
  if (convertedIds.length) {
    const [storesR, metaR, creativesR, subsR] = await Promise.all([
      admin.from('shopify_stores').select('user_id').in('user_id', convertedIds),
      admin.from('meta_accounts').select('user_id').in('user_id', convertedIds).eq('status', 'active'),
      admin.from('creative_generations').select('user_id').in('user_id', convertedIds),
      admin.from('subscriptions').select('owner_id, status').in('owner_id', convertedIds),
    ])
    const connectedSet = new Set<string>()
    for (const r of (storesR.data || [])) connectedSet.add((r as any).user_id)
    for (const r of (metaR.data || [])) connectedSet.add((r as any).user_id)
    connected = connectedSet.size
    generatedAd = new Set((creativesR.data || []).map((r: any) => r.user_id)).size
    paidFromAudit = new Set((subsR.data || []).filter((r: any) => ['active', 'trialing'].includes(String(r.status))).map((r: any) => r.owner_id)).size
  }
  const signedUpFromAudit = convertedIds.length
  const pct = (n: number) => (auditsCompleted > 0 ? Math.round((n / auditsCompleted) * 100) : 0)

  // ── EVERY recent signup + the furthest stage they reached — so no new account is invisible. Answers
  // "this person signed up, what happened to them?" by cross-referencing the account tables. ──
  const recent = [...allUsers]
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, 100)
  const recentIds = recent.map((u) => u.id)
  let recentSignups: any[] = []
  if (recentIds.length) {
    const [stR, mtR, cgR, subR, asR] = await Promise.all([
      admin.from('shopify_stores').select('user_id').in('user_id', recentIds),
      admin.from('meta_accounts').select('user_id').in('user_id', recentIds).eq('status', 'active'),
      admin.from('creative_generations').select('user_id').in('user_id', recentIds),
      admin.from('subscriptions').select('owner_id, status').in('owner_id', recentIds),
      admin.from('activity_logs').select('user_id').eq('action_type', 'AUDIT_STARTED').in('user_id', recentIds),
    ])
    const paidSet = new Set((subR.data || []).filter((r: any) => ['active', 'trialing'].includes(String(r.status))).map((r: any) => r.owner_id))
    const genSet = new Set((cgR.data || []).map((r: any) => r.user_id))
    const connSet = new Set<string>([...(stR.data || []).map((r: any) => r.user_id), ...(mtR.data || []).map((r: any) => r.user_id)])
    const startedSet = new Set((asR.data || []).map((r: any) => r.user_id))
    // user id → their audit lead (a COMPLETED audit), for brand + stage
    const leadByUser = new Map<string, any>()
    for (const l of leads) { const uid = leadUserId(l); if (uid) leadByUser.set(uid, l) }
    const stageOf = (uid: string): string => {
      if (paidSet.has(uid)) return 'paid'
      if (genSet.has(uid)) return 'generated'
      if (connSet.has(uid)) return 'connected'
      if (leadByUser.has(uid)) return 'audit_done'
      if (startedSet.has(uid)) return 'audit_started'
      return 'signed_up'
    }
    recentSignups = recent.map((u) => {
      const lead = leadByUser.get(u.id)
      return {
        email: u.email || null,
        created_at: u.created_at || null,
        provider: (u.app_metadata?.provider || u.app_metadata?.providers?.[0] || 'email'),
        stage: stageOf(u.id),
        brand: lead ? (lead.brand_name || lead.domain || null) : null,
      }
    })
  }

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
    auditsCompletedSeo: auditsCompleted,
    auditsCompletedAds: adsCompleted,
    // Every recent signup + the furthest stage they reached (newest first).
    recentSignups,
  })
}
