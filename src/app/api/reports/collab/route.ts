/**
 * POST /api/reports/collab — invite a partner to collaborate on a SAVED report.
 * Creates a report_collaborators row (pending) and emails the partner an accept link
 * (/share-request/<token>). The partner accepts into one of their workspaces, after which the report
 * shows under "Shared with me" for their org. Degrades gracefully if migrations 092/093 aren't applied.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { sendEmail, emailShell, emailEnabled } from '@/lib/email'

export const dynamic = 'force-dynamic'
const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')
const missingTable = (e: any) => e && (e.code === '42P01' || /does not exist/i.test(e.message || ''))
const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)

  const { savedReportId, partnerEmail } = await req.json()
  const email = (partnerEmail || '').trim().toLowerCase()
  if (!savedReportId) return NextResponse.json({ error: 'Save the report first, then invite a partner.' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'A valid partner email is required.' }, { status: 400 })

  try {
    const { data: rep, error: repErr } = await admin.from('saved_reports').select('id, name, template_key, org_id').eq('id', savedReportId).single()
    if (repErr) throw repErr
    if (!rep || rep.org_id !== org.orgId) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

    const token = randomUUID().replace(/-/g, '')
    const ownerName = user.user_metadata?.full_name || org.name || 'A Selfmade user'
    const { error: insErr } = await admin.from('report_collaborators').insert({
      saved_report_id: rep.id, owner_org_id: org.orgId, owner_name: ownerName,
      partner_email: email, token, invited_by: user.id, status: 'pending',
    })
    if (insErr) throw insErr

    const link = `${APP_URL}/share-request/${token}`
    let emailed = false
    if (emailEnabled) {
      const html = emailShell({
        title: `${esc(ownerName)} has invited you to collaborate`,
        intro: `${esc(ownerName)} wants to collaborate on the <b>“${esc(rep.name)}”</b> report with you on Selfmade. Accept the invite to add it to your workspace — you'll see live performance whenever they update it.`,
        ctaText: 'Accept invitation', ctaUrl: link,
      })
      emailed = await sendEmail(email, `${ownerName} invited you to collaborate on “${rep.name}”`, html)
    }
    return NextResponse.json({ ok: true, link, emailed })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: 'Partner collaboration is rolling out — try again shortly.', pending: true }, { status: 503 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
