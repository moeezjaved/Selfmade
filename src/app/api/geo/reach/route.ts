/**
 * POST /api/geo/reach → find real off-site discussions (Reddit now; Exa when keyed) where the brand's
 * buyers ask, and DRAFT a genuinely-helpful reply for each. Draft-only — the founder reviews + posts.
 * Metered (search + read + LLM per thread). Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { runReach } from '@/lib/geo/reach'

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
  try {
    const out = await runReach(admin as any, user.id, brandId)
    return NextResponse.json(out, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'geo_reach_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
