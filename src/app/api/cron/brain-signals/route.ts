/**
 * Nightly proactive-signals cron — the "company teaches Selfmade by operating" loop.
 * For every user with real activity (customer conversations or watched competitors), run the
 * deterministic signal detectors (src/lib/brain/signals.ts): customer topic trends, competitor launch
 * spikes, standout-campaign learnings. Conclusions land in brain_context + learnings + brief_events,
 * so the 8AM brief opens with "what changed + why it matters" that nobody typed in.
 *
 * GET /api/cron/brain-signals  (CRON_SECRET or an authed session). Runs nightly via vercel.json.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runBrainSignals } from '@/lib/brain/signals'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (user) return true } catch { /* ignore */ }
  return false
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  // Users with signal-bearing activity: recent customer conversations OR spied competitors.
  const H14D = new Date(Date.now() - 14 * 86400000).toISOString()
  const userIds = new Set<string>()
  try {
    const { data } = await admin.from('customer_signals').select('user_id').gte('created_at', H14D).limit(3000)
    for (const r of (data || []) as any[]) userIds.add(r.user_id)
  } catch { /* best-effort */ }
  try {
    const { data } = await admin.from('followed_brands').select('user_id').eq('spied', true).limit(3000)
    for (const r of (data || []) as any[]) userIds.add(r.user_id)
  } catch { /* best-effort */ }

  const results: Record<string, any> = {}
  let processed = 0
  for (const uid of Array.from(userIds).slice(0, 100)) {   // nightly cap — plenty at current scale
    try {
      const r = await runBrainSignals(admin, uid)
      if (r.trends || r.spikes || r.learnings) results[uid] = r
      processed++
    } catch { /* one user's failure never blocks the rest */ }
  }

  return NextResponse.json({ ok: true, processed, produced: results })
}
