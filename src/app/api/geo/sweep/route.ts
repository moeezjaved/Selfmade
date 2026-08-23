/**
 * POST /api/geo/sweep → run a fresh GEO visibility check: ask each available AI engine the brand's target
 * buyer questions and record who got cited. User-triggered (this is the metered cost — prompts × engines
 * LLM calls). Strict active-brand scope. Returns the fresh snapshot.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { runGeoSweep } from '@/lib/geo/monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300   // a sweep is several engine calls per prompt
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)
  try {
    const status = await runGeoSweep(admin as any, user.id, brandId)
    return NextResponse.json(status, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'geo_sweep_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
