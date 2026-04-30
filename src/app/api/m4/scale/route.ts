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
      campaignName, budgetMultiplier = 2, isBudgetIncrease = false,
      selectedInterests = [], adsetId, adsetName, testBudget = 500,
      product = '', description = '', competitorDomains = ''
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
      if (data.error) throw new Error(data.error.message)
      return data
    }

    // Find the winning campaign by name
    const campRes = await fetch(
      "https://graph.facebook.com/" + V + "/" + adAccountId + "/campaigns?" +
      new URLSearchParams({ fields: "id,name,status,objective,daily_budget", limit: "50", access_token: token })
    )
    const campData = await campRes.json()
    const winning = campData.data?.find((c: any) =>
      c.name === campaignName || c.name.includes(campaignName.split(' — ')[0])
    )
    if (!winning) return NextResponse.json({ error: 'Campaign not found: ' + campaignName }, { status: 404 })

    const currentBudget = parseInt(winning.daily_budget || '0') / 100
    const scaledBudget = isBudgetIncrease
      ? Math.round(currentBudget * (1 + budgetMultiplier / 100) * 100)
      : Math.round(currentBudget * budgetMultiplier * 100)

    // BUDGET INCREASE ONLY - update existing campaign
    if (isBudgetIncrease) {
      await post(winning.id, { daily_budget: Math.max(minBudget * 100, scaledBudget) })
      return NextResponse.json({
        success: true, action: 'budget_increased',
        new_budget: scaledBudget / 100, increase_pct: budgetMultiplier,
      })
    }

    // DUPLICATE THE WINNING AD SET
    let duplicateAdsetId = null
    try {
      const adsetsRes = await fetch(
        "https://graph.facebook.com/" + V + "/" + winning.id + "/adsets?" +
        new URLSearchParams({ fields: "id,name,targeting,optimization_goal,billing_event,destination_type,promoted_object", access_token: token, limit: "20" })
      )
      const adsetsData = await adsetsRes.json()
      let targetAdset = adsetsData.data?.find((a: any) => a.id === adsetId)
      if (!targetAdset) targetAdset = adsetsData.data?.[0]

      if (targetAdset) {
        const newAdset = await post(adAccountId + "/adsets", {
          name: (adsetName || targetAdset.name) + " — Scale " + budgetMultiplier + "x",
          campaign_id: winning.id,
          status: "ACTIVE",
          daily_budget: Math.max(minBudget * 100, scaledBudget),
          targeting: targetAdset.targeting,
          optimization_goal: targetAdset.optimization_goal,
          billing_event: targetAdset.billing_event,
          destination_type: targetAdset.destination_type || "WEBSITE",
          ...(targetAdset.promoted_object ? { promoted_object: targetAdset.promoted_object } : {}),
        })
        duplicateAdsetId = newAdset?.id

        // Copy ads to new adset
        if (newAdset?.id) {
          const adsRes = await fetch(
            "https://graph.facebook.com/" + V + "/" + targetAdset.id + "/ads?" +
            new URLSearchParams({ fields: "id,name,creative", access_token: token })
          )
          const adsData = await adsRes.json()
          for (const ad of (adsData.data || []).slice(0, 3)) {
            await post(adAccountId + "/ads", {
              name: ad.name + " — Scale",
              adset_id: newAdset.id,
              creative: { creative_id: ad.creative?.id },
              status: "ACTIVE",
            }).catch(() => null)
          }
        }
      }
    } catch(e: any) { console.log("Adset duplicate error:", e.message) }

    // CREATE TEST AD SETS per selected interest
    const newAdsets: string[] = []
    for (const interestName of (selectedInterests as string[])) {
      try {
        const intRes = await fetch(
          "https://graph.facebook.com/" + V + "/" + adAccountId + "/search?" +
          new URLSearchParams({ type: "adinterest", q: interestName, limit: "3", access_token: token })
        )
        const intData = await intRes.json()
        const match = intData.data?.[0]
        if (match) {
          await post(adAccountId + "/adsets", {
            name: campaignName + " — Test — " + match.name,
            campaign_id: winning.id,
            status: "PAUSED",
            daily_budget: Math.max(minBudget * 100, testBudget * 100),
            targeting: {
              age_min: 18,
              geo_locations: { countries: ["PK"] },
              flexible_spec: [{ interests: [{ id: match.id, name: match.name }] }],
            },
            destination_type: "WEBSITE",
            optimization_goal: "OFFSITE_CONVERSIONS",
            billing_event: "IMPRESSIONS",
          })
          newAdsets.push(match.name)
        }
      } catch(e: any) { console.log("Test adset error:", e.message) }
    }

    return NextResponse.json({
      success: true,
      action: 'scaled',
      duplicate_adset_id: duplicateAdsetId,
      new_test_adsets: newAdsets,
      new_interests: newAdsets.length,
    })

  } catch (err: any) {
    console.error('Scale error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
