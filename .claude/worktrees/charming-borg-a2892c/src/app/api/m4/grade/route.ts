import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: primaryAccount } = await admin
    .from('meta_accounts')
    .select('id,account_name,currency')
    .eq('user_id', user.id)
    .eq('is_primary', true)
    .single()

  const { data: campaigns } = await admin
    .from('campaigns')
    .select('id,name,meta_campaign_id,status,campaign_insights(*)')
    .eq('user_id', user.id)
    .eq('meta_account_id', primaryAccount?.id || '')

  if (!campaigns?.length) return NextResponse.json({ grades: [] })

  const withInsights = campaigns.filter((c: any) => c.campaign_insights?.length > 0)
  if (!withInsights.length) return NextResponse.json({ grades: [] })

  // Calculate account averages (M4 benchmark)
  const allInsights = withInsights.flatMap((c: any) => c.campaign_insights)
  const totalSpend = allInsights.reduce((s: number, i: any) => s + Number(i.spend || 0), 0)
  const totalValue = allInsights.reduce((s: number, i: any) => s + Number(i.conversion_value || 0), 0)
  const totalClicks = allInsights.reduce((s: number, i: any) => s + Number(i.clicks || 0), 0)
  const totalImpressions = allInsights.reduce((s: number, i: any) => s + Number(i.impressions || 0), 0)
  const totalConversions = allInsights.reduce((s: number, i: any) => s + Number(i.conversions || 0), 0)

  const avgRoas = totalSpend > 0 ? totalValue / totalSpend : 0
  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
  const avgSpend = totalSpend / withInsights.length
  const currency = primaryAccount?.currency || 'USD'

  const grades = withInsights.map((c: any) => {
    const ins = c.campaign_insights[0]
    const spend = Number(ins.spend || 0)
    const roas = Number(ins.roas || 0)
    const ctr = Number(ins.ctr || 0)
    const conversions = Number(ins.conversions || 0)
    const cpa = Number(ins.cpa || 0)

    // M4 GRADING LOGIC
    // GRADUATE: ROAS significantly above account average AND meaningful spend
    const isGraduate = roas > avgRoas * 1.3 && spend > avgSpend * 0.3 && conversions > 0

    // CATCHY_NOT_CONVERTING: High CTR or high spend but ROAS well below average
    const isCatchy = (ctr > avgCtr * 1.5 || spend > avgSpend * 1.2) && roas < avgRoas * 0.7

    // PAUSE_POOR: Low spend AND below average ROAS (Meta not showing it)
    const isPoor = spend < avgSpend * 0.3 && roas < avgRoas * 0.7

    // HOLD: Everything else - average performance, needs more data
    let grade: string
    let emoji: string
    let label: string
    let why: string
    let action: string
    let action_reason: string

    if (isGraduate) {
      grade = 'GRADUATE'
      emoji = '⭐'
      label = 'Graduate — Winner'
      why = `This campaign has a ${roas.toFixed(1)}x ROAS, which is ${((roas/avgRoas-1)*100).toFixed(0)}% above your account average of ${avgRoas.toFixed(1)}x. It has spent ${currency} ${spend.toFixed(0)} and generated ${conversions} conversions. This is your winner.`
      action = 'Duplicate this campaign into your Scale Campaign'
      action_reason = 'Per M4 Method: never move or pause a winner. Duplicate it into your Scale Campaign (Broad Advantage+) so you can pour more budget into it without disturbing what is already working. Also copy this creative into your Interest ad sets to find even more winning audiences.'
    } else if (isCatchy) {
      grade = 'CATCHY_NOT_CONVERTING'
      emoji = '🪤'
      label = 'Catchy — Not Converting'
      why = `This campaign has a ${ctr.toFixed(2)}% CTR (${ctr > avgCtr ? 'above' : 'below'} average) but only a ${roas.toFixed(1)}x ROAS against your ${avgRoas.toFixed(1)}x account average. People are clicking the ad but not buying. It has spent ${currency} ${spend.toFixed(0)} with poor return.`
      action = 'Pause this ad set and review the landing page'
      action_reason = 'Per M4 Method: high CTR with low ROAS means the ad is attracting the wrong audience or the landing page is not converting. The creative gets attention but creates false intent. Pause it to stop wasting budget. Review your landing page offer or rewrite the ad to attract buyers not browsers.'
    } else if (isPoor) {
      grade = 'PAUSE_POOR'
      emoji = '❌'
      label = 'Poor Performer — Pause'
      why = `This campaign has only spent ${currency} ${spend.toFixed(0)} which is well below your account average of ${currency} ${avgSpend.toFixed(0)} per campaign. Meta is not showing this ad much — a sign it is not performing well enough to compete for delivery in your account.`
      action = 'Pause this ad set and replace with a fresh creative'
      action_reason = 'Per M4 Method: when Meta stops showing an ad, it is telling you something. The algorithm has deprioritised it because early signals were poor. Pausing and replacing with a new creative pack is better than letting it drain your budget slowly. New creatives always go into new packs.'
    } else {
      grade = 'HOLD'
      emoji = '🟡'
      label = 'Hold — Leave Running'
      why = `This campaign has a ${roas.toFixed(1)}x ROAS against your ${avgRoas.toFixed(1)}x account average. Spend is ${currency} ${spend.toFixed(0)}. Performance is average — not a clear winner yet but not losing money badly enough to pause.`
      action = 'Leave this campaign running — do not touch it'
      action_reason = 'Per M4 Method: average campaigns need more data before you make a decision. Changing budgets, pausing or editing active ad sets resets the Meta learning phase and can make performance worse. Give it more time. Check back in 3-5 days.'
    }

    return { campaign_name: c.name, grade, emoji, label, why, action, action_reason }
  })

  // Sort: GRADUATE first, then CATCHY, then POOR, then HOLD
  const order = { GRADUATE: 0, CATCHY_NOT_CONVERTING: 1, PAUSE_POOR: 2, HOLD: 3 }
  grades.sort((a: any, b: any) => (order[a.grade as keyof typeof order] || 3) - (order[b.grade as keyof typeof order] || 3))

  // Save as recommendations
  for (const grade of grades) {
    const campaign = withInsights.find((c: any) => c.name === grade.campaign_name)
    if (!campaign) continue
    const typeMap: Record<string,string> = { GRADUATE:'SCALE', HOLD:'BUDGET_REALLOCATION', CATCHY_NOT_CONVERTING:'PAUSE', PAUSE_POOR:'PAUSE' }
    await admin.from('recommendations').upsert({
      user_id: user.id,
      campaign_id: campaign.id,
      type: typeMap[grade.grade] || 'PAUSE',
      title: `${grade.emoji} ${grade.label} — "${grade.campaign_name}"`,
      reasoning: grade.why + '\n\n' + grade.action_reason,
      impact_estimate: grade.action,
      confidence_score: grade.grade === 'GRADUATE' ? 90 : grade.grade === 'HOLD' ? 70 : 85,
      status: 'PENDING',
      meta_action: { grade: grade.grade, campaign_id: campaign.meta_campaign_id }
    }, { onConflict: 'user_id,campaign_id,type' })
  }

  return NextResponse.json({ 
    grades,
    account: primaryAccount?.account_name,
    benchmarks: {
      avg_roas: avgRoas.toFixed(2),
      avg_ctr: avgCtr.toFixed(2),
      avg_spend: avgSpend.toFixed(0),
      currency,
      total_campaigns: withInsights.length
    }
  })
}
