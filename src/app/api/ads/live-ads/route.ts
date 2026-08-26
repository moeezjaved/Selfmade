/**
 * GET /api/ads/live-ads — the founder's live ads (active + paused) for the Refresh/Carousel picker:
 * which ad to swap the creative on, or add a card to. Read-only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createMetaClientForUser } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const mc = await createMetaClientForUser(user.id).catch(() => null)
  if (!mc) return NextResponse.json({ ads: [], connected: false })
  const ads = await mc.listAdsForPicker()
  return NextResponse.json({ ads, connected: true })
}
