/**
 * Reservation reconcile — the safety net for stranded credits.
 *
 * reserve_credits() debits the balance and writes a status='reserved' row up front; the API route
 * commits or refunds it when generation finishes. But if that route is KILLED mid-flight — a Vercel
 * FUNCTION_INVOCATION_TIMEOUT (504) on a slow image/video clone — neither commit nor refund runs, so
 * the reservation sits 'reserved' forever and the user silently loses the credits.
 *
 * This cron refunds any reservation older than STALE_MINUTES. refund_credits() is idempotent and only
 * touches still-'reserved' rows, so a job that actually committed/refunded is never double-handled.
 * STALE_MINUTES must exceed the longest legit synchronous job (image clone maxDuration = 300s = 5min)
 * with margin, so an in-flight generation is never refunded out from under itself.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const STALE_MINUTES = 10   // > image clone's 5-min maxDuration, so only dead reservations are swept

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
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString()

  const { data: stale, error } = await admin
    .from('credit_transactions')
    .select('id, user_id, action_type, delta')
    .eq('status', 'reserved')
    .lt('created_at', cutoff)
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let refunded = 0, credits = 0
  for (const tx of (stale || []) as any[]) {
    const { error: rErr } = await admin.rpc('refund_credits', { p_tx: tx.id })
    if (!rErr) { refunded++; credits += Math.abs(tx.delta || 0) }
  }

  // Mark killed image-clone jobs (waitUntil generation exceeded maxDuration) as failed so the
  // client poll and My Creatives stop showing them "generating" forever. STALE_MINUTES > the 5-min
  // maxDuration, so an in-flight generation is never touched.
  const { data: deadJobs } = await admin.from('creative_generations')
    .update({ status: 'failed' })
    .eq('status', 'processing').eq('media_type', 'image')
    .lt('created_at', cutoff)
    .select('id')
  return NextResponse.json({ ok: true, scanned: (stale || []).length, refunded, credits_returned: credits, failed_stale_jobs: (deadJobs || []).length, stale_minutes: STALE_MINUTES })
}
