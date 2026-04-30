import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'
const minBudget = 100

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
      campaignName, campaignId, budgetMultiplier = 2, isBudgetIncrease = false,
      selectedInterests = [], adsetId, adsetName, testBudget = 500,
    } = await request.json()

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = "act_" + metaAccount.account_id

    const post = async (path: string, body: Record<string, unknown>) => {
      const url = "https://graph.facebook.com/" + V + "/" + path
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, access_token: token })
      })
      const data = await res.json()
      if (data.error) throw new Error(JSON.stringify(data.error))
      return data
    }

    const get = async (path: string, params: Record<string, string>) => {
      const url = "https://graph.facebook.com/" + V + "/" + path + "?" +
        new URLSearchParams({ ...params, access_token: token })
      const res = await fetch(url)
      return res.json()
    }

    // Find the winning campaign
    const campData = await get(adAccountId + "/campaigns", {
      fields: "id,name,status,objective,daily_budget",
      limit: "200"
    })
    const winning = campData.data?.find((c: any) => c.id === campaignId || c.name === campaignName
    )
    if (!winning) return NextResponse.json({ error: 'Campaign not found: ' + campaignName }, { status: 404 })

    const currentBudget = parseInt(winning.daily_budget || '0') / 100
    const scaledBudget = isBudgetIncrease
      ? Math.round(currentBudget * (1 + budgetMultiplier / 100) * 100)
      : Math.round(currentBudget * budgetMultiplier * 100)

    // BUDGET INCREASE ONLY
    if (isBudgetIncrease) {
      await post(winning.id, { daily_budget: Math.max(minBudget * 100, scaledBudget) })
      return NextResponse.json({ success: true, action: 'budget_increased' })
    }

    // FIND OR CREATE SCALING CAMPAIGN
    const scalingCampaignName = "M4 | Scaling | " + winning.name
    let scalingCampaign = campData.data?.find((c: any) => c.name === scalingCampaignName)

    if (!scalingCampaign) {
      scalingCampaign = await post(adAccountId + "/campaigns", {
        name: scalingCampaignName,
        objective: winning.objective || "OUTCOME_SALES",
        status: "PAUSED",
        special_ad_categories: [],
        bid_strategy: "LOWEST_COST",
        daily_budget: Math.max(minBudget * 100, scaledBudget),
      })
      console.log("Created Scaling campaign:", scalingCampaign.id)
    } else {
      console.log("Reusing Scaling campaign:", scalingCampaign.id)
    }

    // GET WINNING ADSET
    const adsetsData = await get(winning.id + "/adsets", {
      fields: "id,name,targeting,optimization_goal,billing_event,destination_type,promoted_object",
      limit: "20"
    })

    let targetAdset = adsetsData.data?.find((a: any) => a.id === adsetId)
    if (!targetAdset) targetAdset = adsetsData.data?.[0]
    if (!targetAdset) return NextResponse.json({ error: 'No adset found' }, { status: 404 })

    // CLEAN TARGETING
    const t = targetAdset.targeting || {}
    const cleanT: Record<string, unknown> = {
      geo_locations: t.geo_locations || { countries: ["PK"] },
      age_min: t.age_min || 18,
    }
    if (t.age_max) cleanT.age_max = t.age_max
    if (t.genders) cleanT.genders = t.genders
    if (t.flexible_spec) cleanT.flexible_spec = t.flexible_spec
    if (t.custom_audiences) cleanT.custom_audiences = t.custom_audiences
    if (t.exclusions) cleanT.exclusions = t.exclusions
    if (t.targeting_automation) cleanT.targeting_automation = t.targeting_automation

    // BUILD SCALED ADSET
    // No bid_strategy, no bid_amount — open bid, let Meta optimize freely
    const adsetBody: Record<string, unknown> = {
      name: (adsetName || targetAdset.name) + " — Scale " + budgetMultiplier + "x",
      campaign_id: scalingCampaign.id,
      status: "PAUSED",
      targeting: cleanT,
      optimization_goal: targetAdset.optimization_goal || "OFFSITE_CONVERSIONS",
      billing_event: targetAdset.billing_event || "IMPRESSIONS",
      is_adset_budget_sharing_enabled: true,
    }
    if (targetAdset.destination_type) adsetBody.destination_type = targetAdset.destination_type
    if (targetAdset.promoted_object) adsetBody.promoted_object = targetAdset.promoted_object

    const newAdset = await post(adAccountId + "/adsets", adsetBody)
    console.log("Created scaled adset:", newAdset.id)

    // COPY ADS INTO NEW ADSET
    if (newAdset?.id) {
      const adsData = await get(targetAdset.id + "/ads", { fields: "id,name,creative" })
      for (const ad of (adsData.data || []).slice(0, 3)) {
        await post(adAccountId + "/ads", {
          name: ad.name + " — Scale",
          adset_id: newAdset.id,
          creative: { creative_id: ad.creative?.id },
          status: "PAUSED",
        }).catch((e: any) => console.log("Ad copy error:", e.message))
      }
    }

    // ORIGINAL ADSET STAYS UNTOUCHED

    // TEST INTEREST ADSETS
    const newAdsets: string[] = []
    for (const interestName of (selectedInterests as string[])) {
      try {
        const intData = await get(adAccountId + "/search", {
          type: "adinterest", q: interestName, limit: "3"
        })
        const match = intData.data?.[0]
        if (match) {
          const testAdsetBody: Record<string, unknown> = {
            name: campaignName + " — Test — " + match.name,
            campaign_id: winning.id,
            status: "PAUSED",
            targeting: {
              age_min: 18,
              geo_locations: { countries: ["PK"] },
              flexible_spec: [{ interests: [{ id: match.id, name: match.name }] }],
            },
            optimization_goal: targetAdset.optimization_goal || "OFFSITE_CONVERSIONS",
            billing_event: targetAdset.billing_event || "IMPRESSIONS",
            is_adset_budget_sharing_enabled: true,
          }
          if (targetAdset.destination_type) testAdsetBody.destination_type = targetAdset.destination_type
          if (targetAdset.promoted_object) testAdsetBody.promoted_object = targetAdset.promoted_object

          await post(adAccountId + "/adsets", testAdsetBody)
          newAdsets.push(match.name)
        }
      } catch (e: any) {
        console.log("Test adset error:", e.message)
      }
    }

    return NextResponse.json({
      success: true,
      action: 'scaled',
      scaling_campaign_id: scalingCampaign.id,
      scaling_campaign_name: scalingCampaignName,
      duplicate_adset_id: newAdset.id,
      new_test_adsets: newAdsets,
    })

  } catch (err: any) {
    console.error('Scale error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
