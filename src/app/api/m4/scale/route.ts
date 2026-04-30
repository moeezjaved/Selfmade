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

    // FIND EXISTING SCALING CAMPAIGN (match by original campaign ID in name)
    const scalingCampaignName = "M4 | Scaling | " + winning.name
    const existingScaling = campData.data?.find((c: any) => c.name === scalingCampaignName)

    let scalingCampaignId: string

    if (existingScaling) {
      // Reuse existing scaling campaign
      scalingCampaignId = existingScaling.id
      console.log("Reusing Scaling campaign:", scalingCampaignId)
    } else {
      // COPY the winning campaign — Meta preserves ALL settings including bid strategy
      const copied = await post(winning.id + "/copies", {
        deep_copy: false,         // don't copy adsets — we'll handle that separately
        status_override: "PAUSED",
        rename_options: {
          rename_strategy: "CUSTOM_STRING",
          custom_string: scalingCampaignName,
        }
      })
      scalingCampaignId = copied.copied_campaign_id
      console.log("Copied Scaling campaign:", scalingCampaignId)
    }

    // COPY THE WINNING ADSET into the Scaling campaign
    // Use /copies on the adset — preserves ALL settings including bid strategy
    const copiedAdset = await post(adsetId + "/copies", {
      campaign_id: scalingCampaignId,
      deep_copy: true,              // copies ads/creatives too
      status_override: "PAUSED",
      rename_options: {
        rename_strategy: "CUSTOM_STRING", 
        custom_string: (adsetName || "Winner") + " — Scale " + budgetMultiplier + "x",
      }
    })

    console.log("Copied adset:", copiedAdset)

    // ORIGINAL ADSET STAYS UNTOUCHED

    return NextResponse.json({
      success: true,
      action: 'scaled',
      scaling_campaign_id: scalingCampaignId,
      scaling_campaign_name: scalingCampaignName,
      copied_adset: copiedAdset,
    })

  } catch (err: any) {
    console.error('Scale error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
