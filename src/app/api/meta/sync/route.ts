import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: metaAccounts } = await admin.from('meta_accounts').select('*').eq('user_id', user.id).eq('status', 'active')
    if (!metaAccounts?.length) return NextResponse.json({ error: 'No Meta accounts connected' }, { status: 400 })

    let totalCampaigns = 0

    for (const metaAccount of metaAccounts) {
      const token = decryptToken(metaAccount.access_token)
      const accountId = `act_${metaAccount.account_id}`

      // Fetch campaigns
      const campsRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${accountId}/campaigns?` +
        new URLSearchParams({ fields: 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,created_time', limit: '100', access_token: token })
      )
      const campsData = await campsRes.json()
      const campaigns = campsData.data || []
      totalCampaigns += campaigns.length

      for (const camp of campaigns) {
        const { data: savedCamp } = await admin.from('campaigns').upsert({
          user_id: user.id,
          meta_account_id: metaAccount.id,
          meta_campaign_id: camp.id,
          name: camp.name,
          objective: camp.objective,
          status: camp.status,
          daily_budget: camp.daily_budget ? Number(camp.daily_budget) / 100 : null,
          lifetime_budget: camp.lifetime_budget ? Number(camp.lifetime_budget) / 100 : null,
          start_time: camp.start_time || null,
          stop_time: camp.stop_time || null,
        }, { onConflict: 'meta_account_id,meta_campaign_id' }).select().single()

        if (!savedCamp) continue

        // Fetch insights for this campaign
        const insightsRes = await fetch(
          `https://graph.facebook.com/${META_API_VERSION}/${camp.id}/insights?` +
          new URLSearchParams({
            fields: 'spend,impressions,clicks,ctr,cpm,cpc,actions,action_values,reach',
            date_preset: 'last_30d',
            access_token: token,
          })
        )
        const insightsData = await insightsRes.json()
        const insight = insightsData.data?.[0]

        if (insight) {
          const actions = insight.actions || []
          const actionValues = insight.action_values || []
          const purchases = actions.find((a: any) => a.action_type === 'purchase')
          const purchaseValue = actionValues.find((a: any) => a.action_type === 'purchase')
          const leads = actions.find((a: any) => a.action_type === 'lead')
          const conversions = Number(purchases?.value || leads?.value || 0)
          const conversionValue = Number(purchaseValue?.value || 0)
          const spend = Number(insight.spend || 0)

          await admin.from('campaign_insights').upsert({
            campaign_id: savedCamp.id,
            date_start: insight.date_start || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0],
            date_stop: insight.date_stop || new Date().toISOString().split('T')[0],
            spend,
            impressions: Number(insight.impressions || 0),
            clicks: Number(insight.clicks || 0),
            ctr: Number(insight.ctr || 0),
            cpm: Number(insight.cpm || 0),
            cpc: Number(insight.cpc || 0),
            conversions,
            conversion_value: conversionValue,
            roas: spend > 0 ? conversionValue / spend : 0,
            cpa: conversions > 0 ? spend / conversions : 0,
            reach: Number(insight.reach || 0),
          }, { onConflict: 'campaign_id,date_start,date_stop' })
        }
      }

      await admin.from('meta_accounts').update({ last_synced_at: new Date().toISOString() }).eq('id', metaAccount.id)
    }

    await admin.from('activity_logs').insert({
      user_id: user.id,
      action_type: 'SYNC_COMPLETED',
      entity_type: 'system',
      description: `Synced ${totalCampaigns} campaigns with insights from Meta`,
      performed_by: 'system',
    })

    return NextResponse.json({ success: true, campaigns: totalCampaigns })
  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
