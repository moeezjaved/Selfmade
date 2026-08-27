/**
 * POST /api/geo/build  { kind: 'llms_txt' | 'schema' | 'fact_sheet' } → generate a crawlability/entity
 * asset (Phase C) as a draft in geo_assets. Copy-to-apply now; auto-apply to Shopify later. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { buildCrawlAsset, type CrawlKind } from '@/lib/geo/crawlability'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

const KINDS: CrawlKind[] = ['llms_txt', 'schema', 'fact_sheet']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const kind = body?.kind as CrawlKind
  if (!KINDS.includes(kind)) return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)
  let txId: string | null = null
  try { txId = (await reserveCredits(admin as any, user.id, 'geo_build')).id }
  catch (e) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'Building a GEO asset costs credits — top up or upgrade.' }, { status: 402 })
    return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
  }
  try {
    const asset = await buildCrawlAsset(admin as any, user.id, brandId, kind)
    await commitCredits(admin as any, txId, { kind: 'geo_build', assetKind: kind }).catch(() => {})
    return NextResponse.json({ asset }, { status: 200 })
  } catch (e) {
    if (txId) await refundCredits(admin as any, txId).catch(() => {})
    return NextResponse.json({ error: 'geo_build_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
