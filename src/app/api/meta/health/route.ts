/**
 * GET /api/meta/health — the Ads Account-Health read for the active brand: recent vs baseline windows +
 * the flagged issues (CPA spike, ROAS drop, creative fatigue, CPM spike, spend pacing). Read-only, advisory.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { checkAdsHealth } from '@/lib/meta/health'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const health = await checkAdsHealth(admin, user.id, brandId)
  return NextResponse.json(health)
}
