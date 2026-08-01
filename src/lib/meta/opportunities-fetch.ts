/**
 * Server-side fetch of "What Mello would do" for ONE account: pulls the Graph insights (overview, ad,
 * placement, age, gender) and runs computeOpportunities. Shared by the nightly audit (runMetaAudit —
 * so opportunities are computed ONCE/day and stored in the brief, zero live calls on load) and the
 * on-demand /api/meta/opportunities endpoint (refresh). One code path = the cards never drift.
 */
import { computeOpportunities, type Opportunity } from '@/lib/meta/opportunities'

const V = process.env.META_API_VERSION || 'v20.0'
const rev = (ins: any) => Number((ins?.action_values || []).find((a: any) => /purchase/.test(a.action_type))?.value || 0)
const conv = (ins: any) => Number((ins?.actions || []).find((a: any) => /purchase/.test(a.action_type))?.value || 0)

export async function fetchLiveOpportunities(token: string, accountId: string, range: string, currency: string): Promise<Opportunity[]> {
  const adAccountId = accountId.startsWith('act_') ? accountId : `act_${accountId}`
  const money = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()}` } }
  const days = parseInt(range.replace('last_', '').replace('d', ''), 10) || 30
  const get = async (params: Record<string, string>) => {
    const url = `https://graph.facebook.com/${V}/${adAccountId}/insights?` + new URLSearchParams({ ...params, date_preset: range, access_token: token })
    try { return await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json() } catch { return {} }
  }

  const [ov, adsR, plR, agR, geR] = await Promise.all([
    get({ level: 'account', fields: 'spend,action_values,actions,impressions,clicks,ctr,cpm' }),
    get({ level: 'ad', fields: 'ad_name,spend,action_values,actions,frequency,impressions,ctr', limit: '50' }),
    get({ level: 'account', breakdowns: 'publisher_platform,platform_position', fields: 'spend,action_values' }),
    get({ level: 'account', breakdowns: 'age', fields: 'spend,action_values' }),
    get({ level: 'account', breakdowns: 'gender', fields: 'spend,action_values' }),
  ])

  const acc = ov?.data?.[0] || {}
  const accSpend = Number(acc.spend || 0)
  const accRoas = accSpend > 0 ? rev(acc) / accSpend : 0
  const accConv = conv(acc)
  const accClicks = Number(acc.clicks || 0)
  const accCtr = Number(acc.ctr || 0)

  const adRows = (adsR?.data || []).map((r: any) => { const s = Number(r.spend || 0); return { label: r.ad_name || 'ad', roas: s > 0 ? rev(r) / s : 0, spend: s, conversions: conv(r), frequency: Number(r.frequency || 0) } })
  const byRoas = adRows.filter((r: any) => r.spend > 0).sort((a: any, b: any) => b.roas - a.roas)
  const winners = byRoas.filter((r: any) => r.roas >= Math.max(1, accRoas)).slice(0, 3)
  const losers = [...byRoas].reverse().filter((r: any) => r.roas < 1 && r.spend > 0).slice(0, 3)

  // Ad fatigue: the highest-spend ad your audience has seen too many times (frequency ≥ 3) is burning
  // budget on people who've already scrolled past it. A fresh creative resets that.
  const fatigue = [...adRows].filter((r: any) => r.spend > 0 && r.frequency >= 3).sort((a: any, b: any) => b.spend - a.spend)[0] || null

  const plRows = (plR?.data || []).map((r: any) => { const s = Number(r.spend || 0); return { label: `${r.publisher_platform || ''} — ${r.platform_position || ''}`.trim(), roas: s > 0 ? rev(r) / s : 0, spend: s } })
  const bestPl = [...plRows].sort((a, b) => b.roas - a.roas)[0] || null
  const worstPl = [...plRows].filter((p) => p.spend >= accSpend * 0.08).sort((a, b) => a.roas - b.roas)[0] || null

  // Best segment = highest REVENUE if the account is converting; otherwise the segment absorbing the
  // most SPEND (where the reach/budget actually concentrates — the founder's real audience). This
  // surfaces the TRUE top segment (e.g. 35-44), NOT the arbitrary first bucket (18-24) that a
  // zero-revenue tie used to return. Only skip when a segment has no spend at all (no data to read).
  const ages = (agR?.data || []).map((r: any) => { const s = Number(r.spend || 0); return { label: r.age || '', roas: s > 0 ? rev(r) / s : 0, revenue: rev(r), spend: s } })
  const bestAge = [...ages].filter((a) => a.spend > 0).sort((a, b) => (b.revenue - a.revenue) || (b.spend - a.spend))[0] || null
  const genders = (geR?.data || []).map((r: any) => { const s = Number(r.spend || 0); return { label: r.gender || '', roas: s > 0 ? rev(r) / s : 0, revenue: rev(r), spend: s } })
  const bestGender = [...genders].filter((g) => g.spend > 0).sort((a, b) => (b.revenue - a.revenue) || (b.spend - a.spend))[0] || null
  // Tell the card whether this is revenue-backed (strong) or spend-based (an early read), so the copy
  // is honest — never claim "highest-revenue" for a segment that hasn't earned yet.
  const segmentEarns = !!(bestAge && bestAge.revenue > 0)

  return computeOpportunities({
    roas: accRoas, spend: accSpend, conv: accConv, days, winners, losers,
    bestPl, worstPl, bestAge: bestAge ? { label: bestAge.label, roas: bestAge.roas } : null, bestGender, segmentEarns,
    accClicks, accCtr,
    fatigue: fatigue ? { label: fatigue.label, frequency: Math.round(fatigue.frequency * 10) / 10, spend: fatigue.spend } : null,
  }, money)
}
