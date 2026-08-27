/**
 * POST /api/geo/reach → find real off-site discussions (Reddit now; Exa when keyed) where the brand's
 * buyers ask, and DRAFT a genuinely-helpful reply for each. Draft-only — the founder reviews + posts.
 * Metered (search + read + LLM per thread). Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { runReach } from '@/lib/geo/reach'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)
  let txId: string | null = null
  try { txId = (await reserveCredits(admin as any, user.id, 'geo_reach')).id }
  catch (e) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'Finding & drafting outreach costs credits — top up or upgrade.' }, { status: 402 })
    return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
  }
  try {
    const out = await runReach(admin as any, user.id, brandId)
    await commitCredits(admin as any, txId, { kind: 'geo_reach' }).catch(() => {})
    return NextResponse.json(out, { status: 200 })
  } catch (e) {
    if (txId) await refundCredits(admin as any, txId).catch(() => {})
    return NextResponse.json({ error: 'geo_reach_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
