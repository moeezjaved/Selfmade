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
    const {
      campaignName = 'M4 Campaign',
      creatives = [],
      interests = [],
      budget = '500',
      ageMin = '18',
      ageMax = '65',
      gender = 'ALL',
      pixelId = '',
      objective = 'OUTCOME_SALES',
      pageId = '',
      instagramActorId = '',
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
    const budgetAmount = parseFloat(budget) || 500
    const budgetCents = Math.round(budgetAmount * 100)
    const currencyMinimums: Record<string,number> = { USD:100, PKR:28100, GBP:100, EUR:100, AED:400, SAR:400, INR:8000 }
    const minBudget = currencyMinimums[currency] || 100
    const safeBudget = Math.max(minBudget, budgetCents)

    const validObjectives = ['OUTCOME_SALES','OUTCOME_LEADS','OUTCOME_TRAFFIC','OUTCOME_AWARENESS','OUTCOME_ENGAGEMENT','OUTCOME_APP_PROMOTION']
    const apiObjective = validObjectives.includes(objective) ? objective : 'OUTCOME_TRAFFIC'

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

    const post = async (path: string, params: Record<string,unknown>) => {
      const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, access_token: token }),
      })
      const d = await r.json()
      if (d.error) throw new Error(`${d.error.message} [${d.error.error_subcode||d.error.code}] ${d.error.error_user_msg||''}`)
      return d
    }

    // Search for real Meta interest ID
    const searchInterest = async (name: string) => {
      try {
        const r = await fetch(`https://graph.facebook.com/${V}/search?` + new URLSearchParams({ type: 'adinterest', q: name, limit: '3', access_token: token }))
        const d = await r.json()
        // Find best match
        const match = d.data?.find((i: any) => i.name.toLowerCase() === name.toLowerCase()) || d.data?.[0]
        return match || null
      } catch { return null }
    }

    // Create ad creative with image hash
    const createAdCreative = async (name: string, imageHash: string | null) => {
      console.log('Creating creative:', name, 'pageId:', pageId, 'websiteUrl:', websiteUrl, 'hash:', imageHash)
      if (!pageId || !websiteUrl) { console.log('Skipping creative - no pageId or websiteUrl'); return null }
      try {
        const linkData: Record<string,unknown> = {
          message: primaryText || 'Check out our products',
          link: websiteUrl,
          name: headline || campaignName,
          description: '',
          call_to_action: { type: cta || 'LEARN_MORE', value: { link: websiteUrl } },
        }
        if (imageHash) linkData.image_hash = imageHash

        const creativeSpec: Record<string,unknown> = {
          name,
          object_story_spec: { page_id: pageId, link_data: linkData },
        }
        // Add Instagram actor if available
        if (instagramActorId) creativeSpec.instagram_actor_id = instagramActorId

        const creative = await post(`${adAccountId}/adcreatives`, creativeSpec)
        return creative.id
      } catch(e: any) {
        console.log('Creative error:', e.message)
        return null
      }
    }

    const errors: string[] = []
    let broadCount = 0
    let intCount = 0

    // ── CAMPAIGN 1: Broad (Advantage+ audience ON) ────────────
    const broadCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Broad`,
      objective: apiObjective,
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    })

    for (const c of (creatives as any[]).slice(0, 5)) {
      try {
        const broadAdset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Broad — ${c.name}`,
          campaign_id: broadCamp.id,
          status: 'PAUSED',
          daily_budget: safeBudget,
          targeting: {
            age_min: parseInt(ageMin) || 18,
            geo_locations: { countries: ['PK'] },
            ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
            targeting_automation: { advantage_audience: 1 },
            ...exclusions,
          },
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          destination_type: 'WEBSITE',
          ...optSettings,
          ...promotedObject,
        })

        // Create ad with creative
        const creativeId = await createAdCreative(`Creative — ${c.name}`, c.hash || null)
        if (creativeId) {
          await post(`${adAccountId}/ads`, {
            name: `Ad — ${c.name}`,
            adset_id: broadAdset.id,
            creative: { creative_id: creativeId },
            status: 'PAUSED',
          })
        }
        broadCount++
      } catch(e: any) {
        console.log('Broad error:', e.message)
        errors.push(`Broad "${c.name}": ${e.message}`)
      }
    }

    // ── CAMPAIGN 2: Interests (manual targeting) ──────────────
    const intCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Interests`,
      objective: apiObjective,
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    })

    // Use first creative's hash for interest ads
    const firstCreative = (creatives as any[])[0]
    const firstHash = firstCreative?.hash || null

    for (const interest of (interests as any[]).slice(0, 6)) {
      try {
        // Get real Meta interest ID
        const metaInterest = await searchInterest(interest.name)
        console.log('Interest search:', interest.name, '->', metaInterest?.name, metaInterest?.id)

        const intTargeting: Record<string,unknown> = {
          age_min: parseInt(ageMin) || 18,
          age_max: parseInt(ageMax) || 65,
          geo_locations: geoLocations,
          ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
          targeting_automation: { advantage_audience: 0 },
        }
        if (metaInterest) {
          intTargeting.flexible_spec = [{ interests: [{ id: metaInterest.id, name: metaInterest.name }] }]
        }

        const intAdset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Interest — ${interest.name}`,
          campaign_id: intCamp.id,
          status: 'PAUSED',
          daily_budget: safeBudget,
          targeting: intTargeting,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          destination_type: 'WEBSITE',
          ...optSettings,
          ...promotedObject,
        })

        const creativeId = await createAdCreative(`Creative — ${interest.name}`, firstHash)
        if (creativeId) {
          await post(`${adAccountId}/ads`, {
            name: `Ad — ${interest.name}`,
            adset_id: intAdset.id,
            creative: { creative_id: creativeId },
            status: 'PAUSED',
          })
        }
        intCount++
      } catch(e: any) {
        console.log('Interest error:', e.message)
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
    } catch(e) { console.log('Activity log error') }

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
