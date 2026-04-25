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
      budget = '50',
      ageMin = '18',
      ageMax = '65',
      gender = 'ALL',
      pixelId = '',
      objective = 'OUTCOME_SALES',
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
    const dailyBudget = Math.max(576, Math.round(parseFloat(budget) * 100))

    console.log('M4 Launch:', metaAccount.account_name, adAccountId, objective)

    const post = async (path: string, params: Record<string,unknown>) => {
      const r = await fetch(`https://graph.facebook.com/${V}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, access_token: token }),
      })
      const d = await r.json()
      if (d.error) throw new Error(`${d.error.message} [${d.error.error_subcode||d.error.code}]`)
      return d
    }

    // Optimization based on objective
    const optMap: Record<string,{optimization_goal:string,billing_event:string}> = {
      OUTCOME_SALES:    { optimization_goal: 'OFFSITE_CONVERSIONS', billing_event: 'IMPRESSIONS' },
      OUTCOME_LEADS:    { optimization_goal: 'LEAD_GENERATION',     billing_event: 'IMPRESSIONS' },
      OUTCOME_TRAFFIC:  { optimization_goal: 'LINK_CLICKS',         billing_event: 'IMPRESSIONS' },
      OUTCOME_AWARENESS:{ optimization_goal: 'REACH',               billing_event: 'IMPRESSIONS' },
    }
    const opt = optMap[objective] || optMap.OUTCOME_TRAFFIC

    const promotedObject = pixelId && (objective === 'OUTCOME_SALES' || objective === 'OUTCOME_LEADS')
      ? { promoted_object: { pixel_id: pixelId, custom_event_type: objective === 'OUTCOME_SALES' ? 'PURCHASE' : 'LEAD' } }
      : {}

    const baseTargeting = {
      age_min: parseInt(ageMin) || 18,
      age_max: parseInt(ageMax) || 65,
      geo_locations: { countries: ['PK'] },
      ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
    }

    // Create ad creative helper
    const createAdCreative = async (name: string, imageUrl?: string) => {
      const linkData: Record<string,unknown> = {
        message: primaryText || 'Check out our products',
        link: websiteUrl || 'https://facebook.com',
        name: headline || campaignName,
        call_to_action: { type: cta || 'LEARN_MORE', value: { link: websiteUrl || 'https://facebook.com' } },
      }
      if (imageUrl) linkData.picture = imageUrl

      return post(`${adAccountId}/adcreatives`, {
        name,
        object_story_spec: {
          page_id: pageId,
          link_data: linkData,
        },
      })
    }

    const errors: string[] = []
    let broadCount = 0
    let intCount = 0

    // ── CAMPAIGN 1: Broad ─────────────────────────────────────
    const broadCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Broad`,
      objective,
      status: 'PAUSED',
      special_ad_categories: [],
    })

    const adsetBudget = Math.max(576, Math.round(dailyBudget / Math.max(creatives.length, 1)))

    for (const c of creatives.slice(0, 5)) {
      try {
        const adset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Broad — ${c.name}`,
          campaign_id: broadCamp.id,
          status: 'PAUSED',
          daily_budget: adsetBudget,
          targeting: baseTargeting,
          ...opt,
          ...promotedObject,
        })

        // Create creative and ad only if we have a page
        if (pageId) {
          try {
            const creative = await createAdCreative(`Creative — ${c.name}`)
            await post(`${adAccountId}/ads`, {
              name: `Ad — ${c.name}`,
              adset_id: adset.id,
              creative: { creative_id: creative.id },
              status: 'PAUSED',
            })
          } catch(e: any) {
            errors.push(`Ad creative "${c.name}": ${e.message}`)
          }
        }
        broadCount++
      } catch(e: any) {
        errors.push(`Broad adset "${c.name}": ${e.message}`)
      }
    }

    // ── CAMPAIGN 2: Interests ─────────────────────────────────
    const intCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Interests`,
      objective,
      status: 'PAUSED',
      special_ad_categories: [],
    })

    const intBudget = Math.max(576, Math.round(dailyBudget / Math.max(interests.length, 1)))

    for (const interest of interests.slice(0, 6)) {
      try {
        // Search Meta for interest ID
        const sr = await fetch(`https://graph.facebook.com/${V}/search?` + new URLSearchParams({ type: 'adinterest', q: interest.name, limit: '1', access_token: token }))
        const sd = await sr.json()
        const mi = sd.data?.[0]

        const intTargeting = {
          ...baseTargeting,
          ...(mi ? { flexible_spec: [{ interests: [{ id: mi.id, name: mi.name }] }] } : {}),
        }

        const adset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Interest — ${interest.name}`,
          campaign_id: intCamp.id,
          status: 'PAUSED',
          daily_budget: intBudget,
          targeting: intTargeting,
          ...opt,
          ...promotedObject,
        })

        if (pageId && creatives.length > 0) {
          try {
            const creative = await createAdCreative(`Creative — Interest — ${interest.name}`)
            await post(`${adAccountId}/ads`, {
              name: `Ad — ${interest.name}`,
              adset_id: adset.id,
              creative: { creative_id: creative.id },
              status: 'PAUSED',
            })
          } catch(e: any) {
            errors.push(`Ad creative "${interest.name}": ${e.message}`)
          }
        }
        intCount++
      } catch(e: any) {
        errors.push(`Interest adset "${interest.name}": ${e.message}`)
      }
    }

    await admin.from('activity_logs').insert({
      user_id: user.id,
      action_type: 'M4_LAUNCHED',
      entity_type: 'campaign',
      description: `M4 launched: ${broadCamp.id}, ${intCamp.id} in ${metaAccount.account_name}`,
      performed_by: 'user',
    }).catch(() => {})

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
