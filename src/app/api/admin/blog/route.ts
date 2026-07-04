/**
 * Admin blog CRUD — powers /admin/blog.
 *   GET                 → all posts (drafts + published), newest first
 *   POST  {…fields}     → create (or upsert by id if present)
 *   PATCH {id, …fields} → update
 *   DELETE ?id=         → delete
 * Auth: verifyAdminRequest (admin cookie/token), same as other /api/admin routes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { slugify } from '@/lib/blog'
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FIELDS = ['slug', 'title', 'excerpt', 'cover_image_url', 'body_md', 'author', 'tags', 'meta_description', 'status', 'published_at'] as const

function clean(body: any) {
  const row: Record<string, any> = {}
  for (const f of FIELDS) if (body[f] !== undefined) row[f] = body[f]
  if (row.title && !row.slug) row.slug = slugify(row.title)
  if (row.slug) row.slug = slugify(row.slug)
  if (Array.isArray(row.tags)) row.tags = row.tags.filter(Boolean)
  // Stamp published_at the first time it goes live.
  if (row.status === 'published' && !row.published_at) row.published_at = new Date().toISOString()
  row.updated_at = new Date().toISOString()
  return row
}

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('blog_posts').select('*').order('updated_at', { ascending: false }).limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ posts: data || [] })
}

export async function POST(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const body = await request.json().catch(() => ({}))
  if (!body.title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const row = clean(body)
  const q = body.id
    ? admin.from('blog_posts').update(row).eq('id', body.id).select().single()
    : admin.from('blog_posts').insert(row).select().single()
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidatePath('/blog'); if (data?.slug) revalidatePath(`/blog/${data.slug}`)
  return NextResponse.json({ post: data })
}

export async function PATCH(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const body = await request.json().catch(() => ({}))
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await admin.from('blog_posts').update(clean(body)).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidatePath('/blog'); if (data?.slug) revalidatePath(`/blog/${data.slug}`)
  return NextResponse.json({ post: data })
}

export async function DELETE(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient() as any
  const { error } = await admin.from('blog_posts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidatePath('/blog')
  return NextResponse.json({ ok: true })
}
