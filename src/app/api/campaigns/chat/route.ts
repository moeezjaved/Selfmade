import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import Anthropic from '@anthropic-ai/sdk'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const V = process.env.META_API_VERSION || 'v20.0'
const claude = new Anthropic()

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: ma } = await admin
    .from('meta_accounts').select('*')
    .eq('user_id', user.id).eq('is_primary', true).single()
  if (!ma) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

  const token = decryptToken(ma.access_token)
  const adAccountId = 'act_' + ma.account_id
  const currency = ma.currency || 'USD'

  const body = await request.json()
  const { campaign, message, history = [], uploaded_creative_hash, uploaded_is_video } = body

  const adsetList = (campaign.adsets || [])
    .map((a: any) => `  • "${a.name}" [${a.id}] (${a.status}) — ${a.ads?.length || 0} ads`)
    .join('\n')

  const systemPrompt = `You are a Meta Ads AI assistant. Parse the user's intent and return a structured action.

Campaign context:
- Name: "${campaign.name}"
- ID: ${campaign.id}
- Status: ${campaign.status}
- Objective: ${campaign.objective?.replace('OUTCOME_', '') || 'unknown'}
- Daily Budget: ${Math.round((campaign.daily_budget || 0) / 100)} ${currency}
- Ad Sets:
${adsetList || '  (none yet)'}
- Currency: ${currency}
${uploaded_creative_hash ? `\nUser has uploaded a new ${uploaded_is_video ? 'video' : 'image'} creative (hash/id: ${uploaded_creative_hash}).` : ''}

Supported actions:
1. "update_budget" — user wants to change campaign daily budget
2. "add_adset" — user wants to add a new ad set (requires uploaded creative)
3. "toggle_status" — user wants to pause or activate something
4. "none" — user is asking a question or you need clarification

Rules:
- For update_budget: extract the number from the message. Budget is in ${currency} (not cents).
- For add_adset: only valid if a creative was uploaded. Extract adset_name, primary_text, headline if mentioned.
- For toggle_status: identify which entity (campaign/adset/ad) and whether to ACTIVE or PAUSED. Use the IDs from context.
- If budget change is ambiguous (e.g. "increase by 20%"), compute the new value.
- Keep "reply" short, friendly, action-confirming. No markdown.

Respond ONLY with valid JSON (no markdown fences):
{
  "action": "update_budget" | "add_adset" | "toggle_status" | "none",
  "reply": "Short confirmation or question",
  "params": {
    "budget": 5000,
    "adset_name": "Retargeting — New Creative",
    "primary_text": "...",
    "headline": "...",
    "entity_type": "campaign" | "adset" | "ad",
    "entity_id": "...",
    "new_status": "ACTIVE" | "PAUSED"
  }
}`

  const msgs = [
    ...history.map((h: any) => ({ role: h.role as 'user' | 'assistant', content: h.content })),
    { role: 'user' as const, content: message },
  ]

  let parsed: any = { action: 'none', reply: 'Sorry, I had trouble understanding that. Could you rephrase?', params: {} }
  try {
    const res = await claude.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: msgs,
    })
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    const s = text.indexOf('{')
    const e = text.lastIndexOf('}')
    if (s !== -1 && e !== -1) parsed = JSON.parse(text.slice(s, e + 1))
  } catch {}

  const post = async (path: string, data: Record<string, unknown>) => {
    const url = `https://graph.facebook.com/${V}/${path}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, access_token: token }),
    })
    const json = await res.json()
    if (json.error) {
      const e = json.error
      const detail = e.error_user_msg || e.error_user_title || e.message
      console.error(`Meta API error [${path}]:`, JSON.stringify(e))
      throw new Error(detail + (e.error_subcode ? ` (${e.error_subcode})` : ''))
    }
    return json
  }

  try {
    // ── Budget update ───────────────────────────────────────────
    if (parsed.action === 'update_budget' && parsed.params?.budget) {
      const budgetCents = Math.round(Number(parsed.params.budget) * 100)
      await post(campaign.id, { daily_budget: budgetCents })
      return NextResponse.json({ reply: parsed.reply, action_taken: 'update_budget', reload: true })
    }

    // ── Add new ad set with creative ────────────────────────────
    if (parsed.action === 'add_adset' && uploaded_creative_hash) {
      // Get page_id from existing creative or from connected page
      let pageId = ''
      let existingSpec: any = {}

      const firstAd = campaign.adsets?.[0]?.ads?.[0]
      if (firstAd?.creative_id) {
        const cr = await fetch(`https://graph.facebook.com/${V}/${firstAd.creative_id}?fields=object_story_spec&access_token=${token}`)
        const crData = await cr.json()
        existingSpec = crData.object_story_spec || {}
        pageId = existingSpec.page_id || ''
      }

      if (!pageId) {
        const pageRes = await fetch(`https://graph.facebook.com/${V}/me/accounts?fields=id&access_token=${token}&limit=1`)
        const pageData = await pageRes.json()
        pageId = pageData.data?.[0]?.id || ''
      }

      if (!pageId) {
        return NextResponse.json({ reply: "I couldn't find a connected Facebook Page. Please verify your Meta account is linked to a Page.", action_taken: 'none' })
      }

      // Build creative payload — copy as much from existing spec as possible
      const ld = existingSpec.link_data || {}
      const vd = existingSpec.video_data || {}
      const primaryText = parsed.params?.primary_text || ld.message || vd.message || ''
      const headline    = parsed.params?.headline    || ld.name || ''
      const destLink    = ld.link || vd.link || ''
      // Prefer existing CTA; fall back to a sensible default for sales campaigns
      const existingCTA = ld.call_to_action || vd.call_to_action
      const defaultCTA  = destLink ? { type: 'SHOP_NOW', value: { link: destLink } } : undefined
      const callToAction = existingCTA || defaultCTA

      const creativePayload: any = {
        name: (parsed.params?.adset_name || 'New Creative') + ' — ' + new Date().toISOString().slice(0, 10),
        object_story_spec: uploaded_is_video
          ? {
              page_id: pageId,
              video_data: {
                video_id: uploaded_creative_hash,
                message: primaryText,
                ...(destLink && { link: destLink }),
                ...(callToAction && { call_to_action: callToAction }),
              },
            }
          : {
              page_id: pageId,
              link_data: {
                image_hash: uploaded_creative_hash,
                link: destLink,
                message: primaryText,
                name: headline,
                ...(callToAction && { call_to_action: callToAction }),
              },
            },
      }
      console.log('Creating creative:', JSON.stringify(creativePayload))
      const newCreative = await post(adAccountId + '/adcreatives', creativePayload)

      // Copy targeting from first existing adset
      const srcAdset = campaign.adsets?.[0]
      const targeting: any = {
        age_min: srcAdset?.age_min || 18,
        age_max: srcAdset?.age_max || 65,
      }
      if (srcAdset?.genders?.length) targeting.genders = srcAdset.genders

      // Map campaign objective → optimization settings + destination_type
      const obj = campaign.objective || ''
      let optimization_goal = 'OFFSITE_CONVERSIONS'
      let billing_event     = 'IMPRESSIONS'
      let destination_type  = 'WEBSITE'
      if (obj.includes('TRAFFIC'))    { optimization_goal = 'LINK_CLICKS';     billing_event = 'IMPRESSIONS'; destination_type = 'WEBSITE' }
      if (obj.includes('AWARENESS'))  { optimization_goal = 'REACH';           billing_event = 'IMPRESSIONS'; destination_type = 'WEBSITE' }
      if (obj.includes('ENGAGEMENT')) { optimization_goal = 'POST_ENGAGEMENT'; billing_event = 'IMPRESSIONS'; destination_type = 'FACEBOOK' }
      if (obj.includes('LEAD'))       { optimization_goal = 'LEAD_GENERATION'; billing_event = 'IMPRESSIONS'; destination_type = 'ON_AD' }

      const adsetName = parsed.params?.adset_name || 'New Creative Ad Set — ' + new Date().toLocaleDateString()
      console.log('Creating adset:', JSON.stringify({ campaign_id: campaign.id, name: adsetName, optimization_goal, billing_event, destination_type }))
      const newAdset = await post(adAccountId + '/adsets', {
        campaign_id: campaign.id,
        name: adsetName,
        targeting,
        daily_budget: campaign.daily_budget || 100000,
        billing_event,
        optimization_goal,
        destination_type,
        bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        status: 'PAUSED',
      })

      await post(adAccountId + '/ads', {
        adset_id: newAdset.id,
        name: adsetName + ' — Ad 1',
        creative: { creative_id: newCreative.id },
        status: 'PAUSED',
      })

      return NextResponse.json({
        reply: parsed.reply + ' Created as Paused — activate it when you\'re ready to run.',
        action_taken: 'add_adset',
        reload: true,
      })
    }

    // ── Toggle status ───────────────────────────────────────────
    if (parsed.action === 'toggle_status' && parsed.params?.entity_id && parsed.params?.new_status) {
      await post(parsed.params.entity_id, { status: parsed.params.new_status })
      return NextResponse.json({ reply: parsed.reply, action_taken: 'toggle_status', reload: true })
    }

    // ── add_adset requested but no creative uploaded ────────────
    if (parsed.action === 'add_adset' && !uploaded_creative_hash) {
      return NextResponse.json({
        reply: "To add a new ad set I need a creative — use the 📎 button to upload an image or video first, then send your message again.",
        action_taken: 'none',
      })
    }

    return NextResponse.json({ reply: parsed.reply, action_taken: 'none' })
  } catch (err: any) {
    console.error('Chat action error:', err.message)
    return NextResponse.json({ reply: `❌ Meta API error: ${err.message}`, action_taken: 'error' })
  }
}
