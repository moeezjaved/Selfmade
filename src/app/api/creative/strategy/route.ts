/**
 * GET /api/creative/strategy?account=…  — the Creative Strategist: what to make next, fused from your ad
 * performance (winners + fatigue) and rivals' winning angles. Read-only + advisory; the Studio link is
 * where making actually starts. Cached briefly so opening the brief doesn't re-run the model each time.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateCreativeStrategy, type CreativeStrategy } from '@/lib/creative/strategist'
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const cache = new Map<string, { at: number; data: CreativeStrategy }>()
const TTL = 15 * 60 * 1000

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const accountId = req.nextUrl.searchParams.get('account') || undefined
  // Scope to the active project: explicit ?brand= wins, else the app-wide sf_brand cookie (rail switcher).
  const brandId = (await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand'))) || undefined
  const key = `${user.id}:${accountId || 'primary'}:${brandId || 'all'}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL && req.nextUrl.searchParams.get('fresh') !== '1') return NextResponse.json(hit.data)

  try {
    const data = await generateCreativeStrategy(admin, user.id, { accountId, brandId })
    cache.set(key, { at: Date.now(), data })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: 'strategy_failed', message: String(e?.message || e) }, { status: 500 })
  }
}
