/**
 * Admin — preview / edit / approve the audit nurture drip before it sends.
 *   GET                      → recent leads + their queued emails (+ autosend flag)
 *   GET ?preview=<emailId>   → the fully-rendered { subject, html } for that email
 *   POST { action, ... }     → approve | skip | send | edit | approve_all | toggle_autosend
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isAdminToken } from '@/lib/admin/auth'
import { sendEmail } from '@/lib/email'
import { buildAuditEmail, type AuditLead } from '@/lib/audit/emails'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function guard(): Promise<boolean> {
  try { const { data: { user } } = await (await createClient()).auth.getUser(); if (user) return true } catch { /* ignore */ }
  return isAdminToken()
}

export async function GET(req: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  // Render one email for preview.
  const previewId = req.nextUrl.searchParams.get('preview')
  if (previewId) {
    const { data: em } = await admin.from('audit_emails').select('*').eq('id', previewId).maybeSingle()
    if (!em) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const { data: lead } = await admin.from('audit_leads').select('*').eq('id', em.lead_id).maybeSingle()
    const built = buildAuditEmail(em.step, lead as AuditLead)
    return NextResponse.json({ subject: em.edited_subject || built?.subject || em.subject, html: em.edited_html || built?.html || '' })
  }

  const { data: leads } = await admin.from('audit_leads').select('*').order('created_at', { ascending: false }).limit(100)
  const ids = (leads || []).map((l: any) => l.id)
  const { data: emails } = ids.length ? await admin.from('audit_emails').select('id, lead_id, step, subject, status, send_after, sent_at').in('lead_id', ids).order('step', { ascending: true }) : { data: [] }
  const byLead = new Map<string, any[]>()
  for (const e of (emails || []) as any[]) { const a = byLead.get(e.lead_id) || []; a.push(e); byLead.set(e.lead_id, a) }
  const { data: flag } = await admin.from('system_flags').select('value').eq('key', 'audit_email_autosend').maybeSingle()

  return NextResponse.json({
    autosend: String(flag?.value).toLowerCase() === 'true',
    leads: (leads || []).map((l: any) => ({
      id: l.id, email: l.email, domain: l.domain, brand_name: l.brand_name, status: l.status,
      created_at: l.created_at, revenueLostPerYear: l.report?.revenueLostPerYear ?? null, currency: l.report?.currency || '$',
      adCount: (l.ad_urls || []).length, emails: byLead.get(l.id) || [],
    })),
  })
}

export async function POST(req: NextRequest) {
  if (!(await guard())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const body = await req.json().catch(() => ({} as any))
  const action = body?.action

  if (action === 'toggle_autosend') {
    await admin.from('system_flags').upsert({ key: 'audit_email_autosend', value: body.on ? 'true' : 'false' }, { onConflict: 'key' })
    return NextResponse.json({ ok: true })
  }
  if (action === 'edit') {
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await admin.from('audit_emails').update({ edited_subject: body.subject ?? null, edited_html: body.html ?? null }).eq('id', body.id)
    return NextResponse.json({ ok: true })
  }
  if (action === 'approve' || action === 'skip') {
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await admin.from('audit_emails').update({ status: action === 'approve' ? 'approved' : 'skipped' }).eq('id', body.id).eq('status', action === 'approve' ? 'pending' : body.from || 'pending')
    return NextResponse.json({ ok: true })
  }
  if (action === 'approve_all') {
    let q = admin.from('audit_emails').update({ status: 'approved' }).eq('status', 'pending')
    if (body.leadId) q = q.eq('lead_id', body.leadId)
    await q
    return NextResponse.json({ ok: true })
  }
  if (action === 'send') {
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const { data: em } = await admin.from('audit_emails').select('*').eq('id', body.id).maybeSingle()
    if (!em) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const { data: lead } = await admin.from('audit_leads').select('*').eq('id', em.lead_id).maybeSingle()
    if (!lead || lead.status !== 'active') return NextResponse.json({ error: 'lead_inactive' }, { status: 400 })
    const built = buildAuditEmail(em.step, lead as AuditLead)
    const subject = em.edited_subject || built?.subject, html = em.edited_html || built?.html
    if (!subject || !html) return NextResponse.json({ error: 'no_content' }, { status: 400 })
    const ok = await sendEmail(lead.email, subject, html)
    if (ok) await admin.from('audit_emails').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', em.id)
    return NextResponse.json({ ok })
  }
  return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
}
