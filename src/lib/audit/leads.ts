/**
 * Audit lead lifecycle: capture a lead, queue the 8-email drip, send email #1 instantly, and stop the drip
 * when they sign up or unsubscribe. The cron (/api/cron/audit-emails) sends the rest once due + approved.
 */
import { sendEmail } from '@/lib/email'
import { AUDIT_SEQUENCE, buildAuditEmail, type AuditLead } from '@/lib/audit/emails'

type Admin = ReturnType<typeof import('@/lib/supabase/server')['createAdminClient']> | any

export type LeadInput = {
  email: string
  domain?: string | null
  brandName?: string | null
  report?: AuditLead['report']
  adUrls?: string[]
}

/** Is admin approval required before #2–#8 send? Default YES (founder previews each). A system flag can
 *  flip the whole drip to auto-send once the founder trusts the templates. */
async function autoSend(admin: Admin): Promise<boolean> {
  try {
    const { data } = await admin.from('system_flags').select('value').eq('key', 'audit_email_autosend').maybeSingle()
    return String(data?.value).toLowerCase() === 'true'
  } catch { return false }
}

/** Capture (or refresh) a lead, queue the drip, and send email #1 now. Returns the lead row. Idempotent on
 *  (email, domain): re-running the audit updates the report/ads and (re)sends #1 only if it hasn't gone. */
export async function captureAuditLead(admin: Admin, input: LeadInput): Promise<{ ok: boolean; leadId?: string }> {
  const email = (input.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return { ok: false }
  const domain = (input.domain || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim() || null

  const { data: lead, error } = await admin.from('audit_leads').upsert({
    email, domain, brand_name: input.brandName || null, report: input.report || null,
    ad_urls: input.adUrls || [], status: 'active', updated_at: new Date().toISOString(),
  }, { onConflict: 'email,domain' }).select('*').maybeSingle()
  if (error || !lead) return { ok: false }

  const auto = await autoSend(admin)
  const now = Date.now()
  // Queue every step (idempotent via unique(lead_id, step)). #1 is 'approved' + due-now so that if the
  // instant send below FAILS, the daily cron still delivers it — we only flip it to 'sent' once the send
  // actually succeeds (previously #1 was pre-marked 'sent', so a failed send was never retried = no email).
  const rows = AUDIT_SEQUENCE.map((s) => ({
    lead_id: lead.id, step: s.step,
    subject: buildAuditEmail(s.step, lead as AuditLead)?.subject || `Your ${input.brandName || 'store'} audit`,
    status: s.step === 1 ? 'approved' : (auto ? 'approved' : 'pending'),
    send_after: new Date(now + s.dayOffset * 86400000).toISOString(),
    sent_at: null,
  }))
  await admin.from('audit_emails').upsert(rows, { onConflict: 'lead_id,step', ignoreDuplicates: true }).then(() => {}, () => {})

  // Send #1 instantly; flip to 'sent' ONLY on a confirmed send. If it fails, it stays 'approved' + due, so
  // the cron retries it. Guard against double-send: skip if #1 is already 'sent' (e.g. an audit re-run).
  try {
    const { data: cur } = await admin.from('audit_emails').select('status').eq('lead_id', lead.id).eq('step', 1).maybeSingle()
    if (cur?.status !== 'sent') {
      const built = buildAuditEmail(1, lead as AuditLead)
      if (built && await sendEmail(email, built.subject, built.html)) {
        await admin.from('audit_emails').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('lead_id', lead.id).eq('step', 1).then(() => {}, () => {})
      }
    }
  } catch { /* leave #1 'approved' + due → the cron delivers it */ }

  return { ok: true, leadId: lead.id }
}

/** They signed up → stop the drip (mark lead converted, skip any un-sent emails). Match by email. */
export async function convertAuditLeads(admin: Admin, email: string, userId: string): Promise<void> {
  const e = (email || '').trim().toLowerCase()
  if (!e) return
  try {
    const { data: leads } = await admin.from('audit_leads').select('id').eq('email', e).eq('status', 'active')
    const ids = (leads || []).map((l: any) => l.id)
    if (!ids.length) return
    await admin.from('audit_leads').update({ status: 'converted', converted_user_id: userId }).in('id', ids)
    await admin.from('audit_emails').update({ status: 'skipped' }).in('lead_id', ids).in('status', ['pending', 'approved'])
  } catch { /* best-effort */ }
}

/** Unsubscribe by token → stop the drip. */
export async function unsubscribeAuditLead(admin: Admin, token: string): Promise<boolean> {
  const t = (token || '').trim()
  if (!t) return false
  try {
    const { data: lead } = await admin.from('audit_leads').update({ status: 'unsubscribed' }).eq('unsub_token', t).select('id').maybeSingle()
    if (!lead) return false
    await admin.from('audit_emails').update({ status: 'skipped' }).eq('lead_id', lead.id).in('status', ['pending', 'approved'])
    return true
  } catch { return false }
}
