/**
 * GET /api/mello/documents          — list the user's AI-authored documents (newest first)
 * GET /api/mello/documents?id=<id>  — fetch one full document (body_md included)
 * The generator lives at /api/mello/documents/competitor-report.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    const { data, error } = await admin.from('mello_documents').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ document: data })
  }

  // List view — omit the heavy body_md for the index.
  const { data, error } = await admin
    .from('mello_documents')
    .select('id, kind, title, subject, subject_brand_id, model, meta, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ documents: data || [] })
}
