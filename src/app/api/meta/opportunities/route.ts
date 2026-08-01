/**
 * GET /api/meta/opportunities?accountId=<act_id>&range=last_30d
 * The "What Mello would do" cards for the Morning Brief — SAME engine as Reports (computeOpportunities),
 * so the cards never drift. Live per account/range; read-only. Deterministic (own-account numbers).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { computeOpportunities } from '@/lib/meta/opportunities'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const V = process.env.META_API_VERSION || 'v20.0'
const RANGES = new Set(['last_3d', 'last_7d', 'last_14d', 'last_30d'])

const rev = (ins: any) => Number((ins?.action_values || []).find((a: any) => /purchase/.test(a.action_type))?.value || 0)
const conv = (ins: any) => Number((ins?.actions || []).find((a: any) => /purchase/.test(a.action_type))?.value || 0)

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const range = RANGES.has(req.nextUrl.searchParams.get('range') || '') ? req.nextUrl.searchParams.get('range')! : 'last_30d'
  const days = parseInt(range.replace('last_', '').replace('d', ''), 10) || 30
  const accountId = req.nextUrl.searchParams.get('accountId') || undefined

  try {
    const admin = createAdminClient()
    let acct: any = null
    if (accountId) {
      const { data } = await admin.from('meta_accounts').select('*').eq('user_id', user.id).eq('account_id', accountId).eq('status', 'active').maybeSingle()
      acct = data
    }
    if (!acct) acct = await resolveScopedAccount(admin, user.id)
    if (!acct) return NextResponse.json({ opportunities: [] })

    const token = decryptToken(acct.access_token)
    const adAccountId = 'act_' + acct.account_id
    const currency = acct.currency || 'USD'
    const money = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0).toLocaleString()}` } }
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

    const opportunities = computeOpportunities({
      roas: accRoas, spend: accSpend, conv: accConv, days, winners, losers,
      bestPl, worstPl, bestAge: bestAge ? { label: bestAge.label, roas: bestAge.roas } : null, bestGender,
    }, money)

    return NextResponse.json({ opportunities, currency, accountName: acct.account_name || null, range })
  } catch (e: any) {
    return NextResponse.json({ opportunities: [], error: e?.message || 'failed' }, { status: 200 })
  }
}
