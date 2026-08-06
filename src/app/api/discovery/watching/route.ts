/**
 * GET /api/discovery/watching?brand=<brandId> — the competitors you're spying (optionally for one brand),
 * each with a live status so adding one gives instant confirmation + progress:
 *   'live'     → we have their ads (count shown)
 *   'crawling' → the crawler is fetching them right now
 *   'queued'   → added, waiting for the crawler's next pass
 * Powers the brief's "Watching for <brand>" list so a just-added rival never looks like it failed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brandId = req.nextUrl.searchParams.get('brand') || undefined

  let fq = admin.from('followed_brands').select('page_id, brand_name').eq('user_id', user.id).eq('spied', true)
  if (brandId) fq = fq.eq('brand_id', brandId)
  const { data: follows } = await fq.limit(50)
  const rivals = (follows || []).filter((f: any) => f.page_id)
  if (!rivals.length) return NextResponse.json({ watching: [] })

  const ids = rivals.map((r: any) => String(r.page_id))
  // Crawl state per page (last_crawled_at + crawling_at).
  const { data: terms } = await admin.from('discovery_crawl_terms').select('page_id, last_crawled_at, crawling_at').in('page_id', ids)
  const termMap: Record<string, any> = {}
  for (const t of (terms || []) as any[]) termMap[String(t.page_id)] = t

  const watching = await Promise.all(rivals.map(async (r: any) => {
    const pid = String(r.page_id)
    let adCount = 0
    try { const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', pid); adCount = count || 0 } catch { /* ok */ }
    const t = termMap[pid]
    const crawling = !!t?.crawling_at
    const everCrawled = !!t?.last_crawled_at
    const status = adCount > 0 ? 'live' : (crawling ? 'crawling' : (everCrawled ? 'empty' : 'queued'))
    return { pageId: pid, brand: r.brand_name || 'Competitor', adCount, status, lastCrawledAt: t?.last_crawled_at || null }
  }))
  // Newest-added (queued/crawling) first so a just-added rival is right at the top.
  const order: Record<string, number> = { crawling: 0, queued: 1, empty: 2, live: 3 }
  watching.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
  return NextResponse.json({ watching })
}
