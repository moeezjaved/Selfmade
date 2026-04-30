import { NextResponse } from 'next/server'
import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const dateRange = request.nextUrl.searchParams.get('dateRange') || 'last_7d'
    const days = parseInt(dateRange.replace('last_','').replace('d','')) || 7

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()

    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = "act_" + metaAccount.account_id
    const currency = metaAccount.currency || 'USD'

    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
    const until = new Date().toISOString().split('T')[0]
    const timeRange = JSON.stringify({ since, until })

    // Get campaigns
    const campRes = await fetch(
      "https://graph.facebook.com/" + V + "/" + adAccountId + "/campaigns?" +
      new URLSearchParams({
        fields: "id,name,status,objective,daily_budget",
        limit: "50",
        access_token: token,
      })
    )
    const campData = await campRes.json()
    if (campData.error) throw new Error(campData.error.message)

    // Get account-level ROAS for comparison
    const accountRes = await fetch(
      "https://graph.facebook.com/" + V + "/" + adAccountId + "/insights?" +
      new URLSearchParams({
        fields: "spend,action_values,actions",
        time_range: timeRange,
        access_token: token,
      })
    )
    const accountData = await accountRes.json()
    const accountInsight = accountData.data?.[0]
    const accountSpend = parseFloat(accountInsight?.spend || "0")
    const accountRevenue = parseFloat(accountInsight?.action_values?.find((a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase")?.value || "0")
    const accountROAS = accountSpend > 0 ? accountRevenue / accountSpend : 0

    const campaigns = []
    let totalSpend = 0, totalRevenue = 0, totalConversions = 0

    for (const camp of (campData.data || [])) {
      // Get adsets for this campaign with insights
      const adsetRes = await fetch(
        "https://graph.facebook.com/" + V + "/" + camp.id + "/adsets?" +
        new URLSearchParams({
          fields: "id,name,status,daily_budget,insights.time_range(" + timeRange + "){spend,impressions,clicks,actions,action_values,ctr,cpc}",
          limit: "20",
          access_token: token,
        })
      )
      const adsetData = await adsetRes.json()
      const adsets = []

      for (const adset of (adsetData.data || [])) {
        const ins = adset.insights?.data?.[0]
        if (!ins) continue
        const spend = parseFloat(ins.spend || "0")
        const revenue = parseFloat(ins.action_values?.find((a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase")?.value || "0")
        const conversions = parseInt(ins.actions?.find((a: any) => a.action_type === "offsite_conversion.fb_pixel_purchase")?.value || "0")
        const roas = spend > 0 ? revenue / spend : 0
        const ctr = parseFloat(ins.ctr || "0")
        const cpc = parseFloat(ins.cpc || "0")

        totalSpend += spend
        totalRevenue += revenue
        totalConversions += conversions

        let rec_type = "hold"
        let recommendation = ""

        if (spend < 50) {
          rec_type = "hold"
          recommendation = "Need more spend data. Let this run longer before deciding."
        } else if (roas >= accountROAS * 1.3 && conversions >= 2) {
          rec_type = "scale"
          recommendation = roas.toFixed(2) + "x ROAS vs account avg " + accountROAS.toFixed(2) + "x. Duplicate this ad set with higher budget to scale this creative/audience."
        } else if (spend > 300 && roas < accountROAS * 0.7) {
          rec_type = "pause"
          recommendation = "Underperforming vs account average. Pause and reallocate budget to winners."
        } else if (ctr > 2 && conversions === 0 && spend > 100) {
          rec_type = "retarget"
          recommendation = "Good clicks but no conversions. Build retargeting for these visitors."
        } else {
          rec_type = "hold"
          recommendation = (roas > 0 ? roas.toFixed(2) + "x ROAS. " : "No conversions yet. ") + "Keep running for more data."
        }

        adsets.push({
          id: adset.id, name: adset.name, status: adset.status,
          spend, revenue, conversions, roas, ctr, cpc,
          cpa: conversions > 0 ? spend / conversions : 0,
          clicks: parseInt(ins.clicks || "0"),
          impressions: parseInt(ins.impressions || "0"),
          currency, rec_type, recommendation,
          budget: parseInt(adset.daily_budget || "0") / 100,
        })
      }

      // Sort adsets: scale first
      const order: Record<string,number> = { scale: 0, hold: 1, retarget: 2, pause: 3 }
      adsets.sort((a, b) => order[a.rec_type] - order[b.rec_type])

      if (adsets.length > 0) {
        campaigns.push({
          id: camp.id, name: camp.name, status: camp.status,
          objective: camp.objective, currency,
          budget: parseInt(camp.daily_budget || "0") / 100,
          adsets,
        })
      }
    }

    return NextResponse.json({
      campaigns,
      account: metaAccount.account_name,
      totals: {
        spend: totalSpend,
        revenue: totalRevenue,
        roas: totalSpend > 0 ? totalRevenue / totalSpend : 0,
        conversions: totalConversions,
      },
      accountROAS,
    })
  } catch (err: any) {
    console.error("Insights error:", err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
