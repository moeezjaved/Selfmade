/**
 * POST /api/geo/identity  { category?, website? } → the founder tells us who they actually are when the
 * auto-detection gets it wrong. Stores the category as the source-of-truth override (company_dna,
 * source='geo_founder_category') and the website into brand_kit, then re-runs a fresh sweep. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { runGeoSweep } from '@/lib/geo/monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const body = await req.json().catch(() => ({} as any))
  const category = String(body?.category || '').trim().slice(0, 200)
  const website = String(body?.website || '').trim().slice(0, 300)
  const brandId = await resolveActiveBrandId(admin, user.id, (body?.brandId as string) || null).catch(() => null)

  // save the category override (source of truth)
  if (category) {
    try {
      let del = admin.from('company_dna').delete().eq('user_id', user.id).eq('source', 'geo_founder_category')
      if (brandId) del = del.eq('brand_id', brandId)
      await del
      await admin.from('company_dna').insert({ user_id: user.id, brand_id: brandId, rule: `category: ${category}`, source: 'geo_founder_category', created_by: 'founder', active: true, priority: 'high' })
    } catch { /* best-effort */ }
  }
  // save the website into brand_kit (merged), used as the verified URL for reading the real site
  if (website && brandId) {
    try {
      const { data: b } = await admin.from('brands').select('brand_kit').eq('id', brandId).maybeSingle()
      const kit = (b?.brand_kit && typeof b.brand_kit === 'object') ? b.brand_kit : {}
      await admin.from('brands').update({ brand_kit: { ...kit, website } }).eq('id', brandId)
    } catch { /* best-effort */ }
  }

  try {
    // regenerate: bust the cached understanding + questions and rebuild from the override
    const status = await runGeoSweep(admin, user.id, brandId, { regenerate: true })
    return NextResponse.json(status, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'geo_identity_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
