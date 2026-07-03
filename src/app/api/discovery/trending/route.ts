/**
 * Trending feed — "what's hot right now," Motion-style but powered by OUR data instead of a
 * save-loop (which needs a big user base). Hybrid rank:
 *   trendScore = performance_score  (primary, percentile-calibrated)
 *              + recency boost       (ads still active this week rank higher)
 *              + save velocity        (blend in user saves as the base grows — tiebreaker for now)
 * GET ?niche=<coarse niche>&limit= → ranked ads with creatives, scoped by industry.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const DAY = 86_400_000

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const niche = (req.nextUrl.searchParams.get('niche') || '').trim()
  const pageId = (req.nextUrl.searchParams.get('pageId') || '').trim()
  const format = (req.nextUrl.searchParams.get('format') || '').trim()
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '48'), 96)

  // Candidate pool: top performers with a creative, scoped by niche. Ordered by performance_score
  // (indexed) so this stays fast; we re-rank the pool in JS with recency + saves.
  let q = admin.from('discovery_ads_index')
    .select('ad_id, page_id, page_name, performance_score, format_style, hook_type, is_active, last_seen, start_date, days_running, discovery_creatives(asset_type,position,r2_url,poster_url,width,height)')
    .eq('has_creative', true)
    .gt('performance_score', 0)
    .order('performance_score', { ascending: false })
    .limit(Math.max(limit * 3, 120))
  if (niche) q = q.eq('niche', niche)
  if (pageId) q = q.eq('page_id', pageId)
  if (format) q = q.eq('format_style', format)
  const { data: rows, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const pool = (rows || []) as any[]
  if (pool.length === 0) return NextResponse.json({ ads: [], niche: niche || null })

  // Save velocity (last 7d) for the candidate ads — blended in as a small boost.
  const ids = pool.map((r) => r.ad_id)
  const since = new Date(Date.now() - 7 * DAY).toISOString()
  const saveCount = new Map<string, number>()
  const { data: saves } = await admin.from('discovery_saved_ads')
    .select('ad_id').in('ad_id', ids).gte('created_at', since)
  for (const s of (saves || []) as any[]) saveCount.set(s.ad_id, (saveCount.get(s.ad_id) || 0) + 1)

  const now = Date.now()
  const ranked = pool.map((r) => {
    const cres = (r.discovery_creatives || []).slice().sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
    const cre = cres.find((c: any) => (c.asset_type === 'video' ? c.poster_url : c.r2_url)) || cres[0]
    const isVideo = cre?.asset_type === 'video'
    const image = cre ? (isVideo ? cre.poster_url : cre.r2_url) : null
    const lastSeen = r.last_seen ? Date.parse(r.last_seen) : NaN
    const ageDays = Number.isNaN(lastSeen) ? 999 : (now - lastSeen) / DAY
    const recency = ageDays <= 7 ? 0.05 : ageDays <= 30 ? 0.02 : 0
    const saves7d = saveCount.get(r.ad_id) || 0
    const saveBoost = 0.03 * Math.min(saves7d, 10)
    const perf = Number(r.performance_score) || 0
    return {
      adId: r.ad_id, pageId: r.page_id, pageName: r.page_name || 'Brand',
      image, isVideo, score: perf, format: r.format_style || null, hook: r.hook_type || null,
      saves: saves7d, isActive: !!r.is_active, daysRunning: r.days_running || null,
      trendScore: perf + recency + saveBoost,
    }
  }).filter((a) => a.image)
    .sort((a, b) => b.trendScore - a.trendScore)
    .slice(0, limit)

  return NextResponse.json({ ads: ranked, niche: niche || null })
}
