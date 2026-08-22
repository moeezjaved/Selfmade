/**
 * POST /api/mello/strategist  → Mello's "best-founder brain" generates the next high-impact tasks.
 *
 * Body: { brandId?: string, persist?: boolean, limit?: number }
 * Returns a StrategistPlan: { stage, headline, tasks[], grounding[] }.
 *
 * ADDITIVE + SAFE: only ever generates/writes SUGGESTED tasks. Never executes, never touches billing/Meta
 * (runTask still gates real actions). Authed to the logged-in founder; scoped to the active brand.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateStrategistPlan } from '@/lib/mello/strategist'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { brandId?: string | null; persist?: boolean; limit?: number } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  try {
    const admin = createAdminClient()
    const plan = await generateStrategistPlan(admin, {
      userId: user.id,
      brandId: body.brandId ?? null,
      persist: body.persist === true,
      limit: body.limit,
    })
    return NextResponse.json(plan, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'strategist_failed', detail: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 })
  }
}
