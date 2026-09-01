/**
 * /api/showcase-ads — PUBLIC, read-only. Returns a handful of real ad thumbnails for marketing
 * pages (e.g. /features/ads). It reads the already-computed default Discovery feed snapshot
 * (discovery_feed_cache) — public ad data, no per-user scope, no auth — and hands back just the
 * thumbnail + brand. In-memory cached; fails soft to an empty list (so local dev with no DB env,
 * or a pre-snapshot cold start, simply shows nothing instead of erroring).
 */
import { NextResponse } from 'next/server'
import { createReadClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Showcase = { thumb: string; brand: string; title: string }
let CACHE: { at: number; ads: Showcase[] } | null = null
const TTL = 10 * 60_000

export async function GET() {
  try {
    if (CACHE && Date.now() - CACHE.at < TTL) return NextResponse.json({ ads: CACHE.ads })
    const admin = createReadClient()
    // Newest default-feed snapshot row (key looks like `feed:default:<sort>:0`); its payload.ads are
    // already transformed with an R2 thumbnailUrl, so we just pluck the fields we need.
    const { data } = await admin
      .from('discovery_feed_cache')
      .select('payload')
      .ilike('key', 'feed:default:%')
      .order('updated_at', { ascending: false })
      .limit(1)
    const payload: any = data?.[0]?.payload
    const raw: any[] = Array.isArray(payload?.ads) ? payload.ads : []
    const ads: Showcase[] = raw
      .filter((a) => a?.thumbnailUrl)
      .slice(0, 12)
      .map((a) => ({ thumb: a.thumbnailUrl as string, brand: a.pageName || '', title: a.title || '' }))
    CACHE = { at: Date.now(), ads }
    return NextResponse.json({ ads })
  } catch {
    return NextResponse.json({ ads: [] })
  }
}
