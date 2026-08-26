/**
 * GET /api/scan/live-ads?page_id=… — a brand's live ads pulled ON DEMAND (droplet Playwright, ~seconds),
 * so the ads audit can show REAL ads in seconds instead of waiting minutes for the background crawler.
 * No login (lead-magnet theater). Returns ad METADATA + thumbnail URLs ONLY — we do NOT download or proxy
 * the media through IPRoyal (bandwidth): the client renders the fbcdn URLs directly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { fetchLiveAdsByPage } from '@/lib/ads-studio/adlibrary'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// light IP rate-limit (shared shape with /api/scan/run)
const hits = new Map<string, { n: number; t: number }>()
function limited(ip: string): boolean {
  const now = Date.now(); const w = hits.get(ip)
  if (!w || now - w.t > 60_000) { hits.set(ip, { n: 1, t: now }); return false }
  w.n++; return w.n > 20
}

export async function GET(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'anon'
  if (limited(ip)) return NextResponse.json({ ads: [] }, { status: 429 })
  const pageId = (req.nextUrl.searchParams.get('page_id') || '').trim()
  if (!/^\d{5,}$/.test(pageId)) return NextResponse.json({ ads: [] })
  try {
    const live = await fetchLiveAdsByPage(pageId, 12)
    // URLs only — never fetch the bytes here (no IPRoyal media download). The browser loads thumbnails.
    const ads = live.map((a) => ({
      adId: a.adId,
      thumb: (a.images && a.images[0]) || (a.videoPreviews && a.videoPreviews[0]) || null,
      isVideo: !!(a.videos && a.videos.length),
      body: (a.body || '').slice(0, 160),
      title: (a.title || '').slice(0, 120),
      link: a.link || null,
    }))
    return NextResponse.json({ ads, count: ads.length })
  } catch {
    return NextResponse.json({ ads: [] })
  }
}
