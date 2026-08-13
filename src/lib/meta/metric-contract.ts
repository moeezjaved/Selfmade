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
export type MetricKind = 'spend' | 'roas' | 'revenue' | 'purchases' | 'cpa'

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

/** Which single account-level metric the question asks for. null = not a single-metric ask. */
export function parseMetric(q: string): MetricKind | null {
  const t = ` ${String(q || '').toLowerCase()} `
  // "which/best/top/compare" ask for a breakdown, not one account number → let the diagnostic path handle it.
  if (/\b(which|what campaign|what ad|best|worst|top|compare|versus|\bvs\b|improve|optimi|scale up|pause|fix|what should)\b/.test(t)) return null
  if (/\bcpa\b|cost per (acquisition|purchase|order|result|conversion|sale)/.test(t)) return 'cpa'
  if (/\broas\b|return on ad spend/.test(t)) return 'roas'
  if (/\borders?\b|\bpurchases?\b|\bconversions?\b|\bsales count\b/.test(t)) return 'purchases'
  if (/\brevenue\b|\bsales\b|\bmade\b|\bearn(ed|ings)?\b|how much (did|have) we (make|made|earn)/.test(t)) return 'revenue'
  if (/\bspen[dt]\b|\bbudget\b|\bcost\b/.test(t)) return 'spend'
  return null
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

const money = (n: number, currency: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()}` } }

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
    return { reply: `Your Meta cost per purchase ${period.label} is **${money(cpa, cur)}** (${money(a.spend, cur)} ÷ ${p} attributed purchases, ${acct}).`, provenance: prov(+cpa.toFixed(2)) }
  }
  return null
}
