import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: primaryAccount } = await admin
    .from('meta_accounts')
    .select('id,account_name')
    .eq('user_id', user.id)
    .eq('is_primary', true)
    .single()

  const { data: campaigns } = await admin
    .from('campaigns')
    .select('id,name,meta_campaign_id,status,campaign_insights(*)')
    .eq('user_id', user.id)
    .eq('meta_account_id', primaryAccount?.id || '')
    .limit(10)

  if (!campaigns?.length) return NextResponse.json({ grades: [] })

  const campaignsWithInsights = campaigns.filter((c: any) => c.campaign_insights?.length > 0)
  if (!campaignsWithInsights.length) return NextResponse.json({ grades: [] })

  const allInsights = campaignsWithInsights.flatMap((c: any) => c.campaign_insights || [])
  const totalSpend = allInsights.reduce((s: number, i: any) => s + Number(i.spend || 0), 0)
  const totalValue = allInsights.reduce((s: number, i: any) => s + Number(i.conversion_value || 0), 0)
  const accountAvgRoas = totalSpend > 0 ? totalValue / totalSpend : 0

  const campaignData = campaignsWithInsights.slice(0, 6).map((c: any) => {
    const ins = c.campaign_insights[0]
    return {
      name: c.name.substring(0, 40),
      spend: Number(ins.spend || 0).toFixed(0),
      roas: Number(ins.roas || 0).toFixed(2),
      ctr: Number(ins.ctr || 0).toFixed(2),
      cpa: Number(ins.cpa || 0).toFixed(0),
      conversions: ins.conversions || 0,
    }
  })

  const prompt = `You are an expert Meta ads media buyer using the M4 Method. Grade these campaigns.

Account average ROAS: ${accountAvgRoas.toFixed(2)}x
Account: ${primaryAccount?.account_name}

CAMPAIGNS:
${campaignData.map(c => `"${c.name}" | Spend: ${c.spend} | ROAS: ${c.roas}x | CTR: ${c.ctr}% | CPA: ${c.cpa} | Conv: ${c.conversions}`).join('\n')}

M4 GRADING RULES:
- GRADUATE = ROAS clearly above account average with good spend. Winner - duplicate to scale.
- HOLD = Average performance. Leave running, needs more data.
- CATCHY_NOT_CONVERTING = High spend or CTR but very low ROAS. People click but don't buy.
- PAUSE_POOR = Low spend AND poor metrics. Meta is not showing it.

Return ONLY a JSON object, no markdown, no explanation, starting with { and ending with }:
{"grades":[{"campaign_name":"name","grade":"GRADUATE","emoji":"⭐","label":"Graduate","why":"simple explanation","action":"what to do","action_reason":"why this helps"}]}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    const data = await res.json()
    const text = (data.content?.[0]?.text || '').trim()
    
    // Find JSON object in response
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('No JSON found in response')
    
    const jsonStr = text.slice(start, end + 1)
    const parsed = JSON.parse(jsonStr)

    // Save as recommendations
    for (const grade of (parsed.grades || [])) {
      const campaign = campaigns.find((c: any) => c.name === grade.campaign_name || c.name.substring(0,40) === grade.campaign_name)
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

    return NextResponse.json({ grades: parsed.grades || [] })
  } catch (err) {
    console.error('Grade error:', err)
    return NextResponse.json({ error: 'Failed to grade' }, { status: 500 })
  }
}
