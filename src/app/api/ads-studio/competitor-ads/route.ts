/**
 * GET /api/ads-studio/competitor-ads?name=&domain= — on-demand "Spy their ads" for ONE competitor.
 * Keyword-searches the Meta Ad Library (via the droplet's Playwright + IPRoyal) for this brand, matches the
 * advertiser by domain/name, and returns their live running creatives. Used by the "Spy their ads" button on
 * the rivals we didn't already have ads for.
 */
import { NextRequest, NextResponse } from 'next/server'
import { searchAdLibrary, fetchLiveAdsByPage, type LiveAd } from '@/lib/ads-studio/adlibrary'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const root = (d: string) => d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase()
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const nameMatch = (a: string, b: string) => { const x = norm(a), y = norm(b); return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)) }

export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get('name') || '').trim()
  const domain = root(req.nextUrl.searchParams.get('domain') || '')
  if (!name && !domain) return NextResponse.json({ ads: [], error: 'name or domain required' })
  try {
    // Search by the brand name (best Ad Library signal); fall back to the domain's brand token.
    const queries = Array.from(new Set([name, domain.split('.')[0]].filter((q) => q && q.length >= 2))).slice(0, 2)
    const found = (await Promise.all(queries.map((q) => searchAdLibrary(q, 'ALL', 6).catch(() => [])))).flat()

    // Pick the advertiser that matches this competitor (domain first, then name).
    let match = domain ? found.find((a) => a.domain && root(a.domain) === domain) : undefined
    if (!match) match = found.find((a) => a.pageName && nameMatch(a.pageName, name))
    if (!match && found.length === 1) match = found[0]
    if (!match) return NextResponse.json({ ads: [], adCount: 0, pageId: null })

    // The search is non-deterministic and returns only a few ads per advertiser. Once we have the page_id,
    // fetch their FULL active set deterministically via /preview (droplet) — more reliable + complete.
    let liveAds: LiveAd[] = match.ads
    if (match.pageId) {
      const full = await fetchLiveAdsByPage(match.pageId, 8).catch(() => [])
      if (full.length) liveAds = full
    }
    const ads = liveAds.map((a) => ({
      id: a.adId, thumb: a.images[0] || a.videoPreviews[0] || null, copy: (a.body || a.title || '').slice(0, 220),
      format: a.videos.length ? 'video' : 'image', active: a.isActive,
    })).filter((a) => a.thumb)
    return NextResponse.json({ ads, adCount: ads.length, pageId: match.pageId, domain: match.domain || domain || null })
  } catch (e: any) {
    return NextResponse.json({ ads: [], error: String(e?.message || e).slice(0, 160) })
  }
}
