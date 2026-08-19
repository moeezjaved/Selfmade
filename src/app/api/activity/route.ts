/**
 * Activity Log — the workspace's audit trail. Workspace-scoped (not self): every member sees the whole
 * team's actions, each row attributed to the real person who performed it, so an owner can tell which
 * launches/edits were a teammate's vs their own. Uses the admin client + manual workspace scoping
 * (activity_logs has a self-only RLS policy, so the browser client could never show teammates' rows).
 *
 * GET ?brand=<id> → { logs: [{ ...row, actor, is_self }] } newest first.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { workspaceMemberIds } from '@/lib/org'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  const brand = req.nextUrl.searchParams.get('brand')
  const memberIds = await workspaceMemberIds(admin, user.id).catch(() => [user.id])

  let q = admin.from('activity_logs').select('*').in('user_id', memberIds)
  if (brand && brand !== 'all') q = q.or(`brand_id.eq.${brand},brand_id.is.null`)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data || []) as any[]

  // Resolve a display label per distinct actor: full_name (user_profiles) → email (auth) → short id.
  const actorIds = Array.from(new Set(rows.map(r => r.user_id).filter(Boolean)))
  const label = new Map<string, string>()
  if (actorIds.length) {
    const { data: profs } = await admin.from('user_profiles').select('user_id, full_name').in('user_id', actorIds)
    for (const p of (profs || []) as any[]) if (p.full_name) label.set(p.user_id, String(p.full_name))
    // Fill any still-unnamed actor from auth email (admin API — one lookup each; members are few).
    for (const id of actorIds) {
      if (label.has(id)) continue
      try { const { data: u } = await admin.auth.admin.getUserById(id); const email = u?.user?.email; if (email) label.set(id, String(email)) } catch { /* best-effort */ }
    }
  }

  const logs = rows.map(r => ({
    ...r,
    is_self: r.user_id === user.id,
    actor: r.user_id === user.id ? 'You' : (label.get(r.user_id) || 'Teammate'),
  }))
  return NextResponse.json({ logs })
}
