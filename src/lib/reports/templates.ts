/**
 * Report template + metric registry — the single source of truth for the Motion-style reporting suite.
 * Drives the Create-report modal, the sidebar list, and the /api/reports/generate engine.
 *
 * A report = a template (which metrics to highlight + default grouping/sort) run over the connected
 * Meta ad account's ad-level insights, grouped by a dimension, sorted by a metric.
 */

export type MetricKey =
  | 'spend' | 'impressions' | 'reach' | 'frequency' | 'clicks' | 'ctr' | 'cpc' | 'cpm'
  | 'conversions' | 'revenue' | 'roas' | 'cpa'
  | 'add_to_cart' | 'initiate_checkout' | 'view_content' | 'landing_page_view' | 'link_click' | 'post_engagement'
  | 'thruplay' | 'video_3s' | 'hook_rate' | 'hold_rate' | 'video_p25' | 'video_p50' | 'video_p75' | 'video_p100'
  | 'avg_watch_time' | 'sustain_rate' | 'cost_per_thruplay'
  | 'aov' | 'cost_per_atc' | 'cost_per_checkout' | 'cost_per_lpv' | 'cost_per_link_click'
  | 'outbound_clicks' | 'outbound_ctr' | 'click_to_purchase' | 'atc_to_purchase'
  | 'comments' | 'reactions' | 'shares' | 'post_saves'
  | 'leads' | 'cost_per_lead' | 'registrations' | 'cost_per_registration'
  | 'app_installs' | 'cost_per_app_install' | 'messaging_started' | 'cost_per_messaging'
  | 'add_payment_info' | 'search' | 'add_to_wishlist' | 'likes' | 'cost_per_view_content'
  | 'engagement_rate' | 'checkout_to_purchase' | 'vc_to_atc'
  // Attribution-window variants (real, different numbers per window)
  | 'purchases_1d_click' | 'purchases_7d_click' | 'purchases_1d_view' | 'purchases_28d_click'
  | 'revenue_1d_click' | 'revenue_7d_click' | 'revenue_1d_view' | 'revenue_28d_click'
  | 'roas_1d_click' | 'roas_7d_click' | 'roas_1d_view' | 'roas_28d_click'
  | 'cpa_1d_click' | 'cpa_7d_click' | 'cpa_1d_view' | 'cpa_28d_click'
  // Per-1000-impression variants (arithmetic on existing counts)
  | 'purchases_per_1k' | 'revenue_per_1k' | 'atc_per_1k' | 'checkout_per_1k' | 'lpv_per_1k'
  | 'link_clicks_per_1k' | 'leads_per_1k' | 'registrations_per_1k' | 'view_content_per_1k' | 'thruplay_per_1k'

export type Metric = {
  key: MetricKey
  label: string
  /** How to format the value in the UI. */
  format: 'currency' | 'number' | 'percent' | 'ratio' | 'seconds'
  /** Higher is better (green) vs lower is better (for CPM/CPA/CPC etc.). */
  goodHigh: boolean
  /** Needs the extra video fields on the insights call (Hook/Hold/retention). */
  video?: boolean
}

export const METRICS: Record<MetricKey, Metric> = {
  spend:            { key: 'spend',            label: 'Spend',            format: 'currency', goodHigh: false },
  impressions:      { key: 'impressions',      label: 'Impressions',      format: 'number',   goodHigh: true },
  reach:            { key: 'reach',            label: 'Reach',            format: 'number',   goodHigh: true },
  frequency:        { key: 'frequency',        label: 'Frequency',        format: 'ratio',    goodHigh: false },
  clicks:           { key: 'clicks',           label: 'Clicks',           format: 'number',   goodHigh: true },
  ctr:              { key: 'ctr',              label: 'CTR',              format: 'percent',  goodHigh: true },
  cpc:              { key: 'cpc',              label: 'CPC',              format: 'currency', goodHigh: false },
  cpm:              { key: 'cpm',              label: 'CPM',              format: 'currency', goodHigh: false },
  conversions:      { key: 'conversions',      label: 'Purchases',        format: 'number',   goodHigh: true },
  revenue:          { key: 'revenue',          label: 'Revenue',          format: 'currency', goodHigh: true },
  roas:             { key: 'roas',             label: 'ROAS',             format: 'ratio',    goodHigh: true },
  cpa:              { key: 'cpa',              label: 'CPA',              format: 'currency', goodHigh: false },
  add_to_cart:      { key: 'add_to_cart',      label: 'Adds to Cart',     format: 'number',   goodHigh: true },
  initiate_checkout:{ key: 'initiate_checkout',label: 'Checkouts',        format: 'number',   goodHigh: true },
  view_content:     { key: 'view_content',     label: 'Content Views',    format: 'number',   goodHigh: true },
  landing_page_view:{ key: 'landing_page_view',label: 'Landing Views',    format: 'number',   goodHigh: true },
  link_click:       { key: 'link_click',       label: 'Link Clicks',      format: 'number',   goodHigh: true },
  post_engagement:  { key: 'post_engagement',  label: 'Engagements',      format: 'number',   goodHigh: true },
  thruplay:         { key: 'thruplay',         label: 'ThruPlays',        format: 'number',   goodHigh: true, video: true },
  video_3s:         { key: 'video_3s',         label: '3s Views',         format: 'number',   goodHigh: true, video: true },
  hook_rate:        { key: 'hook_rate',        label: 'Hook Rate',        format: 'percent',  goodHigh: true, video: true },
  hold_rate:        { key: 'hold_rate',        label: 'Hold Rate',        format: 'percent',  goodHigh: true, video: true },
  video_p25:        { key: 'video_p25',        label: '25% Watched',      format: 'number',   goodHigh: true, video: true },
  video_p50:        { key: 'video_p50',        label: '50% Watched',      format: 'number',   goodHigh: true, video: true },
  video_p75:        { key: 'video_p75',        label: '75% Watched',      format: 'number',   goodHigh: true, video: true },
  video_p100:       { key: 'video_p100',       label: '100% Watched',     format: 'number',   goodHigh: true, video: true },
  avg_watch_time:   { key: 'avg_watch_time',   label: 'Avg Watch Time',   format: 'seconds',  goodHigh: true, video: true },
  sustain_rate:     { key: 'sustain_rate',     label: 'Sustain Rate',     format: 'percent',  goodHigh: true, video: true },
  cost_per_thruplay:{ key: 'cost_per_thruplay',label: 'Cost / ThruPlay',  format: 'currency', goodHigh: false, video: true },
  aov:              { key: 'aov',              label: 'AOV',              format: 'currency', goodHigh: true },
  cost_per_atc:     { key: 'cost_per_atc',     label: 'Cost / Add to Cart', format: 'currency', goodHigh: false },
  cost_per_checkout:{ key: 'cost_per_checkout',label: 'Cost / Checkout',  format: 'currency', goodHigh: false },
  cost_per_lpv:     { key: 'cost_per_lpv',     label: 'Cost / Landing View', format: 'currency', goodHigh: false },
  cost_per_link_click:{ key: 'cost_per_link_click', label: 'Cost / Link Click', format: 'currency', goodHigh: false },
  outbound_clicks:  { key: 'outbound_clicks',  label: 'Outbound Clicks',  format: 'number',   goodHigh: true },
  outbound_ctr:     { key: 'outbound_ctr',     label: 'CTR (outbound)',   format: 'percent',  goodHigh: true },
  click_to_purchase:{ key: 'click_to_purchase',label: 'Click→Purchase',   format: 'percent',  goodHigh: true },
  atc_to_purchase:  { key: 'atc_to_purchase',  label: 'ATC→Purchase',     format: 'percent',  goodHigh: true },
  comments:         { key: 'comments',         label: 'Comments',         format: 'number',   goodHigh: true },
  reactions:        { key: 'reactions',        label: 'Reactions',        format: 'number',   goodHigh: true },
  shares:           { key: 'shares',           label: 'Shares',           format: 'number',   goodHigh: true },
  post_saves:       { key: 'post_saves',       label: 'Post Saves',       format: 'number',   goodHigh: true },
  leads:            { key: 'leads',            label: 'Leads',            format: 'number',   goodHigh: true },
  cost_per_lead:    { key: 'cost_per_lead',    label: 'Cost / Lead',      format: 'currency', goodHigh: false },
  registrations:    { key: 'registrations',    label: 'Registrations',    format: 'number',   goodHigh: true },
  cost_per_registration: { key: 'cost_per_registration', label: 'Cost / Registration', format: 'currency', goodHigh: false },
  app_installs:     { key: 'app_installs',     label: 'App Installs',     format: 'number',   goodHigh: true },
  cost_per_app_install: { key: 'cost_per_app_install', label: 'Cost / Install', format: 'currency', goodHigh: false },
  messaging_started:{ key: 'messaging_started',label: 'Conversations',    format: 'number',   goodHigh: true },
  cost_per_messaging:{ key: 'cost_per_messaging', label: 'Cost / Conversation', format: 'currency', goodHigh: false },
  add_payment_info: { key: 'add_payment_info', label: 'Payment Info Adds', format: 'number',  goodHigh: true },
  search:           { key: 'search',           label: 'Searches',         format: 'number',   goodHigh: true },
  add_to_wishlist:  { key: 'add_to_wishlist',  label: 'Wishlist Adds',    format: 'number',   goodHigh: true },
  likes:            { key: 'likes',            label: 'Page Likes',       format: 'number',   goodHigh: true },
  cost_per_view_content: { key: 'cost_per_view_content', label: 'Cost / Content View', format: 'currency', goodHigh: false },
  engagement_rate:  { key: 'engagement_rate',  label: 'Engagement Rate',  format: 'percent',  goodHigh: true },
  checkout_to_purchase: { key: 'checkout_to_purchase', label: 'Checkout→Purchase', format: 'percent', goodHigh: true },
  vc_to_atc:        { key: 'vc_to_atc',        label: 'View→ATC',         format: 'percent',  goodHigh: true },
  // Attribution-window variants — same event, different attribution window (genuinely different counts)
  purchases_1d_click:  { key: 'purchases_1d_click',  label: 'Purchases (1d click)',  format: 'number',   goodHigh: true },
  purchases_7d_click:  { key: 'purchases_7d_click',  label: 'Purchases (7d click)',  format: 'number',   goodHigh: true },
  purchases_1d_view:   { key: 'purchases_1d_view',   label: 'Purchases (1d view)',   format: 'number',   goodHigh: true },
  purchases_28d_click: { key: 'purchases_28d_click', label: 'Purchases (28d click)', format: 'number',   goodHigh: true },
  revenue_1d_click:    { key: 'revenue_1d_click',    label: 'Revenue (1d click)',    format: 'currency', goodHigh: true },
  revenue_7d_click:    { key: 'revenue_7d_click',    label: 'Revenue (7d click)',    format: 'currency', goodHigh: true },
  revenue_1d_view:     { key: 'revenue_1d_view',     label: 'Revenue (1d view)',     format: 'currency', goodHigh: true },
  revenue_28d_click:   { key: 'revenue_28d_click',   label: 'Revenue (28d click)',   format: 'currency', goodHigh: true },
  roas_1d_click:       { key: 'roas_1d_click',       label: 'ROAS (1d click)',       format: 'ratio',    goodHigh: true },
  roas_7d_click:       { key: 'roas_7d_click',       label: 'ROAS (7d click)',       format: 'ratio',    goodHigh: true },
  roas_1d_view:        { key: 'roas_1d_view',        label: 'ROAS (1d view)',        format: 'ratio',    goodHigh: true },
  roas_28d_click:      { key: 'roas_28d_click',      label: 'ROAS (28d click)',      format: 'ratio',    goodHigh: true },
  cpa_1d_click:        { key: 'cpa_1d_click',        label: 'CPA (1d click)',        format: 'currency', goodHigh: false },
  cpa_7d_click:        { key: 'cpa_7d_click',        label: 'CPA (7d click)',        format: 'currency', goodHigh: false },
  cpa_1d_view:         { key: 'cpa_1d_view',         label: 'CPA (1d view)',         format: 'currency', goodHigh: false },
  cpa_28d_click:       { key: 'cpa_28d_click',       label: 'CPA (28d click)',       format: 'currency', goodHigh: false },
  // Per-1000-impression variants — density of an event against reach
  purchases_per_1k:     { key: 'purchases_per_1k',     label: 'Purchases / 1k impr',   format: 'number',   goodHigh: true },
  revenue_per_1k:       { key: 'revenue_per_1k',       label: 'Revenue / 1k impr',     format: 'currency', goodHigh: true },
  atc_per_1k:           { key: 'atc_per_1k',           label: 'ATC / 1k impr',         format: 'number',   goodHigh: true },
  checkout_per_1k:      { key: 'checkout_per_1k',      label: 'Checkouts / 1k impr',   format: 'number',   goodHigh: true },
  lpv_per_1k:           { key: 'lpv_per_1k',           label: 'LP Views / 1k impr',    format: 'number',   goodHigh: true },
  link_clicks_per_1k:   { key: 'link_clicks_per_1k',   label: 'Link Clicks / 1k impr', format: 'number',   goodHigh: true },
  leads_per_1k:         { key: 'leads_per_1k',         label: 'Leads / 1k impr',       format: 'number',   goodHigh: true },
  registrations_per_1k: { key: 'registrations_per_1k', label: 'Regs / 1k impr',        format: 'number',   goodHigh: true },
  view_content_per_1k:  { key: 'view_content_per_1k',  label: 'Content Views / 1k impr', format: 'number', goodHigh: true },
  thruplay_per_1k:      { key: 'thruplay_per_1k',      label: 'ThruPlays / 1k impr',   format: 'number',   goodHigh: true },
}

export type GroupByKey =
  | 'creative' | 'ad' | 'adset' | 'campaign' | 'landing_page' | 'format' | 'launch_date'
  // AI creative-pattern dimensions (require the tagging pass — see lib/reports/tagging.ts):
  | 'visual_format' | 'messaging_theme' | 'hook_tactic' | 'headline_tactic' | 'intended_audience' | 'offer_type' | 'seasonality'
export const GROUP_BY: { key: GroupByKey; label: string; ai?: boolean }[] = [
  { key: 'creative', label: 'Creative' },
  { key: 'ad', label: 'Ad' },
  { key: 'adset', label: 'Ad set' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'landing_page', label: 'Landing page' },
  { key: 'format', label: 'Format' },
  { key: 'launch_date', label: 'Launch date' },
  // ── AI tags ──
  { key: 'visual_format', label: 'Visual format', ai: true },
  { key: 'messaging_theme', label: 'Messaging theme', ai: true },
  { key: 'hook_tactic', label: 'Hook tactic', ai: true },
  { key: 'headline_tactic', label: 'Headline tactic', ai: true },
  { key: 'intended_audience', label: 'Intended audience', ai: true },
  { key: 'offer_type', label: 'Offer type', ai: true },
  { key: 'seasonality', label: 'Seasonality', ai: true },
]
export const AI_GROUP_BY = GROUP_BY.filter(g => g.ai)

// ── Filters (Motion-style) ──
export type FilterOp = '>' | '<' | '>=' | '<=' | '=' | 'contains' | 'is' | 'is_not' | 'after' | 'before'
export const NUM_OPS: FilterOp[] = ['>', '<', '>=', '<=', '=']
export const FILTER_OPS = NUM_OPS
export type ReportFilter = { field: string; op: FilterOp; value: number | string }
export const AD_STATUSES = ['active', 'paused', 'archived'] as const

// Filter-field registry drives the "Add filter" picker + the engine.
export type FilterFieldType = 'number' | 'text' | 'date' | 'enum' | 'tag'
export type FilterField = { key: string; label: string; type: FilterFieldType; group: string; options?: readonly string[] }
export const FILTER_FIELDS: FilterField[] = [
  // Dimensions
  { key: 'ad_name', label: 'Ad name', type: 'text', group: 'Dimensions' },
  { key: 'campaign_name', label: 'Campaign name', type: 'text', group: 'Dimensions' },
  { key: 'adset_name', label: 'Ad set name', type: 'text', group: 'Dimensions' },
  { key: 'landing_page', label: 'Landing page', type: 'text', group: 'Dimensions' },
  { key: 'launch_date', label: 'Launch date', type: 'date', group: 'Dimensions' },
  { key: 'format', label: 'Asset type', type: 'enum', group: 'Dimensions', options: ['video', 'image', 'carousel'] },
  { key: 'status', label: 'Ad status', type: 'enum', group: 'Dimensions', options: AD_STATUSES },
  // Performance metrics
  ...(Object.keys(METRICS) as MetricKey[]).map(k => ({ key: k, label: METRICS[k].label, type: 'number' as FilterFieldType, group: 'Performance' })),
  // AI tags
  { key: 'visual_format', label: 'Visual Format', type: 'tag', group: 'AI Tags' },
  { key: 'messaging_theme', label: 'Messaging Theme', type: 'tag', group: 'AI Tags' },
  { key: 'hook_tactic', label: 'Hook Tactic', type: 'tag', group: 'AI Tags' },
  { key: 'headline_tactic', label: 'Headline Tactic', type: 'tag', group: 'AI Tags' },
  { key: 'intended_audience', label: 'Intended Audience', type: 'tag', group: 'AI Tags' },
  { key: 'offer_type', label: 'Offer Type', type: 'tag', group: 'AI Tags' },
  { key: 'seasonality', label: 'Seasonality', type: 'tag', group: 'AI Tags' },
]
export const FILTER_FIELD_BY_KEY: Record<string, FilterField> = Object.fromEntries(FILTER_FIELDS.map(f => [f.key, f]))
export const opsForType = (t: FilterFieldType): FilterOp[] =>
  t === 'number' ? NUM_OPS : t === 'text' ? ['contains', 'is', 'is_not'] : t === 'date' ? ['after', 'before'] : ['is', 'is_not']

export type ReportCategory = 'Find winners' | 'Find problems' | 'Creative strategy' | 'Understand performance'

export type ReportTemplate = {
  key: string
  title: string
  emoji: string
  description: string
  category: ReportCategory
  /** Featured at the top of the modal (Top performers / Comparative / Launch analysis). */
  featured?: boolean
  groupBy: GroupByKey
  /** Ordered metric columns; the first is the default sort. */
  metrics: MetricKey[]
  sort: MetricKey
  sortDir: 'desc' | 'asc'
  /** Only include rows that are videos (Hook/Hold/Video analysis) or images (Static). */
  onlyFormat?: 'video' | 'image'
  /** Needs the video fields on the insights call. */
  needsVideo?: boolean
}

// Fuller default column set (Motion-style) — used by most templates. Add/remove per report anytime.
const BASE: MetricKey[] = ['spend', 'impressions', 'cpm', 'link_click', 'cpc', 'ctr', 'conversions', 'cpa', 'revenue', 'roas']
const VIDEO_BASE: MetricKey[] = ['spend', 'impressions', 'ctr', 'hook_rate', 'hold_rate', 'thruplay', 'conversions', 'cpa', 'revenue', 'roas']

export const TEMPLATES: ReportTemplate[] = [
  // ── Featured ──
  { key: 'top_performers', title: 'Top performers', emoji: '⭐', category: 'Find winners', featured: true,
    description: 'Your best creatives by return on ad spend', groupBy: 'creative',
    metrics: BASE, sort: 'roas', sortDir: 'desc' },
  { key: 'comparative', title: 'Comparative analysis', emoji: '📊', category: 'Understand performance', featured: true,
    description: 'Compare this period against the previous one', groupBy: 'creative',
    metrics: BASE, sort: 'spend', sortDir: 'desc' },
  { key: 'launch_analysis', title: 'Launch analysis', emoji: '🚀', category: 'Find winners', featured: true,
    description: 'How your newest ads are performing out of the gate', groupBy: 'creative',
    metrics: BASE, sort: 'spend', sortDir: 'desc' },

  // ── Find winners ──
  { key: 'top_converters', title: 'Top converters', emoji: '💵', category: 'Find winners',
    description: 'See which creatives are driving the most purchases and revenue', groupBy: 'creative',
    metrics: ['spend', 'impressions', 'cpm', 'link_click', 'cpc', 'ctr', 'conversions', 'cpa', 'revenue', 'roas'], sort: 'conversions', sortDir: 'desc' },
  { key: 'top_engagers', title: 'Top engagers', emoji: '👀', category: 'Find winners',
    description: 'Which creatives capture the most attention and engagement', groupBy: 'creative',
    metrics: ['spend', 'impressions', 'ctr', 'clicks', 'link_click', 'cpc', 'post_engagement'], sort: 'ctr', sortDir: 'desc' },
  { key: 'scalers', title: 'Scalers', emoji: '📈', category: 'Find winners',
    description: 'Promising low-spend creatives with strong ROAS that are ready to scale', groupBy: 'creative',
    metrics: BASE, sort: 'roas', sortDir: 'desc' },
  { key: 'top_hook', title: 'Top hook', emoji: '🪝', category: 'Find winners',
    description: 'Which video openings grab attention in the first 3 seconds', groupBy: 'creative',
    metrics: ['spend', 'impressions', 'hook_rate', 'video_3s', 'thruplay', 'ctr', 'cpc', 'conversions', 'roas'], sort: 'hook_rate', sortDir: 'desc',
    onlyFormat: 'video', needsVideo: true },
  { key: 'top_hold', title: 'Top hold', emoji: '⏱️', category: 'Find winners',
    description: 'Which videos keep viewers watching the longest', groupBy: 'creative',
    metrics: ['spend', 'impressions', 'hold_rate', 'thruplay', 'avg_watch_time', 'video_p100', 'ctr', 'conversions', 'roas'], sort: 'hold_rate', sortDir: 'desc',
    onlyFormat: 'video', needsVideo: true },

  // ── Find problems ──
  { key: 'bottom_cpm', title: 'Bottom performers (CPM)', emoji: '😴', category: 'Find problems',
    description: 'High-CPM creatives that are eating into your budget', groupBy: 'creative',
    metrics: ['spend', 'impressions', 'cpm', 'cpc', 'ctr', 'conversions', 'cpa', 'roas'], sort: 'cpm', sortDir: 'desc' },
  { key: 'heavies', title: 'Heavies', emoji: '🏋️', category: 'Find problems',
    description: "High-spend creatives that aren't pulling their weight", groupBy: 'creative',
    metrics: BASE, sort: 'spend', sortDir: 'desc' },
  { key: 'drop_off', title: 'Drop off rate', emoji: '📉', category: 'Find problems',
    description: 'See exactly where viewers lose interest in your videos', groupBy: 'creative',
    metrics: ['spend', 'impressions', 'video_3s', 'video_p25', 'video_p50', 'video_p75', 'video_p100', 'hold_rate', 'thruplay'], sort: 'spend', sortDir: 'desc',
    onlyFormat: 'video', needsVideo: true },
  { key: 'video_analysis', title: 'Video analysis', emoji: '🎬', category: 'Find problems',
    description: 'Deep dive into your video ad performance and retention', groupBy: 'creative',
    metrics: VIDEO_BASE, sort: 'spend', sortDir: 'desc',
    onlyFormat: 'video', needsVideo: true },
  { key: 'static_analysis', title: 'Static analysis', emoji: '🖼️', category: 'Find problems',
    description: 'Analyze your image ad performance across key metrics', groupBy: 'creative',
    metrics: BASE, sort: 'spend', sortDir: 'desc',
    onlyFormat: 'image' },

  // ── Creative strategy ──
  { key: 'persona', title: 'Persona analysis', emoji: '👥', category: 'Creative strategy',
    description: 'Which audience personas respond best to your creatives', groupBy: 'intended_audience',
    metrics: BASE, sort: 'roas', sortDir: 'desc' },
  { key: 'hook_analysis', title: 'Hook analysis', emoji: '🎣', category: 'Creative strategy',
    description: 'Which hook tactics capture the most attention', groupBy: 'hook_tactic',
    metrics: BASE, sort: 'roas', sortDir: 'desc' },
  { key: 'visual_analysis', title: 'Visual format', emoji: '🎨', category: 'Creative strategy',
    description: 'Compare visual formats to learn which creative style makes your message stick', groupBy: 'visual_format',
    metrics: BASE, sort: 'spend', sortDir: 'desc' },
  { key: 'messaging', title: 'Messaging theme analysis', emoji: '💬', category: 'Creative strategy',
    description: 'Which messaging themes resonate most with your audience', groupBy: 'messaging_theme',
    metrics: BASE, sort: 'roas', sortDir: 'desc' },
  { key: 'offer_analysis', title: 'Offer analysis', emoji: '🏷️', category: 'Creative strategy',
    description: 'Which offer types drive the best return', groupBy: 'offer_type',
    metrics: BASE, sort: 'roas', sortDir: 'desc' },
  { key: 'headline_analysis', title: 'Headline tactic analysis', emoji: '✍️', category: 'Creative strategy',
    description: 'Which headline tactics win clicks and conversions', groupBy: 'headline_tactic',
    metrics: BASE, sort: 'roas', sortDir: 'desc' },

  // ── Understand performance ──
  { key: 'customer_journey', title: 'Customer journey', emoji: '🛤️', category: 'Understand performance',
    description: 'Track performance from first impression to final purchase', groupBy: 'creative',
    metrics: ['spend', 'impressions', 'link_click', 'view_content', 'add_to_cart', 'initiate_checkout', 'conversions', 'revenue', 'roas'], sort: 'spend', sortDir: 'desc' },
  { key: 'ad_format', title: 'Ad format comparison', emoji: '🧩', category: 'Understand performance',
    description: 'Compare performance across images, videos, and carousels', groupBy: 'format',
    metrics: BASE, sort: 'spend', sortDir: 'desc' },
  { key: 'funnel', title: 'Funnel comparison', emoji: '🔻', category: 'Understand performance',
    description: 'Compare creative performance across TOF, MOF, and BOF', groupBy: 'campaign',
    metrics: BASE, sort: 'spend', sortDir: 'desc' },
]

// Column presets (Motion's "Custom" dropdown) — named metric/tag-column sets. Built-ins ship with the
// app; user presets are saved in localStorage (no DB migration needed).
export type ColumnPreset = { name: string; metrics: MetricKey[]; tagCols?: string[]; builtin?: boolean }
export const BUILTIN_PRESETS: ColumnPreset[] = [
  { name: 'Facebook Ecommerce', metrics: ['spend', 'roas', 'conversions', 'revenue', 'cpa', 'ctr'], builtin: true },
  { name: 'Facebook SaaS', metrics: ['spend', 'cpc', 'ctr', 'link_click', 'conversions', 'cpa'], builtin: true },
  { name: 'Facebook Video', metrics: ['spend', 'roas', 'hook_rate', 'hold_rate', 'thruplay', 'ctr'], builtin: true },
]

export const TEMPLATE_BY_KEY: Record<string, ReportTemplate> =
  Object.fromEntries(TEMPLATES.map(t => [t.key, t]))

export const CATEGORIES: ReportCategory[] =
  ['Find winners', 'Find problems', 'Creative strategy', 'Understand performance']
