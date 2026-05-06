/**
 * Thumbnail extractor — fetches Meta ad snapshot server-side and extracts
 * the actual image/video URL from the rendered HTML (og:image, video src, etc.)
 * Results are cached in discovery_ads_index.thumbnail_url
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Simple in-memory cache to avoid re-fetching within same process
const cache = new Map<string, string | null>()

async function extractThumbnail(snapshotUrl: string): Promise<string | null> {
  if (cache.has(snapshotUrl)) return cache.get(snapshotUrl)!

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const res = await fetch(snapshotUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    clearTimeout(timeout)

    if (!res.ok) { cache.set(snapshotUrl, null); return null }

    const html = await res.text()

    // Try og:image first (most reliable)
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
    if (ogImage && ogImage.startsWith('http')) {
      cache.set(snapshotUrl, ogImage)
      return ogImage
    }

    // Try finding a video thumbnail
    const videoThumb = html.match(/thumbnail_url["']?\s*:\s*["']([^"']+)["']/i)?.[1]
      || html.match(/"thumbnailUrl"\s*:\s*"([^"]+)"/i)?.[1]
    if (videoThumb && videoThumb.startsWith('http')) {
      cache.set(snapshotUrl, videoThumb)
      return videoThumb
    }

    // Try finding main image in content
    const imgUrl = html.match(/<img[^>]+src=["'](https:\/\/[^"']+(?:fbcdn|fbsbx|cdninstagram)[^"']+)["']/i)?.[1]
    if (imgUrl) {
      cache.set(snapshotUrl, imgUrl)
      return imgUrl
    }

    cache.set(snapshotUrl, null)
    return null
  } catch {
    cache.set(snapshotUrl, null)
    return null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const adId = searchParams.get('ad_id')
  const snapshotUrl = searchParams.get('url')

  if (!snapshotUrl || !adId) {
    return NextResponse.json({ thumbnail: null }, { status: 400 })
  }

  const admin = createAdminClient()

  // Check if already cached in DB
  const { data: existing } = await admin
    .from('discovery_ads_index')
    .select('thumbnail_url')
    .eq('ad_id', adId)
    .single()

  if (existing?.thumbnail_url) {
    return NextResponse.json({ thumbnail: existing.thumbnail_url })
  }

  // Extract thumbnail from snapshot
  const thumbnail = await extractThumbnail(snapshotUrl)

  // Cache in DB if found
  if (thumbnail) {
    await admin.from('discovery_ads_index')
      .update({ thumbnail_url: thumbnail })
      .eq('ad_id', adId)
  }

  return NextResponse.json(
    { thumbnail },
    { headers: { 'Cache-Control': 'public, max-age=3600' } }
  )
}
