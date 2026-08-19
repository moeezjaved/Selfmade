/**
 * Saved ads. Org-aware (spec §10.2): saves carry org_id so TEAM boards aggregate the whole team's
 * saves, while personal boards (and the "all saves" library) stay scoped to the individual. Uses the
 * admin client + manual scoping since discovery_saved_ads/boards have RLS.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'

export const dynamic = 'force-dynamic'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, user.id)
  return { user, admin, org }
}

// GET /api/discovery/saved?board_id=xxx — list saved ads (team board → org-wide; else the user's own).
export async function GET(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const boardId = request.nextUrl.searchParams.get('board_id')

  let query = admin.from('discovery_saved_ads').select('*').order('saved_at', { ascending: false })
  if (boardId) query = query.eq('board_id', boardId)
  // ONE SHARED WORKSPACE: saved ads belong to the org, not the individual — a teammate opening a board
  // sees every member's saves in it, matching the now-shared boards. Scoped by org_id (single org, no
  // cross-workspace leak). Replaces the old `team board → org / else → self` gate that hid the owner's
  // saves from members (boards were never 'team' by default, so it always collapsed to self).
  query = query.eq('org_id', org.orgId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach cross-cutting tags (spec §10.2) to each saved ad.
  const ads = (data || []) as any[]
  if (ads.length) {
    const { data: tagRows } = await admin.from('saved_ad_tags')
      .select('saved_ad_id, tag').in('saved_ad_id', ads.map(a => a.id))
    const byAd: Record<string, string[]> = {}
    for (const t of tagRows || []) (byAd[t.saved_ad_id] ||= []).push(t.tag)
    for (const a of ads) a.tags = byAd[a.id] || []
  }
  return NextResponse.json({ ads })
}

// POST /api/discovery/saved — save an ad to a board (stamps org_id so team boards can aggregate).
export async function POST(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin, org } = c
  const { board_id, ad_id, page_id, page_name, snapshot_url, ad_data } = await request.json()
  if (!board_id || !ad_id) return NextResponse.json({ error: 'board_id and ad_id required' }, { status: 400 })

  const { data, error } = await admin
    .from('discovery_saved_ads')
    .upsert({ user_id: user.id, org_id: org.orgId, board_id, ad_id, page_id, page_name, snapshot_url, ad_data },
      { onConflict: 'user_id,board_id,ad_id' })
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ saved: data })
}

// DELETE /api/discovery/saved?ad_id=&board_id= — remove YOUR save (team boards: you unsave your own).
export async function DELETE(request: NextRequest) {
  const c = await ctx(); if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user, admin } = c
  const adId = request.nextUrl.searchParams.get('ad_id')
  const boardId = request.nextUrl.searchParams.get('board_id')
  if (!adId) return NextResponse.json({ error: 'ad_id required' }, { status: 400 })

  let query = admin.from('discovery_saved_ads').delete().eq('user_id', user.id).eq('ad_id', adId)
  if (boardId) query = query.eq('board_id', boardId)
  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
