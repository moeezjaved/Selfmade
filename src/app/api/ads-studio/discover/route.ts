/**
 * GET /api/ads-studio/discover — the workspace "Discover" feed: trending ad creatives from our crawl
 * library (images now; video later). Each is "Create Similar" → tags into the Mello chat. Fast: reads
 * top-performing ads with a permanent R2 thumbnail straight from discovery_ads_index.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '24', 10), 48)
  try {
    const admin = createAdminClient() as any
    // Top performers first (need a wide-enough pool since many will have had their R2 image purged).
    const { data: index } = await admin.from('discovery_ads_index')
      .select('ad_id, page_name, body, title, format, performance_score')
      .eq('has_creative', true).eq('is_active', true)
      .order('performance_score', { ascending: false, nullsFirst: false })
      .limit(limit * 20)
    const rows = (index || []) as any[]
    if (!rows.length) return NextResponse.json({ ads: [] })

    // The R2 purge deleted non-spied objects but KEPT discovery_creatives posters/images for spied brands,
    // so the creatives table is the source of truth for what STILL EXISTS. Only show those (no dead thumbs).
    const ids = rows.map((r) => r.ad_id)
    const { data: cre } = await admin.from('discovery_creatives')
      .select('ad_id, asset_type, r2_url, poster_url, position')
      .in('ad_id', ids).order('position', { ascending: true })
    const thumbByAd = new Map<string, string>()
    for (const c of (cre || []) as any[]) {
      if (thumbByAd.has(c.ad_id)) continue                                   // first (lowest-position) per ad
      const t = c.poster_url || (c.asset_type !== 'video' ? c.r2_url : null)  // surviving R2 url only
      if (t) thumbByAd.set(c.ad_id, t)
    }

    const seen = new Set<string>()
    const ads = rows.map((a) => ({
      id: a.ad_id,
      brand: a.page_name || 'Brand',
      thumb: thumbByAd.get(a.ad_id) || null,
      copy: (a.body || a.title || '').slice(0, 120),
      format: a.format || 'image',
    })).filter((a) => {
      if (!a.thumb || seen.has(a.brand)) return false   // one per brand → a varied wall of REAL, surviving images
      seen.add(a.brand); return true
    }).slice(0, limit)
    return NextResponse.json({ ads })
  } catch (e: any) {
    return NextResponse.json({ ads: [], error: String(e?.message || e).slice(0, 160) })
  }
}
