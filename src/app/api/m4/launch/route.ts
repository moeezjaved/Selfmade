import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

async function metaPost(path: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`https://graph.facebook.com/${V}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`${data.error.message}`)
  return data
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json()
    const { campaignName, creatives, interests, budget, location, ageMin, ageMax, gender, pixelId } = body

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_primary', true)
      .single()

    if (!metaAccount) return NextResponse.json({ error: 'No primary Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = `act_${metaAccount.account_id}`

    console.log('M4 Launch starting for:', metaAccount.account_name, adAccountId)

    const errors: string[] = []
    const dailyBudgetCents = Math.round(parseFloat(budget || '50') * 100)

    const buildTargeting = (interestId?: string, interestName?: string) => {
      const t: Record<string, unknown> = {
        age_min: parseInt(ageMin) || 18,
        age_max: parseInt(ageMax) || 65,
        geo_locations: { countries: ['PK'] },
      }
      if (gender === 'MALE') t.genders = [1]
      if (gender === 'FEMALE') t.genders = [2]
      if (interestId && interestName) {
        t.flexible_spec = [{ interests: [{ id: interestId, name: interestName }] }]
      }
      return t
    }

    // Campaign 1 — Broad
    let broadCampaignId = ''
    let broadAdSets = 0

    const broadCamp = await metaPost(`${adAccountId}/campaigns`, token, {
      name: `${campaignName} — M4 Broad`,
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: dailyBudgetCents,
    })
    broadCampaignId = broadCamp.id
    console.log('Broad campaign created:', broadCampaignId)

    for (const creative of (creatives || []).slice(0, 5)) {
      try {
        await metaPost(`${adAccountId}/adsets`, token, {
          name: `${campaignName} — Broad — ${creative.name}`,
          campaign_id: broadCampaignId,
          status: 'PAUSED',
          targeting: buildTargeting(),
          optimization_goal: 'OFFSITE_CONVERSIONS',
          billing_event: 'IMPRESSIONS',
          daily_budget: Math.max(100, Math.round(dailyBudgetCents / Math.max((creatives||[]).length, 1))),
        })
        broadAdSets++
      } catch (e: any) {
        errors.push(`Broad "${creative.name}": ${e.message}`)
      }
    }

    // Campaign 2 — Interests
    let interestCampaignId = ''
    let interestAdSets = 0

    const intCamp = await metaPost(`${adAccountId}/campaigns`, token, {
      name: `${campaignName} — M4 Interests`,
      objective: 'OUTCOME_SALES',
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: dailyBudgetCents,
    })
    interestCampaignId = intCamp.id
    console.log('Interest campaign created:', interestCampaignId)

    for (const interest of (interests || []).slice(0, 6)) {
      try {
        // Search Meta for interest ID
        const searchRes = await fetch(
          `https://graph.facebook.com/${V}/search?` +
          new URLSearchParams({ type: 'adinterest', q: interest.name, limit: '1', access_token: token })
        )
        const searchData = await searchRes.json()
        const metaInterest = searchData.data?.[0]

        await metaPost(`${adAccountId}/adsets`, token, {
          name: `${campaignName} — Interest — ${interest.name}`,
          campaign_id: interestCampaignId,
          status: 'PAUSED',
          targeting: metaInterest
            ? buildTargeting(metaInterest.id, metaInterest.name)
            : buildTargeting(),
          optimization_goal: 'OFFSITE_CONVERSIONS',
          billing_event: 'IMPRESSIONS',
          daily_budget: Math.max(100, Math.round(dailyBudgetCents / Math.max((interests||[]).length, 1))),
        })
        interestAdSets++
      } catch (e: any) {
        errors.push(`Interest "${interest.name}": ${e.message}`)
      }
    }

    console.log('M4 Launch complete:', { broadAdSets, interestAdSets, errors })

    return NextResponse.json({
      success: true,
      account: metaAccount.account_name,
      broad_campaign_id: broadCampaignId,
      interest_campaign_id: interestCampaignId,
      broad_adsets: broadAdSets,
      interest_adsets: interestAdSets,
      exclusion_audiences: 0,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (err: any) {
    console.error('M4 Launch fatal error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
