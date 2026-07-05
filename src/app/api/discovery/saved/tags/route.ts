/**
 * Cross-cutting tags on saved ads (spec §10.2, Atria depth). Org-scoped: a tag lives on a saved-ad
 * row and is visible to the org (team boards) / the author (personal). Uses admin client + manual
 * org-scoping since the tables have RLS.
 *   POST   { saved_ad_id, tag }        → add
 *   DELETE ?saved_ad_id=&tag=          → remove
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
  const { user, admin, org } = c
  const { saved_ad_id, tag } = await request.json()
  const clean = String(tag || '').trim().slice(0, 40)
  if (!saved_ad_id || !clean) return NextResponse.json({ error: 'saved_ad_id and tag required' }, { status: 400 })

  // The saved ad must belong to this org.
  const { data: sa } = await admin.from('discovery_saved_ads').select('org_id').eq('id', saved_ad_id).maybeSingle()
  if (!sa || sa.org_id !== org.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('saved_ad_tags')
    .upsert({ org_id: org.orgId, saved_ad_id, tag: clean, created_by: user.id }, { onConflict: 'saved_ad_id,tag', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, tag: clean })
}

export async function DELETE(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { admin, org } = c
  const savedAdId = request.nextUrl.searchParams.get('saved_ad_id')
  const tag = request.nextUrl.searchParams.get('tag')
  if (!savedAdId || !tag) return NextResponse.json({ error: 'saved_ad_id and tag required' }, { status: 400 })
  const { error } = await admin.from('saved_ad_tags').delete().eq('org_id', org.orgId).eq('saved_ad_id', savedAdId).eq('tag', tag)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
