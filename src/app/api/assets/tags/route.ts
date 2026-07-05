/**
 * Tags on Assets (spec §10.3 clip filters). Tags live in the assets.tags text[] column, org-scoped.
 *   POST   { id, tag }        → add
 *   DELETE ?id=&tag=          → remove
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'

export const dynamic = 'force-dynamic'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  return { user, admin, org }
}

export async function POST(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, org } = c
  const { id, tag } = await request.json()
  const clean = String(tag || '').trim().slice(0, 40)
  if (!id || !clean) return NextResponse.json({ error: 'id and tag required' }, { status: 400 })

  const { data: a } = await admin.from('assets').select('tags, org_id').eq('id', id).maybeSingle()
  if (!a || a.org_id !== org.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const tags = Array.from(new Set([...(a.tags || []), clean]))
  const { error } = await admin.from('assets').update({ tags }).eq('id', id).eq('org_id', org.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tags })
}

export async function DELETE(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, org } = c
  const id = request.nextUrl.searchParams.get('id')
  const tag = request.nextUrl.searchParams.get('tag')
  if (!id || !tag) return NextResponse.json({ error: 'id and tag required' }, { status: 400 })

  const { data: a } = await admin.from('assets').select('tags, org_id').eq('id', id).maybeSingle()
  if (!a || a.org_id !== org.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const tags = (a.tags || []).filter((t: string) => t !== tag)
  const { error } = await admin.from('assets').update({ tags }).eq('id', id).eq('org_id', org.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tags })
}
