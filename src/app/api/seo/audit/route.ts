/**
 * POST /api/seo/audit → crawl the brand's site + report technical SEO issues (SEO Phase 1). Metered (a few
 * page fetches). GET → the latest audit snapshot (cheap). Brand-scoped, read-only beyond storing the audit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandForAction } from '@/lib/brand/active'
import { runSeoAudit, loadSeoAudit } from '@/lib/seo/crawl-audit'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const { brandId, needsSelection } = await resolveBrandForAction(admin as any, user.id, (body?.brandId as string) || null)
  if (needsSelection || !brandId) return NextResponse.json({ selectBrand: true }, { status: 200 })
  // Crawl + LLM analysis → charge credits (everyone). Out of credits → 402 upsell. Refunded on failure.
  let txId: string | null = null
  try {
    const tx = await reserveCredits(admin as any, user.id, 'seo_audit')
    txId = tx.id
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'An SEO audit costs credits — top up or upgrade to run it.' }, { status: 402 })
    return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
  }
  try {
    const audit = await runSeoAudit(admin as any, user.id, brandId)
    await commitCredits(admin as any, txId, { kind: 'seo_audit' }).catch(() => {})
    return NextResponse.json(audit, { status: 200 })
  } catch (e) {
    if (txId) await refundCredits(admin as any, txId).catch(() => {})
    return NextResponse.json({ error: 'seo_audit_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { brandId, needsSelection } = await resolveBrandForAction(admin as any, user.id)
  if (needsSelection || !brandId) return NextResponse.json({ selectBrand: true }, { status: 200 })
  try {
    const audit = await loadSeoAudit(admin as any, user.id, brandId)
    return NextResponse.json(audit, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'seo_audit_load_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
