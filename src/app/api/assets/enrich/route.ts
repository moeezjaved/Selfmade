/**
 * Enrich one asset — caption + embedding for semantic search (spec §10.3, step 5). Called by the
 * client right after confirm so the upload UX isn't blocked; the asset shows 'processing' until done.
 * Idempotent + safe to retry. POST { id }.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { enrichAsset } from '@/lib/assets/enrich'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  const { data: a } = await admin.from('assets').select('id, org_id, file_url, mime, file_type, file_name').eq('id', id).maybeSingle()
  if (!a || a.org_id !== org.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { ai_caption, embedding } = await enrichAsset(a)
  await admin.from('assets').update({ ai_caption, embedding, status: 'ready' }).eq('id', id).eq('org_id', org.orgId)
  return NextResponse.json({ ok: true, captioned: !!ai_caption, embedded: !!embedding })
}
