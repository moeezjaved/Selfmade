/**
 * Saved reports CRUD — org-scoped like boards (admin client + manual org filter).
 * A saved report = { name, template_key, config } that pins to the sidebar.
 * Degrades gracefully if migration 092 hasn't been applied yet (table missing → empty list).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg, canManage } from '@/lib/org'

export const dynamic = 'force-dynamic'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  return { user, admin, org }
}

const missingTable = (e: any) => e && (e.code === '42P01' || /does not exist/i.test(e.message || ''))

// GET — team reports in my org + my personal ones.
export async function GET() {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const { data, error } = await admin
    .from('saved_reports').select('*')
    .eq('org_id', org.orgId)
    .or(`visibility.eq.team,created_by.eq.${user.id}`)
    .order('created_at', { ascending: false })
  if (error) {
    if (missingTable(error)) return NextResponse.json({ reports: [], pending: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ reports: data || [] })
}

// POST — create (or update when id supplied) a saved report.
export async function POST(req: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const body = await req.json()
  const name = (body.name || '').trim().slice(0, 120) || 'Untitled report'
  const templateKey = body.templateKey || body.template_key
  if (!templateKey) return NextResponse.json({ error: 'template required' }, { status: 400 })
  const row = {
    org_id: org.orgId, created_by: user.id, name, template_key: templateKey,
    config: body.config || {}, platform: body.platform || 'meta',
    visibility: body.visibility === 'team' ? 'team' : 'personal', updated_at: new Date().toISOString(),
  }
  try {
    if (body.id) {
      const { data, error } = await admin.from('saved_reports').update(row).eq('id', body.id).eq('org_id', org.orgId).select().single()
      if (error) throw error
      return NextResponse.json({ report: data })
    }
    const { data, error } = await admin.from('saved_reports').insert(row).select().single()
    if (error) throw error
    return NextResponse.json({ report: data })
  } catch (e: any) {
    if (missingTable(e)) return NextResponse.json({ error: 'Saved reports are rolling out — try again shortly.', pending: true }, { status: 503 })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE ?id= — author or an org admin can remove.
export async function DELETE(req: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: rep } = await admin.from('saved_reports').select('created_by').eq('id', id).eq('org_id', org.orgId).single()
  if (!rep) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (rep.created_by !== user.id && !canManage(org.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { error } = await admin.from('saved_reports').delete().eq('id', id).eq('org_id', org.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
