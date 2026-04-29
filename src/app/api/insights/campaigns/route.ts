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
    const adAccountId = `act_${metaAccount.account_id}`
    const currency = metaAccount.currency || 'USD'

    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
    const until = new Date().toISOString().split('T')[0]

    const res = await fetch(
      `https://graph.facebook.com/${V}/${adAccountId}/campaigns?` +
      new URLSearchParams({
        fields: `id,name,status,objective,daily_budget,insights.time_range({"since":"${since}","until":"${until}"}){spend,impressions,clicks,actions,action_values,ctr,cpc}`,
        limit: '50',
        access_token: token,
      })
    )
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)

    const accountRes = await fetch(
      `https://graph.facebook.com/${V}/${adAccountId}/insights?` +
      new URLSearchParams({
        fields: 'spend,action_values,actions',
        time_range: JSON.stringify({ since, until }),
        access_token: token,
      })
    )
    const accountData = await accountRes.json()
    const accountInsight = accountData.data?.[0]
    const accountSpend = parseFloat(accountInsight?.spend || '0')
    const accountRevenue = parseFloat(accountInsight?.action_values?.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0')
    const accountROAS = accountSpend > 0 ? accountRevenue / accountSpend : 0

    const campaigns = []
    let totalSpend = 0, totalRevenue = 0, totalConversions = 0

    for (const camp of (data.data || [])) {
      const ins = camp.insights?.data?.[0]
      if (!ins) continue

      const spend = parseFloat(ins.spend || '0')
      const revenue = parseFloat(ins.action_values?.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0')
      const conversions = parseInt(ins.actions?.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0')
      const roas = spend > 0 ? revenue / spend : 0
      const ctr = parseFloat(ins.ctr || '0')
      const cpc = parseFloat(ins.cpc || '0')
      const cpa = conversions > 0 ? spend / conversions : 0

      totalSpend += spend
      totalRevenue += revenue
      totalConversions += conversions

      let rec_type: 'scale'|'hold'|'pause'|'retarget' = 'hold'
      let recommendation = ''

      if (spend < 100) {
        rec_type = 'hold'
        recommendation = `Only ${currency} ${spend.toFixed(0)} spent. Need more data — let this run until at least ${currency} 500 before deciding.`
      } else if (roas >= accountROAS * 1.3 && conversions >= 3) {
        rec_type = 'scale'
        recommendation = `${roas.toFixed(2)}x ROAS vs account average ${accountROAS.toFixed(2)}x — ${((roas/Math.max(accountROAS,0.01)-1)*100).toFixed(0)}% better. Duplicate with 2x budget and test new interests in original.`
      } else if (roas < accountROAS * 0.7 && spend > 500) {
        rec_type = 'pause'
        recommendation = `${currency} ${spend.toFixed(0)} spent with ${roas.toFixed(2)}x ROAS vs account average ${accountROAS.toFixed(2)}x. Underperforming — pause and reallocate budget to winners.`
      } else if (ctr > 2 && conversions === 0 && spend > 200) {
        rec_type = 'retarget'
        recommendation = `Good CTR ${ctr.toFixed(2)}% but no conversions. People click but don't buy. Build a retargeting campaign for these warm visitors.`
      } else {
        rec_type = 'hold'
        recommendation = `${roas > 0 ? roas.toFixed(2)+'x ROAS' : 'No conversions yet'}. ${conversions < 3 ? 'Need more conversions for confidence.' : 'Average performance.'} Keep running and check back soon.`
      }

      campaigns.push({
        id: camp.id, name: camp.name, status: camp.status, objective: camp.objective,
        spend, revenue, conversions,
        clicks: parseInt(ins.clicks || '0'),
        impressions: parseInt(ins.impressions || '0'),
        roas, ctr, cpc, cpa, currency, recommendation, rec_type,
        budget: parseInt(camp.daily_budget || '0') / 100,
      })
    }

    const order: Record<string,number> = { scale: 0, retarget: 1, hold: 2, pause: 3 }
    campaigns.sort((a, b) => order[a.rec_type] - order[b.rec_type])

    return NextResponse.json({
      campaigns,
      account: metaAccount.account_name,
      totals: { spend: totalSpend, revenue: totalRevenue, roas: totalSpend > 0 ? totalRevenue/totalSpend : 0, conversions: totalConversions },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
