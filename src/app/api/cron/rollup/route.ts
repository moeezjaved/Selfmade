/**
 * GET /api/cron/rollup  → runs discovery_rollup() (the nightly aggregate pass that
 * computes creative_reuse_count, brand_active_ads, performance_score/tier, niche,
 * niche_counts). Wired to a Vercel nightly cron; also callable manually for the
 * first run / on-demand refresh.
 *
 * Auth (mirrors /api/indexer): ?secret=<CRON_SECRET> | Bearer <CRON_SECRET> |
 * any authenticated Supabase user. Heavy lifting is in Postgres — this route just
 * awaits the rpc and returns its summary.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return true
  } catch { /* ignore */ }
  return false
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request)))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const started = Date.now()
  const { data, error } = await admin.rpc('discovery_rollup')
  if (error) {
    console.error('[rollup] failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ...(data || {}), duration_ms: Date.now() - started })
}
