/**
 * Brand catalog — the user's own brands (Clone's input foundation).
 * GET  /api/brands            → list the user's brands (+ product/asset counts)
 * POST /api/brands            → create a brand
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { persistImagesToR2 } from '@/lib/brand-photos'

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

// A user's brand slots are capped by their plan (trial 1, core 3, plus 10, business unlimited).
// Returns { used, limit } so the UI can show "2 / 3 brands". limit -1 = unlimited.
async function brandQuota(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const [{ data: prof }, { count }] = await Promise.all([
    admin.from('user_profiles').select('plan_id').eq('id', userId).maybeSingle(),
    admin.from('brands').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])
  let limit = 1
  const planId = (prof as any)?.plan_id
  if (planId) {
    const { data: plan } = await admin.from('plans').select('brand_limit').eq('id', planId).maybeSingle()
    if (plan && typeof (plan as any).brand_limit === 'number') limit = (plan as any).brand_limit
  }
  return { used: count || 0, limit }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const b = await req.json()
  if (!b.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  // Enforce the plan's brand-slot cap before inserting.
  const { used, limit } = await brandQuota(admin, user.id)
  if (limit >= 0 && used >= limit) {
    return NextResponse.json(
      { error: 'brand_limit_reached', used, limit, message: `Your plan includes ${limit} brand${limit === 1 ? '' : 's'}. Upgrade to add more.` },
      { status: 402 },
    )
  }

  const { data, error } = await admin.from('brands').insert({
    user_id: user.id,
    name: b.name.trim(), website: b.website || null,
    industry: ARR(b.industry), description: b.description || null, usps: ARR(b.usps),
    target_audience: b.target_audience || null, tone: b.tone || null,
    preferred_words: ARR(b.preferred_words), avoid_words: ARR(b.avoid_words),
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Seed products from detected/uploaded images (from the URL-detect flow), so the new brand is
  // immediately usable in Clone. image_urls holds the product photos; one product row per brand init.
  const productImages = ARR(b.product_images || b.images)
  if (productImages.length) {
    const persisted = await persistImagesToR2(user.id, productImages)   // copy into R2 → permanent
    await admin.from('brand_products').insert({
      brand_id: (data as any).id,
      name: b.product_name || b.name.trim(),
      image_urls: (persisted.length ? persisted : productImages.slice(0, 12)),
    }).then(() => {}, () => {})
  }

  return NextResponse.json({ brand: data, quota: { used: used + 1, limit } })
}
