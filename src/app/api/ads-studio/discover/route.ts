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
    const { data } = await admin.from('discovery_ads_index')
      .select('ad_id, page_id, page_name, thumbnail_url, raw_image_urls, body, title, format')
      .eq('has_creative', true).eq('is_active', true)
      .not('thumbnail_url', 'is', null)
      .order('performance_score', { ascending: false, nullsFirst: false })
      .limit(limit * 2)
    const seen = new Set<string>()
    const ads = (data || []).map((a: any) => ({
      id: a.ad_id,
      brand: a.page_name || 'Brand',
      thumb: a.thumbnail_url || (Array.isArray(a.raw_image_urls) ? a.raw_image_urls[0] : null) || null,
      copy: (a.body || a.title || '').slice(0, 120),
      format: a.format || 'image',
    })).filter((a: any) => {
      if (!a.thumb || seen.has(a.brand)) return false   // one per brand → a varied wall
      seen.add(a.brand); return true
    }).slice(0, limit)
    return NextResponse.json({ ads })
  } catch (e: any) {
    return NextResponse.json({ ads: [], error: String(e?.message || e).slice(0, 160) })
  }
}
