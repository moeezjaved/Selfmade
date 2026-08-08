/**
 * GET /api/cron/brain-reflect — nightly Company Brain reflection for every active founder.
 * Finds users whose memory has moved recently (new learnings or fresh customer signals) and runs the
 * shared reflection pass for each, so proposals accrue on their own instead of only when the founder
 * clicks "look for patterns". Proposals are inactive until approved — this never changes a rule silently.
 *
 * Auth mirrors the other crons (CRON_SECRET via ?secret= / Bearer, or an authed session). Best-effort,
 * time-boxed, and capped so it can't run up the model bill.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runReflection } from '@/lib/brain/reflect'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

const MAX_USERS = 40      // cap per run — one LLM call each; scale later with a per-user "last reflected" cursor
const BUDGET_MS = 250_000 // stay inside maxDuration

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = req.nextUrl.searchParams.get('secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (user) return true } catch { /* ignore */ }
  return false
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const started = Date.now()
  const sinceLearn = new Date(Date.now() - 7 * 86400000).toISOString()
  const sinceSig = new Date(Date.now() - 14 * 86400000).toISOString()

  // Users whose brain moved recently → worth re-reflecting.
  const [lnRes, sgRes] = await Promise.all([
    admin.from('learnings').select('user_id').gte('created_at', sinceLearn).limit(4000),
    admin.from('customer_signals').select('user_id').gte('created_at', sinceSig).limit(4000),
  ])
  const ids = new Set<string>()
  for (const r of ((lnRes?.data || []) as any[])) if (r.user_id) ids.add(r.user_id)
  for (const r of ((sgRes?.data || []) as any[])) if (r.user_id) ids.add(r.user_id)
  const users = Array.from(ids).slice(0, MAX_USERS)

  let processed = 0, proposed = 0
  for (const uid of users) {
    if (Date.now() - started > BUDGET_MS) break
    try {
      const res = await runReflection(admin, uid)
      processed++
      proposed += res.proposals?.length || 0
    } catch { /* per-user best effort */ }
  }

  return NextResponse.json({ ok: true, candidates: users.length, processed, proposed, ms: Date.now() - started })
}
