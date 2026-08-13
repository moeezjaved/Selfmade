/**
 * Phase 2.1 — Meta Reality Check harness. NOT a product feature: a repeatable verification surface so a
 * real connected account can be checked in one call. It runs each golden founder question through the
 * ACTUAL Mello pipeline (answerAdsQuestion — same router, parser, canonical service, provenance the /mello
 * and /brief chats use) and, alongside, the raw canonical audit numbers per period. The founder compares
 * the third leg (Meta Ads Manager, filtered to the shown account + date preset) by eye.
 *
 * Golden rule this enforces: Brief == Mello (same auditAccount + account + preset, by construction) and
 * both must == Meta. If a number is off, fix the canonical service before anything else.
 *
 * GET /api/debug/meta-parity?brand=<id>   (authed; audits the caller's active brand's account)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// The golden matrix — every measurable metric × the periods founders actually ask about, plus the
// comparisons. All resolve to the DETERMINISTIC path, so this is fast and the numbers are exact.
const GOLDEN: { group: string; q: string }[] = [
  { group: 'money', q: 'how much did we spend yesterday?' },
  { group: 'money', q: 'how much did we spend in the last 7 days?' },
  { group: 'money', q: 'how much did we spend this month?' },
  { group: 'money', q: "what's our roas?" },
  { group: 'money', q: 'how much revenue did facebook generate?' },
  { group: 'money', q: "what's our cpa?" },
  { group: 'orders', q: 'how many purchases did facebook generate?' },
  { group: 'orders', q: 'how many orders did we get from facebook?' },
  { group: 'orders', q: 'how many purchases did we get yesterday?' },
  { group: 'performance', q: "what's our ctr?" },
  { group: 'performance', q: "what's our cpc?" },
  { group: 'performance', q: "what's our cpm?" },
  { group: 'performance', q: 'how many impressions did we get?' },
  { group: 'performance', q: 'how many clicks did we get?' },
  { group: 'comparison', q: 'did we spend more this week than last week?' },
  { group: 'comparison', q: 'did roas improve this week vs last week?' },
]

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brandId = req.nextUrl.searchParams.get('brand') || req.cookies.get(BRAND_COOKIE)?.value || null

  const [{ answerAdsQuestion }, { auditAccount }, { resolveBrandScopedAccount }, contract] = await Promise.all([
    import('@/lib/meta/answer'), import('@/lib/meta/audit'), import('@/lib/meta/scope'), import('@/lib/meta/metric-contract'),
  ])

  // Which account Mello/Brief will audit for this brand — the identity you compare against Ads Manager.
  let account: any = null
  try { account = await resolveBrandScopedAccount(admin, user.id, brandId ?? undefined) } catch { /* none */ }
  if (!account?.account_id) {
    return NextResponse.json({ ok: false, error: 'no_meta_account', note: 'No Meta account resolved for this brand — connect one first.', brandId })
  }

  // Run each golden question through the REAL pipeline.
  const rows: any[] = []
  for (const g of GOLDEN) {
    try {
      const ans = await answerAdsQuestion(admin, user.id, g.q, { brandId })
      rows.push({ group: g.group, question: g.q, mello: ans?.reply || '(no answer)' })
    } catch (e: any) {
      rows.push({ group: g.group, question: g.q, mello: `ERROR: ${e?.message || 'failed'}` })
    }
  }

  // Raw canonical numbers per period — the exact figures behind the answers, for a fast Ads-Manager check.
  const PRESETS: Array<{ preset: any; label: string }> = [
    { preset: 'yesterday', label: 'yesterday' },
    { preset: 'last_7d', label: 'last 7 days' },
    { preset: 'this_month', label: 'this month' },
    { preset: 'last_30d', label: 'last 30 days (Brief window)' },
  ]
  const raw: any[] = []
  for (const p of PRESETS) {
    try {
      const a = await auditAccount(admin, user.id, account.account_id, p.preset)
      raw.push({
        period: p.label, preset: p.preset, account: a?.accountName, accountId: a?.selected, currency: a?.currency,
        spend: a?.spend, roas: a?.avgRoas, revenue: a?.revenue, purchases: a?.purchases,
        impressions: a?.impressions, clicks: a?.clicks, ctr: a?.ctr, cpc: a?.cpc, cpm: a?.cpm,
        campaigns: a?.total,
      })
    } catch (e: any) { raw.push({ period: p.label, preset: p.preset, error: e?.message || 'failed' }) }
  }

  return NextResponse.json({
    ok: true,
    brandId,
    account: { id: account.account_id, name: account.account_name, currency: account.currency },
    howToVerify: 'For each period below, open Meta Ads Manager → this account → set the date preset shown → the spend/ROAS/purchases must match `raw`. Then confirm the /brief card and a /mello chat give the same numbers. Brief == Mello == Meta. Any mismatch = fix the canonical service (src/lib/meta/audit.ts) before anything else.',
    caveat: 'Meta-attributed purchases are Meta’s pixel/CAPI attribution, NOT total Shopify orders. Do not treat them as company-wide order counts.',
    fetchedAt: new Date().toISOString(),
    answers: rows,
    raw,
  })
}
