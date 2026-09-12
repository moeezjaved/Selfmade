/**
 * Advanced Page Builder — the structured PageDoc load/save API (Phase 1).
 *   GET  /api/builder/doc?pageId=…   → { doc, version }   (seeds a starter doc from the page's product if none)
 *   PUT  /api/builder/doc { pageId, doc } → { version }    (saves + pushes a version-history row; prunes to last 30)
 * Scoped to the signed-in user's own builder_pages rows.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { starterProductDoc } from '@/lib/builder/seed'
import type { PageDoc } from '@/lib/builder/schema'

export const dynamic = 'force-dynamic'
const KEEP_VERSIONS = 30

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = req.nextUrl.searchParams.get('pageId') || ''
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })

  const admin = createAdminClient() as any
  const { data: row } = await admin.from('builder_pages')
    .select('id, user_id, product_id, doc, doc_version').eq('id', pageId).maybeSingle()
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (row.doc) return NextResponse.json({ doc: row.doc, version: row.doc_version || 0, seeded: false })
  // No structured doc yet — seed a starter from the page's product so the advanced editor can open it.
  const doc = starterProductDoc({ productId: row.product_id || undefined })
  return NextResponse.json({ doc, version: 0, seeded: true })
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const pageId = String(body?.pageId || '')
  const doc = body?.doc as PageDoc | undefined
  if (!pageId || !doc || !Array.isArray(doc.sections)) return NextResponse.json({ error: 'pageId and a valid doc required' }, { status: 400 })

  const admin = createAdminClient() as any
  const { data: row } = await admin.from('builder_pages').select('id, user_id, doc_version').eq('id', pageId).maybeSingle()
  if (!row || row.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nextVersion = (row.doc_version || 0) + 1
  const saved = { ...doc, version: nextVersion }
  const { error } = await admin.from('builder_pages')
    .update({ doc: saved, doc_version: nextVersion, doc_edited_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', pageId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Version history + prune (best-effort — never fail the save on history).
  await admin.from('builder_page_versions').insert({ page_id: pageId, version: nextVersion, doc: saved, created_by: user.id }).then(() => {}, () => {})
  try {
    const { data: old } = await admin.from('builder_page_versions').select('version').eq('page_id', pageId).order('version', { ascending: false }).range(KEEP_VERSIONS, KEEP_VERSIONS + 200)
    const cutoff = (old || [])[0]?.version
    if (cutoff != null) await admin.from('builder_page_versions').delete().eq('page_id', pageId).lte('version', cutoff)
  } catch { /* pruning is best-effort */ }

  return NextResponse.json({ version: nextVersion })
}
