/**
 * Thumbnail extractor — gets actual ad creative image/video from the
 * public Facebook Ads Library page (no login required).
 * facebook.com/ads/library/?id=XXX has og:image set to the real creative.
 * Results cached in discovery_ads_index.thumbnail_url
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const cache = new Map<string, string | null>()

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
}

function extractFromHtml(html: string): string | null {
  // 1. og:image — most reliable, Facebook sets this to the actual creative
  const og1 = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1]
  const og2 = html.match(/content="([^"]+)"\s+property="og:image"/)?.[1]
  const og3 = html.match(/property='og:image'\s+content='([^']+)'/)?.[1]
  const ogImage = og1 || og2 || og3
  if (ogImage?.startsWith('http')) return decodeHtmlEntities(ogImage)

  // 2. twitter:image
  const tw = html.match(/name="twitter:image"\s+content="([^"]+)"/)?.[1]
    || html.match(/content="([^"]+)"\s+name="twitter:image"/)?.[1]
  if (tw?.startsWith('http')) return decodeHtmlEntities(tw)

  // 3. JSON-LD thumbnail
  const jld = html.match(/"thumbnailUrl"\s*:\s*"(https:[^"]+)"/)?.[1]
    || html.match(/"thumbnail_url"\s*:\s*"(https:[^"]+)"/)?.[1]
  if (jld) return decodeHtmlEntities(jld)

  // 4. Direct fbcdn image URLs in the page
  const fbcdn = html.match(/https:\/\/[a-z0-9-]+\.fbcdn\.net\/[^"'\s>]{20,}/g)
  if (fbcdn?.length) {
    // Prefer larger images (skip small icons)
    const large = fbcdn.find(u => u.includes('_n.') || u.includes('_o.') || u.length > 100)
    if (large) return large
    return fbcdn[0]
  }

  // 5. Instagram CDN
  const ig = html.match(/https:\/\/[a-z0-9-]+\.cdninstagram\.com\/[^"'\s>]{20,}/g)
  if (ig?.length) return ig[0]

  return null
}

function decodeHtmlEntities(str: string): string {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
}

async function fetchAndExtract(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 10000)
    const res = await fetch(url, { signal: controller.signal, headers: HEADERS })
    clearTimeout(t)
    if (!res.ok) return null
    const html = await res.text()
    return extractFromHtml(html)
  } catch {
    return null
  }
}

async function getThumbnail(adId: string, snapshotUrl: string): Promise<string | null> {
  const cacheKey = adId
  if (cache.has(cacheKey)) return cache.get(cacheKey)!

  // Strategy 1: Public Ads Library page — no login needed, has og:image = actual creative
  const publicLibraryUrl = `https://www.facebook.com/ads/library/?id=${adId}&country=ALL`
  let thumb = await fetchAndExtract(publicLibraryUrl)

  // Strategy 2: render_ad snapshot URL (includes access_token)
  if (!thumb && snapshotUrl) {
    thumb = await fetchAndExtract(snapshotUrl)
  }

  // Strategy 3: Try without country param
  if (!thumb) {
    thumb = await fetchAndExtract(`https://www.facebook.com/ads/library/?id=${adId}`)
  }

  cache.set(cacheKey, thumb)
  return thumb
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const adId = searchParams.get('ad_id')
  const snapshotUrl = searchParams.get('url') || ''

  if (!adId) return NextResponse.json({ thumbnail: null }, { status: 400 })

  const admin = createAdminClient()

  // Return cached DB value immediately if exists
  const { data: existing } = await admin
    .from('discovery_ads_index')
    .select('thumbnail_url')
    .eq('ad_id', adId)
    .single()

  if (existing?.thumbnail_url) {
    return NextResponse.json(
      { thumbnail: existing.thumbnail_url },
      { headers: { 'Cache-Control': 'public, max-age=86400' } }
    )
  }

  // Extract thumbnail
  const thumbnail = await getThumbnail(adId, snapshotUrl)

  // Persist to DB
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
