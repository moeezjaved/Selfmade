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
    get({ level: 'account', fields: 'spend,action_values,actions' }),
    get({ level: 'ad', fields: 'ad_name,spend,action_values,actions', limit: '50' }),
    get({ level: 'account', breakdowns: 'publisher_platform,platform_position', fields: 'spend,action_values' }),
    get({ level: 'account', breakdowns: 'age', fields: 'spend,action_values' }),
    get({ level: 'account', breakdowns: 'gender', fields: 'spend,action_values' }),
  ])

  const acc = ov?.data?.[0] || {}
  const accSpend = Number(acc.spend || 0)
  const accRoas = accSpend > 0 ? rev(acc) / accSpend : 0
  const accConv = conv(acc)

  const adRows = (adsR?.data || []).map((r: any) => { const s = Number(r.spend || 0); return { label: r.ad_name || 'ad', roas: s > 0 ? rev(r) / s : 0, spend: s, conversions: conv(r) } })
  const byRoas = adRows.filter((r: any) => r.spend > 0).sort((a: any, b: any) => b.roas - a.roas)
  const winners = byRoas.filter((r: any) => r.roas >= Math.max(1, accRoas)).slice(0, 3)
  const losers = [...byRoas].reverse().filter((r: any) => r.roas < 1 && r.spend > 0).slice(0, 3)

  const plRows = (plR?.data || []).map((r: any) => { const s = Number(r.spend || 0); return { label: `${r.publisher_platform || ''} — ${r.platform_position || ''}`.trim(), roas: s > 0 ? rev(r) / s : 0, spend: s } })
  const bestPl = [...plRows].sort((a, b) => b.roas - a.roas)[0] || null
  const worstPl = [...plRows].filter((p) => p.spend >= accSpend * 0.08).sort((a, b) => a.roas - b.roas)[0] || null

  const ages = (agR?.data || []).map((r: any) => { const s = Number(r.spend || 0); return { label: r.age || '', roas: s > 0 ? rev(r) / s : 0, revenue: rev(r) } })
  const bestAge = [...ages].sort((a, b) => b.revenue - a.revenue)[0] || null
  const genders = (geR?.data || []).map((r: any) => ({ label: r.gender || '', revenue: rev(r) }))
  const bestGender = [...genders].sort((a, b) => b.revenue - a.revenue)[0] || null

  // "Lean into <segment>" only makes sense when a segment ACTUALLY earns more. With no conversion
  // revenue (0 ROAS accounts), every bucket ties at 0 and the sort just returns the FIRST one (18-24),
  // a meaningless default that reads like a real insight. Only surface a best segment with real revenue.
  const bestAgeReal = bestAge && bestAge.revenue > 0 ? bestAge : null
  const bestGenderReal = bestGender && bestGender.revenue > 0 ? bestGender : null

  return computeOpportunities({
    roas: accRoas, spend: accSpend, conv: accConv, days, winners, losers,
    bestPl, worstPl, bestAge: bestAgeReal ? { label: bestAgeReal.label, roas: bestAgeReal.roas } : null, bestGender: bestGenderReal,
  }, money)
}
