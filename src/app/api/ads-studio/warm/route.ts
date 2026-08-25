/**
 * POST /api/ads-studio/warm — mark the active brand's ads studio as "warmed" (brand_kit.adsStudio.warmedAt)
 * once the build-and-reveal screen has pre-built everything. /ads-workspace reads this to decide whether a
 * first-arrival should go through the build screen or render straight away.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { mergeAdsStudio } from '@/lib/ads-studio/cache'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return NextResponse.json({ ok: false }, { status: 401 })
    const admin = createAdminClient() as any
    const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
    if (brandId) await mergeAdsStudio(admin, brandId, { warmedAt: new Date().toISOString() })
    return NextResponse.json({ ok: true })
  } catch { return NextResponse.json({ ok: false }) }
}
