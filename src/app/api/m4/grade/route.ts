import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: campaigns } = await admin
    .from('campaigns')
    .select('*, campaign_insights(*)')
    .eq('user_id', user.id)

  if (!campaigns?.length) return NextResponse.json({ grades: [] })

  const allInsights = campaigns.flatMap((c: any) => c.campaign_insights || [])
  const totalSpend = allInsights.reduce((s: number, i: any) => s + Number(i.spend || 0), 0)
  const totalValue = allInsights.reduce((s: number, i: any) => s + Number(i.conversion_value || 0), 0)
  const accountAvgRoas = totalSpend > 0 ? totalValue / totalSpend : 0

  const prompt = `You are an expert Meta ads media buyer using the M4 Method.

Account average ROAS: ${accountAvgRoas.toFixed(2)}x

CAMPAIGNS:
${campaigns.map((c: any) => {
  const ins = c.campaign_insights?.[0]
  if (!ins) return null
  return `"${c.name}" | Spend: $${Number(ins.spend).toFixed(2)} | ROAS: ${Number(ins.roas).toFixed(2)}x | CTR: ${Number(ins.ctr).toFixed(2)}% | CPA: $${Number(ins.cpa).toFixed(2)} | Conversions: ${ins.conversions}`
}).filter(Boolean).join('\n')}

GRADING (M4 Method):
- GRADUATE = Top performer vs account avg. High ROAS + meaningful spend
- HOLD = Average. Middle of the pack. Needs more data
- CATCHY_NOT_CONVERTING = High CTR or high spend but low ROAS
- PAUSE_POOR = Low spend AND poor performance. Meta deprioritised it

Return ONLY valid JSON:
{
  "grades": [
    {
      "campaign_name": "exact name",
      "grade": "GRADUATE | HOLD | CATCHY_NOT_CONVERTING | PAUSE_POOR",
      "emoji": "⭐ | 🟡 | 🪤 | ❌",
      "label": "Graduate | Hold | Catchy - Not Converting | Poor Performer",
      "why": "Simple explanation for a business owner",
      "action": "Specific action to take",
      "action_reason": "Why this will improve results"
    }
  ]
}`

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
    const text = data.content?.[0]?.text || ''
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean)

    for (const grade of parsed.grades) {
      const campaign = campaigns.find((c: any) => c.name === grade.campaign_name)
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
        meta_action: { grade: grade.grade, campaign_id: campaign.meta_campaign_id, action: grade.action }
      }, { onConflict: 'user_id,campaign_id,type' })
    }

    return NextResponse.json({ grades: parsed.grades, saved: parsed.grades.length })
  } catch (err) {
    console.error('Grade error:', err)
    return NextResponse.json({ error: 'Failed to grade' }, { status: 500 })
  }
}
