/**
 * POST /api/mello/growth-plan → the founder's road from today's revenue to their next milestone, as a
 * math-backed waterfall of levers. Reads the ACTIVE BRAND's real Meta numbers (same brand-scoped resolver
 * /api/reports and the strategist use — never the org primary) and hands them to the pure buildGrowthPlan
 * engine. READ-ONLY: computes + returns; never executes or spends.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { auditAccount } from '@/lib/meta/audit'
import { buildGrowthPlan, type PlanInput } from '@/lib/mello/growth-plan'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  const body = await req.json().catch(() => ({} as any))
  const brandId = await resolveActiveBrandId(admin, user.id, (body?.brandId as string) || null).catch(() => null)

  // rivals watched (for the TikTok recon line) — strict active-brand scope
  let rivalCount = 0
  try {
    let q = admin.from('followed_brands').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('spied', true)
    if (brandId) q = q.eq('brand_id', brandId)
    const { count } = await q; rivalCount = count || 0
  } catch { /* best-effort */ }

  // real Meta numbers from THIS brand's account
  const inp: PlanInput = {
    currency: 'USD', metaConnected: false, revenueMo: null, spendMo: null, purchases: null, clicks: null,
    cac: null, aov: null, cvr: null, rivalCount, hasShopify: false, hasKlaviyo: false,
    goal: typeof body?.goal === 'number' ? body.goal : null,
  }
  try {
    const { resolveBrandScopedAccount } = await import('@/lib/meta/scope')
    const acct = await resolveBrandScopedAccount(admin, user.id, brandId ?? null)
    const acctId = (acct as any)?.account_id ? String((acct as any).account_id) : undefined
    if (acctId) {
      const t: any = await auditAccount(admin, user.id, acctId)
      if (t && t.spend != null) {
        const purchases = Number(t.purchases) || 0
        const clicks = Number(t.clicks) || 0
        const revenue = t.revenue != null ? Number(t.revenue) : (t.avgRoas != null ? Number(t.spend) * Number(t.avgRoas) : null)
        inp.metaConnected = true
        inp.currency = t.currency || 'USD'
        inp.spendMo = Number(t.spend)
        inp.purchases = purchases
        inp.clicks = clicks
        inp.revenueMo = revenue
        inp.cac = purchases > 0 ? Number(t.spend) / purchases : null
        inp.aov = purchases > 0 && revenue != null ? revenue / purchases : null
        inp.cvr = clicks > 0 ? purchases / clicks : null
      }
    }
  } catch { /* degrade to the connect-Meta plan */ }

  try {
    const plan = buildGrowthPlan(inp)
    return NextResponse.json(plan, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'plan_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
