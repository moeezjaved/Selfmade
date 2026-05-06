/**
 * Media extractor — fetches the public Facebook Ads Library page server-side
 * and extracts the actual image/video URLs (no login required).
 * facebook.com/ads/library/?id=XXX has the full creative data in its HTML.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const cache = new Map<string, { thumbnail: string | null; videoUrl: string | null }>()

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
}

function dec(s: string) {
  return s.replace(/&amp;/g, '&').replace(/\\u0025/g, '%').replace(/\\/g, '')
}

function extractMedia(html: string): { thumbnail: string | null; videoUrl: string | null } {
  let thumbnail: string | null = null
  let videoUrl: string | null = null

  // ── VIDEO URLs (highest priority) ──
  // Facebook embeds video data in JSON inside the page HTML
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
        videoUrl = dec(url)
        break
      }
    }
  }

  // ── THUMBNAIL / IMAGE ──
  // og:image is set by Facebook to the actual ad creative
  const ogPatterns = [
    /property="og:image"\s+content="([^"]+)"/,
    /content="([^"]+)"\s+property="og:image"/,
    /property='og:image'\s+content='([^']+)'/,
  ]
  for (const pat of ogPatterns) {
    const m = html.match(pat)
    if (m?.[1]?.startsWith('http')) {
      thumbnail = dec(m[1])
      break
    }
  }

  // If video found, also look for its poster/thumbnail
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

  // Fallback: any fbcdn image URL
  if (!thumbnail) {
    const fbImgs = html.match(/https:\/\/[a-z0-9-]+\.fbcdn\.net\/v\/[^\s"'<>]{30,}/g)
    if (fbImgs?.length) {
      // Prefer non-video, larger images
      thumbnail = fbImgs.find(u => !u.includes('video') && !u.includes('.mp4')) || fbImgs[0]
    }
  }

  return { thumbnail, videoUrl }
}

async function fetchMedia(adId: string, snapshotUrl: string) {
  if (cache.has(adId)) return cache.get(adId)!

  const result = { thumbnail: null as string | null, videoUrl: null as string | null }

  const urls = [
    `https://www.facebook.com/ads/library/?id=${adId}&country=ALL`,
    `https://www.facebook.com/ads/library/?id=${adId}`,
    snapshotUrl,
  ].filter(Boolean)

  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 10000)
      const res = await fetch(url, { signal: ctrl.signal, headers: HEADERS })
      clearTimeout(t)
      if (!res.ok) continue
      const html = await res.text()
      const extracted = extractMedia(html)
      if (extracted.thumbnail || extracted.videoUrl) {
        result.thumbnail = extracted.thumbnail
        result.videoUrl = extracted.videoUrl
        break
      }
    } catch { continue }
  }

  cache.set(adId, result)
  return result
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const adId = searchParams.get('ad_id')
  const snapshotUrl = searchParams.get('url') || ''

  if (!adId) return NextResponse.json({ thumbnail: null, videoUrl: null }, { status: 400 })

  const admin = createAdminClient()

  // Return cached DB values immediately
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

  const { thumbnail, videoUrl } = await fetchMedia(adId, snapshotUrl)

  if (thumbnail || videoUrl) {
    await admin.from('discovery_ads_index')
      .update({ thumbnail_url: thumbnail, video_url: videoUrl })
      .eq('ad_id', adId)
  }

  return NextResponse.json(
    { thumbnail, videoUrl },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
