/** GET /api/builder/products?q= — the merchant's synced Shopify products for the picker. */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { listBuilderProducts } from '@/lib/builder/products'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q') || undefined
  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  try {
    const res = await listBuilderProducts(user.id, { q, brandId })
    return NextResponse.json(res)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Could not load products', products: [] }, { status: 500 })
  }
}
