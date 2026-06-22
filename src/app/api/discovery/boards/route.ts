import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/discovery/boards — list user's boards
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: boards, error } = await supabase
    .from('discovery_boards')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Count per board the SAME way the saved-ads list does — scoped to this user
  // (.eq('user_id', user.id)). The old embedded `discovery_saved_ads(count)`
  // aggregate counted by the board FK only, NOT by user_id, so a board could show
  // "2 ads" in the badge while the user-scoped list query returned 0 (orphaned/
  // mismatched-user rows). Tallying the user's own rows keeps the badge and the
  // panel in agreement. A user's saved set is small, so selecting board_id is cheap.
  const { data: rows } = await supabase
    .from('discovery_saved_ads')
    .select('board_id')
    .eq('user_id', user.id)

  const counts: Record<string, number> = {}
  for (const r of rows || []) counts[r.board_id] = (counts[r.board_id] || 0) + 1

  const withCounts = (boards || []).map(b => ({
    ...b,
    discovery_saved_ads: [{ count: counts[b.id] || 0 }],
  }))

  return NextResponse.json({ boards: withCounts })
}

// POST /api/discovery/boards — create a board
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, emoji = '📋', description = '' } = await request.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const { data, error } = await supabase
    .from('discovery_boards')
    .insert({ user_id: user.id, name: name.trim(), emoji, description })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ board: data })
}

// DELETE /api/discovery/boards?id=xxx — delete a board
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 })

  const { error } = await supabase
    .from('discovery_boards')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
