/**
 * POST /api/mello/agents  { task: StrategistTask, brandId?: string }
 *
 * The agent router's front door: resolve a Strategist move to WHO runs it and HOW — a concrete
 * TaskSuggestion (execute via the existing POST /api/mello/tasks/run { suggestion }), an already-staged
 * task id ({ id }), a Connect CTA, or a founder brief. READ-ONLY: this endpoint never executes, bills,
 * or writes — approve-mode's second click stays with /api/mello/tasks/run.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { routeStrategistTask } from '@/lib/mello/agents'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({} as any))
  const t = b?.task
  if (!t || typeof t.title !== 'string' || typeof t.dept !== 'string') {
    return NextResponse.json({ error: 'task required' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    // explicit brandId is validated against the org's brands inside resolveActiveBrandId — never trusted raw
    const brandId = await resolveActiveBrandId(admin as any, user.id, (b?.brandId as string) || null).catch(() => null)
    const resolution = await routeStrategistTask(admin as any, { userId: user.id, brandId, task: t })
    return NextResponse.json({ resolution }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'route_failed', detail: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 })
  }
}
