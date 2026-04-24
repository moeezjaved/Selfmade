import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createMetaClientForUser } from '@/lib/meta/client'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { recommendation_id, action } = await request.json()
    if (!recommendation_id || !action) {
      return NextResponse.json({ error: 'Missing recommendation_id or action' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Fetch the recommendation
    const { data: rec, error: recError } = await admin
      .from('recommendations')
      .select('*, campaigns(*), ad_sets(*)')
      .eq('id', recommendation_id)
      .eq('user_id', user.id)
      .single()

    if (recError || !rec) {
      return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 })
    }

    if (rec.status !== 'PENDING') {
      return NextResponse.json({ error: `Recommendation already ${rec.status}` }, { status: 400 })
    }

    // REJECT path — no Meta API call needed
    if (action === 'reject') {
      await admin
        .from('recommendations')
        .update({ status: 'REJECTED', updated_at: new Date().toISOString() })
        .eq('id', recommendation_id)

      await admin.from('activity_logs').insert({
        user_id: user.id,
        action_type: 'RECOMMENDATION_REJECTED',
        entity_type: rec.campaigns ? 'campaign' : 'adset',
        entity_name: rec.campaigns?.name || rec.ad_sets?.name,
        description: `Rejected: ${rec.title}`,
        performed_by: 'user',
      })

      return NextResponse.json({ success: true, status: 'REJECTED' })
    }

    // APPROVE path — execute on Meta API
    let metaResult: Record<string, unknown> = {}
    let executionError: string | undefined

    try {
      const metaClient = await createMetaClientForUser(user.id)
      const campaign = rec.campaigns
      const adSet = rec.ad_sets

      switch (rec.type) {
        case 'PAUSE':
          if (adSet?.meta_adset_id) {
            metaResult = await metaClient.pauseAdSet(adSet.meta_adset_id)
          } else if (campaign?.meta_campaign_id) {
            metaResult = await metaClient.pauseCampaign(campaign.meta_campaign_id)
          }
          break

        case 'SCALE':
          if (adSet?.meta_adset_id && rec.meta_action?.new_daily_budget) {
            metaResult = await metaClient.scaleAdSetBudget(
              adSet.meta_adset_id,
              rec.meta_action.new_daily_budget as number
            )
          }
          break

        case 'ADJUST_BUDGET':
          if (adSet?.meta_adset_id && rec.meta_action?.new_daily_budget) {
            metaResult = await metaClient.scaleAdSetBudget(
              adSet.meta_adset_id,
              rec.meta_action.new_daily_budget as number
            )
          }
          break

        default:
          // For complex actions, store as approved and handle manually / future automation
          metaResult = { note: `Action ${rec.type} queued for execution` }
      }

    } catch (metaErr) {
      executionError = metaErr instanceof Error ? metaErr.message : 'Meta API error'
      console.error('Meta API execution error:', metaErr)
    }

    // Update recommendation status
    const newStatus = executionError ? 'FAILED' : 'EXECUTED'
    await admin
      .from('recommendations')
      .update({
        status: newStatus,
        executed_at: new Date().toISOString(),
        execution_result: executionError
          ? { error: executionError }
          : metaResult,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recommendation_id)

    // Log activity
    await admin.from('activity_logs').insert({
      user_id: user.id,
      action_type: `RECOMMENDATION_${newStatus}`,
      entity_type: rec.campaigns ? 'campaign' : 'adset',
      entity_name: rec.campaigns?.name || rec.ad_sets?.name,
      description: executionError
        ? `Failed to execute: ${rec.title} — ${executionError}`
        : `Approved & executed: ${rec.title}`,
      meta_api_response: metaResult,
      performed_by: 'user',
    })

    if (executionError) {
      return NextResponse.json({
        success: false,
        status: 'FAILED',
        error: executionError,
      }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      status: 'EXECUTED',
      meta_result: metaResult,
    })

  } catch (err) {
    console.error('Approve recommendation error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
