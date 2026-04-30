import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const {
      campaignId, budgetMultiplier = 2, isBudgetIncrease = false,
      adsetId, adsetName,
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

    // Find winning campaign
    const campData = await get(adAccountId + "/campaigns", {
      fields: "id,name,status,objective,daily_budget",
      limit: "200"
    })
    const winning = campData.data?.find((c: any) => c.id === campaignId)
    if (!winning) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    const currentBudget = parseInt(winning.daily_budget || '0') / 100
    const scaledBudget = isBudgetIncrease
      ? Math.round(currentBudget * (1 + budgetMultiplier / 100) * 100)
      : Math.round(currentBudget * budgetMultiplier * 100)

    // BUDGET INCREASE ONLY
    if (isBudgetIncrease) {
      await post(winning.id, { daily_budget: Math.max(10000, scaledBudget) })
      return NextResponse.json({ success: true, action: 'budget_increased' })
    }

    // STEP 1: FIND OR CREATE SCALING CAMPAIGN
    const scalingCampaignName = "M4 | Scaling | " + winning.name
    const existingScaling = campData.data?.find((c: any) => c.name === scalingCampaignName)
    let scalingCampaignId: string

    if (existingScaling) {
      scalingCampaignId = existingScaling.id
      console.log("Reusing Scaling campaign:", scalingCampaignId)
      await post(scalingCampaignId, { daily_budget: Math.max(10000, scaledBudget) }).catch(() => null)
    } else {
      const copied = await post(winning.id + "/copies", {
        deep_copy: false,
        status_override: "PAUSED",
        rename_options: { rename_strategy: "ONLY_TOP_LEVEL_RENAME" }
      })
      scalingCampaignId = copied.copied_campaign_id
      await post(scalingCampaignId, { name: scalingCampaignName, daily_budget: Math.max(10000, scaledBudget) })
      console.log("Created Scaling campaign:", scalingCampaignId)
    }

    // STEP 2: COPY ADSET (structure only)
    const copiedAdset = await post(adsetId + "/copies", {
      campaign_id: scalingCampaignId,
      deep_copy: false,
      status_override: "PAUSED",
      rename_options: { rename_strategy: "ONLY_TOP_LEVEL_RENAME" }
    })
    const newAdsetId = copiedAdset.copied_adset_id
    if (!newAdsetId) throw new Error("Failed to copy adset")

    await post(newAdsetId, {
      name: (adsetName || "Winner") + " — Scale " + budgetMultiplier + "x"
    }).catch(() => null)

    // STEP 3: GET ADS FROM ORIGINAL ADSET with creative_id
    const adsData = await get(adsetId + "/ads", {
      fields: "id,name,creative"
    })
    const ads = adsData.data || []
    console.log("Found ads:", ads.length)

    // STEP 4: CREATE NEW AD in new adset using SAME creative_id
    // This reuses ALL creative content — text, media, URL, everything
    for (const ad of ads.slice(0, 5)) {
      const creativeId = ad.creative?.id
      if (!creativeId) {
        console.log("No creative_id for ad:", ad.id)
        continue
      }
      const newAd = await post(adAccountId + "/ads", {
        name: ad.name + " — Scale " + budgetMultiplier + "x",
        adset_id: newAdsetId,
        creative: { creative_id: creativeId },
        status: "PAUSED",
      }).catch((e: any) => {
        console.log("Ad creation error:", e.message)
        return null
      })
      console.log("Created ad:", newAd?.id, "using creative:", creativeId)
    }

    return NextResponse.json({
      success: true,
      action: 'scaled',
      scaling_campaign_id: scalingCampaignId,
      scaling_campaign_name: scalingCampaignName,
      duplicate_adset_id: newAdsetId,
    })

  } catch (err: any) {
    console.error('Scale error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
