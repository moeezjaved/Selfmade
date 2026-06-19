/**
 * Brand Preview — fetch first N ads for a page_id WITHOUT saving anywhere.
 *
 * Migrated 2026-05-15 from the deprecated Meta Graph API path (which
 * required access_tokens that have expired) to the same token-free public
 * Ads Library URL the droplet indexer uses.
 *
 * Approach:
 *   1. GET https://www.facebook.com/ads/library/?view_all_page_id={pageId}
 *      with a browser-like User-Agent. Meta server-renders the first ~30
 *      ads as embedded JSON inside <script> tags.
 *   2. Brace-match every "ad_archive_id":"..." occurrence to its
 *      enclosing JSON object (same parser the droplet's playwright-indexer
 *      uses — verified against Hims/Nike/Gymshark schema 2026-05-14).
 *   3. Extract structured creative URLs from snapshot.images / videos /
 *      cards (full-resolution original_image_url + video_hd_url).
 *   4. Return { page, ads } so the admin UI can show samples.
 *
 * Trade-offs vs the old Graph-API path:
 *   + No tokens to manage / refresh
 *   + Returns full-resolution image URLs (Graph returned only snapshot links)
 *   + Future-proof — same path our scraper uses, so if it works the brand
 *     will index successfully too
 *   - May rate-limit if previewed too aggressively from one Vercel region
 *     (acceptable for occasional admin use)
 *
 * GET /api/admin/brands/preview?page_id=129669023798560&limit=10
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export const runtime = 'nodejs'   // ProxyAgent needs Node runtime, not Edge

/**
 * Build a residential proxy URL from env vars (matches the droplet's
 * IPRoyal sticky-session format — same credentials).
 *
 * Required env on Vercel for preview to work past Meta's IP gating:
 *   WORKER_PROXY_HOST  (e.g. "geo.iproyal.com")
 *   WORKER_PROXY_PORT  (default 12321)
 *   WORKER_PROXY_USER
 *   WORKER_PROXY_PASS
 */
function buildProxyAgent(): ProxyAgent | undefined {
  const host = process.env.WORKER_PROXY_HOST
  const user = process.env.WORKER_PROXY_USER
  const pass = process.env.WORKER_PROXY_PASS
  if (!host || !user || !pass) return undefined
  const port = process.env.WORKER_PROXY_PORT || '12321'
  // Random short session ID so each preview call rotates IP. No need for
  // sticky here — we make exactly one request per preview.
  const sid = Math.random().toString(36).slice(2, 10)
  const country = (process.env.WORKER_PROXY_COUNTRY || 'us').toLowerCase()
  // IPRoyal expects modifiers in the password field (verified format)
  const stickyPass = `${pass}_session-${sid}_lifetime-5m_country-${country}`
  const url = `http://${encodeURIComponent(user)}:${encodeURIComponent(stickyPass)}@${host}:${port}`
  return new ProxyAgent(url)
}

interface PreviewAd {
  ad_id: string
  body: string
  title: string
  page_name: string
  snapshot_url: string
  start_date: string | null
  stop_date: string | null
  is_active: boolean
  display_format: string | null
  image_urls: string[]      // raw fbcdn image URLs (full resolution)
  video_urls: string[]      // raw fbcdn video URLs (HD preferred)
  video_preview_urls: string[]
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('page_id')?.trim()
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '10'), 30)
  if (!pageId || !/^\d+$/.test(pageId)) {
    return NextResponse.json({ error: 'page_id required (numeric)' }, { status: 400 })
  }

  // ── PRIMARY PATH: call the droplet's preview-server ──
  // The droplet uses real Playwright + IPRoyal sticky session, which Meta
  // accepts. Vercel-side bare fetches (even through residential proxy) get
  // 403'd because Meta fingerprints TLS handshake + missing browser cookies.
  const dropletUrl = process.env.DROPLET_PREVIEW_URL          // e.g. http://24.199.113.41:8787
  const dropletSecret = process.env.PREVIEW_SECRET
  let dropletError: string | null = null
  let dropletStatus: number | null = null

  if (dropletUrl && dropletSecret) {
    try {
      const u = new URL('/preview', dropletUrl)
      u.searchParams.set('page_id', pageId)
      u.searchParams.set('limit', String(limit))
      const dRes = await undiciFetch(u.toString(), {
        headers: { 'X-Preview-Secret': dropletSecret },
        signal: AbortSignal.timeout(45_000),
      })
      dropletStatus = dRes.status
      if (dRes.ok) {
        const data = await dRes.json()
        return NextResponse.json(data)
      }
      const txt = await dRes.text().catch(() => '')
      dropletError = `HTTP ${dRes.status}: ${txt.slice(0, 300)}`
      console.warn('[preview] droplet returned', dropletError)
    } catch (err: any) {
      dropletError = `${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`
      console.warn('[preview] droplet unreachable:', dropletError)
    }
  }

  // If droplet is configured but failed, surface the exact error rather than
  // silently falling through (the fallback also 403s, so we'd just hide the
  // real cause).
  if (dropletUrl && dropletSecret && dropletError) {
    return NextResponse.json({
      error: 'Droplet preview-server unreachable or returned error',
      droplet_configured: true,
      droplet_url: dropletUrl,
      droplet_status: dropletStatus,
      droplet_error: dropletError,
      hint: 'Curl the droplet directly to verify it works. Common causes: firewall blocks Vercel outbound, droplet container crashed, secret mismatch.',
    }, { status: 502 })
  }

  // ── FALLBACK PATH: direct Vercel fetch via residential proxy ──
  // Often 403's (Meta gates bare cloud-origin requests even through residential
  // proxy because of TLS fingerprinting), but kept as a safety net for when
  // the droplet endpoint is misconfigured or down.
  const url = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${encodeURIComponent(pageId)}`
  const dispatcher = buildProxyAgent()
  const usingProxy = !!dispatcher

  try {
    const res = await undiciFetch(url, {
      dispatcher,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: AbortSignal.timeout(25_000),
    })

    if (!res.ok) {
      return NextResponse.json({
        error: `Meta returned HTTP ${res.status}`,
        proxy_used: usingProxy,
        droplet_configured: !!(dropletUrl && dropletSecret),
        hint: !dropletUrl
          ? 'Set DROPLET_PREVIEW_URL + PREVIEW_SECRET on Vercel to use the droplet preview server (recommended — Meta blocks bare-fetch from cloud IPs).'
          : !usingProxy
            ? 'Droplet preview unavailable + WORKER_PROXY_* not set. Add proxy env vars or fix droplet.'
            : 'Bare-fetch through proxy is unreliable. Make sure droplet preview-server container is running.',
      }, { status: 502 })
    }

    const html = await res.text()
    const adObjects = extractAdsBraceMatched(html)

    if (adObjects.length === 0) {
      return NextResponse.json({
        page: null,
        ads: [],
        total_returned: 0,
        warning: 'No ads found in Meta response. Either the page_id is wrong, this brand has no ads, or Meta is currently gating the request from this server.',
      })
    }

    // Build a "page" summary from the first ad's snapshot.
    // Field names (picture, follower_count, etc.) match the keys the
    // existing PreviewDrawer in admin/brands/page.tsx already reads.
    const firstSnap = adObjects[0]?.snapshot || {}
    const page = {
      page_id: pageId,
      name: firstSnap.page_name || null,
      category: Array.isArray(firstSnap.page_categories) ? firstSnap.page_categories[0] : null,
      follower_count: typeof firstSnap.page_like_count === 'number' ? firstSnap.page_like_count : null,
      picture: firstSnap.page_profile_picture_url || null,
      website: firstSnap.page_profile_uri || null,
      link: firstSnap.page_profile_uri || null,
      verified: false, // not exposed in this payload — would need a separate page_info request to determine
    }

    const ads: PreviewAd[] = adObjects.slice(0, limit).map((obj: any) => {
      const snap = obj.snapshot || {}
      const media = extractMediaUrls(snap)
      return {
        ad_id: String(obj.ad_archive_id),
        body: snap.body?.text || '',
        title: snap.title || snap.link_description || '',
        page_name: snap.page_name || '',
        snapshot_url: `https://www.facebook.com/ads/library/?id=${obj.ad_archive_id}`,
        start_date: obj.start_date_string || (obj.start_date ? new Date(obj.start_date * 1000).toISOString() : null),
        stop_date: obj.end_date_string || (obj.end_date ? new Date(obj.end_date * 1000).toISOString() : null),
        is_active: !!obj.is_active,
        display_format: snap.display_format || null,
        image_urls: media.images,
        video_urls: media.videos,
        video_preview_urls: media.videoPreviews,
      }
    })

    return NextResponse.json({
      page,
      ads,
      total_returned: ads.length,
      total_found: adObjects.length,
    })
  } catch (err: any) {
    return NextResponse.json({
      error: err?.name === 'TimeoutError'
        ? 'Meta took too long to respond (20s timeout). Try again.'
        : err?.message || String(err),
    }, { status: 500 })
  }
}

/**
 * Brace-match every ad_archive_id occurrence to its enclosing JSON object.
 * Mirrors playwright-indexer.ts extractAdsFromText (verified parser).
 */
function extractAdsBraceMatched(text: string): any[] {
  const found: any[] = []
  const adIdRegex = /"ad_archive_id"\s*:\s*"(\d{10,})"/g
  const positions: number[] = []
  let m: RegExpExecArray | null
  while ((m = adIdRegex.exec(text)) !== null) {
    positions.push(m.index)
  }
  for (const pos of positions) {
    let start = pos
    while (start > 0 && text[start] !== '{') start--
    let depth = 0, end = start
    for (let i = start; i < text.length && i < start + 250_000; i++) {
      if (text[i] === '{') depth++
      else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    if (end === start) continue
    try {
      const obj = JSON.parse(text.slice(start, end))
      if (obj.ad_archive_id) found.push(obj)
    } catch { /* malformed slice — skip */ }
  }
  return found
}

/**
 * Pull creative URLs out of a snapshot using the verified GraphQL schema.
 * Mirrors worker/src/playwright-indexer.ts extractMediaUrls().
 */
function extractMediaUrls(snap: any): {
  images: string[]
  videos: string[]
  videoPreviews: string[]
} {
  const images = new Set<string>()
  const videos = new Set<string>()
  const videoPreviews = new Set<string>()

  const pushImg = (...candidates: any[]) => {
    for (const c of candidates) {
      if (typeof c === 'string' && c.startsWith('http') && c.includes('fbcdn')) {
        images.add(c); return
      }
    }
  }
  const pushVid = (...candidates: any[]) => {
    for (const c of candidates) {
      if (typeof c === 'string' && c.startsWith('http') && c.includes('fbcdn')) {
        videos.add(c); return
      }
    }
  }
  const pushPrev = (...candidates: any[]) => {
    for (const c of candidates) {
      if (typeof c === 'string' && c.startsWith('http') && c.includes('fbcdn')) {
        videoPreviews.add(c); return
      }
    }
  }

  if (Array.isArray(snap?.images)) for (const i of snap.images) {
    pushImg(i?.original_image_url, i?.resized_image_url)
  }
  if (Array.isArray(snap?.videos)) for (const v of snap.videos) {
    pushVid(v?.video_hd_url, v?.video_sd_url)
    pushPrev(v?.video_preview_image_url)
  }
  if (Array.isArray(snap?.cards)) for (const c of snap.cards) {
    pushImg(c?.original_image_url, c?.resized_image_url)
    pushVid(c?.video_hd_url, c?.video_sd_url)
    pushPrev(c?.video_preview_image_url)
  }
  if (Array.isArray(snap?.extra_images)) for (const i of snap.extra_images) {
    pushImg(i?.original_image_url, i?.resized_image_url)
  }
  if (Array.isArray(snap?.extra_videos)) for (const v of snap.extra_videos) {
    pushVid(v?.video_hd_url, v?.video_sd_url)
    pushPrev(v?.video_preview_image_url)
  }

  return {
    images: Array.from(images),
    videos: Array.from(videos),
    videoPreviews: Array.from(videoPreviews),
  }
}
