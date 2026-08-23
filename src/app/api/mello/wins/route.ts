/**
 * GET /api/mello/wins — the Wins Ledger scoreboard for the active brand: moves made, € projected (estimate),
 * € banked (verified), and the recent feed. Brand-scoped, read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { winsSummary, winsLifetime } from '@/lib/mello/wins'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

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
