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
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveBrandNames } from '@/lib/discovery/brandNames'

// A manual competitor add stores brand_name = "Facebook page <id>"; treat that (and blanks/ids) as
// unresolved so we fall back to the crawler's real page name.
const isPlaceholderName = (n: unknown): boolean => {
  const t = String(n ?? '').trim()
  return !t || /^\d+$/.test(t) || /^facebook page\s+\d+$/i.test(t)
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brandId = (await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand'))) || undefined

  // ALL the user's spied competitors + their brand link — so we can both scope to this brand AND reveal
  // ones that were added but landed on a different/no brand (the "added but nothing shows" case).
  const { data: allFollows } = await admin.from('followed_brands')
    .select('page_id, brand_name, brand_id').eq('user_id', user.id).eq('spied', true).limit(80)
  const spied = (allFollows || []).filter((f: any) => f.page_id)
  const rivals = brandId ? spied.filter((f: any) => f.brand_id === brandId) : spied
  // Spied but NOT linked to the selected brand (null brand_id or another brand) — offer to link them here.
  const unlinked = brandId ? spied.filter((f: any) => f.brand_id !== brandId).map((f: any) => ({ pageId: String(f.page_id), brand: f.brand_name || 'Competitor' })) : []
  if (!rivals.length) return NextResponse.json({ watching: [], unlinked })

  const ids = rivals.map((r: any) => String(r.page_id))
  // Resolve real brand names (crawl_state → directory → typed → first ad's page_name) so a
  // manually-added rival shows its name, not "Facebook page <id>".
  const nameMap = await resolveBrandNames(admin, ids)
  // Crawl state per page (last_crawled_at + crawling_at).
  const { data: terms } = await admin.from('discovery_crawl_terms').select('page_id, last_crawled_at, crawling_at').in('page_id', ids)
  const termMap: Record<string, any> = {}
  for (const t of (terms || []) as any[]) termMap[String(t.page_id)] = t

  const H48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const media = (a: any) => {
    const cres = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : (a.discovery_creatives ? [a.discovery_creatives] : [])
    const vid = cres.find((c: any) => c?.asset_type === 'video' && c?.r2_url)
    const img = cres.find((c: any) => c?.asset_type !== 'video' && c?.r2_url)
    const isVideo = !!vid && !img
    return { adId: String(a.ad_id), image: isVideo ? (vid?.poster_url || null) : (img?.r2_url || vid?.poster_url || null), isVideo, videoUrl: isVideo ? (vid?.r2_url || null) : null }
  }
  const SEL = 'ad_id, discovery_creatives(asset_type, r2_url, poster_url, position)'

  const watching = await Promise.all(rivals.map(async (r: any) => {
    const pid = String(r.page_id)
    let adCount = 0, topAds: any[] = [], newAds: any[] = []
    try { const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true }).eq('page_id', pid); adCount = count || 0 } catch { /* ok */ }
    try {
      // Top ads (longest-running = proven), and separately the ones first-seen in 48h (new launches).
      const [topR, newR] = await Promise.all([
        admin.from('discovery_ads_index').select(SEL).eq('page_id', pid).order('days_running', { ascending: false, nullsFirst: false }).limit(6),
        admin.from('discovery_ads_index').select(`${SEL}, first_seen_at`).eq('page_id', pid).gte('first_seen_at', H48).order('first_seen_at', { ascending: false }).limit(6),
      ])
      topAds = (topR.data || []).map(media).filter((a: any) => a.image).slice(0, 4)
      newAds = (newR.data || []).map(media).filter((a: any) => a.image).slice(0, 4)
    } catch { /* media is best-effort */ }
    const t = termMap[pid]
    const crawling = !!t?.crawling_at
    const everCrawled = !!t?.last_crawled_at
    const status = adCount > 0 ? 'live' : (crawling ? 'crawling' : (everCrawled ? 'empty' : 'queued'))
    const brand = nameMap.get(pid) || (isPlaceholderName(r.brand_name) ? 'Competitor' : r.brand_name)
    return { pageId: pid, brand, adCount, status, lastCrawledAt: t?.last_crawled_at || null, topAds, newAds }
  }))
  // Newest-added (queued/crawling) first so a just-added rival is right at the top.
  const order: Record<string, number> = { crawling: 0, queued: 1, empty: 2, live: 3 }
  watching.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
  return NextResponse.json({ watching, unlinked })
}
