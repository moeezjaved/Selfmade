/**
 * GET /api/geo/status → the brand's latest GEO visibility snapshot (no engine calls, cheap). For the
 * /mission/geo dashboard's first paint. Strict active-brand scope, read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveBrandForAction } from '@/lib/brand/active'
import { loadGeoStatus } from '@/lib/geo/monitor'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { brandId, needsSelection } = await resolveBrandForAction(admin as any, user.id)
  if (needsSelection || !brandId) return NextResponse.json({ selectBrand: true }, { status: 200 })
  try {
    const status = await loadGeoStatus(admin as any, user.id, brandId)
    return NextResponse.json(status, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'geo_status_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
