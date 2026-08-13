/**
 * The canonical Meta metric contract. ONE deterministic place that turns a founder's question into an
 * exact (metric × period) request, so every surface (Mello chat, Brief, Slack, WhatsApp) resolves the
 * same number the same way — and so a numeric answer NEVER comes from an LLM guessing over a mislabeled
 * window. Period maps to a native Meta date_preset (Meta handles the account timezone + calendar
 * boundaries server-side); metric selects the field. buildMetricAnswer emits the answer + provenance.
 */

// Native Meta date_preset values (v20). Using presets, not custom time_range, so account-TZ + calendar
// boundaries are Meta's responsibility, not ours.
export type MetaPreset =
  | 'today' | 'yesterday' | 'this_week_mon_today' | 'last_week_mon_sun'
  | 'this_month' | 'last_month' | 'last_3d' | 'last_7d' | 'last_14d' | 'last_30d' | 'last_90d'

export type Period = { preset: MetaPreset; label: string }
export type MetricKind = 'spend' | 'roas' | 'revenue' | 'purchases' | 'cpa' | 'ctr' | 'cpc' | 'cpm' | 'impressions' | 'clicks'

export const DEFAULT_PERIOD: Period = { preset: 'last_30d', label: 'last 30 days' }

/** Parse the period named in the question → a Meta preset + a human label. null = no period named. */
export function parsePeriod(q: string): Period | null {
  const t = ` ${String(q || '').toLowerCase()} `
  if (/\byesterday\b/.test(t)) return { preset: 'yesterday', label: 'yesterday' }
  if (/\btoday\b|\bso far today\b/.test(t)) return { preset: 'today', label: 'today' }
  if (/\blast 90 days\b|\bpast 90 days\b|\b90 days\b|\blast quarter\b|\bthis quarter\b|\blast 3 months\b|\bpast 3 months\b|\bthree months\b/.test(t)) return { preset: 'last_90d', label: 'last 90 days' }
  if (/\blast 30 days\b|\bpast 30 days\b|\b30 days\b/.test(t)) return { preset: 'last_30d', label: 'last 30 days' }
  if (/\blast 14 days\b|\bpast 14 days\b|\b14 days\b|\btwo weeks\b|\bpast 2 weeks\b|\blast 2 weeks\b/.test(t)) return { preset: 'last_14d', label: 'last 14 days' }
  if (/\blast 7 days\b|\bpast 7 days\b|\blast seven days\b|\b7 days\b/.test(t)) return { preset: 'last_7d', label: 'last 7 days' }
  if (/\blast month\b|\bprevious month\b/.test(t)) return { preset: 'last_month', label: 'last month' }
  if (/\bthis month\b|\bmonth to date\b|\bmtd\b/.test(t)) return { preset: 'this_month', label: 'this month' }
  if (/\blast week\b|\bpast week\b/.test(t)) return { preset: 'last_week_mon_sun', label: 'last week' }
  if (/\bthis week\b|\bweek to date\b/.test(t)) return { preset: 'this_week_mon_today', label: 'this week' }
  return null
}

/** Detect the metric named in the text, WITHOUT the breakdown/compare guard (used by comparisons). */
function detectMetric(t: string): MetricKind | null {
  if (/\bcpm\b|cost per (thousand|mille|1000|1,000)/.test(t)) return 'cpm'
  if (/\bcpc\b|cost per click/.test(t)) return 'cpc'
  if (/\bctr\b|click.?through/.test(t)) return 'ctr'
  if (/\bcpa\b|cost per (acquisition|purchase|order|result|conversion|sale)/.test(t)) return 'cpa'
  if (/\broas\b|return on ad spend/.test(t)) return 'roas'
  if (/\bimpressions?\b/.test(t)) return 'impressions'
  if (/\bclicks?\b/.test(t)) return 'clicks'
  if (/\borders?\b|\bpurchases?\b|\bconversions?\b|\bsales count\b/.test(t)) return 'purchases'
  if (/\brevenue\b|\bsales\b|\bmade\b|\bearn(ed|ings)?\b|how much (did|have) we (make|made|earn)/.test(t)) return 'revenue'
  if (/\bspen[dt]\b|\bbudget\b|\bcost\b/.test(t)) return 'spend'
  return null
}

/** Which single account-level metric the question asks for. null = not a single-metric ask
 *  (e.g. a "which campaign / best / compare" breakdown → the diagnostic path handles it). */
export function parseMetric(q: string): MetricKind | null {
  const t = ` ${String(q || '').toLowerCase()} `
  if (/\b(which|what campaign|what ad|best|worst|top|compare|versus|\bvs\b|improve|optimi|scale up|pause|fix|what should)\b/.test(t)) return null
  return detectMetric(t)
}

export type Comparison = { metric: MetricKind; a: Period; b: Period }

/** A two-period comparison ("did we spend more this week than last week?"). Supports the week & month
 *  pairs that map cleanly to Meta presets; anything else → null (diagnostic path). */
export function parseComparison(q: string): Comparison | null {
  const t = ` ${String(q || '').toLowerCase()} `
  const isCompare = /\b(vs\.?|versus|compared? (to|with)|more than|less than|higher than|lower than|better than|worse than|than (last|previous|the previous))\b/.test(t)
  if (!isCompare) return null
  const metric = detectMetric(t) || 'spend'
  if (/\b(this month|last month|previous month|month)\b/.test(t))
    return { metric, a: { preset: 'this_month', label: 'this month' }, b: { preset: 'last_month', label: 'last month' } }
  if (/\b(this week|last week|previous week|week)\b/.test(t))
    return { metric, a: { preset: 'this_week_mon_today', label: 'this week' }, b: { preset: 'last_week_mon_sun', label: 'last week' } }
  return null   // no clean preset pair → let the diagnostic path explain
}

/** Read one metric's value off an audit snapshot. */
export function metricValue(a: any, metric: MetricKind): number {
  if (!a) return 0
  switch (metric) {
    case 'spend': return Number(a.spend || 0)
    case 'roas': return Number(a.avgRoas || 0)
    case 'revenue': return Number(a.revenue || 0)
    case 'purchases': return Number(a.purchases || 0)
    case 'cpa': return Number(a.purchases) > 0 ? Number(a.spend) / Number(a.purchases) : 0
    case 'ctr': return Number(a.ctr || 0)
    case 'cpc': return Number(a.cpc || 0)
    case 'cpm': return Number(a.cpm || 0)
    case 'impressions': return Number(a.impressions || 0)
    case 'clicks': return Number(a.clicks || 0)
  }
}

const money = (n: number, currency: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()}` } }
// Per-unit costs (CPC/CPM/CPA) need cents — rounding CPC $0.45 to "$0" is useless.
const money2 = (n: number, currency: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0) } catch { return `${(n || 0).toFixed(2)}` } }

/** Format a metric value in its natural unit. */
export function formatMetric(metric: MetricKind, value: number, currency: string): string {
  switch (metric) {
    case 'spend': case 'revenue': return money(value, currency)
    case 'cpa': case 'cpc': case 'cpm': return money2(value, currency)
    case 'roas': return `${(+value).toFixed(2)}x`
    case 'ctr': return `${(+value).toFixed(2)}%`
    case 'impressions': case 'clicks': case 'purchases': return Math.round(value).toLocaleString()
  }
}

export type MetricProvenance = {
  source: 'meta_ads_live'
  metric: MetricKind
  value: number
  currency: string
  accountId: string | null
  accountName: string | null
  preset: MetaPreset
  label: string
  fetchedAt: string
  aggregation: 'account'
}

/**
 * Deterministic answer for a single (metric × period) — the number comes straight from the canonical
 * audit snapshot, never an LLM. `a` is the auditAccount result fetched for THIS period. Returns null when
 * the needed field isn't available (e.g. no revenue), so the caller can fall back honestly.
 */
export function buildMetricAnswer(a: any, metric: MetricKind, period: Period): { reply: string; provenance: MetricProvenance } | null {
  if (!a) return null
  const cur = a.currency || 'USD'
  const prov = (value: number): MetricProvenance => ({ source: 'meta_ads_live', metric, value, currency: cur, accountId: a.selected || null, accountName: a.accountName || null, preset: period.preset, label: period.label, fetchedAt: new Date().toISOString(), aggregation: 'account' })
  const acct = a.accountName ? `${a.accountName}` : 'your account'

  if (metric === 'spend') {
    return { reply: `You spent **${money(a.spend, cur)}** on Meta ${period.label} (${acct}).`, provenance: prov(a.spend) }
  }
  if (metric === 'roas') {
    if (!a.total) return { reply: `No campaigns with spend ${period.label}, so there's no ROAS to report yet.`, provenance: prov(0) }
    return { reply: `Your Meta ROAS ${period.label} is **${a.avgRoas}x** — ${money(a.spend, cur)} spent, ${money(Number(a.revenue || 0), cur)} in Meta-attributed revenue (${acct}).`, provenance: prov(a.avgRoas) }
  }
  if (metric === 'revenue') {
    if (a.revenue == null) return null
    return { reply: `Meta attributed **${money(a.revenue, cur)}** in revenue ${period.label} on ${money(a.spend, cur)} spend (${a.avgRoas}x). That's Meta's pixel/CAPI attribution — connect Shopify for true store revenue.`, provenance: prov(a.revenue) }
  }
  if (metric === 'purchases') {
    if (a.purchases == null) return null
    const n = a.purchases
    return { reply: `Meta attributed **${n.toLocaleString()} purchase${n === 1 ? '' : 's'}** ${period.label} (${acct}). Heads up — that's Meta's own conversion attribution, not your Shopify order count; connect Shopify and I'll show true orders.`, provenance: prov(n) }
  }
  if (metric === 'cpa') {
    const p = Number(a.purchases || 0)
    if (!p) return { reply: `No Meta-attributed purchases ${period.label}, so I can't compute a cost per purchase yet.`, provenance: prov(0) }
    const cpa = a.spend / p
    return { reply: `Your Meta cost per purchase ${period.label} is **${formatMetric('cpa', cpa, cur)}** (${money(a.spend, cur)} ÷ ${p} attributed purchases, ${acct}).`, provenance: prov(+cpa.toFixed(2)) }
  }
  // Delivery metrics — straight from the canonical account totals.
  if (metric === 'impressions' || metric === 'clicks' || metric === 'ctr' || metric === 'cpc' || metric === 'cpm') {
    if (!a.total) return { reply: `No delivery ${period.label} yet — nothing served, so there's no ${metric.toUpperCase()} to report.`, provenance: prov(0) }
    const v = metricValue(a, metric)
    const NAME: Record<string, string> = { impressions: 'impressions', clicks: 'clicks', ctr: 'CTR', cpc: 'CPC', cpm: 'CPM' }
    return { reply: `Your Meta ${NAME[metric]} ${period.label} is **${formatMetric(metric, v, cur)}** (${acct}).`, provenance: prov(v) }
  }
  return null
}

/** Deterministic two-period comparison — the numbers come from the canonical audits, only the framing is
 *  words. The caller fetches an audit for each period and passes both here. */
export function buildComparisonAnswer(aA: any, aB: any, cmp: Comparison, currency: string): string {
  const va = metricValue(aA, cmp.metric)
  const vb = metricValue(aB, cmp.metric)
  const diff = va - vb
  const pct = vb !== 0 ? (diff / Math.abs(vb)) * 100 : (va > 0 ? 100 : 0)
  const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
  const NAME: Record<MetricKind, string> = { spend: 'spend', roas: 'ROAS', revenue: 'revenue', purchases: 'purchases', cpa: 'CPA', ctr: 'CTR', cpc: 'CPC', cpm: 'CPM', impressions: 'impressions', clicks: 'clicks' }
  const abs = formatMetric(cmp.metric, Math.abs(diff), currency)
  const head = `Meta ${NAME[cmp.metric]} is **${formatMetric(cmp.metric, va, currency)}** ${cmp.a.label} vs **${formatMetric(cmp.metric, vb, currency)}** ${cmp.b.label}`
  if (dir === 'flat') return `${head} — flat.`
  return `${head} — ${dir} ${abs} (${dir === 'up' ? '+' : '-'}${Math.abs(pct).toFixed(0)}%).`
}
