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
import { resolveBrandForAction } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { brandId?: string | null; persist?: boolean; limit?: number; exclude?: string[] } = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  try {
    const admin = createAdminClient()
    // The mission/desk is per-brand. "All brands" with 2+ brands → prompt to pick one, rather than
    // silently building a plan for the newest brand and labelling it "Your company".
    const { brandId, needsSelection } = await resolveBrandForAction(admin, user.id, body.brandId ?? null)
    if (needsSelection || !brandId) return NextResponse.json({ selectBrand: true }, { status: 200 })
    const plan = await generateStrategistPlan(admin, {
      userId: user.id,
      brandId,
      persist: body.persist === true,
      limit: body.limit,
      exclude: Array.isArray(body.exclude) ? body.exclude : undefined,
    })
    // Cache the plan on the brand so the mission desk loads INSTANTLY next time (GET below) instead of
    // re-running the whole strategist on every page view. "+ New moves" POSTs again to refresh it.
    // Don't cache "+ more" backlog fetches (they pass `exclude`) — only the primary 3-move desk plan.
    if (!(Array.isArray(body.exclude) && body.exclude.length)) {
      try {
        const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
        const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit as any : {}
        await admin.from('brands').update({ brand_kit: { ...kit, strategistPlan: { ...plan, generatedAt: new Date().toISOString() } } }).eq('id', brandId).then(() => {}, () => {})
      } catch { /* cache is best-effort */ }
    }
    return NextResponse.json(plan, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'strategist_failed', detail: String((e as Error)?.message || e).slice(0, 200) }, { status: 500 })
  }
}

// GET → the CACHED plan for the active brand (instant, no LLM). The mission desk loads this first; it only
// POSTs (regenerates) when there's no cached plan yet or the founder taps "+ New moves".
export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { brandId, needsSelection } = await resolveBrandForAction(admin, user.id)
  if (needsSelection || !brandId) return NextResponse.json({ selectBrand: true }, { status: 200 })
  const { data } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
  const kit = (data?.brand_kit && typeof data.brand_kit === 'object') ? data.brand_kit as any : {}
  const cached = kit.strategistPlan
  if (cached && Array.isArray(cached.tasks)) return NextResponse.json({ ...cached, cached: true }, { status: 200 })
  return NextResponse.json({ cached: false }, { status: 200 })
}
