/**
 * ADMIN · Brief wishlist — what users asked to see more of in their Morning Brief.
 * Reads mello_memory rows written by the brief's "what else do you want?" button
 * (source 'brief_wishlist'), newest first, with the user's email when resolvable.
 * Admin-token gated.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminToken } from '@/lib/admin/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  const { data: rows } = await admin.from('mello_memory')
    .select('id, user_id, content, created_at')
    .eq('source', 'brief_wishlist')
    .order('created_at', { ascending: false })
    .limit(500)
  const list = rows || []

  // Resolve emails best-effort (auth.users via admin API).
  const emails = new Map<string, string>()
  try {
    const ids = Array.from(new Set(list.map((r: any) => r.user_id).filter(Boolean)))
    for (const id of ids) {
      try { const { data } = await admin.auth.admin.getUserById(id); if (data?.user?.email) emails.set(id, data.user.email) } catch {}
    }
  } catch {}

  const items = list.map((r: any) => ({
    id: r.id,
    text: String(r.content || '').replace(/^Wants to see in the morning brief:\s*/i, ''),
    email: emails.get(r.user_id) || null,
    at: r.created_at,
  }))
  return NextResponse.json({ items, total: items.length })
}
