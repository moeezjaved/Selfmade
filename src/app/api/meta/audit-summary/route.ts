/**
 * GET /api/meta/audit-summary?accountId=<act_id>
 * Powers the Morning Brief's Facebook Ads card + its account switcher. Grades the chosen account from
 * the already-synced DB (fast, no Graph sync) and adds today's live account-level spend. No writes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { auditAccount } from '@/lib/meta/audit'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let accountId = req.nextUrl.searchParams.get('accountId') || undefined
  const range = req.nextUrl.searchParams.get('range') || 'last_30d'
  try {
    const admin = createAdminClient()
    // Scope to the active project: explicit ?brand= wins, else the app-wide sf_brand cookie (rail switcher).
    const brandId = (await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand'))) || undefined
    // When a brand is selected and no explicit account, show THAT brand's linked ad account (the "project"
    // link). If the brand has NO account of its own, DON'T fall back to the primary — that leaked another
    // brand's ad data (Hair ResQ, no account, showed ROY 1's 6.9x ROAS + moves). Return an empty, no-account
    // summary so the card shows "connect this brand's ad account" instead.
    if (!accountId && brandId) {
      const { data: acct } = await admin.from('meta_accounts').select('account_id')
        .eq('user_id', user.id).eq('status', 'active').eq('brand_id', brandId).limit(1).maybeSingle()
      if (acct?.account_id) accountId = acct.account_id
      else return NextResponse.json({ accounts: [], noAccountForBrand: true })
    }
    const r = await auditAccount(admin, user.id, accountId, range)
    return NextResponse.json(r || { accounts: [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed', accounts: [] }, { status: 200 })
  }
}
