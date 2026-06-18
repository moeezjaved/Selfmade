/**
 * Brand catalog — the user's own brands (Clone's input foundation).
 * GET  /api/brands            → list the user's brands (+ product/asset counts)
 * POST /api/brands            → create a brand
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const ARR = (v: any) => Array.isArray(v) ? v.map(String) : (v ? [String(v)] : [])

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const { data: brands } = await admin
    .from('brands').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
  const ids = (brands || []).map((b: any) => b.id)
  // batch product + asset counts
  let products: any[] = [], assets: any[] = []
  if (ids.length) {
    ;[{ data: products }, { data: assets }] = await Promise.all([
      admin.from('brand_products').select('id, brand_id, name, image_urls').in('brand_id', ids),
      admin.from('brand_assets').select('id, brand_id, type, value, is_default').in('brand_id', ids),
    ]) as any
  }
  const byBrand = (rows: any[], id: string) => rows.filter(r => r.brand_id === id)
  const enriched = (brands || []).map((b: any) => ({
    ...b,
    products: byBrand(products || [], b.id),
    assets: byBrand(assets || [], b.id),
  }))
  return NextResponse.json({ brands: enriched })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const b = await req.json()
  if (!b.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data, error } = await admin.from('brands').insert({
    user_id: user.id,
    name: b.name.trim(), website: b.website || null,
    industry: ARR(b.industry), description: b.description || null, usps: ARR(b.usps),
    target_audience: b.target_audience || null, tone: b.tone || null,
    preferred_words: ARR(b.preferred_words), avoid_words: ARR(b.avoid_words),
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ brand: data })
}
