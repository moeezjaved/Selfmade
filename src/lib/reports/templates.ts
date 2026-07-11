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
  | 'avg_watch_time'

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
}

export type GroupByKey =
  | 'creative' | 'ad' | 'adset' | 'campaign' | 'landing_page' | 'format' | 'launch_date'
  // AI creative-pattern dimensions (require the tagging pass — see lib/reports/tagging.ts):
  | 'visual_format' | 'messaging_theme' | 'hook_tactic' | 'headline_tactic' | 'intended_audience' | 'offer_type'
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
]
export const AI_GROUP_BY = GROUP_BY.filter(g => g.ai)

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

export const TEMPLATES: ReportTemplate[] = [
  // ── Featured ──
  { key: 'top_performers', title: 'Top performers', emoji: '⭐', category: 'Find winners', featured: true,
    description: 'Your best creatives by return on ad spend', groupBy: 'creative',
    metrics: ['spend', 'roas', 'conversions', 'revenue', 'cpa', 'ctr'], sort: 'roas', sortDir: 'desc' },
  { key: 'comparative', title: 'Comparative analysis', emoji: '📊', category: 'Understand performance', featured: true,
    description: 'Compare this period against the previous one', groupBy: 'creative',
    metrics: ['spend', 'roas', 'conversions', 'cpa', 'ctr', 'cpm'], sort: 'spend', sortDir: 'desc' },
  { key: 'launch_analysis', title: 'Launch analysis', emoji: '🚀', category: 'Find winners', featured: true,
    description: 'How your newest ads are performing out of the gate', groupBy: 'creative',
    metrics: ['spend', 'roas', 'conversions', 'ctr', 'cpa'], sort: 'spend', sortDir: 'desc' },

  // ── Find winners ──
  { key: 'top_converters', title: 'Top converters', emoji: '💵', category: 'Find winners',
    description: 'See which creatives are driving the most purchases and revenue', groupBy: 'creative',
    metrics: ['spend', 'conversions', 'cpa', 'revenue', 'roas'], sort: 'conversions', sortDir: 'desc' },
  { key: 'top_engagers', title: 'Top engagers', emoji: '👀', category: 'Find winners',
    description: 'Which creatives capture the most attention and engagement', groupBy: 'creative',
    metrics: ['spend', 'ctr', 'clicks', 'link_click', 'post_engagement'], sort: 'ctr', sortDir: 'desc' },
  { key: 'scalers', title: 'Scalers', emoji: '📈', category: 'Find winners',
    description: 'Promising low-spend creatives with strong ROAS that are ready to scale', groupBy: 'creative',
    metrics: ['spend', 'roas', 'conversions', 'cpa', 'ctr'], sort: 'roas', sortDir: 'desc' },
  { key: 'top_hook', title: 'Top hook', emoji: '🪝', category: 'Find winners',
    description: 'Which video openings grab attention in the first 3 seconds', groupBy: 'creative',
    metrics: ['spend', 'hook_rate', 'video_3s', 'thruplay', 'ctr'], sort: 'hook_rate', sortDir: 'desc',
    onlyFormat: 'video', needsVideo: true },
  { key: 'top_hold', title: 'Top hold', emoji: '⏱️', category: 'Find winners',
    description: 'Which videos keep viewers watching the longest', groupBy: 'creative',
    metrics: ['spend', 'hold_rate', 'thruplay', 'avg_watch_time', 'video_p100'], sort: 'hold_rate', sortDir: 'desc',
    onlyFormat: 'video', needsVideo: true },

  // ── Find problems ──
  { key: 'bottom_cpm', title: 'Bottom performers (CPM)', emoji: '😴', category: 'Find problems',
    description: 'High-CPM creatives that are eating into your budget', groupBy: 'creative',
    metrics: ['spend', 'cpm', 'impressions', 'ctr', 'roas'], sort: 'cpm', sortDir: 'desc' },
  { key: 'heavies', title: 'Heavies', emoji: '🏋️', category: 'Find problems',
    description: "High-spend creatives that aren't pulling their weight", groupBy: 'creative',
    metrics: ['spend', 'roas', 'conversions', 'cpa', 'ctr'], sort: 'spend', sortDir: 'desc' },
  { key: 'drop_off', title: 'Drop off rate', emoji: '📉', category: 'Find problems',
    description: 'See exactly where viewers lose interest in your videos', groupBy: 'creative',
    metrics: ['spend', 'video_p25', 'video_p50', 'video_p75', 'video_p100', 'hold_rate'], sort: 'spend', sortDir: 'desc',
    onlyFormat: 'video', needsVideo: true },
  { key: 'video_analysis', title: 'Video analysis', emoji: '🎬', category: 'Find problems',
    description: 'Deep dive into your video ad performance and retention', groupBy: 'creative',
    metrics: ['spend', 'roas', 'hook_rate', 'hold_rate', 'thruplay', 'ctr'], sort: 'spend', sortDir: 'desc',
    onlyFormat: 'video', needsVideo: true },
  { key: 'static_analysis', title: 'Static analysis', emoji: '🖼️', category: 'Find problems',
    description: 'Analyze your image ad performance across key metrics', groupBy: 'creative',
    metrics: ['spend', 'roas', 'conversions', 'ctr', 'cpm', 'cpa'], sort: 'spend', sortDir: 'desc',
    onlyFormat: 'image' },

  // ── Creative strategy ──
  { key: 'persona', title: 'Persona analysis', emoji: '👥', category: 'Creative strategy',
    description: 'Which audience personas respond best to your creatives', groupBy: 'intended_audience',
    metrics: ['spend', 'roas', 'conversions', 'ctr', 'cpa'], sort: 'roas', sortDir: 'desc' },
  { key: 'hook_analysis', title: 'Hook analysis', emoji: '🎣', category: 'Creative strategy',
    description: 'Which hook tactics capture the most attention', groupBy: 'hook_tactic',
    metrics: ['spend', 'roas', 'ctr', 'conversions', 'cpa'], sort: 'roas', sortDir: 'desc' },
  { key: 'visual_analysis', title: 'Visual format', emoji: '🎨', category: 'Creative strategy',
    description: 'Compare visual formats to learn which creative style makes your message stick', groupBy: 'visual_format',
    metrics: ['spend', 'roas', 'conversions', 'ctr', 'cpm'], sort: 'spend', sortDir: 'desc' },
  { key: 'messaging', title: 'Messaging theme analysis', emoji: '💬', category: 'Creative strategy',
    description: 'Which messaging themes resonate most with your audience', groupBy: 'messaging_theme',
    metrics: ['spend', 'roas', 'conversions', 'ctr'], sort: 'roas', sortDir: 'desc' },
  { key: 'offer_analysis', title: 'Offer analysis', emoji: '🏷️', category: 'Creative strategy',
    description: 'Which offer types drive the best return', groupBy: 'offer_type',
    metrics: ['spend', 'roas', 'conversions', 'cpa', 'ctr'], sort: 'roas', sortDir: 'desc' },
  { key: 'headline_analysis', title: 'Headline tactic analysis', emoji: '✍️', category: 'Creative strategy',
    description: 'Which headline tactics win clicks and conversions', groupBy: 'headline_tactic',
    metrics: ['spend', 'roas', 'ctr', 'conversions'], sort: 'roas', sortDir: 'desc' },

  // ── Understand performance ──
  { key: 'customer_journey', title: 'Customer journey', emoji: '🛤️', category: 'Understand performance',
    description: 'Track performance from first impression to final purchase', groupBy: 'creative',
    metrics: ['spend', 'link_click', 'view_content', 'add_to_cart', 'initiate_checkout', 'conversions'], sort: 'spend', sortDir: 'desc' },
  { key: 'ad_format', title: 'Ad format comparison', emoji: '🧩', category: 'Understand performance',
    description: 'Compare performance across images, videos, and carousels', groupBy: 'format',
    metrics: ['spend', 'roas', 'conversions', 'ctr', 'cpm', 'cpa'], sort: 'spend', sortDir: 'desc' },
  { key: 'funnel', title: 'Funnel comparison', emoji: '🔻', category: 'Understand performance',
    description: 'Compare creative performance across TOF, MOF, and BOF', groupBy: 'campaign',
    metrics: ['spend', 'roas', 'conversions', 'ctr', 'cpa'], sort: 'spend', sortDir: 'desc' },
]

export const TEMPLATE_BY_KEY: Record<string, ReportTemplate> =
  Object.fromEntries(TEMPLATES.map(t => [t.key, t]))

export const CATEGORIES: ReportCategory[] =
  ['Find winners', 'Find problems', 'Creative strategy', 'Understand performance']
