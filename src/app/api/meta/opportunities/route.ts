/**
 * GET /api/meta/opportunities?accountId=<act_id>&range=last_30d
 * The "What Mello would do" cards for the Morning Brief — SAME engine as Reports (computeOpportunities),
 * so the cards never drift. Live per account/range; read-only. Deterministic (own-account numbers).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import { resolveScopedAccount } from '@/lib/meta/scope'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { fetchLiveOpportunities } from '@/lib/meta/opportunities-fetch'
import { cacheGet, cacheSet } from '@/lib/meta/cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const RANGES = new Set(['last_3d', 'last_7d', 'last_14d', 'last_30d'])

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const range = RANGES.has(req.nextUrl.searchParams.get('range') || '') ? req.nextUrl.searchParams.get('range')! : 'last_30d'
  const accountId = req.nextUrl.searchParams.get('accountId') || undefined

  try {
    const admin = createAdminClient()
    let acct: any = null
    if (accountId) {
      const { data } = await admin.from('meta_accounts').select('*').eq('user_id', user.id).eq('account_id', accountId).eq('status', 'active').maybeSingle()
      acct = data
    }
    // Brand-scope: when a specific brand is active and no explicit account, use THAT brand's account. If the
    // brand has none, return empty — do NOT fall back to the primary account (that leaked ROY 1's moves onto
    // Hair ResQ). resolveScopedAccount's primary fallback only applies in the "All brands" view.
    if (!acct) {
      const brandId = (await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand')).catch(() => null)) || null
      if (brandId) {
        const { data: ba } = await admin.from('meta_accounts').select('*').eq('user_id', user.id).eq('status', 'active').eq('brand_id', brandId).limit(1).maybeSingle()
        if (!ba) return NextResponse.json({ opportunities: [], noAccountForBrand: true })
        acct = ba
      }
    }
    if (!acct) acct = await resolveScopedAccount(admin, user.id)
    if (!acct) return NextResponse.json({ opportunities: [] })

    // Cache (5 Graph calls) per (user, account, range) — kills the redundant re-fetch on every brief load.
    const cacheKey = `opp:${user.id}:${acct.account_id}:${range}`
    const hit = cacheGet(cacheKey)
    if (hit) return NextResponse.json(hit)

    const token = decryptToken(acct.access_token)
    const currency = acct.currency || 'USD'
    const opportunities = await fetchLiveOpportunities(token, acct.account_id, range, currency)

    const payload = { opportunities, currency, accountName: acct.account_name || null, range }
    cacheSet(cacheKey, payload, 10 * 60 * 1000)
    return NextResponse.json(payload)
  } catch (e: any) {
    return NextResponse.json({ opportunities: [], error: e?.message || 'failed' }, { status: 200 })
  }
}
