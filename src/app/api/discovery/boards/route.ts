/**
 * Boards — Pinterest-style collections of saved ads. Org-shared (spec §10.2): a board is either
 * `personal` (only its author sees it) or `team` (everyone in the org sees it). One shared workspace.
 * Uses the admin client + manual org-scoping (discovery_boards has RLS); creating a team board is
 * gated on plan.teamBoards (Pro+). Sub-boards via parent_board_id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg, canManage } from '@/lib/org'
import { getPlanId } from '@/lib/entitlements'
import { planEntitlements, nextPlan } from '@/lib/plans'

export const dynamic = 'force-dynamic'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  return { user, admin, org }
}

// GET /api/discovery/boards — team boards in my org + my own personal boards, with ad counts.
export async function GET() {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c

  // Adopt legacy boards/saves made before this user had an org (org_id null) into their org, as
  // personal — otherwise the org-scoped query below would hide them. Idempotent (only null rows).
  await admin.from('discovery_boards').update({ org_id: org.orgId, created_by: user.id }).eq('user_id', user.id).is('org_id', null)
  await admin.from('discovery_saved_ads').update({ org_id: org.orgId }).eq('user_id', user.id).is('org_id', null)

  const { data: boards, error } = await admin
    .from('discovery_boards')
    .select('*')
    .eq('org_id', org.orgId)
    .or(`visibility.eq.team,created_by.eq.${user.id}`)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Count saved ads per board across the org (personal boards only ever hold their author's saves,
  // so counting by board_id is correct for both). Small per-org set → cheap.
  const { data: rows } = await admin
    .from('discovery_saved_ads').select('board_id').eq('org_id', org.orgId)
  const counts: Record<string, number> = {}
  for (const r of rows || []) if (r.board_id) counts[r.board_id] = (counts[r.board_id] || 0) + 1

  const withCounts = (boards || []).map((b: any) => ({
    ...b,
    isMine: b.created_by === user.id,
    discovery_saved_ads: [{ count: counts[b.id] || 0 }],
  }))
  return NextResponse.json({ boards: withCounts, canTeam: planEntitlements(await getPlanId(admin, org.ownerId)).teamBoards })
}

// POST /api/discovery/boards — create a board (personal by default; team requires plan.teamBoards).
export async function POST(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const { name, emoji = '📋', description = '', visibility = 'personal', parent_board_id = null } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const vis = visibility === 'team' ? 'team' : 'personal'

  if (vis === 'team') {
    const plan = await getPlanId(admin, org.ownerId)
    if (!planEntitlements(plan).teamBoards) {
      return NextResponse.json({ error: 'plan_limit', limit: 'teamBoards', upgradeTo: nextPlan(plan) || 'pro',
        message: 'Team boards are a Pro feature — upgrade to share boards with your team.' }, { status: 402 })
    }
  }

  const { data, error } = await admin
    .from('discovery_boards')
    .insert({ user_id: user.id, created_by: user.id, org_id: org.orgId, name: name.trim(), emoji, description, visibility: vis, parent_board_id })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ board: data })
}

// DELETE /api/discovery/boards?id= — author, or org admin/owner (team boards are org assets).
export async function DELETE(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  const { data: board } = await admin.from('discovery_boards').select('created_by, org_id').eq('id', id).maybeSingle()
  if (!board || board.org_id !== org.orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (board.created_by !== user.id && !canManage(org.role))
    return NextResponse.json({ error: 'Only the board author or an admin can delete this board.' }, { status: 403 })

  const { error } = await admin.from('discovery_boards').delete().eq('id', id).eq('org_id', org.orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
