/**
 * GET /api/mello/wins — the Wins Ledger scoreboard for the active brand: moves made, € projected (estimate),
 * € banked (verified), and the recent feed. Brand-scoped, read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { winsSummary, winsLifetime } from '@/lib/mello/wins'
import { runProofLoop } from '@/lib/mello/proof'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days')) || 30, 7), 365)
  const [summary, lifetime] = await Promise.all([
    winsSummary(admin, user.id, brandId, days),
    winsLifetime(admin, user.id, brandId),
  ])
  return NextResponse.json({ summary, lifetime })
}

/** POST { action:'verify' } — run the proof loop now: bank the real organic lift against the ledger. */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const body = await req.json().catch(() => ({}))
  if (body.action !== 'verify') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  const res = await runProofLoop(admin, user.id, brandId)
  return NextResponse.json({ ok: true, ...res })
}
