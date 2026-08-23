/**
 * Meta ads health + alerts — the always-on account watchdog. Reads the brand's connected Meta account for a
 * recent window vs a baseline window and flags the issues that actually cost money: CPA spikes, ROAS drops,
 * CTR decay + high frequency (creative fatigue), CPM spikes, and spend-pacing runaways. These become
 * Morning-Brief alerts (the retention hook — "your CPA jumped 40% today" pulls the founder back).
 *
 * Read-only + honest: every number comes from the Graph API; no fabricated deltas. Advisory — it flags,
 * it never changes budgets or pauses ads on its own.
 */
import { decryptToken } from '@/lib/meta/client'
import { resolveBrandScopedAccount } from '@/lib/meta/scope'

const V = process.env.META_API_VERSION || 'v20.0'
const G = `https://graph.facebook.com/${V}`

async function graph(path: string, token: string): Promise<any> {
  const r = await fetch(`${G}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(30000) })
  const j = await r.json().catch(() => ({}))
  if (j.error) throw new Error(j.error.message || 'Meta API error')
  return j
}

const PURCHASE = /purchase/i
function sumAction(arr: any[] | undefined): number {
  if (!Array.isArray(arr)) return 0
  return arr.filter((a) => PURCHASE.test(a.action_type)).reduce((s, a) => s + Number(a.value || 0), 0)
}

export type Window = {
  days: number; spend: number; impressions: number; clicks: number
  ctr: number; cpm: number; cpc: number; purchases: number; revenue: number
  roas: number; cpa: number; cvr: number; frequency: number | null
}

const PRESET_DAYS: Record<string, number> = { last_7d: 7, last_14d: 14, last_30d: 30 }

async function windowInsights(token: string, actId: string, preset: string): Promise<Window | null> {
  const ins = (await graph(`${actId}/insights?fields=spend,impressions,clicks,ctr,cpm,cpc,actions,action_values,purchase_roas,frequency&date_preset=${preset}&level=account`, token)).data?.[0]
  if (!ins) return null
  const spend = Number(ins.spend || 0)
  const purchases = sumAction(ins.actions)
  const revenue = sumAction(ins.action_values)
  const clicks = Number(ins.clicks || 0)
  const roas = Array.isArray(ins.purchase_roas) && ins.purchase_roas[0]?.value != null ? Number(ins.purchase_roas[0].value) : (spend > 0 ? revenue / spend : 0)
  return {
    days: PRESET_DAYS[preset] || 30,
    spend, impressions: Number(ins.impressions || 0), clicks,
    ctr: Number(ins.ctr || 0), cpm: Number(ins.cpm || 0), cpc: Number(ins.cpc || 0),
    purchases, revenue, roas, cpa: purchases > 0 ? spend / purchases : 0, cvr: clicks > 0 ? purchases / clicks : 0,
    frequency: ins.frequency != null ? Number(ins.frequency) : null,
  }
}

export type AdSeverity = 'high' | 'med'
export type AdIssue = {
  kind: 'cpa_spike' | 'roas_drop' | 'creative_fatigue' | 'cpm_spike' | 'spend_pacing' | 'ctr_drop'
  severity: AdSeverity; title: string; body: string
  metric?: string; current?: number; baseline?: number; deltaPct?: number
}

const pct = (cur: number, base: number) => (base > 0 ? Math.round(((cur - base) / base) * 100) : 0)
const money = (n: number) => Math.round(n)

/**
 * Compare the recent 7-day window against the 30-day baseline and surface the issues that matter.
 * Thresholds are deliberately conservative so alerts stay meaningful (no crying wolf).
 */
export function diagnoseAds(recent: Window, base: Window): AdIssue[] {
  const issues: AdIssue[] = []
  const recentDailySpend = recent.spend / recent.days
  const baseDailySpend = base.spend / base.days

  // CPA spike — the money alarm.
  if (base.cpa > 0 && recent.cpa > 0 && recent.cpa >= base.cpa * 1.35 && recent.purchases >= 3) {
    const d = pct(recent.cpa, base.cpa)
    issues.push({ kind: 'cpa_spike', severity: d >= 60 ? 'high' : 'med', metric: 'CPA', current: recent.cpa, baseline: base.cpa, deltaPct: d,
      title: `Your cost per purchase jumped ${d}%.`, body: `CPA is ${money(recent.cpa)} this week vs ${money(base.cpa)} baseline. Something's dragging efficiency — check for a fatiguing ad or a broken landing step.` })
  }
  // ROAS drop.
  if (base.roas > 0 && recent.roas > 0 && recent.roas <= base.roas * 0.7 && recent.spend >= baseDailySpend * 3) {
    const d = pct(recent.roas, base.roas)
    issues.push({ kind: 'roas_drop', severity: d <= -40 ? 'high' : 'med', metric: 'ROAS', current: recent.roas, baseline: base.roas, deltaPct: d,
      title: `ROAS slipped to ${recent.roas.toFixed(1)}x.`, body: `Down from ${base.roas.toFixed(1)}x baseline. Return on spend is softening — likely creative fatigue or audience saturation.` })
  }
  // Creative fatigue — high frequency + falling CTR.
  const freq = recent.frequency ?? 0
  if ((freq >= 2.6) || (base.ctr > 0 && recent.ctr > 0 && recent.ctr <= base.ctr * 0.75)) {
    const ctrD = base.ctr > 0 ? pct(recent.ctr, base.ctr) : 0
    issues.push({ kind: 'creative_fatigue', severity: freq >= 3.2 || ctrD <= -35 ? 'high' : 'med', metric: 'frequency', current: freq || recent.ctr,
      title: freq >= 2.6 ? `Audience is seeing your ads ${freq.toFixed(1)}× — fatigue risk.` : `Click-through is decaying (${ctrD}%).`,
      body: `Frequency ${freq ? freq.toFixed(1) + '×' : 'n/a'}${base.ctr ? `, CTR ${recent.ctr.toFixed(2)}% vs ${base.ctr.toFixed(2)}% baseline` : ''}. Refresh the creative — new hook, same winning angle.` })
  }
  // CPM spike — you're paying more to reach the same people.
  if (base.cpm > 0 && recent.cpm >= base.cpm * 1.4) {
    const d = pct(recent.cpm, base.cpm)
    issues.push({ kind: 'cpm_spike', severity: d >= 70 ? 'high' : 'med', metric: 'CPM', current: recent.cpm, baseline: base.cpm, deltaPct: d,
      title: `CPM is up ${d}% — reach got pricier.`, body: `CPM is ${money(recent.cpm)} vs ${money(base.cpm)} baseline. Auction pressure or a narrowing audience; broaden targeting or refresh creative to reset delivery.` })
  }
  // Spend pacing — a runaway day.
  if (baseDailySpend > 0 && recentDailySpend >= baseDailySpend * 1.6 && recent.spend >= 50) {
    const d = pct(recentDailySpend, baseDailySpend)
    issues.push({ kind: 'spend_pacing', severity: d >= 100 ? 'high' : 'med', metric: 'daily spend', current: recentDailySpend, baseline: baseDailySpend, deltaPct: d,
      title: `Daily spend is pacing ${d}% hotter.`, body: `~${money(recentDailySpend)}/day this week vs ~${money(baseDailySpend)}/day baseline. Make sure the extra spend is on a winner, not a fatiguing set.` })
  }
  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
}

export type AdsHealth = {
  connected: boolean
  account?: { id: string; currency?: string }
  recent?: Window; baseline?: Window
  issues: AdIssue[]
}

/** Full health read for a brand's connected Meta account. */
export async function checkAdsHealth(admin: any, userId: string, brandId: string | null): Promise<AdsHealth> {
  const acct = await resolveBrandScopedAccount(admin, userId, brandId ?? null).catch(() => null)
  if (!acct?.account_id || !acct?.access_token) return { connected: false, issues: [] }
  const token = decryptToken(acct.access_token)
  const actId = `act_${acct.account_id}`
  try {
    const [recent, base] = await Promise.all([
      windowInsights(token, actId, 'last_7d'),
      windowInsights(token, actId, 'last_30d'),
    ])
    if (!recent || !base || recent.spend === 0) return { connected: true, account: { id: String(acct.account_id), currency: acct.currency }, recent: recent || undefined, baseline: base || undefined, issues: [] }
    return { connected: true, account: { id: String(acct.account_id), currency: acct.currency }, recent, baseline: base, issues: diagnoseAds(recent, base) }
  } catch {
    return { connected: true, account: { id: String(acct.account_id) }, issues: [] }
  }
}
