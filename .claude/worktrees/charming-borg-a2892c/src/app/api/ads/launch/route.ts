import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createMetaClientForUser } from '@/lib/meta/client'
import { CampaignDraft } from '@/types'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const draft: CampaignDraft = await request.json()

    // Validate required fields
    if (!draft.campaign_name || !draft.objective || !draft.budget?.amount) {
      return NextResponse.json({ error: 'Missing required campaign fields' }, { status: 400 })
    }

    if (draft.budget.amount < 10) {
      return NextResponse.json({ error: 'Minimum budget is $10/day' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Get primary Meta account for page_id
    const { data: metaAccount } = await admin
      .from('meta_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_primary', true)
      .single()

    if (!metaAccount) {
      return NextResponse.json({ error: 'No Meta account connected' }, { status: 400 })
    }

    // Build targeting object for Meta API
    const targeting = buildMetaTargeting(draft.targeting)

    // Get selected copy variant
    const copyVariant = draft.ai_strategy?.creative.variations.find(
      v => v.id === draft.creative.selected_copy_variant
    ) || draft.ai_strategy?.creative.variations[0]

    if (!copyVariant) {
      return NextResponse.json({ error: 'No ad copy selected' }, { status: 400 })
    }

    // Save draft to DB first
    const { data: savedDraft } = await admin
      .from('campaign_drafts')
      .insert({
        user_id: user.id,
        meta_account_id: metaAccount.id,
        user_type: draft.user_type,
        objective: draft.objective,
        campaign_name: draft.campaign_name,
        landing_url: draft.landing_url,
        targeting: draft.targeting,
        budget: draft.budget,
        placements: draft.placements,
        creative: draft.creative,
        ai_strategy: draft.ai_strategy,
        status: 'approved',
      })
      .select()
      .single()

    // ── LAUNCH ON META API ─────────────────────────────────────
    const metaClient = await createMetaClientForUser(user.id)

    let imageHash: string | undefined

    // Upload image if provided
    if (draft.creative.image_url) {
      try {
        const imgRes = await metaClient.uploadAdImage(draft.creative.image_url)
        const images = imgRes.images
        const firstImage = images ? Object.values(images)[0] as Record<string, unknown> : null
        imageHash = firstImage?.hash as string | undefined
      } catch (imgErr) {
        console.warn('Image upload failed, proceeding without image:', imgErr)
      }
    }

    // Map CTA to Meta format
    const ctaMap: Record<string, string> = {
      'SHOP_NOW':   'SHOP_NOW',
      'LEARN_MORE': 'LEARN_MORE',
      'SIGN_UP':    'SIGN_UP',
      'GET_OFFER':  'GET_OFFER',
    }
    const metaCta = ctaMap[copyVariant.cta] || 'LEARN_MORE'

    const launchResult = await metaClient.launchFullCampaign({
      campaignName: draft.campaign_name,
      objective: draft.objective,
      targeting,
      dailyBudget: draft.budget.amount,
      startTime: draft.budget.start_date
        ? new Date(draft.budget.start_date).toISOString()
        : new Date().toISOString(),
      endTime: draft.budget.end_date
        ? new Date(draft.budget.end_date).toISOString()
        : undefined,
      pageId: metaAccount.page_id || '0', // Will need real page ID
      creative: {
        imageHash,
        headline: copyVariant.headline,
        primaryText: copyVariant.primary_text,
        cta: metaCta,
        linkUrl: draft.landing_url || 'https://example.com',
      },
    })

    // Update draft with Meta IDs
    await admin
      .from('campaign_drafts')
      .update({
        status: 'launched',
        meta_campaign_id: launchResult.campaign_id,
        meta_adset_id: launchResult.adset_id,
        meta_ad_id: launchResult.ad_id,
        launched_at: new Date().toISOString(),
      })
      .eq('id', savedDraft?.id)

    // Save campaign to campaigns table
    await admin.from('campaigns').insert({
      user_id: user.id,
      meta_account_id: metaAccount.id,
      meta_campaign_id: launchResult.campaign_id,
      name: draft.campaign_name,
      objective: draft.objective,
      status: 'ACTIVE',
      daily_budget: draft.budget.amount,
      start_time: new Date().toISOString(),
    })

    // Log activity
    await admin.from('activity_logs').insert({
      user_id: user.id,
      meta_account_id: metaAccount.id,
      action_type: 'AD_LAUNCHED',
      entity_type: 'campaign',
      entity_id: launchResult.campaign_id,
      entity_name: draft.campaign_name,
      description: `Campaign launched: "${draft.campaign_name}" — $${draft.budget.amount}/day — ${draft.objective}`,
      meta_api_response: launchResult,
      performed_by: 'user',
    })

    return NextResponse.json({
      success: true,
      campaign_id: launchResult.campaign_id,
      adset_id: launchResult.adset_id,
      ad_id: launchResult.ad_id,
      draft_id: savedDraft?.id,
    })

  } catch (err) {
    console.error('Ad launch error:', err)
    const message = err instanceof Error ? err.message : 'Launch failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ── Build Meta targeting from our internal format ─────────────
function buildMetaTargeting(targeting: CampaignDraft['targeting']): Record<string, unknown> {
  const metaTargeting: Record<string, unknown> = {
    age_min: targeting.age_min || 18,
    age_max: targeting.age_max || 65,
  }

  // Gender: 1 = male, 2 = female, [] = all
  if (targeting.genders && targeting.genders.length > 0) {
    metaTargeting.genders = targeting.genders
  }

  // Geo locations
  if (targeting.geo_locations) {
    metaTargeting.geo_locations = targeting.geo_locations
  } else {
    metaTargeting.geo_locations = { countries: ['US'] }
  }

  // Interests
  if (targeting.interests?.length) {
    metaTargeting.interests = targeting.interests.map(i => ({ id: i.id, name: i.name }))
  }

  // Behaviors
  if (targeting.behaviors?.length) {
    metaTargeting.behaviors = targeting.behaviors
  }

  // Custom audiences
  if (targeting.custom_audiences?.length) {
    metaTargeting.custom_audiences = targeting.custom_audiences.map(a => ({ id: a.id }))
  }

  // Exclusions
  if (targeting.excluded_custom_audiences?.length) {
    metaTargeting.excluded_custom_audiences = targeting.excluded_custom_audiences.map(a => ({ id: a.id }))
  }

  // Publisher platforms (placements)
  metaTargeting.publisher_platforms = ['facebook', 'instagram', 'audience_network']
  metaTargeting.facebook_positions  = ['feed', 'right_hand_column', 'story', 'reels']
  metaTargeting.instagram_positions = ['stream', 'story', 'reels', 'explore']

  return metaTargeting
}
