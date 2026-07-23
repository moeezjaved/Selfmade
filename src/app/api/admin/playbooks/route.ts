/**
 * ADMIN · Playbooks CRUD — GET list (with ad counts + cover thumbs), POST create,
 * PATCH update, DELETE remove. Gated by the admin_token cookie (same login as the
 * /admin panel). Curation itself lives in ./ads and ./aifill.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminToken } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

const slugify = (s: string) => s.toLowerCase().replace(/playbook/gi, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'playbook'

export async function GET() {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const { data: books } = await admin.from('playbooks').select('*').order('sort_order').order('created_at')
  const ids = (books || []).map((b: any) => b.id)
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: rows } = await admin.from('playbook_ads').select('playbook_id').in('playbook_id', ids)
    for (const r of rows || []) counts.set(r.playbook_id, (counts.get(r.playbook_id) || 0) + 1)
  }
  return NextResponse.json({ playbooks: (books || []).map((b: any) => ({ ...b, ad_count: counts.get(b.id) || 0 })) })
}

export async function POST(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const title = String(body.title || '').trim()
  if (!title) return NextResponse.json({ error: 'Title required' }, { status: 400 })
  const admin = createAdminClient() as any
  const row = {
    title,
    slug: String(body.slug || '').trim() || slugify(title),
    description: String(body.description || '').trim() || null,
    emoji: String(body.emoji || '').trim() || null,
    featured: !!body.featured,
    sort_order: Number.isFinite(+body.sort_order) ? +body.sort_order : 0,
  }
  const { data, error } = await admin.from('playbooks').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ playbook: data })
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient() as any
  const patch: any = { updated_at: new Date().toISOString() }
  for (const k of ['title', 'slug', 'description', 'emoji', 'featured', 'sort_order', 'cover_image', 'cover_video']) {
    if (k in body) patch[k] = body[k]
  }
  const { data, error } = await admin.from('playbooks').update(patch).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ playbook: data })
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient() as any
  const { error } = await admin.from('playbooks').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
