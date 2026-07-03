/**
 * Monthly credit reset + top-up expiry (spec §2.5). Runs every due wallet through ensure_monthly_reset
 * (plan bucket → allotment, no rollover; expire top-ups > 12mo). Protect with CRON_SECRET.
 * Schedule daily (Vercel Cron or the droplet). GET|POST /api/cron/credit-reset?secret=...
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || req.headers.get('x-cron-secret')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('run_due_resets')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, reset: data ?? 0 })
}

export const GET = run
export const POST = run
