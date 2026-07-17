/**
 * Abandoned-onboarding nudge — once/day, email users who signed up 1–3 days ago but never made an ad.
 * Idempotent via an activity_logs ONBOARDING_NUDGE row so each person is nudged at most once.
 *
 * GET /api/cron/onboarding-nudge  (CRON_SECRET or an authed session).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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
  const admin = createAdminClient() as any

  const now = Date.now()
  const from = new Date(now - 72 * 3600_000).toISOString()  // signed up ≤ 3 days ago
  const to = new Date(now - 24 * 3600_000).toISOString()    // …but ≥ 1 day ago (give them a day first)

  // Candidates: profiles created in the window.
  const { data: profs } = await admin.from('user_profiles')
    .select('user_id, full_name, created_at').gte('created_at', from).lte('created_at', to).limit(500)
  const ids: string[] = (profs || []).map((p: any) => p.user_id)
  if (!ids.length) return NextResponse.json({ ok: true, nudged: 0, candidates: 0 })

  // Exclude anyone who already made a creative, or was already nudged.
  const [{ data: made }, { data: nudged }] = await Promise.all([
    admin.from('creative_generations').select('user_id').in('user_id', ids),
    admin.from('activity_logs').select('user_id').eq('action_type', 'ONBOARDING_NUDGE').in('user_id', ids),
  ])
  const skip = new Set<string>([...(made || []).map((r: any) => r.user_id), ...(nudged || []).map((r: any) => r.user_id)])
  const targets = (profs || []).filter((p: any) => !skip.has(p.user_id))

  const { sendOnboardingNudgeEmail } = await import('@/lib/email')
  let sent = 0
  for (const p of targets) {
    try {
      const { data: u } = await admin.auth.admin.getUserById(p.user_id)
      const email = (u as any)?.user?.email
      if (!email) continue
      // Claim first (so a mid-run crash can't double-send), then send.
      await admin.from('activity_logs').insert({ user_id: p.user_id, action_type: 'ONBOARDING_NUDGE', entity_type: 'account', description: 'onboarding nudge sent', performed_by: 'system' })
      if (await sendOnboardingNudgeEmail(email, p.full_name || '')) sent++
    } catch { /* skip this one */ }
  }
  return NextResponse.json({ ok: true, candidates: ids.length, targeted: targets.length, nudged: sent })
}
