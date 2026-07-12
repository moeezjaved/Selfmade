/**
 * GET  /api/reports/collab/[token] — invite details for the accept page (report name, owner, status).
 * POST /api/reports/collab/[token] — accept the invite into the caller's chosen workspace (org),
 *      after which the report shows under "Shared with me" for that org.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { TEMPLATE_BY_KEY } from '@/lib/reports/templates'

export const dynamic = 'force-dynamic'
const missingTable = (e: any) => e && (e.code === '42P01' || /does not exist/i.test(e.message || ''))

async function loadInvite(admin: any, token: string) {
  const { data: collab, error } = await admin.from('report_collaborators').select('*').eq('token', token).single()
  if (error) throw error
  if (!collab) return null
  const { data: rep } = await admin.from('saved_reports').select('id, name, template_key').eq('id', collab.saved_report_id).single()
  return { collab, rep }
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const admin = createAdminClient() as any
  try {
    const inv = await loadInvite(admin, params.token)
    if (!inv || !inv.rep) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const tpl = TEMPLATE_BY_KEY[inv.rep.template_key]
    return NextResponse.json({
      reportId: inv.rep.id, reportName: inv.rep.name, emoji: tpl?.emoji || '📊',
      ownerName: inv.collab.owner_name || 'A Selfmade user', status: inv.collab.status,
    })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: 'not_found', pending: true }, { status: 404 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  try {
    const inv = await loadInvite(admin, params.token)
    if (!inv || !inv.rep) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await admin.from('report_collaborators').update({
      status: 'accepted', partner_org_id: org.orgId, accepted_at: new Date().toISOString(),
    }).eq('token', params.token)
    return NextResponse.json({ ok: true, reportId: inv.rep.id })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: 'Collaboration is rolling out — try again shortly.', pending: true }, { status: 503 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
