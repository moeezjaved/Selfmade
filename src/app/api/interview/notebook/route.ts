/**
 * Mello's notebook writer. POST { entries: [{ content, kind? }], brandId? } → mello_memory rows
 * (source 'interview'). The SAME table the Mello agent injects into every conversation's system
 * prompt — so everything learned in the hiring interview is instantly citable in the standup
 * ("as you told me when we met…"). Idempotent per (user_id, content). GET → the user's notebook.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { addMemory } from '@/lib/mello/memory'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const KINDS = new Set(['fact', 'rule', 'preference', 'scar', 'goal', 'brand'])
// interview answers are user-confirmed → high confidence; a stated red line / scar is a hard rule.
const CONFIDENCE: Record<string, number> = { rule: 92, scar: 90, goal: 88, preference: 85, brand: 90, fact: 82 }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { entries, brandId } = await req.json().catch(() => ({}))
  if (!Array.isArray(entries) || !entries.length) return NextResponse.json({ error: 'entries required' }, { status: 400 })
  // Route each note through addMemory so it's embedded (semantic recall) + carries category/confidence.
  const items = entries.slice(0, 20)
    .map((e: any) => ({ kind: KINDS.has(String(e?.kind)) ? String(e.kind) : 'fact', content: String(e?.content || '').trim().slice(0, 400) }))
    .filter((e: any) => e.content)
  if (!items.length) return NextResponse.json({ error: 'no valid entries' }, { status: 400 })
  await Promise.all(items.map((e: any) =>
    addMemory(user.id, e.content, e.kind, { category: e.kind, confidence: CONFIDENCE[e.kind] ?? 82, brandId: brandId || null, source: 'interview' }),
  ))
  return NextResponse.json({ ok: true, saved: items.length })
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
