/**
 * Test endpoint — verifies CDN URL extraction WITHOUT R2.
 *
 * Picks up to 10 ads from the DB, fetches each snapshot page,
 * tries to extract the real scontent/video CDN URLs, and returns
 * what it found. No downloads, no uploads, no R2 needed.
 *
 * GET /api/thumbnails/test?secret=CRON_SECRET&limit=5
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = req.nextUrl.searchParams.get('secret')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || secret === cronSecret) return true
  if (req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  try {
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (user) return true
  } catch { /* ignore */ }
  return false
}

function decFb(s: string): string {
  return s
    .replace(/\\u0026/g, '&')
    .replace(/\\u003C/g, '<')
    .replace(/\\u003E/g, '>')
    .replace(/\\u0025/g, '%')
    .replace(/&amp;/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
}

function extractCDNUrls(html: string): { imageUrl: string | null; videoUrl: string | null } {
  let imageUrl: string | null = null
  let videoUrl: string | null = null

  const videoPatterns: RegExp[] = [
    /"playable_url"\s*:\s*"(https?:\\?\/\\?\/video[^"\\]{10,})"/,
    /"playable_url_quality_hd"\s*:\s*"(https?:\\?\/\\?\/video[^"\\]{10,})"/,
    /"hd_src"\s*:\s*"(https?:\\?\/\\?\/video[^"\\]{10,})"/,
    /"sd_src"\s*:\s*"(https?:\\?\/\\?\/video[^"\\]{10,})"/,
    /"browser_native_hd_url"\s*:\s*"(https?:\\?\/\\?\/video[^"\\]{10,})"/,
    /"browser_native_sd_url"\s*:\s*"(https?:\\?\/\\?\/video[^"\\]{10,})"/,
  ]
  for (const pat of videoPatterns) {
    const m = html.match(pat)
    if (m?.[1]) {
      const url = decFb(m[1])
      if (url.includes('fbcdn.net') || url.includes('facebook.com')) {
        videoUrl = url
        break
      }
    }
  }

  const imagePatterns: RegExp[] = [
    /property="og:image"\s+content="([^"]+)"/,
    /content="([^"]+)"\s+property="og:image"/,
    /"uri"\s*:\s*"(https?:\\?\/\\?\/scontent[^"\\]{20,}\.(?:jpg|jpeg|png|webp)[^"\\]*)"/i,
    /"image_url"\s*:\s*"(https?:\\?\/\\?\/scontent[^"\\]{20,})"/i,
    /"resized_image_url"\s*:\s*"(https?:\\?\/\\?\/scontent[^"\\]{20,})"/i,
    /"thumbnail_url"\s*:\s*"(https?:\\?\/\\?\/scontent[^"\\]{20,})"/i,
    /"imageURL"\s*:\s*"(https?:\\?\/\\?\/[^"\\]*fbcdn[^"\\]{20,}\.(?:jpg|jpeg|png|webp)[^"\\]*)"/i,
    /"(https?:\\?\/\\?\/scontent[^"\\]{30,}\.(?:jpg|jpeg|png)[^"\\]*)"/i,
  ]
  for (const pat of imagePatterns) {
    const m = html.match(pat)
    const raw = m?.[1]
    if (!raw) continue
    const url = decFb(raw)
    if (
      url.startsWith('http') &&
      (url.includes('fbcdn.net') || url.includes('scontent')) &&
      !url.includes('/emoji') &&
      !url.includes('profile') &&
      !url.includes('picture') &&
      url.length > 40
    ) {
      imageUrl = url
      break
    }
  }

  return { imageUrl, videoUrl }
}

export async function GET(req: NextRequest) {
  if (!await isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '5'), 10)

  // Pick ads that have snapshot URLs but no R2 thumbnail yet
  const { data: ads, error } = await admin
    .from('discovery_ads_index')
    .select('ad_id, snapshot_url, format, page_name')
    .not('snapshot_url', 'is', null)
    .is('thumbnail_url', null)
    .order('last_seen', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!ads?.length) return NextResponse.json({ message: 'No ads found with snapshot URLs' })

  const results = await Promise.all(ads.map(async (ad: { ad_id: string; snapshot_url: string; format: string | null; page_name: string | null }) => {
    const result: {
      ad_id: string
      page_name: string
      format: string | null
      snapshot_url: string
      html_fetched: boolean
      html_bytes: number
      image_url: string | null
      video_url: string | null
      status: string
    } = {
      ad_id: ad.ad_id,
      page_name: ad.page_name || '',
      format: ad.format,
      snapshot_url: ad.snapshot_url,
      html_fetched: false,
      html_bytes: 0,
      image_url: null,
      video_url: null,
      status: 'pending',
    }

    try {
      const res = await fetch(ad.snapshot_url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(12000),
      })

      if (!res.ok) {
        result.status = `http_${res.status}`
        return result
      }

      const html = await res.text()
      result.html_fetched = true
      result.html_bytes = html.length

      const { imageUrl, videoUrl } = extractCDNUrls(html)
      result.image_url = imageUrl
      result.video_url = videoUrl

      if (imageUrl || videoUrl) {
        result.status = '✅ found'
      } else {
        result.status = '❌ no_cdn_url_found'
      }
    } catch (e) {
      result.status = `error: ${e instanceof Error ? e.message : String(e)}`
    }

    return result
  }))

  const found = results.filter(r => r.image_url || r.video_url).length
  const fetched = results.filter(r => r.html_fetched).length

  return NextResponse.json({
    summary: `${found}/${results.length} ads had extractable CDN URLs (${fetched} pages fetched successfully)`,
    success_rate: `${Math.round((found / results.length) * 100)}%`,
    results,
    next_step: found > 0
      ? '✅ Extraction works! Add R2 env vars and hit /api/thumbnails to start storing real creatives.'
      : '⚠️ No CDN URLs found. Meta may be blocking plain fetch for these ads — try different snapshot URLs or check the HTML.',
  })
}
