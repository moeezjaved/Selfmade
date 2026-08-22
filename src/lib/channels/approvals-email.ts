/**
 * "N actions are waiting for your approval" email.
 *
 * After a user connects Meta, `runMetaAudit` deposits fix-actions into `mello_tasks` (meta_pause /
 * meta_scale / meta_audience / meta_placement). This sends ONE email listing up to 6 of those pending
 * actions with a "Review approvals →" button to /brief — the email channel for the approvals digest that
 * previously only went to Slack/WhatsApp (sendApprovalToChannels/pushNewApprovals in ./send.ts).
 *
 * Best-effort: never throws; returns false (skips) on any miss. Triggered from connect-byo right after
 * the audit runs, so the founder gets their action list moments after connecting.
 */
import { sendEmail, emailShell } from '@/lib/email'

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

const esc = (s: string): string => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

export type TaskRow = { title?: string | null; why?: string | null; evidence?: Record<string, unknown> | null }

// Pure builder — turns pending tasks into the email's subject + HTML. Separated so it's unit-testable
// without sending. Returns null when there are no tasks (nothing to send).
export function buildApprovalsDigest(tasks: TaskRow[]): { subject: string; html: string } | null {
  if (!tasks.length) return null
  const n = tasks.length
  const rows = tasks.map((t) => {
    const impact = t.evidence && typeof (t.evidence as any).impact === 'string' ? String((t.evidence as any).impact) : ''
    return `<div style="padding:12px 0;border-bottom:1px solid #eadfce;">
      <div style="font-weight:700;color:#111;font-size:15px;line-height:1.35;">${esc(t.title || 'Suggested action')}</div>
      ${t.why ? `<div style="color:#555;font-size:13px;line-height:1.5;margin-top:3px;">${esc(t.why)}</div>` : ''}
      ${impact ? `<div style="color:#0a7d4b;font-size:12.5px;font-weight:700;margin-top:4px;">${esc(impact)}</div>` : ''}
    </div>`
  }).join('')
  const subject = `${n} action${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} waiting for your approval`
  const intro = `Your agent finished its research pass on your ad account and found ${n} improvement${n === 1 ? '' : 's'}. Approve the ones you want and the agent gets to work — you approve every change before it goes live.`
  const html = emailShell({
    title: subject,
    intro: `${intro}<div style="margin-top:18px;">${rows}</div>`,
    ctaText: 'Review approvals →',
    ctaUrl: `${APP_URL}/brief`,
  })
  return { subject, html }
}

/**
 * Send the pending-approvals digest to `email` for `userId`. Pulls up to `max` (default 6) `suggested`
 * mello_tasks. Returns false if there's no email, no tasks, or the send fails. `admin` is a service-role
 * Supabase client.
 */
export async function sendApprovalsEmail(
  admin: { from: (t: string) => any },
  userId: string,
  email: string | null,
  max = 6,
): Promise<boolean> {
  try {
    if (!email) return false
    const { data } = await admin.from('mello_tasks')
      .select('title, why, evidence')
      .eq('user_id', userId).eq('status', 'suggested')
      .order('created_at', { ascending: false }).limit(max)
    const digest = buildApprovalsDigest((data || []) as TaskRow[])
    if (!digest) return false
    return await sendEmail(email, digest.subject, digest.html)
  } catch {
    return false
  }
}
