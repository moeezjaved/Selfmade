import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/discovery/saved?board_id=xxx — list saved ads
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const boardId = request.nextUrl.searchParams.get('board_id')

  let query = supabase
    .from('discovery_saved_ads')
    .select('*')
    .eq('user_id', user.id)
    .order('saved_at', { ascending: false })

  if (boardId) query = query.eq('board_id', boardId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ads: data || [] })
}

// POST /api/discovery/saved — save an ad to a board
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { board_id, ad_id, page_id, page_name, snapshot_url, ad_data } = await request.json()
  if (!board_id || !ad_id) return NextResponse.json({ error: 'board_id and ad_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('discovery_saved_ads')
    .upsert({
      user_id: user.id,
      board_id,
      ad_id,
      page_id,
      page_name,
      snapshot_url,
      ad_data,
    }, { onConflict: 'user_id,board_id,ad_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ saved: data })
}

// DELETE /api/discovery/saved?ad_id=xxx&board_id=xxx — unsave an ad
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adId = request.nextUrl.searchParams.get('ad_id')
  const boardId = request.nextUrl.searchParams.get('board_id')

  let query = supabase
    .from('discovery_saved_ads')
    .delete()
    .eq('user_id', user.id)
    .eq('ad_id', adId!)

  if (boardId) query = query.eq('board_id', boardId)

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
