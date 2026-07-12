/**
 * GET /api/reports/ad/[adId]?dateRange=last_14d — everything the ad-detail drawer needs for one ad:
 * creative (video/image + copy + CTA + landing), overview (spend/roas/launch/status), full metrics,
 * and Meta breakdowns — age×gender, placement, and a video-retention curve.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const V = process.env.META_API_VERSION || 'v20.0'

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const av = (arr: any[], type: string) => (arr || []).filter((a: any) => a.action_type === type).reduce((s: number, a: any) => s + num(a.value), 0)
const firstAv = (arr: any[], types: string[]) => { for (const t of types) { const v = av(arr, t); if (v) return v } return 0 }
const PURCHASE = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase']

function timeRange(dr: string) {
  const days = { last_3d: 3, last_7d: 7, last_14d: 14, last_30d: 30, last_60d: 60, last_90d: 90 }[dr] || 14
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return encodeURIComponent(JSON.stringify({ since: iso(new Date(Date.now() - days * 86400000)), until: iso(new Date()) }))
}

export async function GET(req: NextRequest, { params }: { params: { adId: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  let acct: any
  try { acct = await resolveScopedAccount(admin, user.id) } catch { acct = null }
  if (!acct?.account_id) return NextResponse.json({ error: 'no_account' }, { status: 200 })
  const token = decryptToken(acct.access_token)
  const currency = acct.currency || 'USD'
  const ad = params.adId
  const tr = timeRange(req.nextUrl.searchParams.get('dateRange') || 'last_14d')
  const metricFields = 'spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,action_values,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_play_actions,video_avg_time_watched_actions'
  const g = (path: string) => fetch(`https://graph.facebook.com/${V}/${path}${path.includes('?') ? '&' : '?'}access_token=${token}`).then(r => r.json()).catch(() => ({}))

  try {
    const [adObj, insRes, ageRes, plcRes] = await Promise.all([
      g(`${ad}?fields=name,created_time,effective_status,creative{thumbnail_url,image_url,object_story_spec,video_id,body,title}`),
      g(`${ad}/insights?fields=${metricFields}&time_range=${tr}`),
      g(`${ad}/insights?breakdowns=age,gender&fields=impressions,spend,actions,action_values&time_range=${tr}`),
      g(`${ad}/insights?breakdowns=publisher_platform,platform_position&fields=impressions,spend&time_range=${tr}`),
    ])
    const ins = insRes?.data?.[0] || {}
    const cr = adObj?.creative || {}
    const spec = cr.object_story_spec || {}

    // Creative video source (playable) — needs the video_id.
    let videoUrl: string | null = null, videoLen = 0
    const vid = cr.video_id || spec.video_data?.video_id
    if (vid) { const v = await g(`${vid}?fields=source,length,picture`); videoUrl = v?.source || null; videoLen = num(v?.length) }

    const thumbnail = cr.thumbnail_url || cr.image_url || spec.video_data?.image_url || spec.link_data?.picture || null
    const body = spec.link_data?.message || spec.video_data?.message || cr.body || null
    const cta = spec.link_data?.call_to_action?.type || spec.video_data?.call_to_action?.type || null
    const landing = spec.link_data?.link || spec.video_data?.call_to_action?.value?.link || null

    // Overview + full metrics.
    const actions = ins.actions || [], values = ins.action_values || []
    const spend = num(ins.spend), impressions = num(ins.impressions), clicks = num(ins.clicks)
    const purchases = firstAv(actions, PURCHASE), revenue = firstAv(values, PURCHASE)
    const metrics = {
      spend, impressions, reach: num(ins.reach), clicks, frequency: num(ins.frequency),
      ctr: num(ins.ctr), cpc: num(ins.cpc), cpm: num(ins.cpm),
      conversions: purchases, revenue, roas: spend ? revenue / spend : 0, cpa: purchases ? spend / purchases : 0,
      aov: purchases ? revenue / purchases : 0,
      add_to_cart: firstAv(actions, ['offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart']),
      initiate_checkout: firstAv(actions, ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout']),
      link_click: av(actions, 'link_click'),
    }

    // Age × gender.
    const ageBuckets = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+']
    const ageMap: Record<string, { age: string; male: number; female: number; unknown: number; spend: number; purchases: number }> = {}
    for (const b of ageBuckets) ageMap[b] = { age: b, male: 0, female: 0, unknown: 0, spend: 0, purchases: 0 }
    for (const r of (ageRes?.data || [])) {
      const b = ageMap[r.age]; if (!b) continue
      const imp = num(r.impressions)
      if (r.gender === 'male') b.male += imp; else if (r.gender === 'female') b.female += imp; else b.unknown += imp
      b.spend += num(r.spend); b.purchases += firstAv(r.actions, PURCHASE)
    }
    const ageGender = ageBuckets.map(b => ageMap[b])

    // Placement.
    const PLAT: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', audience_network: 'Audience Network', messenger: 'Messenger' }
    const placement = (plcRes?.data || []).map((r: any) => ({
      platform: PLAT[r.publisher_platform] || r.publisher_platform || '—',
      position: (r.platform_position || '').replace(/_/g, ' '),
      impressions: num(r.impressions), spend: num(r.spend),
    })).sort((a: any, b: any) => b.impressions - a.impressions).slice(0, 8)

    // Video retention curve — % of impressions still watching at each checkpoint.
    const p3 = av(ins.video_play_actions || [], 'video_view')
    const p25 = av(ins.video_p25_watched_actions || [], 'video_view')
    const p50 = av(ins.video_p50_watched_actions || [], 'video_view')
    const p75 = av(ins.video_p75_watched_actions || [], 'video_view')
    const p100 = av(ins.video_p100_watched_actions || [], 'video_view')
    const base = impressions || 1
    const retention = (p3 || p25) ? [
      { pct: 0, seconds: 0, retention: 100 },
      { pct: 6, seconds: videoLen ? +(videoLen * 0.06).toFixed(1) : 0, retention: +(100 * p3 / base).toFixed(2) },
      { pct: 25, seconds: videoLen ? +(videoLen * 0.25).toFixed(1) : 0, retention: +(100 * p25 / base).toFixed(2) },
      { pct: 50, seconds: videoLen ? +(videoLen * 0.5).toFixed(1) : 0, retention: +(100 * p50 / base).toFixed(2) },
      { pct: 75, seconds: videoLen ? +(videoLen * 0.75).toFixed(1) : 0, retention: +(100 * p75 / base).toFixed(2) },
      { pct: 100, seconds: videoLen || 0, retention: +(100 * p100 / base).toFixed(2) },
    ] : []

    const est = adObj.effective_status || ''
    const status = /ARCHIV/.test(est) ? 'archived' : /ACTIVE/.test(est) ? 'active' : 'paused'

    return NextResponse.json({
      currency,
      creative: { name: adObj.name || ad, videoUrl, thumbnail, image: cr.image_url || null, body, headline: cr.title || spec.link_data?.name || null, cta, landing, pageName: spec.page_id ? undefined : undefined, format: vid ? 'video' : 'image' },
      overview: { spend, roas: metrics.roas, launchDate: adObj.created_time ? String(adObj.created_time).slice(0, 10) : null, status, launchedRecently: adObj.created_time ? (Date.now() - +new Date(adObj.created_time)) < 14 * 86400000 : false },
      metrics, ageGender, placement, retention, hasVideo: !!vid,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load ad' }, { status: 200 })
  }
}
