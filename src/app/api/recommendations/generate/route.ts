import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { generateRecommendations } from '@/lib/claude'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()

    // Fetch all campaigns with recent insights
    const { data: campaigns } = await admin
      .from('campaigns')
      .select(`
        *,
        ad_sets(*),
        campaign_insights(*)
      `)
      .eq('user_id', user.id)
      .eq('status', 'ACTIVE')
      .order('created_at', { ascending: false })
      .limit(20)

    if (!campaigns?.length) {
      return NextResponse.json({ recommendations: [] })
    }

    // Calculate account averages
    const allInsights = campaigns.flatMap((c: Record<string, unknown>) => (c.campaign_insights as Record<string, unknown>[]) || [])
    const accountAvgCpm = allInsights.reduce((sum: number, i: Record<string, unknown>) => sum + Number(i.cpm || 0), 0) / (allInsights.length || 1)
    const accountAvgRoas = allInsights.reduce((sum: number, i: Record<string, unknown>) => sum + Number(i.roas || 0), 0) / (allInsights.length || 1)

    // Run Claude recommendation engine
    const result = await generateRecommendations({
      campaigns,
      adSets: campaigns.flatMap((c: Record<string, unknown>) => (c.ad_sets as Record<string, unknown>[]) || []),
      accountAvgCpm,
      accountAvgRoas,
    })

    // Get primary Meta account
    const { data: metaAccount } = await admin
      .from('meta_accounts')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_primary', true)
      .single()

    // Save recommendations to DB
    const saved = []
    for (const rec of result.recommendations) {
      // Find the matching campaign/adset
      const campaign = campaigns.find((c: Record<string, unknown>) => 
        c.meta_campaign_id === rec.entity_id || c.name === rec.entity_name
      )

      const { data: savedRec } = await admin
        .from('recommendations')
        .insert({
          user_id: user.id,
          meta_account_id: metaAccount?.id,
          campaign_id: campaign?.id,
          type: rec.type,
          title: rec.title,
          reasoning: rec.reasoning,
          impact_estimate: rec.impact_estimate,
          confidence_score: rec.confidence_score,
          status: 'PENDING',
          meta_action: rec.meta_action || {},
        })
        .select()
        .single()

      if (savedRec) saved.push(savedRec)
    }

    // Log activity
    await admin.from('activity_logs').insert({
      user_id: user.id,
      action_type: 'RECOMMENDATION_GENERATED',
      entity_type: 'system',
      description: `${saved.length} new recommendations generated`,
      performed_by: 'system',
    })

    return NextResponse.json({ 
      recommendations: saved,
      count: saved.length,
    })

  } catch (err) {
    console.error('Recommendation generation error:', err)
    return NextResponse.json({ error: 'Failed to generate recommendations' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'PENDING'

    const admin = createAdminClient()
    const { data: recommendations, error } = await admin
      .from('recommendations')
      .select(`*, campaigns(name, objective, status)`)
      .eq('user_id', user.id)
      .eq('status', status)
      .order('confidence_score', { ascending: false })
      .limit(20)

    if (error) throw error

    return NextResponse.json({ recommendations })

  } catch (err) {
    return NextResponse.json({ error: 'Failed to fetch recommendations' }, { status: 500 })
  }
}
