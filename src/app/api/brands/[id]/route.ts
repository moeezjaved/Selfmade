/**
 * Single brand — GET (with products + assets), PATCH (update), DELETE.
 * POST adds a product or asset ({ resource:'product'|'asset', ... }).
 * DELETE ?productId= / ?assetId= removes a child. All ownership-checked.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
const ARR = (v: any) => Array.isArray(v) ? v.map(String) : (v ? [String(v)] : [])

async function owned(admin: any, brandId: string, userId: string) {
  const { data } = await admin.from('brands').select('id').eq('id', brandId).eq('user_id', userId).maybeSingle()
  return !!data
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data: brand } = await admin.from('brands').select('*').eq('id', params.id).eq('user_id', user.id).maybeSingle()
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [{ data: products }, { data: assets }] = await Promise.all([
    admin.from('brand_products').select('*').eq('brand_id', params.id).order('created_at', { ascending: false }),
    admin.from('brand_assets').select('*').eq('brand_id', params.id),
  ])
  return NextResponse.json({ brand: { ...brand, products: products || [], assets: assets || [] } })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await owned(admin, params.id, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await req.json()
  const update: Record<string, any> = {}
  for (const k of ['name', 'website', 'description', 'target_audience', 'tone'])
    if (b[k] !== undefined) update[k] = b[k] || null
  for (const k of ['industry', 'usps', 'preferred_words', 'avoid_words'])
    if (b[k] !== undefined) update[k] = ARR(b[k])
  await admin.from('brands').update(update).eq('id', params.id)
  return NextResponse.json({ success: true })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await owned(admin, params.id, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await req.json()

  if (b.resource === 'product') {
    const { data, error } = await admin.from('brand_products').insert({
      brand_id: params.id, name: b.name || null, description: b.description || null,
      price: b.price || null, image_urls: ARR(b.image_urls),
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ product: data })
  }
  if (b.resource === 'asset') {
    const { data, error } = await admin.from('brand_assets').insert({
      brand_id: params.id, type: b.type, value: b.value || null,
      is_default: !!b.is_default, meta: b.meta || null,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ asset: data })
  }
  return NextResponse.json({ error: 'resource must be product|asset' }, { status: 400 })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  if (!(await owned(admin, params.id, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const productId = req.nextUrl.searchParams.get('productId')
  const assetId = req.nextUrl.searchParams.get('assetId')
  if (productId) await admin.from('brand_products').delete().eq('id', productId).eq('brand_id', params.id)
  else if (assetId) await admin.from('brand_assets').delete().eq('id', assetId).eq('brand_id', params.id)
  else await admin.from('brands').delete().eq('id', params.id)  // delete the whole brand (cascades)
  return NextResponse.json({ success: true })
}
