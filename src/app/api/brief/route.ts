/**
 * Morning Brief API.
 * GET   → the personalized brief. Assembly lives in @/lib/brief/assemble, SHARED with the server-rendered
 *         /brief page — so the brief renders into the HTML even if the client never hydrates.
 * PATCH → { id } marks a brief_events row acted_on (CTA clicked).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { assembleBrief } from '@/lib/brief/assemble'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brief = await assembleBrief(admin, user.id, { ...(user.user_metadata || {}), email: user.email })
  return NextResponse.json(brief)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // RLS owner-update policy scopes this to the user's own rows.
  const { error } = await supabase.from('brief_events').update({ acted_on: true }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
