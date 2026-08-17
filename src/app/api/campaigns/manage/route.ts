import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import { resolveScopedAccount, resolveBrandScopedAccount } from '@/lib/meta/scope'
import { logError } from '@/lib/admin/logError'

const V = process.env.META_API_VERSION || 'v20.0'

// Turn a raw Graph error into something the founder can act on. Meta's
// "Object with ID '…' does not exist, cannot be loaded due to missing
// permissions" almost always means the write hit the WRONG ad account's
// token (or the account was reconnected and the campaign id is stale) —
// say that plainly instead of dumping the API sentence.
function humanMetaError(raw: string): string {
  const s = String(raw || '')
  if (/does not exist|missing permission|cannot be loaded|unsupported (get|post) request/i.test(s))
    return 'That campaign isn’t on the ad account this card is showing — switch to the right Facebook account (top of the card) and try again, or open Campaigns to do it there.'
  if (/expired|invalid|OAuth|session/i.test(s))
    return 'Meta needs you to reconnect this ad account before changes can be made. Reconnect from the brief, then try again.'
  if (/disabled|banned|deactivat/i.test(s))
    return 'This Meta ad account is disabled, so changes can’t be pushed. Switch to a working account.'
  return 'Could not apply the change on Meta — open Campaigns to do it manually.'
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const accountId = request.nextUrl.searchParams.get('account_id')
    // Scope to the ACTIVE BRAND (Aura → ROY 1) when no explicit account is asked for — otherwise the
    // org primary showed a DIFFERENT brand's old campaigns (2022 Decorly/VirginTeez ads under an Aura
    // workspace). Explicit ?account_id= still wins; falls back to primary only if the brand has none.
    const metaAccount = accountId
      ? await resolveScopedAccount(admin, user.id, accountId)
      : await resolveBrandScopedAccount(admin, user.id)
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)
    const adAccountId = 'act_' + metaAccount.account_id
    const currency = metaAccount.currency || 'PKR'

    const dateRange = request.nextUrl.searchParams.get('dateRange') || 'last_7d'
    const days = parseInt(dateRange.replace('last_', '').replace('d', '')) || 7
    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
    const until = new Date().toISOString().split('T')[0]
    const timeRange = JSON.stringify({ since, until })

    // Fetch campaigns with effective_status filter - only ACTIVE and PAUSED
    const params = new URLSearchParams({
      fields: 'id,name,status,effective_status,objective,daily_budget,adsets{id,name,status,daily_budget,targeting,ads{id,name,status,creative{id,body,title,link_url,object_story_spec,thumbnail_url,effective_object_story_id}}}',
      effective_status: '["ACTIVE","PAUSED"]',
      limit: '50',
      access_token: token,
    })

    const url = `https://graph.facebook.com/${V}/${adAccountId}/campaigns?${params}`
    const res = await fetch(url)
    const campData = await res.json()

    if (campData.error) return NextResponse.json({ error: campData.error.message }, { status: 400 })

    // Fetch campaign + adset level insights in parallel (one call each, not per-campaign)
    const insFields = 'spend,impressions,reach,clicks,ctr,actions,action_values'
    const [ciRes, aiRes] = await Promise.all([
      fetch(`https://graph.facebook.com/${V}/${adAccountId}/insights?` + new URLSearchParams({ fields: `campaign_id,${insFields}`, level: 'campaign', time_range: timeRange, limit: '50', access_token: token })).then(r => r.json()).catch(() => ({})),
      fetch(`https://graph.facebook.com/${V}/${adAccountId}/insights?` + new URLSearchParams({ fields: `adset_id,${insFields}`, level: 'adset', time_range: timeRange, limit: '200', access_token: token })).then(r => r.json()).catch(() => ({})),
    ])

    const px = (raw: any) => {
      const spend = parseFloat(raw?.spend || '0')
      const conv = parseInt(raw?.actions?.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase')?.value || '0')
      // Revenue (purchase conversion value) → ROAS. Already fetched via action_values; just wasn't
      // surfaced. This is the number that tells a founder a campaign is worth scaling.
      const revenue = (raw?.action_values || [])
        .filter((a: any) => /purchase/.test(a.action_type))
        .reduce((s: number, a: any) => s + parseFloat(a.value || '0'), 0)
      return {
        spend,
        conversions: conv,
        cpa: conv > 0 ? spend / conv : 0,
        ctr: parseFloat(raw?.ctr || '0'),
        impressions: parseInt(raw?.impressions || '0'),
        reach: parseInt(raw?.reach || '0'),
        revenue,
        roas: spend > 0 ? revenue / spend : 0,
      }
    }
    const ci: Record<string, any> = {}; for (const i of (ciRes.data || [])) ci[i.campaign_id] = px(i)
    const ai: Record<string, any> = {}; for (const i of (aiRes.data || [])) ai[i.adset_id] = px(i)

    const campaigns = (campData.data || [])
      .filter((camp: any) => camp.effective_status === 'ACTIVE' || camp.effective_status === 'PAUSED' || camp.status === 'ACTIVE' || camp.status === 'PAUSED')
      .map((camp: any) => {
        const adsets = (camp.adsets?.data || []).map((adset: any) => {
          const targeting = adset.targeting || {}
          const ads = (adset.ads?.data || []).map((ad: any) => {
            const creative = ad.creative || {}
            const spec = creative.object_story_spec?.link_data || creative.object_story_spec?.video_data || {}
            const previewUrl = creative.effective_object_story_id
              ? `https://www.facebook.com/${creative.effective_object_story_id}`
              : null
            return {
              id: ad.id,
              name: ad.name,
              status: ad.status,
              creative_id: creative.id,
              primary_text: spec.message || creative.body || '',
              headline: spec.name || creative.title || '',
              link_url: spec.link || creative.link_url || '',
              thumbnail_url: creative.thumbnail_url || null,
              preview_url: previewUrl,
            }
          })
          const adsetIns = ai[adset.id] || { spend: 0, conversions: 0, cpa: 0, ctr: 0, impressions: 0, reach: 0 }
          return {
            id: adset.id,
            name: adset.name,
            status: adset.status,
            age_min: targeting.age_min || 18,
            age_max: targeting.age_max || 65,
            genders: targeting.genders || [],
            ads,
            spend: adsetIns.spend,
            conversions: adsetIns.conversions,
            cpa: adsetIns.cpa,
            ctr: adsetIns.ctr,
            impressions: adsetIns.impressions,
            reach: adsetIns.reach,
            revenue: adsetIns.revenue || 0,
            roas: adsetIns.roas || 0,
          }
        })
        const campIns = ci[camp.id] || { spend: 0, conversions: 0, cpa: 0, ctr: 0, impressions: 0, reach: 0, revenue: 0, roas: 0 }
        return {
          id: camp.id,
          name: camp.name,
          status: camp.status,
          effective_status: camp.effective_status,
          objective: camp.objective,
          daily_budget: camp.daily_budget,
          created_time: camp.created_time,
          adsets,
          spend: campIns.spend,
          conversions: campIns.conversions,
          cpa: campIns.cpa,
          ctr: campIns.ctr,
          impressions: campIns.impressions,
          reach: campIns.reach,
          revenue: campIns.revenue || 0,
          roas: campIns.roas || 0,
        }
      })

    // Sort: ACTIVE first, then by created_time newest first
    campaigns.sort((a: any, b: any) => {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1
      if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1
      // Both same status - sort by created_time newest first
      const dateA = new Date(a.created_time || 0).getTime()
      const dateB = new Date(b.created_time || 0).getTime()
      return dateB - dateA
    })

    return NextResponse.json({ campaigns, currency, dateRange })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let user: any = null
  let body: any = {}
  try {
    const supabase = await createClient()
    ;({ data: { user } } = await supabase.auth.getUser())
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    body = await request.json()
    // Scale/edit MUST run against the SAME account the founder is looking at.
    // The brief card sends account_id (the account in its switcher); using the
    // org primary instead was pushing ROY-1 campaign ids through another
    // account's token → Meta "Object … does not exist / missing permissions".
    // Fall back to primary only when no account_id is given (legacy callers).
    const bodyAccountId = body.account_id ? String(body.account_id).replace(/^act_/, '') : null
    const metaAccount = await resolveScopedAccount(admin, user.id, bodyAccountId)
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)

    const post = async (path: string, data: Record<string, unknown>) => {
      const url = `https://graph.facebook.com/${V}/${path}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, access_token: token })
      })
      const json = await res.json()
      if (json.error) throw new Error(json.error.message)
      return json
    }

    if (body.action === 'toggle_status') {
      await post(body.id, { status: body.status })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'update_budget') {
      await post(body.id, { daily_budget: Math.round(body.budget * 100) })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'update_adset') {
      const targeting: Record<string, unknown> = {}
      if (body.age_min) targeting.age_min = body.age_min
      if (body.age_max) targeting.age_max = body.age_max
      if (body.genders && body.genders.length > 0) targeting.genders = body.genders
      await post(body.id, { targeting })
      return NextResponse.json({ success: true })
    }

    if (body.action === 'update_ad') {
      console.log('UPDATE_AD body:', JSON.stringify({id:body.id, creative_id:body.creative_id, new_creative_hash:body.new_creative_hash, has_text:!!body.primary_text}))
      const adAccountId = 'act_' + metaAccount.account_id

      // If a new creative was pre-uploaded, use the hash directly
      if (body.new_creative_hash) {
        const creativePayload: any = { name: 'Updated Creative — ' + new Date().toISOString() }
        if (body.new_creative_is_video) {
          // Get page_id from existing creative
          const existRes = await fetch(`https://graph.facebook.com/${V}/${body.creative_id}?fields=object_story_spec&access_token=${token}`)
          const existData = await existRes.json()
          const pageId = existData.object_story_spec?.page_id || existData.object_story_spec?.link_data?.page_id
          creativePayload.object_story_spec = {
            page_id: pageId,
            video_data: { video_id: body.new_creative_hash, message: body.primary_text || '' }
          }
        } else {
          const existRes = await fetch(`https://graph.facebook.com/${V}/${body.creative_id}?fields=object_story_spec&access_token=${token}`)
          const existData = await existRes.json()
          if (existData.error) return NextResponse.json({ error: 'Failed to fetch creative: ' + existData.error.message }, { status: 400 })
          const spec = existData.object_story_spec || {}
          const ld = spec.link_data || {}
          // Only pass writable fields — spreading the full spec includes read-only fields Meta rejects on create
          creativePayload.object_story_spec = {
            page_id: spec.page_id,
            link_data: {
              image_hash: body.new_creative_hash,
              link: ld.link || '',
              message: ld.message || body.primary_text || '',
              name: ld.name || body.headline || '',
              ...(ld.call_to_action && { call_to_action: ld.call_to_action }),
            },
          }
        }
        const newCreative = await post(adAccountId + '/adcreatives', creativePayload)
        console.log('New creative id:', newCreative.id, 'assigning to ad:', body.id)
        const adUpdateResult = await post(body.id, { creative: { creative_id: newCreative.id } })
        console.log('Ad update result:', JSON.stringify(adUpdateResult))
        return NextResponse.json({ success: true, newCreativeId: newCreative.id })
      }

      // Otherwise update text/url only
      const creativeRes = await fetch(
        `https://graph.facebook.com/${V}/${body.creative_id}?fields=object_story_spec&access_token=${token}`
      )
      const creativeData = await creativeRes.json()
      const spec = creativeData.object_story_spec || {}
      const updatedSpec = { ...spec }
      if (spec.link_data) {
        updatedSpec.link_data = {
          ...spec.link_data,
          ...(body.primary_text && { message: body.primary_text }),
          ...(body.headline && { name: body.headline }),
          ...(body.link_url && { link: body.link_url }),
        }
      } else if (spec.video_data) {
        updatedSpec.video_data = {
          ...spec.video_data,
          ...(body.primary_text && { message: body.primary_text }),
          ...(body.headline && { title: body.headline }),
        }
      }
      const newCreative = await post(adAccountId + '/adcreatives', {
        name: 'Updated Creative',
        object_story_spec: updatedSpec,
      })
      await post(body.id, { creative: { creative_id: newCreative.id } })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err: any) {
    const raw = String(err?.message || err)
    // This was the silent one — a failed Scale/edit threw the raw Graph text to
    // the founder but never landed in the admin error log. Record it (plain
    // kind so /admin/errors buckets it) so we can see write failures.
    await logError({
      user_id: user?.id || null,
      user_email: user?.email || null,
      error_message: `Meta campaign ${body?.action || 'action'} failed: ${raw}`,
      error_stack: err?.stack || null,
      page_url: '/api/campaigns/manage',
      extra: { kind: 'meta_write_failed', action: body?.action || null, target_id: body?.id || null, account_id: body?.account_id || null },
    })
    return NextResponse.json({ error: humanMetaError(raw), raw }, { status: 500 })
  }
}
