/**
 * Shared reporting-engine core — the metric math used by BOTH the aggregate report engine
 * (/api/reports/generate) and the time-series Sprints engine (/api/reports/sprints).
 *
 * A `Row` is one accumulated bucket of Meta ad-level insights (a group over a whole period, or a
 * group within a single time increment). `accInsight` folds a raw Meta insight object into a Row;
 * `metricValue` derives any metric from a Row's raw sums.
 */
import type { MetricKey } from './templates'

export function timeRange(dateRange: string): { since: string; until: string } {
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

export const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
// Sum a Meta actions/action_values array for a given action_type.
function actionVal(arr: any[], type: string): number {
  return (arr || []).filter((a: any) => a.action_type === type).reduce((s: number, a: any) => s + num(a.value), 0)
}
function firstActionVal(arr: any[], types: string[]): number {
  for (const t of types) { const v = actionVal(arr, t); if (v) return v }
  return 0
}
// Sum a specific attribution-window key (e.g. '7d_click') for a given action_type.
function actionWin(arr: any[], type: string, win: string): number {
  return (arr || []).filter((a: any) => a.action_type === type).reduce((s: number, a: any) => s + num(a[win]), 0)
}
// Like firstActionVal, but reads one attribution window; picks the first type present.
function firstActionWin(arr: any[], types: string[], win: string): number {
  for (const t of types) { if ((arr || []).some((a: any) => a.action_type === t)) return actionWin(arr, t, win) }
  return 0
}

export type Row = {
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
  // attribution-window purchase counts + revenue
  p_1dc: number; p_7dc: number; p_1dv: number; p_28dc: number
  rev_1dc: number; rev_7dc: number; rev_1dv: number; rev_28dc: number
  // account-specific custom conversions, keyed by conversion id: counts + values
  cc: Record<string, number>; ccv: Record<string, number>
}

export const emptyRow = (): Omit<Row, 'key' | 'name' | 'thumbnail' | 'format' | 'landingPage' | 'launchDate' | 'status' | 'adCount' | 'adId'> => ({
  spend: 0, impressions: 0, reach: 0, clicks: 0, conversions: 0, revenue: 0,
  add_to_cart: 0, initiate_checkout: 0, view_content: 0, landing_page_view: 0, link_click: 0, post_engagement: 0,
  thruplay: 0, video_3s: 0, video_p25: 0, video_p50: 0, video_p75: 0, video_p100: 0, watch_time_weighted: 0,
  outbound_clicks: 0, comments: 0, reactions: 0, shares: 0, post_saves: 0,
  leads: 0, registrations: 0, app_installs: 0, messaging_started: 0,
  add_payment_info: 0, search: 0, add_to_wishlist: 0, likes: 0,
  p_1dc: 0, p_7dc: 0, p_1dv: 0, p_28dc: 0, rev_1dc: 0, rev_7dc: 0, rev_1dv: 0, rev_28dc: 0,
  cc: {}, ccv: {},
})

export const PURCHASE = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase']
// Accumulate one insight row's metrics into a Row (shared by every pass — current/previous/time-bucket).
export function accInsight(row: Row, ins: any) {
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
  // per-window purchase counts + revenue (only populated when action_attribution_windows requested)
  row.p_1dc += firstActionWin(actions, PURCHASE, '1d_click');  row.p_7dc += firstActionWin(actions, PURCHASE, '7d_click')
  row.p_1dv += firstActionWin(actions, PURCHASE, '1d_view');   row.p_28dc += firstActionWin(actions, PURCHASE, '28d_click')
  row.rev_1dc += firstActionWin(values, PURCHASE, '1d_click'); row.rev_7dc += firstActionWin(values, PURCHASE, '7d_click')
  row.rev_1dv += firstActionWin(values, PURCHASE, '1d_view');  row.rev_28dc += firstActionWin(values, PURCHASE, '28d_click')
  // Account-specific custom conversions surface as action_type "offsite_conversion.custom.<id>".
  const CC = 'offsite_conversion.custom.'
  for (const a of actions) if (typeof a.action_type === 'string' && a.action_type.startsWith(CC)) { const id = a.action_type.slice(CC.length); row.cc[id] = (row.cc[id] || 0) + num(a.value) }
  for (const a of values) if (typeof a.action_type === 'string' && a.action_type.startsWith(CC)) { const id = a.action_type.slice(CC.length); row.ccv[id] = (row.ccv[id] || 0) + num(a.value) }
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
export function metricValue(r: Row, m: MetricKey): number {
  // Dynamic custom-conversion columns: cc_<id> = count, ccv_<id> = value, cpcc_<id> = cost per.
  const k = m as string
  if (k.startsWith('cpcc_')) { const c = r.cc[k.slice(5)] || 0; return c ? r.spend / c : 0 }
  if (k.startsWith('ccv_')) return r.ccv[k.slice(4)] || 0
  if (k.startsWith('cc_')) return r.cc[k.slice(3)] || 0
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
    // Attribution-window purchase counts + revenue (raw sums under short field names)
    case 'purchases_1d_click': return r.p_1dc
    case 'purchases_7d_click': return r.p_7dc
    case 'purchases_1d_view': return r.p_1dv
    case 'purchases_28d_click': return r.p_28dc
    case 'revenue_1d_click': return r.rev_1dc
    case 'revenue_7d_click': return r.rev_7dc
    case 'revenue_1d_view': return r.rev_1dv
    case 'revenue_28d_click': return r.rev_28dc
    case 'roas_1d_click': return r.spend ? r.rev_1dc / r.spend : 0
    case 'roas_7d_click': return r.spend ? r.rev_7dc / r.spend : 0
    case 'roas_1d_view': return r.spend ? r.rev_1dv / r.spend : 0
    case 'roas_28d_click': return r.spend ? r.rev_28dc / r.spend : 0
    case 'cpa_1d_click': return r.p_1dc ? r.spend / r.p_1dc : 0
    case 'cpa_7d_click': return r.p_7dc ? r.spend / r.p_7dc : 0
    case 'cpa_1d_view': return r.p_1dv ? r.spend / r.p_1dv : 0
    case 'cpa_28d_click': return r.p_28dc ? r.spend / r.p_28dc : 0
    // Per-1000-impression density
    case 'purchases_per_1k': return r.impressions ? (r.conversions / r.impressions) * 1000 : 0
    case 'revenue_per_1k': return r.impressions ? (r.revenue / r.impressions) * 1000 : 0
    case 'atc_per_1k': return r.impressions ? (r.add_to_cart / r.impressions) * 1000 : 0
    case 'checkout_per_1k': return r.impressions ? (r.initiate_checkout / r.impressions) * 1000 : 0
    case 'lpv_per_1k': return r.impressions ? (r.landing_page_view / r.impressions) * 1000 : 0
    case 'link_clicks_per_1k': return r.impressions ? (r.link_click / r.impressions) * 1000 : 0
    case 'leads_per_1k': return r.impressions ? (r.leads / r.impressions) * 1000 : 0
    case 'registrations_per_1k': return r.impressions ? (r.registrations / r.impressions) * 1000 : 0
    case 'view_content_per_1k': return r.impressions ? (r.view_content / r.impressions) * 1000 : 0
    case 'thruplay_per_1k': return r.impressions ? (r.thruplay / r.impressions) * 1000 : 0
    default: return num((r as any)[m])
  }
}

// Infer format from whatever the creative exposes — object_story_spec is often null for ads that
// reference an existing page post, so fall back to top-level creative fields (video_id / image).
export function inferFormat(creative: any): 'video' | 'image' | 'carousel' | 'other' {
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
