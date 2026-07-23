/**
 * Mello's notebook writer. POST { entries: [{ content, kind? }], brandId? } → mello_memory rows
 * (source 'interview'). The SAME table the Mello agent injects into every conversation's system
 * prompt — so everything learned in the hiring interview is instantly citable in the standup
 * ("as you told me when we met…"). Idempotent per (user_id, content). GET → the user's notebook.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const KINDS = new Set(['fact', 'rule', 'preference', 'scar', 'goal', 'brand'])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { entries, brandId } = await req.json().catch(() => ({}))
  if (!Array.isArray(entries) || !entries.length) return NextResponse.json({ error: 'entries required' }, { status: 400 })
  const admin = createAdminClient()
  const rows = entries.slice(0, 20).map((e: any) => ({
    user_id: user.id,
    brand_id: brandId || null,
    kind: KINDS.has(String(e?.kind)) ? String(e.kind) : 'fact',
    content: String(e?.content || '').trim().slice(0, 400),
    source: 'interview',
  })).filter(r => r.content)
  if (!rows.length) return NextResponse.json({ error: 'no valid entries' }, { status: 400 })
  const { error } = await admin.from('mello_memory').upsert(rows, { onConflict: 'user_id,content', ignoreDuplicates: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, saved: rows.length })
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin.from('mello_memory')
    .select('id, kind, content, source, created_at').eq('user_id', user.id)
    .order('created_at', { ascending: false }).limit(100)
  return NextResponse.json({ notes: data || [] })
}
