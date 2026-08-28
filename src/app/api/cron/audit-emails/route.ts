/**
 * GET /api/cron/audit-emails — daily sender for the audit nurture drip. Sends every queued email that is
 * DUE (send_after ≤ now), APPROVED (or auto-approved), and whose lead is still active (not converted /
 * unsubscribed). Idempotent: each email is marked 'sent' the moment it goes. Auth: CRON_SECRET or session.
 * Runs daily via vercel.json.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { buildAuditEmail, type AuditLead } from '@/lib/audit/emails'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

async function authorized(req: NextRequest): Promise<boolean> {
  const secret = req.nextUrl.searchParams.get('secret'); const auth = req.headers.get('authorization')
  const cron = process.env.CRON_SECRET
  if (!cron) return true
  if (secret === cron || auth === `Bearer ${cron}`) return true
  try { const s = await createClient(); const { data: { user } } = await s.auth.getUser(); return !!user } catch { return false }
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const cap = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 200, 500)

  // Due + approved emails, oldest first.
  const { data: due } = await admin.from('audit_emails')
    .select('id, lead_id, step, edited_subject, edited_html')
    .eq('status', 'approved').lte('send_after', new Date().toISOString())
    .order('send_after', { ascending: true }).limit(cap)
  const rows = (due || []) as { id: string; lead_id: string; step: number; edited_subject: string | null; edited_html: string | null }[]
  if (!rows.length) return NextResponse.json({ ok: true, sent: 0 })

  // Load the leads in one shot; only send for still-active leads.
  const leadIds = Array.from(new Set(rows.map((r) => r.lead_id)))
  const { data: leads } = await admin.from('audit_leads').select('*').in('id', leadIds)
  const byId = new Map<string, AuditLead & { status: string }>((leads || []).map((l: any) => [l.id, l]))

  let sent = 0, skipped = 0
  for (const r of rows) {
    const lead = byId.get(r.lead_id)
    if (!lead || lead.status !== 'active') { await admin.from('audit_emails').update({ status: 'skipped' }).eq('id', r.id); skipped++; continue }
    const built = buildAuditEmail(r.step, lead as AuditLead)
    const subject = r.edited_subject || built?.subject
    const html = r.edited_html || built?.html
    if (!subject || !html) { skipped++; continue }
    try {
      const ok = await sendEmail(lead.email, subject, html)
      if (ok) { await admin.from('audit_emails').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id); sent++ }
    } catch { /* leave it queued to retry next run */ }
  }
  return NextResponse.json({ ok: true, sent, skipped })
}
