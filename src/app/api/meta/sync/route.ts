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

    // Get connected Meta accounts
    const { data: metaAccounts } = await admin
      .from('meta_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')

    if (!metaAccounts?.length) {
      return NextResponse.json({ error: 'No Meta accounts connected' }, { status: 400 })
    }

    let totalCampaigns = 0

    for (const metaAccount of metaAccounts) {
      const token = decryptToken(metaAccount.access_token)
      const accountId = `act_${metaAccount.account_id}`

      // Fetch campaigns from Meta
      const campsRes = await fetch(
        `https://graph.facebook.com/${META_API_VERSION}/${accountId}/campaigns?` +
        new URLSearchParams({
          fields: 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,created_time',
          limit: '100',
          access_token: token,
        })
      )
      const campsData = await campsRes.json()
      const campaigns = campsData.data || []
      totalCampaigns += campaigns.length

      for (const camp of campaigns) {
        await admin.from('campaigns').upsert({
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
        }, { onConflict: 'meta_account_id,meta_campaign_id' })
      }

      // Update last synced
      await admin.from('meta_accounts')
        .update({ last_synced_at: new Date().toISOString() })
        .eq('id', metaAccount.id)
    }

    // Log activity
    await admin.from('activity_logs').insert({
      user_id: user.id,
      action_type: 'SYNC_COMPLETED',
      entity_type: 'system',
      description: `Synced ${totalCampaigns} campaigns from Meta`,
      performed_by: 'system',
    })

    return NextResponse.json({ success: true, campaigns: totalCampaigns })
  } catch (err) {
    console.error('Sync error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
