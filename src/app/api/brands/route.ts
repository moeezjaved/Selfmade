/**
 * Brand catalog — the user's own brands (Clone's input foundation).
 * GET  /api/brands            → list the user's brands (+ product/asset counts)
 * POST /api/brands            → create a brand
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { persistImagesToR2 } from '@/lib/brand-photos'
import { sendFirstBrandEmail } from '@/lib/email'
import { getPlanId } from '@/lib/entitlements'

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
  // Include the plan's brand-slot quota so the UI can show "used / limit" (limit -1 = unlimited)
  // instead of only surfacing it as an error when you hit the cap.
  const quota = await brandQuota(admin, user.id)
  return NextResponse.json({ brands: enriched, quota })
}

// A user's brand slots are capped by their plan (trial 1, core 3, plus 10, business unlimited).
// Returns { used, limit } so the UI can show "2 / 3 brands". limit -1 = unlimited.
async function brandQuota(admin: ReturnType<typeof createAdminClient>, userId: string) {
  // Resolve the plan the SAME way the rest of the app does: getPlanId reads an ACTIVE subscription
  // first, then falls back to user_profiles.plan_id. The old code read user_profiles.plan_id directly
  // — so a paying user whose subscription hadn't synced to their profile (row missing / stale
  // plan_id) was silently capped at the default limit of 1, and a 2nd brand save 402'd invisibly.
  const [planId, { count }] = await Promise.all([
    getPlanId(admin as any, userId),
    admin.from('brands').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])
  let limit = 1
  const { data: plan } = await admin.from('plans').select('brand_limit').eq('id', planId).maybeSingle()
  if (plan && typeof (plan as any).brand_limit === 'number') limit = (plan as any).brand_limit
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
    // Record this as a product event so it's VISIBLE in admin → Error Logs (a user hitting a wall is an
    // upsell signal, and this handled 402 used to be swallowed silently — never logged anywhere).
    try {
      const { logError } = await import('@/lib/admin/logError')
      await logError({ user_id: user.id, user_email: user.email || null,
        error_message: `Brand limit reached — tried to add brand #${used + 1} on a ${limit}-brand plan`,
        page_url: '/api/brands', extra: { kind: 'plan_limit', used, limit } })
    } catch { /* logging never blocks the response */ }
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
    brand_kit: (b.brand_kit && typeof b.brand_kit === 'object') ? b.brand_kit : {},
    brand_type: b.brand_type === 'service' ? 'service' : 'physical',   // service = app/site/service (no physical product rendered)
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

  // First-brand lifecycle email (sends once; claim-once guard inside). Never block the response on it.
  if (user.email) await sendFirstBrandEmail(user.id, user.email, b.name.trim()).catch(() => {})

  return NextResponse.json({ brand: data, quota: { used: used + 1, limit } })
}
