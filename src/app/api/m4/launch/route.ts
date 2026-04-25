import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = 'v20.0'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const {
      campaignName = 'M4 Campaign',
      creatives = [],
      interests = [],
      budget = '50',
      ageMin = '18',
      ageMax = '65',
      gender = 'ALL',
      pixelId = '',
      objective = 'OUTCOME_TRAFFIC',
      pageId = '',
      primaryText = '',
      headline = '',
      cta = 'LEARN_MORE',
      websiteUrl = '',
    } = body

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()

    if (!metaAccount) return NextResponse.json({ error: 'No primary Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = `act_${metaAccount.account_id}`
    const currency = metaAccount.currency || 'USD'
    const budgetAmount = parseFloat(budget) || 50
    const budgetCents = Math.round(budgetAmount * 100)
    const currencyMinimums: Record<string,number> = { USD:100, PKR:28100, GBP:100, EUR:100, AED:400, SAR:400, INR:8000 }
    const minBudget = currencyMinimums[currency] || 100
    const safeBudget = Math.max(minBudget, budgetCents)

    const apiObjective = ['OUTCOME_SALES','OUTCOME_LEADS','OUTCOME_TRAFFIC','OUTCOME_AWARENESS','OUTCOME_ENGAGEMENT'].includes(objective) ? objective : 'OUTCOME_TRAFFIC'

    // Optimization settings per objective
    const optimizationMap: Record<string,{optimization_goal:string,billing_event:string}> = {
      OUTCOME_SALES: { optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS' },
      OUTCOME_LEADS: { optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS' },
      OUTCOME_TRAFFIC: { optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS' },
      OUTCOME_AWARENESS: { optimization_goal: 'REACH', billing_event: 'IMPRESSIONS' },
    }
    const optSettings = optimizationMap[objective] || optimizationMap.OUTCOME_TRAFFIC

    const promotedObject = (pixelId && objective === 'OUTCOME_SALES')
      ? { promoted_object: { pixel_id: pixelId, custom_event_type: 'PURCHASE' } }
      : {}

    const baseTargeting = {
      age_min: parseInt(ageMin) || 18,
      age_max: parseInt(ageMax) || 65,
      geo_locations: { countries: ['PK'] },
      ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
    }

    const post = async (path: string, params: Record<string,unknown>) => {
      const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, access_token: token }),
      })
      const d = await r.json()
      if (d.error) {
        console.error('Meta API error full:', JSON.stringify(d.error))
        console.error('Params sent:', JSON.stringify({...params, access_token: 'REDACTED'}))
        throw new Error(`${d.error.message} [${d.error.error_subcode||d.error.code}] user_msg: ${d.error.error_user_msg||'none'}`)
      }
      return d
    }

    console.log('M4 Launch:', metaAccount.account_name, adAccountId, apiObjective)

    const errors: string[] = []
    let broadCount = 0
    let intCount = 0

    // ── CAMPAIGN 1: Broad ─────────────────────────────────────
    const broadCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Broad`,
      objective: apiObjective,
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    })
    console.log('Broad campaign created:', broadCamp.id)

    const adsetBudget = Math.max(minBudget, safeBudget)

    for (const c of (creatives as any[]).slice(0, 5)) {
      try {
        const broadAdset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Broad — ${c.name}`,
          campaign_id: broadCamp.id,
          status: 'PAUSED',
          daily_budget: adsetBudget,
          targeting: baseTargeting,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ...optSettings,
          ...promotedObject,
        })

        broadCount++
      } catch(e: any) {
        console.log('Broad adset error:', e.message)
        errors.push(`Broad "${c.name}": ${e.message}`)
      }
    }

    // ── CAMPAIGN 2: Interests ─────────────────────────────────
    const intCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Interests`,
      objective: apiObjective,
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    })
    console.log('Interest campaign created:', intCamp.id)

    const intBudget = Math.max(minBudget, safeBudget)

    for (const interest of (interests as any[]).slice(0, 6)) {
      try {
        const sr = await fetch(`https://graph.facebook.com/${V}/search?` + new URLSearchParams({ type: 'adinterest', q: interest.name, limit: '1', access_token: token }))
        const sd = await sr.json()
        const mi = sd.data?.[0]

        const intTargeting = {
          ...baseTargeting,
          ...(mi ? { flexible_spec: [{ interests: [{ id: mi.id, name: mi.name }] }] } : {}),
        }

        const intAdset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Interest — ${interest.name}`,
          campaign_id: intCamp.id,
          status: 'PAUSED',
          daily_budget: intBudget,
          targeting: intTargeting,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          ...optSettings,
          ...promotedObject,
        })

        intCount++
      } catch(e: any) {
        console.log('Interest adset error:', e.message)
        errors.push(`Interest "${interest.name}": ${e.message}`)
      }
    }

    try {
      await admin.from('activity_logs').insert({
        user_id: user.id,
        action_type: 'M4_LAUNCHED',
        entity_type: 'campaign',
        description: `M4 launched in ${metaAccount.account_name}: Broad ${broadCamp.id}, Interests ${intCamp.id}`,
        performed_by: 'user',
      })
    } catch(e) { console.log('Activity log error:', e) }

    return NextResponse.json({
      success: true,
      account: metaAccount.account_name,
      broad_campaign_id: broadCamp.id,
      interest_campaign_id: intCamp.id,
      broad_adsets: broadCount,
      interest_adsets: intCount,
      exclusion_audiences: 0,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (err: any) {
    console.error('M4 launch error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
// Sun Apr 26 04:12:30 PKT 2026
