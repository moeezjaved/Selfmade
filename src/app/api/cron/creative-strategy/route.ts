/**
 * GET /api/cron/creative-strategy — nightly precompute of the "What to make next" Creative Strategist,
 * once per brand, into creative_strategy_cache (mig 151). Runs when the DB is quiet, so the heavy work
 * (ranking discovery_ads_index + the LLM) happens off the request path. The brief card then reads the
 * cached result instantly instead of computing live (which timed out under crawl load).
 *
 * Auth mirrors the other crons (CRON_SECRET via ?secret= / Bearer, or an authed session). Time-boxed +
 * capped so it can't run up the model bill. Brands with no signal (no competitors, no account → empty
 * ideas) are skipped, so we only pay for brands that actually produce a card.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateCreativeStrategy } from '@/lib/creative/strategist'
import { writeStrategyCache } from '@/lib/creative/cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_BRANDS = 80       // cap per run — one compute (+ maybe an LLM call) each
const BUDGET_MS = 250_000   // stay inside maxDuration

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = req.nextUrl.searchParams.get('secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return true
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true
  try { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (user) return true } catch { /* ignore */ }
  return false
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const start = Date.now()

  // Only precompute brands that could actually produce ideas: they have at least one spied competitor OR
  // a linked ad account. This is where the card's signal comes from, so empty brands are skipped (no cost).
  const [{ data: spied }, { data: accts }] = await Promise.all([
    admin.from('followed_brands').select('brand_id').eq('spied', true).not('brand_id', 'is', null),
    admin.from('meta_accounts').select('brand_id').eq('status', 'active').not('brand_id', 'is', null),
  ])
  const brandIds = Array.from(new Set([
    ...((spied || []) as any[]).map((r: any) => String(r.brand_id)),
    ...((accts || []) as any[]).map((r: any) => String(r.brand_id)),
  ])).slice(0, MAX_BRANDS)

  if (!brandIds.length) return NextResponse.json({ ok: true, brands: 0, computed: 0 })

  // Resolve each brand's owner (generateCreativeStrategy needs the user_id).
  const { data: brandRows } = await admin.from('brands').select('id, user_id').in('id', brandIds)
  const ownerOf: Record<string, string> = {}
  for (const b of (brandRows || []) as any[]) ownerOf[String(b.id)] = String(b.user_id)

  let computed = 0, skipped = 0
  for (const brandId of brandIds) {
    if (Date.now() - start > BUDGET_MS) break
    const userId = ownerOf[brandId]
    if (!userId) continue
    try {
      const data = await generateCreativeStrategy(admin, userId, { brandId })
      if (data.ideas?.length) { await writeStrategyCache(admin, userId, brandId, data); computed++ }
      else skipped++
    } catch { skipped++ }
  }

  return NextResponse.json({ ok: true, brands: brandIds.length, computed, skipped, ms: Date.now() - start })
}
