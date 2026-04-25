import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { campaignName = 'M4 Campaign', creatives = [], interests = [], budget = '50', ageMin = '18', ageMax = '65', gender = 'ALL' } = body

    const admin = createAdminClient()
    const { data: metaAccount, error: accountError } = await admin
      .from('meta_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_primary', true)
      .single()

    if (accountError || !metaAccount) {
      return NextResponse.json({ error: 'No primary Meta account: ' + accountError?.message }, { status: 400 })
    }

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = `act_${metaAccount.account_id}`
    const dailyBudget = Math.max(100, Math.round(parseFloat(budget) * 100))

    const post = async (path: string, params: Record<string,unknown>) => {
      const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, access_token: token }),
      })
      const d = await r.json()
      if (d.error) throw new Error(d.error.message + ' (subcode: ' + d.error.error_subcode + ')')
      return d
    }

    const targeting = {
      age_min: parseInt(ageMin) || 18,
      age_max: parseInt(ageMax) || 65,
      geo_locations: { countries: ['PK'] },
      ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
    }

    // Create Broad Campaign
    const broadCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Broad`,
      objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: dailyBudget,
    })

    // Create broad ad sets
    let broadCount = 0
    for (const c of creatives.slice(0, 5)) {
      try {
        await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — ${c.name || 'Creative'}`,
          campaign_id: broadCamp.id,
          status: 'PAUSED',
          daily_budget: Math.max(100, Math.round(dailyBudget / Math.max(creatives.length, 1))),
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'LINK_CLICKS',
          targeting,
        })
        broadCount++
      } catch(e: any) {
        console.log('Broad adset error:', e.message)
      }
    }

    // Create Interest Campaign
    const intCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Interests`,
      objective: 'OUTCOME_TRAFFIC',
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: dailyBudget,
    })

    // Create interest ad sets
    let intCount = 0
    for (const interest of interests.slice(0, 6)) {
      try {
        // Search for Meta interest ID
        const sr = await fetch(`https://graph.facebook.com/${V}/search?` + new URLSearchParams({ type: 'adinterest', q: interest.name, limit: '1', access_token: token }))
        const sd = await sr.json()
        const mi = sd.data?.[0]

        const intTargeting = {
          ...targeting,
          ...(mi ? { flexible_spec: [{ interests: [{ id: mi.id, name: mi.name }] }] } : {}),
        }

        await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — ${interest.name}`,
          campaign_id: intCamp.id,
          status: 'PAUSED',
          daily_budget: Math.max(100, Math.round(dailyBudget / Math.max(interests.length, 1))),
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'LINK_CLICKS',
          targeting: intTargeting,
        })
        intCount++
      } catch(e: any) {
        console.log('Interest adset error:', e.message)
      }
    }

    return NextResponse.json({
      success: true,
      account: metaAccount.account_name,
      broad_campaign_id: broadCamp.id,
      interest_campaign_id: intCamp.id,
      broad_adsets: broadCount,
      interest_adsets: intCount,
      exclusion_audiences: 0,
    })

  } catch (err: any) {
    console.error('M4 launch error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
