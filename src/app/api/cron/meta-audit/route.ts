/**
 * Nightly Meta audit — the Company Brain's heartbeat for connected ad accounts. For every user with
 * an active meta_account: sync campaigns + insights into the Brain, run the M4 grading, deposit the
 * audit into tomorrow's Morning Brief + one-click action suggestions (approve→act via mello_tasks).
 * Dead tokens are surfaced to the founder (brief_events meta_health) instead of rotting silently.
 * Auth: CRON_SECRET header/param, same pattern as reconcile-reservations.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { runMetaAudit } from '@/lib/meta/audit'
import { pushNewApprovals } from '@/lib/channels/send'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const h = req.headers.get('authorization') || ''
  return h === `Bearer ${secret}` || req.nextUrl.searchParams.get('secret') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  // Distinct users with active connections (bounded — plenty until scale demands batching).
  const { data: accounts } = await admin.from('meta_accounts').select('user_id').eq('status', 'active').limit(500)
  const users = Array.from(new Set<string>((accounts || []).map((a: any) => String(a.user_id))))

  let audited = 0, skipped = 0
  for (const uid of users) {
    try {
      const r = await runMetaAudit(admin, uid, { syncFirst: true })
      if (r) audited++
      else skipped++
      // Auto-push: any fresh approval the audit just suggested lands in the founder's Slack/WhatsApp
      // on its own (deduped; no-op if no channel linked). Best-effort — never fails the audit.
      await pushNewApprovals(admin, uid).catch(() => {})
    } catch { skipped++ }
  }
  return NextResponse.json({ ok: true, users: users.length, audited, skipped })
}
