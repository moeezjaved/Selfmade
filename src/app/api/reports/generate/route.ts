/**
 * GET /api/reports/generate?template=<key>&dateRange=last_14d&groupBy=<dim>&sort=<metric>&dir=desc
 * The reporting-suite engine. Pulls ad-level insights from the connected Meta account with the FULL
 * field set (spend/impr/reach/frequency/clicks/ctr/cpc/cpm + every action type + video retention),
 * joins creative previews (thumbnail + format + landing page + launch date), groups by the requested
 * dimension, aggregates, sorts, and returns rows + a Net Results total. All computed live (no cache).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { decryptToken } from '@/lib/meta/client'
import { TEMPLATE_BY_KEY, GROUP_BY, METRICS, type GroupByKey, type MetricKey, type ReportTemplate } from '@/lib/reports/templates'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'

function timeRange(dateRange: string): { since: string; until: string } {
  const days = { last_3d: 3, last_7d: 7, last_14d: 14, last_30d: 30, last_60d: 60, last_90d: 90 }[dateRange] || 14
  const until = new Date(); const since = new Date(Date.now() - days * 86400000)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { since: iso(since), until: iso(until) }
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
// Sum a Meta actions/action_values array for a given action_type.
function actionVal(arr: any[], type: string): number {
  return (arr || []).filter((a: any) => a.action_type === type).reduce((s: number, a: any) => s + num(a.value), 0)
}
function firstActionVal(arr: any[], types: string[]): number {
  for (const t of types) { const v = actionVal(arr, t); if (v) return v }
  return 0
}

type Row = {
  key: string; name: string; thumbnail: string | null; format: 'video' | 'image' | 'carousel' | 'other'
  landingPage: string | null; launchDate: string | null; adCount: number
  // raw sums
  spend: number; impressions: number; reach: number; clicks: number
  conversions: number; revenue: number
  add_to_cart: number; initiate_checkout: number; view_content: number; landing_page_view: number; link_click: number; post_engagement: number
  thruplay: number; video_3s: number; video_p25: number; video_p50: number; video_p75: number; video_p100: number; watch_time_weighted: number
}

const emptyRow = (): Omit<Row, 'key' | 'name' | 'thumbnail' | 'format' | 'landingPage' | 'launchDate' | 'adCount'> => ({
  spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, revenue: 0,
  add_to_cart: 0, initiate_checkout: 0, view_content: 0, landing_page_view: 0, link_click: 0, post_engagement: 0,
  thruplay: 0, video_3s: 0, video_p25: 0, video_p50: 0, video_p75: 0, video_p100: 0, watch_time_weighted: 0,
})

// Derived metric values from a row's raw sums.
function metricValue(r: Row, m: MetricKey): number {
  switch (m) {
    case 'ctr': return r.impressions ? (r.clicks / r.impressions) * 100 : 0
    case 'cpc': return r.clicks ? r.spend / r.clicks : 0
    case 'cpm': return r.impressions ? (r.spend / r.impressions) * 1000 : 0
    case 'roas': return r.spend ? r.revenue / r.spend : 0
    case 'cpa': return r.conversions ? r.spend / r.conversions : 0
    case 'frequency': return r.reach ? r.impressions / r.reach : 0
    case 'hook_rate': return r.impressions ? (r.video_3s / r.impressions) * 100 : 0
    case 'hold_rate': return r.impressions ? (r.thruplay / r.impressions) * 100 : 0
    case 'avg_watch_time': return r.thruplay ? r.watch_time_weighted / r.thruplay : 0
    default: return num((r as any)[m])
  }
}

// Infer format from whatever the creative exposes — object_story_spec is often null for ads that
// reference an existing page post, so fall back to top-level creative fields (video_id / image).
function inferFormat(creative: any): 'video' | 'image' | 'carousel' | 'other' {
  const spec = creative?.object_story_spec
  if (spec?.video_data) return 'video'
  if (spec?.link_data?.child_attachments?.length > 1) return 'carousel'
  if (spec?.link_data) return 'image'
  if (creative?.video_id) return 'video'
  if (creative?.asset_feed_spec?.videos?.length) return 'video'
  if (creative?.asset_feed_spec?.images?.length > 1) return 'carousel'
  if (creative?.image_url || creative?.image_hash || creative?.asset_feed_spec?.images?.length) return 'image'
  return 'other'
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const sp = req.nextUrl.searchParams
  const tpl: ReportTemplate | undefined = TEMPLATE_BY_KEY[sp.get('template') || 'top_performers']
  if (!tpl) return NextResponse.json({ error: 'Unknown report template' }, { status: 400 })
  const dateRange = sp.get('dateRange') || 'last_14d'
  const groupBy = (sp.get('groupBy') as GroupByKey) || tpl.groupBy
  // Columns: client can override the template's metric list (add/remove). Falls back to the template's.
  const reqMetrics = (sp.get('metrics') || '').split(',').map(s => s.trim()).filter(Boolean) as MetricKey[]
  const cols = (reqMetrics.length ? reqMetrics : tpl.metrics).filter(m => !!METRICS[m])
  const sort = (sp.get('sort') as MetricKey) || tpl.sort
  const dir = (sp.get('dir') as 'asc' | 'desc') || tpl.sortDir

  let metaAccount: any
  try { metaAccount = await resolveScopedAccount(admin, user.id) } catch { metaAccount = null }
  if (!metaAccount?.account_id) return NextResponse.json({ error: 'no_account', rows: [], template: tpl }, { status: 200 })
  const token = decryptToken(metaAccount.access_token)
  const currency = metaAccount.currency || 'USD'
  const act = `act_${metaAccount.account_id}`
  const { since, until } = timeRange(dateRange)
  const tr = encodeURIComponent(JSON.stringify({ since, until }))

  try {
    // 1) Ad-level insights — the full metric field set.
    const insFields = [
      'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
      'spend', 'impressions', 'reach', 'frequency', 'clicks', 'ctr', 'cpc', 'cpm',
      'actions', 'action_values',
      'video_thruplay_watched_actions', 'video_p25_watched_actions', 'video_p50_watched_actions',
      'video_p75_watched_actions', 'video_p100_watched_actions', 'video_play_actions', 'video_avg_time_watched_actions',
    ].join(',')
    const insRes = await fetch(`https://graph.facebook.com/${V}/${act}/insights?level=ad&fields=${insFields}&time_range=${tr}&limit=500&access_token=${token}`)
    const insJson = await insRes.json()
    if (insJson.error) throw new Error(insJson.error.message)
    const insights: any[] = insJson.data || []

    // 2) Ad objects — creative preview, format, landing page, launch date. Matched by ad id.
    const adRes = await fetch(`https://graph.facebook.com/${V}/${act}/ads?fields=id,name,created_time,creative{thumbnail_url,object_story_spec,video_id,image_url,image_hash,asset_feed_spec}&limit=500&effective_status=["ACTIVE","PAUSED","ARCHIVED","IN_PROCESS","WITH_ISSUES"]&access_token=${token}`)
    const adJson = await adRes.json().catch(() => ({}))
    const adMeta = new Map<string, any>()
    for (const a of (adJson.data || [])) {
      const spec = a.creative?.object_story_spec
      adMeta.set(a.id, {
        thumbnail: a.creative?.thumbnail_url || null,
        format: inferFormat(a.creative),
        landingPage: spec?.link_data?.link || spec?.video_data?.call_to_action?.value?.link || a.creative?.asset_feed_spec?.link_urls?.[0]?.website_url || null,
        launchDate: a.created_time ? String(a.created_time).slice(0, 10) : null,
      })
    }

    // 3) Build + group rows.
    const groups = new Map<string, Row>()
    const keyOf = (ins: any, meta: any): { key: string; name: string } => {
      switch (groupBy) {
        case 'ad': return { key: ins.ad_id, name: ins.ad_name || ins.ad_id }
        case 'adset': return { key: ins.adset_id, name: ins.adset_name || ins.adset_id }
        case 'campaign': return { key: ins.campaign_id, name: ins.campaign_name || ins.campaign_id }
        case 'landing_page': return { key: meta?.landingPage || '—', name: meta?.landingPage || 'No landing page' }
        case 'format': return { key: meta?.format || 'other', name: (meta?.format || 'other').replace(/^\w/, (c: string) => c.toUpperCase()) }
        case 'launch_date': return { key: meta?.launchDate || '—', name: meta?.launchDate || 'Unknown' }
        case 'creative': default: return { key: (meta?.thumbnail || ins.ad_id), name: ins.ad_name || ins.ad_id }
      }
    }

    for (const ins of insights) {
      const meta = adMeta.get(ins.ad_id) || {}
      // Format filter (video-only / image-only templates).
      if (tpl.onlyFormat === 'video' && meta.format !== 'video') continue
      if (tpl.onlyFormat === 'image' && !(meta.format === 'image' || meta.format === 'carousel')) continue
      const { key, name } = keyOf(ins, meta)
      let row = groups.get(key)
      if (!row) {
        row = { key, name, thumbnail: meta.thumbnail || null, format: meta.format || 'other', landingPage: meta.landingPage || null, launchDate: meta.launchDate || null, adCount: 0, ...emptyRow() }
        groups.set(key, row)
      }
      row.adCount++
      const actions = ins.actions || [], values = ins.action_values || []
      row.spend += num(ins.spend); row.impressions += num(ins.impressions); row.reach += num(ins.reach); row.clicks += num(ins.clicks)
      row.conversions += firstActionVal(actions, ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'])
      row.revenue += firstActionVal(values, ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'])
      row.add_to_cart += firstActionVal(actions, ['offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart', 'omni_add_to_cart'])
      row.initiate_checkout += firstActionVal(actions, ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout', 'omni_initiated_checkout'])
      row.view_content += firstActionVal(actions, ['offsite_conversion.fb_pixel_view_content', 'view_content', 'omni_view_content'])
      row.landing_page_view += actionVal(actions, 'landing_page_view')
      row.link_click += actionVal(actions, 'link_click')
      row.post_engagement += actionVal(actions, 'post_engagement')
      row.video_3s += actionVal(ins.video_play_actions || [], 'video_view')
      row.thruplay += actionVal(ins.video_thruplay_watched_actions || [], 'video_view')
      row.video_p25 += actionVal(ins.video_p25_watched_actions || [], 'video_view')
      row.video_p50 += actionVal(ins.video_p50_watched_actions || [], 'video_view')
      row.video_p75 += actionVal(ins.video_p75_watched_actions || [], 'video_view')
      row.video_p100 += actionVal(ins.video_p100_watched_actions || [], 'video_view')
      const avgWatch = actionVal(ins.video_avg_time_watched_actions || [], 'video_view')
      row.watch_time_weighted += avgWatch * actionVal(ins.video_thruplay_watched_actions || [], 'video_view')
    }

    // 4) Shape + sort. "Scalers" = above-median ROAS but below-median spend (ready to scale).
    let rows = Array.from(groups.values())
    if (tpl.key === 'scalers' && rows.length > 3) {
      const spends = rows.map(r => r.spend).sort((a, b) => a - b)
      const medSpend = spends[Math.floor(spends.length / 2)]
      rows = rows.filter(r => metricValue(r, 'roas') >= 1 && r.spend <= medSpend && r.conversions > 0)
    }
    const shaped = rows.map(r => {
      const m: Record<string, number> = {}
      for (const k of cols) m[k] = metricValue(r, k)
      m[sort] = metricValue(r, sort)
      return {
        key: r.key, name: r.name, thumbnail: r.thumbnail, format: r.format,
        landingPage: r.landingPage, launchDate: r.launchDate, adCount: r.adCount, metrics: m,
      }
    }).filter(r => r.metrics.spend > 0)
    shaped.sort((a, b) => dir === 'desc' ? (b.metrics[sort] || 0) - (a.metrics[sort] || 0) : (a.metrics[sort] || 0) - (b.metrics[sort] || 0))

    // 5) Net Results — column totals (sums for volume metrics, averages for rate metrics).
    const net: Record<string, number> = {}
    for (const k of cols) {
      const f = METRICS[k].format
      if (f === 'percent' || f === 'ratio' || f === 'seconds' || k === 'cpm' || k === 'cpc' || k === 'cpa') {
        const vals = shaped.map(r => r.metrics[k]).filter(v => v > 0)
        net[k] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
      } else {
        net[k] = shaped.reduce((s, r) => s + (r.metrics[k] || 0), 0)
      }
    }

    return NextResponse.json({
      template: { key: tpl.key, title: tpl.title, emoji: tpl.emoji, description: tpl.description },
      groupBy, groupByOptions: GROUP_BY, sort, dir, dateRange, currency,
      metrics: tpl.metrics, rows: shaped, netResults: net, count: shaped.length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to build report', rows: [] }, { status: 200 })
  }
}
