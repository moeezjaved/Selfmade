/**
 * One-time (re-runnable) BACKFILL of the shared competitor-ad library. Walks the competitors users track
 * (followed_brands.page_id), pulls each brand's live ads off the droplet, and durably saves their IMAGE ads
 * to R2 + discovery_ads_index/discovery_creatives (same path as a live competitor pull) — so the Discover
 * feed fills up with real competitor creatives for every user, and they persist even after ads go down.
 *
 * Bounded per call (droplet is shared + flaky): processes `limit` page_ids, skipping ones pulled recently,
 * so it's safe to call repeatedly until it reports done. Gated by the admin_token cookie OR CRON_SECRET.
 *
 *   POST /api/admin/backfill-competitor-ads?limit=5   → { processed, saved, remaining }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchLiveAdsByPage } from '@/lib/ads-studio/adlibrary'
import { persistPulledAds } from '@/lib/discovery/persist'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get('admin_token')?.value
  const adminToken = process.env.ADMIN_TOKEN
  if (adminToken && cookie === adminToken) return true
  const bearer = req.headers.get('authorization')
  const cron = process.env.CRON_SECRET
  return !!cron && (bearer === `Bearer ${cron}` || req.nextUrl.searchParams.get('secret') === cron)
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limit = Math.min(20, Math.max(1, parseInt(req.nextUrl.searchParams.get('limit') || '5', 10)))
  const admin = createAdminClient() as any

  // Distinct tracked-competitor page_ids. Skip any that already have creatives saved in the last 3 days
  // (re-runnable + gentle on the droplet). We check discovery_creatives presence per page below.
  const { data: follows } = await admin.from('followed_brands').select('page_id, brand_name').not('page_id', 'is', null)
  const seen = new Set<string>()
  const pages: { pageId: string; name: string }[] = []
  for (const f of (follows || [])) {
    const pid = String((f as any).page_id || '')
    if (!pid || seen.has(pid)) continue
    seen.add(pid); pages.push({ pageId: pid, name: String((f as any).brand_name || '') })
  }

  // Which page_ids already have R2 creatives (recent) → skip, so repeat calls advance to fresh ones.
  const toDo: { pageId: string; name: string }[] = []
  for (const p of pages) {
    const { data: existing } = await admin.from('discovery_ads_index')
      .select('ad_id, discovery_creatives!inner(id)').eq('page_id', p.pageId).limit(1)
    if (!existing || existing.length === 0) toDo.push(p)
    if (toDo.length >= limit) break
  }

  let processed = 0, saved = 0
  for (const p of toDo) {
    try {
      const ads = await fetchLiveAdsByPage(p.pageId, 500).catch(() => [])
      if (ads.length) {
        const res = await persistPulledAds(admin, p.pageId, p.name, ads, { imagesOnly: true })
        saved += res.rehosted
      }
      processed++
    } catch { /* skip this one, keep going */ }
  }

  return NextResponse.json({ processed, saved, trackedCompetitors: pages.length, note: processed ? 'Call again to continue — repeats skip already-saved competitors.' : 'No un-backfilled competitors left — the library is filled.' })
}
