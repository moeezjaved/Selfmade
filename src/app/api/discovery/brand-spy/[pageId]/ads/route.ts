/**
 * Brand Spy ad grid — paginated ads for ONE brand, read straight from discovery_ads_index.
 *
 * Deliberately does NOT go through /db-search: that inner-joins discovery_creatives (R2-downloaded
 * media), so a freshly-spied brand whose ads haven't been through the drain yet returns ZERO rows
 * (the "No ads match these filters" empty grid). Here we read the index row directly and resolve a
 * thumbnail from the media the crawler already captured (thumbnail_url → raw_image_urls →
 * raw_video_preview_urls), so every ad shows immediately.
 *
 * GET /api/discovery/brand-spy/<pageId>/ads?page=&format=&status=&sort=&days=&day=
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const PAGE = 24
// Proxy Meta CDN images through weserv (hotlink/referrer-safe + resized) — same approach as the
// Discovery grid. R2 URLs and already-proxied URLs are left alone.
const proxy = (u: string | null): string | null => {
  if (!u) return null
  if (u.includes('weserv.nl') || u.includes('r2.') || u.includes('cloudflarestorage')) return u
  return `https://images.weserv.nl/?url=${encodeURIComponent(u.replace(/^https?:\/\//, ''))}&w=600&we&output=webp`
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params
  if (!pageId) return NextResponse.json({ error: 'pageId required' }, { status: 400 })
  const sp = req.nextUrl.searchParams
  const page = Math.max(0, parseInt(sp.get('page') || '0'))
  const format = (sp.get('format') || '').trim()
  const status = (sp.get('status') || 'ALL').trim()
  const sort = (sp.get('sort') || 'newest').trim()
  const days = parseInt(sp.get('days') || '0')
  const day = (sp.get('day') || '').trim()   // YYYY-MM-DD → that launch day (creative-test expand)
  const admin = createAdminClient()

  const COLS = 'ad_id, page_name, body, caption, format, start_date, stop_date, last_seen, is_active, days_running, hook_type, angle, cta, performance_score, thumbnail_url, video_url, raw_image_urls, raw_video_urls, raw_video_preview_urls'
  const base = () => {
    let q = admin.from('discovery_ads_index').select(COLS).eq('page_id', pageId)
    if (format) q = q.ilike('format', `%${format}%`)
    if (status === 'ACTIVE') q = q.eq('is_active', true)
    else if (status === 'INACTIVE') q = q.eq('is_active', false)
    if (days > 0) q = q.gte('start_date', new Date(Date.now() - days * 864e5).toISOString())
    if (day) { const next = new Date(new Date(day + 'T00:00:00Z').getTime() + 864e5).toISOString().slice(0, 10); q = q.gte('start_date', day).lt('start_date', next) }
    return q
  }

  let q = base()
  if (sort === 'longest') q = q.order('days_running', { ascending: false, nullsFirst: false })
  else if (sort === 'performance') q = q.order('performance_score', { ascending: false, nullsFirst: false })
  else if (sort === 'oldest') q = q.order('start_date', { ascending: true })
  else q = q.order('start_date', { ascending: false, nullsFirst: false })   // newest

  const { data, error } = await q.range(page * PAGE, page * PAGE + PAGE - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Brand-scoped total (page 0 only — the filter bar shows THIS brand's count, not the global feed).
  let total: number | null = null
  if (page === 0) { const { count } = await base().select('ad_id', { count: 'exact', head: true }); total = count ?? null }

  // Prefer the PERMANENT R2-rehosted creative over the raw Meta CDN URL. The raw thumbnail_url /
  // raw_image_urls are signed fbcdn.net links that EXPIRE (oh=/oe= tokens) — so older ads render as
  // broken images. R2 copies (poster_url / r2_url, filled by the thumb+poster backfills) never expire.
  // We still fall back to the raw URL when an ad hasn't been drained to R2 yet, preserving the
  // "every freshly-spied ad shows immediately" behaviour this route was built for.
  const adIds = (data || []).map((a: any) => a.ad_id)
  const r2map = new Map<string, { thumb: string | null; video: string | null }>()
  if (adIds.length) {
    const { data: cre } = await admin
      .from('discovery_creatives')
      .select('ad_id, asset_type, r2_url, poster_url, position')
      .in('ad_id', adIds)
      .order('position', { ascending: true })
    for (const c of (cre || []) as any[]) {
      if (r2map.has(c.ad_id)) continue   // keep the first (lowest-position) creative per ad
      const isVideo = c.asset_type === 'video'
      r2map.set(c.ad_id, {
        thumb: c.poster_url || (!isVideo ? c.r2_url : null) || null,   // R2 thumbnail / poster frame
        video: isVideo ? c.r2_url : null,
      })
    }
  }

  const ads = (data || []).map((a: any) => {
    const r2 = r2map.get(a.ad_id)
    const rawThumb = a.thumbnail_url || (a.raw_image_urls?.[0]) || (a.raw_video_preview_urls?.[0]) || null
    const rawVideo = a.video_url || (a.raw_video_urls?.[0]) || null
    const thumb = r2?.thumb || rawThumb     // permanent R2 first, expiring raw URL only as fallback
    const video = r2?.video || rawVideo
    return {
      id: a.ad_id, pageName: a.page_name, body: a.body, caption: a.caption,
      snapshotUrl: `https://www.facebook.com/ads/library/?id=${a.ad_id}`,
      thumbnailUrl: proxy(thumb), videoUrl: video,
      startDate: a.start_date, stopDate: a.stop_date, lastSeen: a.last_seen,
      isActive: a.is_active, daysRunning: a.days_running, format: a.format,
      hookType: a.hook_type, angle: a.angle, cta: a.cta,
      performanceScore: a.performance_score ?? null, platforms: [],
    }
  })
  return NextResponse.json({ ads, total, hasMore: (data?.length || 0) === PAGE })
}
