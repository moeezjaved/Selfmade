/**
 * POST /api/ads-studio/brand-website — set the active brand's website so the ads studio (Brand Hub,
 * Products, Audiences, Competitors, Templates) can learn everything from the site. Needed for brands
 * created without a site (e.g. via the Shopify connect), so the studio isn't stuck on "no store".
 * Body: { website }. Returns { website } (normalized domain).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const body = await req.json().catch(() => ({}))
    const website = String(body.website || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
    if (!website || !website.includes('.')) return NextResponse.json({ error: 'Enter a valid website like yourstore.com' }, { status: 400 })
    const admin = createAdminClient() as any
    const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
    if (!brandId) return NextResponse.json({ error: 'No active brand' }, { status: 400 })
    await admin.from('brands').update({ website }).eq('id', brandId)
    return NextResponse.json({ website })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) }, { status: 500 })
  }
}
