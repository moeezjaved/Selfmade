import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { MetaClient, decryptToken } from '@/lib/meta/client'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()

    // Get all active Meta accounts for user
    const { data: accounts } = await admin
      .from('meta_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (!accounts?.length) {
      return NextResponse.json({ error: 'No Meta accounts connected' }, { status: 400 })
    }

    const syncResults = []

    for (const account of accounts) {
      try {
        const token = decryptToken(account.access_token)
        const client = new MetaClient(token, account.account_id)

        // 1. Sync campaigns
        const campaigns = await client.getCampaigns()
        
        for (const campaign of campaigns) {
          const { data: campaignRow } = await admin
            .from('campaigns')
            .upsert({
              user_id: user.id,
              meta_account_id: account.id,
              meta_campaign_id: campaign.id,
              name: campaign.name,
              objective: campaign.objective,
              status: campaign.status,
              daily_budget: campaign.daily_budget ? parseInt(campaign.daily_budget) / 100 : null,
              lifetime_budget: campaign.lifetime_budget ? parseInt(campaign.lifetime_budget) / 100 : null,
              start_time: campaign.start_time,
              stop_time: campaign.stop_time,
            }, { onConflict: 'meta_account_id,meta_campaign_id' })
            .select('id')
            .single()

          if (!campaignRow) continue

          // 2. Sync insights for each campaign
          try {
            const insights = await client.getCampaignInsights(campaign.id, 'last_30d')
            for (const insight of insights) {
              await admin.from('campaign_insights').upsert({
                campaign_id: campaignRow.id,
                date_start: insight.date_start,
                date_stop: insight.date_stop,
                spend: insight.spend,
                impressions: insight.impressions,
                clicks: insight.clicks,
                ctr: insight.ctr,
                cpm: insight.cpm,
                cpc: insight.cpc,
                conversions: insight.conversions,
                conversion_value: insight.conversion_value,
                roas: insight.roas,
                cpa: insight.cpa,
                reach: insight.reach,
              }, { onConflict: 'campaign_id,date_start,date_stop' })
            }
          } catch (insightErr) {
            console.warn(`Failed to sync insights for campaign ${campaign.id}:`, insightErr)
          }

          // 3. Sync ad sets
          try {
            const adSets = await client.getAdSets(campaign.id)
            for (const adSet of adSets) {
              await admin.from('ad_sets').upsert({
                campaign_id: campaignRow.id,
                meta_adset_id: adSet.id,
                name: adSet.name,
                status: adSet.status,
                daily_budget: adSet.daily_budget ? parseInt(adSet.daily_budget) / 100 : null,
                targeting: adSet.targeting || {},
                optimization_goal: adSet.optimization_goal,
                billing_event: adSet.billing_event,
              }, { onConflict: 'campaign_id,meta_adset_id' })
            }
          } catch (adSetErr) {
            console.warn(`Failed to sync ad sets for campaign ${campaign.id}:`, adSetErr)
          }
        }

        // Update last synced
        await admin
          .from('meta_accounts')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('id', account.id)

        syncResults.push({
          account_id: account.account_id,
          account_name: account.account_name,
          campaigns_synced: campaigns.length,
          status: 'success',
        })

      } catch (accountErr) {
        console.error(`Failed to sync account ${account.account_id}:`, accountErr)
        syncResults.push({
          account_id: account.account_id,
          account_name: account.account_name,
          status: 'error',
          error: accountErr instanceof Error ? accountErr.message : 'Unknown error',
        })

        // Mark account as error if token is invalid
        if ((accountErr as Error).message?.includes('token')) {
          await admin
            .from('meta_accounts')
            .update({ status: 'error' })
            .eq('id', account.id)
        }
      }
    }

    // Log sync activity
    await admin.from('activity_logs').insert({
      user_id: user.id,
      action_type: 'SYNC_COMPLETED',
      entity_type: 'system',
      description: `Synced ${syncResults.filter(r => r.status === 'success').length} account(s) successfully`,
      performed_by: 'system',
    })

    return NextResponse.json({ success: true, results: syncResults })

  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
