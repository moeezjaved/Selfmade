import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// This route (the brand-VIEW page's Follow button) writes the SAME `followed_brands` table as the
// Following tab, Brand Spy, and the alert-worker — so follow state is consistent everywhere. It used to
// write a SEPARATE `discovery_followed_brands` table, which is why a brand followed from the Following
// tab still showed "+ Follow" on its brand page. A plain follow is spied=false (→ Following, not Brand
// Spy); an existing spy is never downgraded.

// GET /api/discovery/follow — list followed brands (page_id is all the caller checks)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('followed_brands').select('page_id, brand_name').eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ brands: data || [] })
}

// POST /api/discovery/follow — follow a brand (idempotent; keeps an existing spy intact)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { page_id, page_name } = await request.json()
  if (!page_id) return NextResponse.json({ error: 'page_id required' }, { status: 400 })
  const admin = createAdminClient()

  const { data: ex } = await admin.from('followed_brands').select('id').eq('user_id', user.id).eq('page_id', String(page_id)).maybeSingle()
  if (!ex) await admin.from('followed_brands').insert({ user_id: user.id, page_id: String(page_id), brand_name: page_name || null, spied: false })
  return NextResponse.json({ followed: true })
}

// DELETE /api/discovery/follow?page_id=xxx — unfollow a brand
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const pageId = request.nextUrl.searchParams.get('page_id')
  if (!pageId) return NextResponse.json({ error: 'page_id required' }, { status: 400 })
  const admin = createAdminClient()
  const { error } = await admin.from('followed_brands').delete().eq('user_id', user.id).eq('page_id', String(pageId))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
