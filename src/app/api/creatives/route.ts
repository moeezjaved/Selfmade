/**
 * "My Creatives" gallery API.
 * GET    /api/creatives?brandId=&type=   → the user's saved AI generations (newest first)
 * DELETE /api/creatives?id=               → remove one generation (row only; R2 object is left)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const brandId = req.nextUrl.searchParams.get('brandId')
  const type = req.nextUrl.searchParams.get('type')

  let q = admin.from('creative_generations')
    .select('id, brand_id, source_ad_id, parent_id, type, tier, prompt, image_url, media_type, status, created_at')
    .eq('user_id', user.id).order('created_at', { ascending: false }).limit(300)
  if (brandId) q = q.eq('brand_id', brandId)
  if (type) q = q.eq('type', type)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach brand names for labels.
  const brandIds = Array.from(new Set((data || []).map((g: any) => g.brand_id).filter(Boolean)))
  const names = new Map<string, string>()
  if (brandIds.length) {
    const { data: bs } = await admin.from('brands').select('id, name').in('id', brandIds)
    for (const b of (bs || []) as any[]) names.set(b.id, b.name)
  }
  const creatives = (data || []).map((g: any) => ({ ...g, brand_name: g.brand_id ? names.get(g.brand_id) || null : null }))
  return NextResponse.json({ creatives })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const admin = createAdminClient()
  await admin.from('creative_generations').delete().eq('id', id).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}
