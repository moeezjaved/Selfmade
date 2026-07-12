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
import { TEMPLATE_BY_KEY, GROUP_BY, METRICS, type GroupByKey, type MetricKey, type ReportTemplate, type ReportFilter, type FilterOp } from '@/lib/reports/templates'
import { ensureTags, loadTagCache, isTagDimension, type TagInput, type CreativeTags } from '@/lib/reports/tagging'

export const dynamic = 'force-dynamic'
export const maxDuration = 60   // first-time AI tagging (vision over top ads) can take ~10-15s
const V = process.env.META_API_VERSION || 'v20.0'

function timeRange(dateRange: string): { since: string; until: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const now = new Date()
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  // Custom range: "custom:2026-01-01:2026-01-31"
  if (dateRange.startsWith('custom:')) { const [, s, u] = dateRange.split(':'); if (s && u) return { since: s, until: u } }
  const days = { last_3d: 3, last_7d: 7, last_14d: 14, last_30d: 30, last_60d: 60, last_90d: 90, last_365d: 365 }[dateRange]
  if (days) return { since: iso(new Date(Date.now() - days * 86400000)), until: iso(now) }
  // Calendar presets.
  if (dateRange === 'today') return { since: iso(now), until: iso(now) }
  if (dateRange === 'yesterday') { const y = new Date(Date.now() - 86400000); return { since: iso(y), until: iso(y) } }
  if (dateRange === 'this_week') { const d = startOfDay(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { since: iso(d), until: iso(now) } }
  if (dateRange === 'last_week') { const end = startOfDay(now); end.setDate(end.getDate() - ((end.getDay() + 6) % 7) - 1); const start = new Date(end); start.setDate(start.getDate() - 6); return { since: iso(start), until: iso(end) } }
  if (dateRange === 'this_month') return { since: iso(new Date(now.getFullYear(), now.getMonth(), 1)), until: iso(now) }
  if (dateRange === 'last_month') return { since: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), until: iso(new Date(now.getFullYear(), now.getMonth(), 0)) }
  return { since: iso(new Date(Date.now() - 14 * 86400000)), until: iso(now) }
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
  landingPage: string | null; launchDate: string | null; status: string; adCount: number; adId: string
  // raw sums
  spend: number; impressions: number; reach: number; clicks: number
  conversions: number; revenue: number
  add_to_cart: number; initiate_checkout: number; view_content: number; landing_page_view: number; link_click: number; post_engagement: number
  thruplay: number; video_3s: number; video_p25: number; video_p50: number; video_p75: number; video_p100: number; watch_time_weighted: number
  outbound_clicks: number; comments: number; reactions: number; shares: number; post_saves: number
  leads: number; registrations: number; app_installs: number; messaging_started: number
  add_payment_info: number; search: number; add_to_wishlist: number; likes: number
}

const emptyRow = (): Omit<Row, 'key' | 'name' | 'thumbnail' | 'format' | 'landingPage' | 'launchDate' | 'status' | 'adCount' | 'adId'> => ({
  spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, revenue: 0,
  add_to_cart: 0, initiate_checkout: 0, view_content: 0, landing_page_view: 0, link_click: 0, post_engagement: 0,
  thruplay: 0, video_3s: 0, video_p25: 0, video_p50: 0, video_p75: 0, video_p100: 0, watch_time_weighted: 0,
  outbound_clicks: 0, comments: 0, reactions: 0, shares: 0, post_saves: 0,
  leads: 0, registrations: 0, app_installs: 0, messaging_started: 0,
  add_payment_info: 0, search: 0, add_to_wishlist: 0, likes: 0,
})

const PURCHASE = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase']
// Accumulate one insight row's metrics into a Row (shared by the current + previous-period passes).
function accInsight(row: Row, ins: any) {
  row.adCount++
  const actions = ins.actions || [], values = ins.action_values || []
  row.spend += num(ins.spend); row.impressions += num(ins.impressions); row.reach += num(ins.reach); row.clicks += num(ins.clicks)
  row.conversions += firstActionVal(actions, PURCHASE)
  row.revenue += firstActionVal(values, PURCHASE)
  row.add_to_cart += firstActionVal(actions, ['offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart', 'omni_add_to_cart'])
  row.initiate_checkout += firstActionVal(actions, ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout', 'omni_initiated_checkout'])
  row.view_content += firstActionVal(actions, ['offsite_conversion.fb_pixel_view_content', 'view_content', 'omni_view_content'])
  row.landing_page_view += actionVal(actions, 'landing_page_view')
  row.link_click += actionVal(actions, 'link_click')
  row.post_engagement += actionVal(actions, 'post_engagement')
  row.outbound_clicks += actionVal(actions, 'outbound_click')
  row.comments += actionVal(actions, 'comment')
  row.reactions += actionVal(actions, 'post_reaction')
  row.shares += actionVal(actions, 'post')
  row.post_saves += actionVal(actions, 'onsite_conversion.post_save')
  row.leads += firstActionVal(actions, ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'])
  row.registrations += firstActionVal(actions, ['complete_registration', 'offsite_conversion.fb_pixel_complete_registration'])
  row.app_installs += firstActionVal(actions, ['mobile_app_install', 'app_install', 'omni_app_install'])
  row.messaging_started += actionVal(actions, 'onsite_conversion.messaging_conversation_started_7d')
  row.add_payment_info += firstActionVal(actions, ['add_payment_info', 'offsite_conversion.fb_pixel_add_payment_info'])
  row.search += firstActionVal(actions, ['search', 'offsite_conversion.fb_pixel_search'])
  row.add_to_wishlist += firstActionVal(actions, ['add_to_wishlist', 'offsite_conversion.fb_pixel_add_to_wishlist'])
  row.likes += actionVal(actions, 'like')
  row.video_3s += actionVal(ins.video_play_actions || [], 'video_view')
  row.thruplay += actionVal(ins.video_thruplay_watched_actions || [], 'video_view')
  row.video_p25 += actionVal(ins.video_p25_watched_actions || [], 'video_view')
  row.video_p50 += actionVal(ins.video_p50_watched_actions || [], 'video_view')
  row.video_p75 += actionVal(ins.video_p75_watched_actions || [], 'video_view')
  row.video_p100 += actionVal(ins.video_p100_watched_actions || [], 'video_view')
  const avgWatch = actionVal(ins.video_avg_time_watched_actions || [], 'video_view')
  row.watch_time_weighted += avgWatch * actionVal(ins.video_thruplay_watched_actions || [], 'video_view')
}

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
    case 'sustain_rate': return r.video_3s ? (r.video_p100 / r.video_3s) * 100 : 0
    case 'cost_per_thruplay': return r.thruplay ? r.spend / r.thruplay : 0
    case 'aov': return r.conversions ? r.revenue / r.conversions : 0
    case 'cost_per_atc': return r.add_to_cart ? r.spend / r.add_to_cart : 0
    case 'cost_per_checkout': return r.initiate_checkout ? r.spend / r.initiate_checkout : 0
    case 'cost_per_lpv': return r.landing_page_view ? r.spend / r.landing_page_view : 0
    case 'cost_per_link_click': return r.link_click ? r.spend / r.link_click : 0
    case 'outbound_ctr': return r.impressions ? (r.outbound_clicks / r.impressions) * 100 : 0
    case 'click_to_purchase': return r.link_click ? (r.conversions / r.link_click) * 100 : 0
    case 'atc_to_purchase': return r.add_to_cart ? (r.conversions / r.add_to_cart) * 100 : 0
    case 'cost_per_lead': return r.leads ? r.spend / r.leads : 0
    case 'cost_per_registration': return r.registrations ? r.spend / r.registrations : 0
    case 'cost_per_app_install': return r.app_installs ? r.spend / r.app_installs : 0
    case 'cost_per_messaging': return r.messaging_started ? r.spend / r.messaging_started : 0
    case 'cost_per_view_content': return r.view_content ? r.spend / r.view_content : 0
    case 'engagement_rate': return r.impressions ? (r.post_engagement / r.impressions) * 100 : 0
    case 'checkout_to_purchase': return r.initiate_checkout ? (r.conversions / r.initiate_checkout) * 100 : 0
    case 'vc_to_atc': return r.view_content ? (r.add_to_cart / r.view_content) * 100 : 0
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
  let filters: ReportFilter[] = []
  try { const f = JSON.parse(sp.get('filters') || '[]'); if (Array.isArray(f)) filters = f } catch {}
  const TAG_FIELDS = ['visual_format', 'messaging_theme', 'hook_tactic', 'headline_tactic', 'intended_audience', 'offer_type', 'seasonality']
  const statusFilter = filters.find(f => f.field === 'status')
  const nameFilters = filters.filter(f => ['ad_name', 'campaign_name', 'adset_name'].includes(f.field))   // pre-group (on insights)
  const metricFilters = filters.filter(f => !!METRICS[f.field as MetricKey])
  const rowTextFilters = filters.filter(f => f.field === 'landing_page')
  const dateFilters = filters.filter(f => f.field === 'launch_date')
  const formatFilters = filters.filter(f => f.field === 'format')
  const tagFilters = filters.filter(f => TAG_FIELDS.includes(f.field))
  const passOp = (a: number, op: FilterOp, b: number) =>
    op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : a === b
  const passText = (v: string, op: FilterOp, q: string) => {
    const a = (v || '').toLowerCase(), b = (q || '').toLowerCase()
    return op === 'is' ? a === b : op === 'is_not' ? a !== b : a.includes(b)   // contains
  }

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
    const adRes = await fetch(`https://graph.facebook.com/${V}/${act}/ads?fields=id,name,created_time,effective_status,creative{thumbnail_url,object_story_spec,video_id,image_url,image_hash,asset_feed_spec}&limit=500&effective_status=["ACTIVE","PAUSED","ARCHIVED","IN_PROCESS","WITH_ISSUES","CAMPAIGN_PAUSED","ADSET_PAUSED"]&access_token=${token}`)
    const adJson = await adRes.json().catch(() => ({}))
    const adMeta = new Map<string, any>()
    for (const a of (adJson.data || [])) {
      const cr = a.creative || {}
      const spec = cr.object_story_spec
      const afs = cr.asset_feed_spec
      // thumbnail_url is often null for video/dynamic creatives — fall back through the other image
      // fields Meta exposes so the report card shows a real frame instead of a placeholder.
      const thumbnail = cr.thumbnail_url || cr.image_url
        || spec?.video_data?.image_url || spec?.link_data?.picture
        || spec?.link_data?.child_attachments?.[0]?.picture
        || afs?.images?.[0]?.url || afs?.videos?.[0]?.thumbnail_url || null
      adMeta.set(a.id, {
        thumbnail,
        videoId: cr.video_id || spec?.video_data?.video_id || afs?.videos?.[0]?.video_id || null,
        format: inferFormat(a.creative),
        landingPage: spec?.link_data?.link || spec?.video_data?.call_to_action?.value?.link || afs?.link_urls?.[0]?.website_url || null,
        launchDate: a.created_time ? String(a.created_time).slice(0, 10) : null,
        primaryText: spec?.link_data?.message || spec?.video_data?.message || afs?.bodies?.[0]?.text || null,
        headline: spec?.link_data?.name || spec?.video_data?.title || afs?.titles?.[0]?.text || null,
        // Normalize Meta's effective_status to active | paused | archived for the status filter.
        status: /ARCHIV/.test(a.effective_status) ? 'archived' : /ACTIVE/.test(a.effective_status) ? 'active' : 'paused',
      })
    }

    // 2a) Posters — Meta's bulk /ads edge is unreliable about creative images. For any ad missing a
    // thumbnail, re-fetch its creative per-ad (batched ?ids=) which returns thumbnail_url/image_url/
    // video_id more reliably; then batch-fetch the video's higher-res `picture`. So cards show a real
    // frame instead of a placeholder. Bounded to the ads actually in the report.
    const missIds = Array.from(adMeta.entries()).filter(([, m]: any) => !m.thumbnail).map(([id]) => id as string).slice(0, 120)
    for (let i = 0; i < missIds.length; i += 50) {
      const chunk = missIds.slice(i, i + 50)
      const res = await fetch(`https://graph.facebook.com/${V}/?ids=${chunk.join(',')}&fields=creative{thumbnail_url,image_url,video_id}&access_token=${token}`).then(r => r.json()).catch(() => ({}))
      for (const id of chunk) {
        const c = res?.[id]?.creative; if (!c) continue
        const m = adMeta.get(id); if (!m) continue
        m.thumbnail = m.thumbnail || c.thumbnail_url || c.image_url || null
        m.videoId = m.videoId || c.video_id || null
      }
    }
    const vidIds = Array.from(new Set(Array.from(adMeta.values()).filter((m: any) => !m.thumbnail && m.videoId).map((m: any) => m.videoId))).slice(0, 120)
    for (let i = 0; i < vidIds.length; i += 50) {
      const chunk = vidIds.slice(i, i + 50)
      const res = await fetch(`https://graph.facebook.com/${V}/?ids=${chunk.join(',')}&fields=picture&access_token=${token}`).then(r => r.json()).catch(() => ({}))
      for (const m of Array.from(adMeta.values())) if (!m.thumbnail && m.videoId && res?.[m.videoId]?.picture) m.thumbnail = res[m.videoId].picture
    }

    // 2b) AI creative tags. Grouping by an AI dimension, or the "AI tags" toggle (aiTags=1), RUNS the
    // tagging pass (top-spend ads, cached in R2 → once per creative). Otherwise we still LOAD the cache
    // for free so already-tagged creatives show their pills without spending anything.
    let tagMap: Record<string, CreativeTags> = {}
    let tagRemaining = 0
    const wantTags = isTagDimension(groupBy) || sp.get('aiTags') === '1' || tagFilters.length > 0
    if (wantTags) {
      const spendById = new Map<string, number>()
      for (const ins of insights) spendById.set(ins.ad_id, (spendById.get(ins.ad_id) || 0) + num(ins.spend))
      const tagInputs: TagInput[] = Array.from(spendById.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => {
          const m = adMeta.get(id) || {}
          const ins = insights.find(x => x.ad_id === id)
          return { id, name: ins?.ad_name, primaryText: m.primaryText, headline: m.headline, thumbnail: m.thumbnail, format: m.format }
        })
      const r = await ensureTags(metaAccount.account_id, tagInputs, 30)
      tagMap = r.tags; tagRemaining = r.remaining
    } else {
      tagMap = await loadTagCache(metaAccount.account_id)
    }

    // 3) Build + group rows.
    const groups = new Map<string, Row>()
    const keyOf = (ins: any, meta: any): { key: string; name: string } => {
      if (isTagDimension(groupBy)) {
        const t = tagMap[ins.ad_id]?.[groupBy] || 'Untagged'
        return { key: t, name: t }
      }
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
      // Ad-status filter (per-ad, applied before grouping).
      if (statusFilter) { const match = (meta.status || 'paused') === statusFilter.value; if (statusFilter.op === 'is_not' ? match : !match) continue }
      // Name filters (ad/campaign/ad set) — applied per-ad before grouping.
      if (nameFilters.length) {
        const val: Record<string, string> = { ad_name: ins.ad_name || '', campaign_name: ins.campaign_name || '', adset_name: ins.adset_name || '' }
        if (!nameFilters.every(f => passText(val[f.field], f.op, String(f.value)))) continue
      }
      const { key, name } = keyOf(ins, meta)
      let row = groups.get(key)
      if (!row) {
        row = { key, name, thumbnail: meta.thumbnail || null, format: meta.format || 'other', landingPage: meta.landingPage || null, launchDate: meta.launchDate || null, status: meta.status || 'paused', adCount: 0, adId: ins.ad_id, ...emptyRow() }
        groups.set(key, row)
      }
      accInsight(row, ins)
    }

    // Comparative: fetch the previous equal-length period and compute per-group prev metrics for deltas.
    let prevByKey: Record<string, Row> | null = null
    if (tpl.key === 'comparative' || sp.get('compare') === '1') {
      const [sy, sm, sd] = since.split('-').map(Number), [uy, um, ud] = until.split('-').map(Number)
      const len = Math.max(1, Math.round((Date.UTC(uy, um - 1, ud) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1)
      const pUntil = new Date(Date.UTC(sy, sm - 1, sd) - 86400000)
      const pSince = new Date(pUntil.getTime() - (len - 1) * 86400000)
      const isoU = (d: Date) => d.toISOString().slice(0, 10)
      const ptr = encodeURIComponent(JSON.stringify({ since: isoU(pSince), until: isoU(pUntil) }))
      const prevRes = await fetch(`https://graph.facebook.com/${V}/${act}/insights?level=ad&fields=${insFields}&time_range=${ptr}&limit=500&access_token=${token}`).then(r => r.json()).catch(() => ({}))
      const pg = new Map<string, Row>()
      for (const ins of (prevRes?.data || [])) {
        const meta = adMeta.get(ins.ad_id) || {}
        const { key, name } = keyOf(ins, meta)
        let row = pg.get(key)
        if (!row) { row = { key, name, thumbnail: null, format: 'other', landingPage: null, launchDate: null, status: 'paused', adCount: 0, adId: ins.ad_id, ...emptyRow() }; pg.set(key, row) }
        accInsight(row, ins)
      }
      prevByKey = Object.fromEntries(pg)
    }

    // 4) Shape + sort. "Scalers" = above-median ROAS but below-median spend (ready to scale).
    let rows = Array.from(groups.values())
    if (tpl.key === 'scalers' && rows.length > 3) {
      const spends = rows.map(r => r.spend).sort((a, b) => a - b)
      const medSpend = spends[Math.floor(spends.length / 2)]
      rows = rows.filter(r => metricValue(r, 'roas') >= 1 && r.spend <= medSpend && r.conversions > 0)
    }
    // Filters on grouped rows — Net Results below reflects the filtered set.
    for (const f of metricFilters) rows = rows.filter(r => passOp(metricValue(r, f.field as MetricKey), f.op, Number(f.value)))
    for (const f of rowTextFilters) rows = rows.filter(r => passText(r.landingPage || '', f.op, String(f.value)))
    for (const f of formatFilters) rows = rows.filter(r => f.op === 'is_not' ? r.format !== f.value : r.format === f.value)
    for (const f of dateFilters) rows = rows.filter(r => { if (!r.launchDate) return false; return f.op === 'before' ? r.launchDate < String(f.value) : r.launchDate > String(f.value) })
    for (const f of tagFilters) rows = rows.filter(r => { const t = tagMap[r.adId]?.[f.field as keyof CreativeTags]; return f.op === 'is_not' ? t !== f.value : t === f.value })
    // Pills make sense on creative-level rows (each row = one creative/ad). For aggregate groupings a
    // single creative's tags would misrepresent the group, so only attach there.
    const attachTags = groupBy === 'creative' || groupBy === 'ad'
    const shaped = rows.map(r => {
      const m: Record<string, number> = {}
      for (const k of cols) m[k] = metricValue(r, k)
      m[sort] = metricValue(r, sort)
      // Comparative: previous-period value + % delta per column.
      let delta: Record<string, number> | undefined
      if (prevByKey) {
        const pr = prevByKey[r.key]
        delta = {}
        for (const k of cols) { const cur = m[k], prev = pr ? metricValue(pr, k) : 0; delta[k] = prev ? ((cur - prev) / prev) * 100 : (cur ? 100 : 0) }
      }
      return {
        key: r.key, name: r.name, thumbnail: r.thumbnail, format: r.format, adId: r.adId,
        landingPage: r.landingPage, launchDate: r.launchDate, status: r.status, adCount: r.adCount, metrics: m, delta,
        tags: attachTags ? (tagMap[r.adId] || null) : null,
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
      tagRemaining, aiGrouped: isTagDimension(groupBy),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to build report', rows: [] }, { status: 200 })
  }
}
