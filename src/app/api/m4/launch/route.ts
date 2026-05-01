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
      retargetingCreatives = [] as any[],
      retainerCreatives = [] as any[],
      retargetingCopy = {} as any,
      retainerCopy = {} as any,
      includeRetainer = false,
      location = 'PK',
      locations = [] as any[],
      primaryText = '',
      headline = '',
      cta = 'LEARN_MORE',
      websiteUrl = '',
      product = '',
      description = '',
      targetCustomer = '',
      competitorDomains = '',
    } = body

    // Build geo_locations from locations array or fallback to location string
    const buildGeo = () => {
      if (locations && locations.length > 0) {
        const countries = locations.filter((l:any) => l.type === 'country').map((l:any) => l.key)
        const cities = locations.filter((l:any) => l.type === 'city').map((l:any) => ({ key: parseInt(l.key) }))
        const regions = locations.filter((l:any) => l.type === 'region').map((l:any) => ({ key: parseInt(l.key) }))
        const result: any = {}
        if (countries.length > 0) result.countries = countries
        if (cities.length > 0) result.cities = cities
        if (regions.length > 0) result.regions = regions
        if (Object.keys(result).length === 0) result.countries = [location || 'PK']
        return result
      }
      return { countries: [location || 'PK'] }
    }
    const geoLocations = buildGeo()


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

    // Create ad creative with image hash and optional custom copy
    const createAdCreative = async (name: string, imageHash: string | null, customCopy?: any, isVideo = false) => {
      const cp = customCopy || {}
      const msg = cp.primaryText || primaryText || 'Check out our products'
      const lnk = cp.destinationUrl || websiteUrl
      const hd = cp.headline || headline || campaignName
      const ct = cp.cta || cta || 'LEARN_MORE'
      if (!pageId || !lnk) return null
      try {
        const linkData: Record<string,unknown> = {
          message: msg, link: lnk, name: hd, description: '',
          call_to_action: { type: ct, value: { link: lnk } },
        }
        if (isVideo && imageHash) {
          linkData.video_id = imageHash
        } else if (imageHash) {
          linkData.image_hash = imageHash
        }

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

    let exclusionAudienceId: string | null = null
    const errors: string[] = []
    let broadCount = 0
    let intCount = 0

    // ── CAMPAIGN 1: Broad (Advantage+ audience ON) ────────────
    const broadCamp = await post(`${adAccountId}/campaigns`, {
      name: `${campaignName} — M4 Broad`,
      objective: apiObjective,
      status: 'PAUSED',
      special_ad_categories: [],
      daily_budget: Math.max(minBudget, Math.round(safeBudget * 0.3)),
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      is_adset_budget_sharing_enabled: false,
    })

    for (const c of (creatives as any[]).slice(0, 5)) {
      try {
        const broadAdset = await post(`${adAccountId}/adsets`, {
          name: `${campaignName} — Broad — ${c.name}`,
          campaign_id: broadCamp.id,
          status: 'PAUSED',
          targeting: {
            age_min: parseInt(ageMin) || 18,
            geo_locations: geoLocations,
            ...(gender === 'MALE' ? { genders: [1] } : gender === 'FEMALE' ? { genders: [2] } : {}),
            targeting_automation: { advantage_audience: 1 },
            ...(exclusionAudienceId ? { exclusions: { custom_audiences: [{ id: exclusionAudienceId }] } } : {}),
          },
          destination_type: 'WEBSITE',
          ...optSettings,
          ...promotedObject,
        })

        // Create ad with creative
        const creativeId = await createAdCreative(`Creative — ${c.name}`, c.hash || null, undefined, c.type === 'video')
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
      daily_budget: Math.max(minBudget, Math.round(safeBudget * 0.3)),
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
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
          targeting: intTargeting,
          destination_type: 'WEBSITE',
          ...optSettings,
          ...promotedObject,
        })

        const creativeId = await createAdCreative(`Creative — ${interest.name}`, firstHash, undefined, firstCreative?.type === 'video')
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

    // ── CAMPAIGN 3: Retargeting (website visitors 60 days) ──────
    let retargetingCount = 0
    let retainerCount = 0

    if (pixelId) {
      try {
        const excAud = await post(`${adAccountId}/customaudiences`, {
          name: `${campaignName} — Exclusion Visitors 60d`,
          rule: JSON.stringify({ inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixelId, type: 'pixel' }], retention_seconds: 5184000, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'PageView' }] } }] } }),
          prefill: true,
        })
        exclusionAudienceId = excAud.id
        console.log('Exclusion audience created:', exclusionAudienceId)
      } catch(e: any) { console.log('Exclusion audience error:', e.message) }
    }

    console.log('Retargeting check - pixelId:', pixelId, 'retargetingCreatives:', (retargetingCreatives as any[]).length)
    if (pixelId && (retargetingCreatives as any[]).length > 0) {
      try {
        // Create retargeting audience
        const rtAud = await post(`${adAccountId}/customaudiences`, {
          name: `${campaignName} — Retargeting 60d`,
          rule: JSON.stringify({ inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixelId, type: 'pixel' }], retention_seconds: 5184000, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'PageView' }] } }] } }),
          prefill: true,
        }).catch(() => null)

        const rtPct = includeRetainer ? 0.2 : 0.4
        const rtBudget = Math.max(minBudget, Math.round(safeBudget * rtPct))
        const rtCamp = await post(`${adAccountId}/campaigns`, {
          name: `${campaignName} — M4 Retargeting`,
          objective: apiObjective,
          status: 'PAUSED',
          special_ad_categories: [],
          daily_budget: rtBudget,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          is_adset_budget_sharing_enabled: false,
        })

        for (const c of (retargetingCreatives as any[]).slice(0, 3)) {
          try {
            const rtTargeting: Record<string,unknown> = {
              age_min: parseInt(ageMin) || 18,
              age_max: parseInt(ageMax) || 65,
              geo_locations: geoLocations,
              targeting_automation: { advantage_audience: 0 },
            }
            if (rtAud?.id) rtTargeting.custom_audiences = [{ id: rtAud.id }]

            const rtAdset = await post(`${adAccountId}/adsets`, {
              name: `${campaignName} — Retargeting — ${c.name}`,
              campaign_id: rtCamp.id,
              status: 'PAUSED',
              targeting: rtTargeting,
                  destination_type: 'WEBSITE',
              ...optSettings,
              ...promotedObject,
            })

            if (pageId && (retargetingCopy as any).websiteUrl || (retargetingCopy as any).destinationUrl) {
              const rtCreative = await createAdCreative(`RT Creative — ${c.name}`, c.hash || null, retargetingCopy, c.type === 'video')
              if (rtCreative) {
                await post(`${adAccountId}/ads`, {
                  name: `RT Ad — ${c.name}`,
                  adset_id: rtAdset.id,
                  creative: { creative_id: rtCreative },
                  status: 'PAUSED',
                })
              }
            }
            retargetingCount++
          } catch(e: any) { console.log('Retargeting adset error:', e.message); errors.push(`Retargeting "${c.name}": ${e.message}`) }
        }
      } catch(e: any) { errors.push(`Retargeting campaign: ${e.message}`) }
    }

    // ── CAMPAIGN 4: Retainer (past purchasers) ────────────────
    if (includeRetainer && pixelId && (retainerCreatives as any[]).length > 0) {
      try {
        const rnAud = await post(`${adAccountId}/customaudiences`, {
          name: `${campaignName} — Purchasers 180d`,
          rule: JSON.stringify({ inclusions: { operator: 'or', rules: [{ event_sources: [{ id: pixelId, type: 'pixel' }], retention_seconds: 15552000, filter: { operator: 'and', filters: [{ field: 'event', operator: 'eq', value: 'Purchase' }] } }] } }),
          prefill: true,
        }).catch(() => null)

        const rnBudget = Math.max(minBudget, Math.round(safeBudget * 0.2))
        const rnCamp = await post(`${adAccountId}/campaigns`, {
          name: `${campaignName} — M4 Retainer`,
          objective: apiObjective,
          status: 'PAUSED',
          special_ad_categories: [],
          daily_budget: Math.max(minBudget, Math.round(safeBudget * 0.2)),
          is_adset_budget_sharing_enabled: false,
        })

        for (const c of (retainerCreatives as any[]).slice(0, 3)) {
          try {
            const rnTargeting: Record<string,unknown> = {
              age_min: parseInt(ageMin) || 18,
              age_max: parseInt(ageMax) || 65,
              geo_locations: geoLocations,
              targeting_automation: { advantage_audience: 0 },
            }
            if (rnAud?.id) rnTargeting.custom_audiences = [{ id: rnAud.id }]

            const rnAdset = await post(`${adAccountId}/adsets`, {
              name: `${campaignName} — Retainer — ${c.name}`,
              campaign_id: rnCamp.id,
              status: 'PAUSED',
              targeting: rnTargeting,
                  destination_type: 'WEBSITE',
              ...optSettings,
              ...promotedObject,
            })

            if (pageId && (retainerCopy as any).websiteUrl || (retainerCopy as any).destinationUrl) {
              const rnCreative = await createAdCreative(`RN Creative — ${c.name}`, c.hash || null, retainerCopy)
              if (rnCreative) {
                await post(`${adAccountId}/ads`, {
                  name: `RN Ad — ${c.name}`,
                  adset_id: rnAdset.id,
                  creative: { creative_id: rnCreative },
                  status: 'PAUSED',
                })
              }
            }
            retainerCount++
          } catch(e: any) { errors.push(`Retainer "${c.name}": ${e.message}`) }
        }
      } catch(e: any) { errors.push(`Retainer campaign: ${e.message}`) }
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

    // Store launch data for insights
    try {
      const adminSb = createAdminClient()
      await adminSb.from('m4_launches').insert({
        user_id: user.id,
        campaign_name: campaignName,
        product: product || '',
        description: description || '',
        target_customer: targetCustomer || '',
        competitor_domains: competitorDomains || '',
      })
    } catch(e: any) { console.log('Launch store error:', e.message) }

    return NextResponse.json({
      success: true,
      account: metaAccount.account_name,
      broad_campaign_id: broadCamp.id,
      interest_campaign_id: intCamp.id,
      broad_adsets: broadCount,
      interest_adsets: intCount,
      retargeting_adsets: retargetingCount,
      retainer_adsets: retainerCount,
      exclusion_audiences: 0,
      errors: errors.length > 0 ? errors : undefined,
    })

  } catch (err: any) {
    console.error('M4 launch error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
