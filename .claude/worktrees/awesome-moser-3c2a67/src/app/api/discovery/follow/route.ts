import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/discovery/follow — list followed brands
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('discovery_followed_brands')
    .select('*')
    .eq('user_id', user.id)
    .order('followed_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ brands: data || [] })
}

// POST /api/discovery/follow — follow a brand
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { page_id, page_name } = await request.json()
  if (!page_id) return NextResponse.json({ error: 'page_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('discovery_followed_brands')
    .upsert({ user_id: user.id, page_id, page_name }, { onConflict: 'user_id,page_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ followed: data })
}

// DELETE /api/discovery/follow?page_id=xxx — unfollow a brand
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = request.nextUrl.searchParams.get('page_id')
  if (!pageId) return NextResponse.json({ error: 'page_id required' }, { status: 400 })

  const { error } = await supabase
    .from('discovery_followed_brands')
    .delete()
    .eq('user_id', user.id)
    .eq('page_id', pageId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
