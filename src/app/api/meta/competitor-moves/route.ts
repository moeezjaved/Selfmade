import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { cacheGet, cacheSet } from '@/lib/meta/cache'
import { getCompetitorWinners, type CompetitorWinner } from '@/lib/meta/competitor-winners'
import { resolveActiveBrandId } from '@/lib/brand/active'

/**
 * Competitor moves — "your rivals' winning ad right now", ranked by the public-signal proxy. The scoring
 * + fetch live in @/lib/meta/competitor-winners (shared with the Creative Strategist). This route just
 * rotates the hero by day and caches. ZERO Graph calls — pure DB, off the Meta rate budget.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type Move = CompetitorWinner

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const brandId = (await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand'))) || undefined
  const cacheKey = `competitor-moves:${user.id}:${brandId || 'all'}`
  const cached = cacheGet<{ moves: Move[] }>(cacheKey)
  if (cached && !req.nextUrl.searchParams.get('refresh')) return NextResponse.json(cached)

  const distinct = await getCompetitorWinners(admin, user.id, { poolSize: 8, brandId })
  if (!distinct.length) return NextResponse.json({ moves: [] })

  // Rotate the pool by the day so the hero isn't the SAME longest-running ad (e.g. Leesa's 814-day
  // mattress) every single day — "winning ad right now" should feel alive. Score still gates who's in
  // the pool; the day decides who leads. Stable within a day (matches the 30-min cache), fresh daily.
  const dayIndex = Math.floor(Date.now() / 86_400_000)
  const offset = distinct.length ? dayIndex % distinct.length : 0
  const moves = [...distinct.slice(offset), ...distinct.slice(0, offset)].slice(0, 3)

  const payload = { moves }
  // Pure-DB (no Graph rate budget), so a short TTL is fine — and REQUIRED: this cache is in-process
  // per instance, so removing all spies must expire fast rather than showing ghost rivals for 30 min.
  cacheSet(cacheKey, payload, 60 * 1000)
  return NextResponse.json(payload)
}
