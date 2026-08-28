/**
 * CRO Audit API.
 *   POST { domain? } → run a fresh CRO audit (crawl + rules + LLM review). Metered (crawl + one LLM
 *                      pass) → charges cro_audit credits, refunded on failure. Caches the result on the
 *                      brand (brand_kit.croAudit) so GET is instant.
 *   GET             → the last CRO audit snapshot for the active brand.
 * Domain resolves from the request, else the active brand's website. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandForAction } from '@/lib/brand/active'
import { runCroAudit } from '@/lib/cro/audit'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'
import { isAppDomain, CONNECT_STORE_NOTE } from '@/lib/domain-guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

async function brandDomain(admin: any, userId: string, brandId: string | null): Promise<string> {
  // Prefer the connected Shopify store domain over the (often stale) brands.website signup default.
  try {
    const { resolveStore } = await import('@/lib/shopify/client')
    const store = await resolveStore(admin, userId, brandId).catch(() => null)
    if (store?.shop_domain) return String(store.shop_domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  } catch { /* fall through to brand website */ }
  if (!brandId) return ''
  const { data } = await admin.from('brands').select('brand_kit, website').eq('id', brandId).maybeSingle()
  const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
  return String(data?.website || kit.website || kit.siteName || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const { brandId, needsSelection } = await resolveBrandForAction(admin, user.id)
  if (needsSelection || !brandId) return NextResponse.json({ selectBrand: true })
  const body = await req.json().catch(() => ({} as any))
  const domain = String(body?.domain || '').trim() || await brandDomain(admin, user.id, brandId)
  if (!domain || !domain.includes('.')) return NextResponse.json({ error: 'no_domain', note: 'Connect a store or add your website first.' }, { status: 400 })
  if (isAppDomain(domain)) return NextResponse.json({ error: 'no_domain', note: CONNECT_STORE_NOTE }, { status: 400 })

  // Crawl + LLM review → charge credits (everyone). Out of credits → 402 upsell. Refunded on failure.
  let txId: string | null = null
  try {
    const tx = await reserveCredits(admin, user.id, 'cro_audit')
    txId = tx.id
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'A CRO audit costs credits — top up or upgrade to run it.' }, { status: 402 })
    return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
  }
  try {
    const audit = await runCroAudit(domain)
    if (!audit.hasData) { await refundCredits(admin, txId).catch(() => {}); return NextResponse.json(audit) }
    // Cache on the brand so GET is instant (best-effort).
    if (brandId) {
      const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
      const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
      await admin.from('brands').update({ brand_kit: { ...kit, croAudit: audit } }).eq('id', brandId).then(() => {}, () => {})
    }
    await commitCredits(admin, txId, { kind: 'cro_audit', domain }).catch(() => {})
    return NextResponse.json(audit)
  } catch (e) {
    if (txId) await refundCredits(admin, txId).catch(() => {})
    return NextResponse.json({ error: 'cro_audit_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const { brandId, needsSelection } = await resolveBrandForAction(admin, user.id)
  if (needsSelection) return NextResponse.json({ selectBrand: true })
  if (!brandId) return NextResponse.json({ hasData: false })
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit : {}
  return NextResponse.json(kit.croAudit || { hasData: false })
}
