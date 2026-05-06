/**
 * Media extractor — three-layer approach for ad creatives:
 *
 * 1. DB cache   — instant return if already stored
 * 2. Scraping   — fetch the render_ad snapshot URL (has access_token embedded)
 *                 and the public ads/library page; extract og:image + video URLs
 * 3. Fallback   — graph.facebook.com/{page_id}/picture always works for public
 *                 pages; returns the brand's profile picture so the card is never
 *                 blank even when scraping returns nothing
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const cache = new Map<string, { thumbnail: string | null; videoUrl: string | null }>()

// Full browser-like headers — helps bypass simple bot checks
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.facebook.com/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Upgrade-Insecure-Requests': '1',
}

function dec(s: string) {
  try {
    return s
      .replace(/\\u0026/g, '&')
      .replace(/\\u0025/g, '%')
      .replace(/&amp;/g, '&')
      .replace(/\\"/g, '"')
      .replace(/\\\//g, '/')
  } catch { return s }
}

function extractMedia(html: string): { thumbnail: string | null; videoUrl: string | null } {
  let thumbnail: string | null = null
  let videoUrl: string | null = null

  // ── VIDEO (highest priority) ──────────────────────────────
  const videoPatterns = [
    /["']playable_url["']\s*:\s*["'](https:\/\/video[^"'\\]+)["']/,
    /["']playable_url_quality_hd["']\s*:\s*["'](https:\/\/video[^"'\\]+)["']/,
    /["']src_no_ratelimit["']\s*:\s*["'](https:\/\/video[^"'\\]+)["']/,
    /["']video_sd_url["']\s*:\s*["'](https:\/\/[^"'\\]+fbcdn[^"'\\]+\.mp4[^"'\\]*)["']/,
    /["']video_hd_url["']\s*:\s*["'](https:\/\/[^"'\\]+fbcdn[^"'\\]+\.mp4[^"'\\]*)["']/,
    /"src"\s*:\s*"(https:\/\/video\.xx\.fbcdn\.net[^"]+)"/,
    /https:\/\/video\.[a-z0-9-]+\.fbcdn\.net\/v\/[^\s"'<>]{30,}/,
  ]
  for (const pat of videoPatterns) {
    const m = html.match(pat)
    if (m) {
      const url = pat.source.includes('(') ? m[1] : m[0]
      if (url?.includes('fbcdn.net') || url?.includes('facebook.com')) {
        videoUrl = dec(url); break
      }
    }
  }

  // ── THUMBNAIL / IMAGE ─────────────────────────────────────
  const imagePatterns = [
    // og:image (set by Facebook for the ad creative on the library page)
    /property="og:image"\s+content="([^"]+)"/,
    /content="([^"]+)"\s+property="og:image"/,
    /property='og:image'\s+content='([^']+)'/,
    // Facebook CDN images embedded in page JSON (render_ad page)
    /"uri"\s*:\s*"(https:\/\/scontent[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/,
    /"imageURL"\s*:\s*"(https:\/\/[^"]+fbcdn[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/,
    /"image"\s*:\s*\{"uri"\s*:\s*"(https:\/\/[^"]+fbcdn[^"]+)"/,
    // Img tags in render_ad HTML
    /<img[^>]+src="(https:\/\/scontent[^"]{20,}\.(?:jpg|jpeg|png|webp)[^"]*)"/,
    // Any scontent CDN image URL (broad fallback)
    /https:\/\/scontent[a-z0-9.-]+\.fbcdn\.net\/v\/[^\s"'<>]{30,}/,
  ]
  for (const pat of imagePatterns) {
    const m = html.match(pat)
    const url = (m && (pat.source.includes('(') ? m[1] : m[0])) || null
    if (url?.startsWith('http') && !url.includes('emoji') && url.length > 30) {
      thumbnail = dec(url); break
    }
  }

  // Poster for video ads
  if (videoUrl && !thumbnail) {
    const posterPats = [
      /["']thumbnailImage["'][^}]*?["']uri["']\s*:\s*["'](https:\/\/[^"']+fbcdn[^"']+)["']/,
      /["']preferred_thumbnail["'][^}]*?["']uri["']\s*:\s*["'](https:\/\/[^"']+fbcdn[^"']+)["']/,
      /["']thumbnail_url["']\s*:\s*["'](https:\/\/[^"']+fbcdn[^"']+)["']/,
    ]
    for (const pat of posterPats) {
      const m = html.match(pat)
      if (m?.[1]) { thumbnail = dec(m[1]); break }
    }
  }

  return { thumbnail, videoUrl }
}

// ── Page profile picture via Facebook Graph API ───────────────
// Publicly accessible for all public pages — no auth required.
// Returns the brand's FB page profile picture URL.
function pagePictureUrl(pageId: string): string {
  // The browser's <img> tag follows this redirect automatically to the CDN image
  return `https://graph.facebook.com/${pageId}/picture?type=large`
}

async function fetchHtml(url: string, timeoutMs = 10000): Promise<string | null> {
  // Use Browserless headless Chrome if configured — executes JS, gets real images
  const token = process.env.BROWSERLESS_TOKEN
  if (token) {
    try {
      const res = await fetch(`https://chrome.browserless.io/content?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 },
          waitFor: 2000,
          userAgent: HEADERS['User-Agent'],
        }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) return await res.text()
    } catch { /* fall through */ }
  }
  // Plain fetch fallback (no JS execution)
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, headers: HEADERS })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

async function fetchMedia(adId: string, snapshotUrl: string) {
  if (cache.has(adId)) return cache.get(adId)!

  const result = { thumbnail: null as string | null, videoUrl: null as string | null }

  // Try URLs in order of likely success:
  // 1. Ads Library page  (has og:image for most ads in the server-rendered HTML)
  // 2. Snapshot/render URL (has access_token embedded — renders the full ad)
  const urls = [
    `https://www.facebook.com/ads/library/?id=${adId}&country=ALL`,
    snapshotUrl,
  ].filter(Boolean)

  for (const url of urls) {
    const html = await fetchHtml(url)
    if (!html) continue
    const extracted = extractMedia(html)
    if (extracted.thumbnail || extracted.videoUrl) {
      result.thumbnail = extracted.thumbnail
      result.videoUrl = extracted.videoUrl
      break
    }
  }

  cache.set(adId, result)
  return result
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const adId = searchParams.get('ad_id')
  const snapshotUrl = searchParams.get('url') || ''
  const pageId = searchParams.get('page_id') || ''

  if (!adId) return NextResponse.json({ thumbnail: null, videoUrl: null }, { status: 400 })

  const admin = createAdminClient()

  // 1. Return cached DB values immediately (set during crawl or previous fetch)
  const { data: existing } = await admin
    .from('discovery_ads_index')
    .select('thumbnail_url, video_url')
    .eq('ad_id', adId)
    .single()

  if (existing?.thumbnail_url || existing?.video_url) {
    return NextResponse.json(
      { thumbnail: existing.thumbnail_url, videoUrl: existing.video_url },
      { headers: { 'Cache-Control': 'public, max-age=86400' } }
    )
  }

  // 2. Try scraping the ad creative from Facebook pages
  const { thumbnail, videoUrl } = await fetchMedia(adId, snapshotUrl)

  // 3. Fallback for display: brand profile picture — always available for public FB pages
  //    We return it to the browser but do NOT store it in DB as thumbnail_url.
  //    Storing it would prevent the card from ever retrying for a real creative URL.
  const displayThumbnail = thumbnail || (pageId ? pagePictureUrl(pageId) : null)

  // Only persist REAL creative URLs (not the brand profile picture fallback)
  const isRealCreative = thumbnail && !thumbnail.includes('graph.facebook.com')
  if (isRealCreative || videoUrl) {
    await admin.from('discovery_ads_index')
      .update({
        ...(isRealCreative ? { thumbnail_url: thumbnail } : {}),
        ...(videoUrl ? { video_url: videoUrl } : {}),
      })
      .eq('ad_id', adId)
  }

  return NextResponse.json(
    { thumbnail: displayThumbnail, videoUrl },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
