/**
 * Creative Extractor — background job (scalable, no headless Chrome)
 *
 * How it works:
 *  1. Fetch the Meta ad snapshot page via plain HTTP (free, fast, parallelizable)
 *  2. Parse the inline JSON/HTML to extract the actual CDN URLs:
 *       Images: scontent.fbcdn.net / scontent-*.fbcdn.net
 *       Videos: video-*.fbcdn.net / video.fbcdn.net (playable_url)
 *  3. Download the raw media file directly from Facebook's CDN
 *  4. Upload to Cloudflare R2 with immutable cache headers
 *  5. Update discovery_ads_index with permanent R2 URLs
 *
 * This scales to millions of ads — each ad is 3 HTTP calls (fetch HTML,
 * download media, upload to R2). No headless Chrome, no screenshots,
 * no UI chrome captured. Pure raw creative files.
 *
 * Run via: GET /api/thumbnails?secret=CRON_SECRET&batch=100
 * Add to vercel.json cron every 5 min to continuously drain the queue.
 *
 * Requires:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
 *   R2_BUCKET_NAME, R2_PUBLIC_URL
 * Optional (for ads where plain fetch fails):
 *   BROWSERLESS_TOKEN (fallback for JS-heavy pages)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { isR2Configured } from '@/lib/r2'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// ── Auth ─────────────────────────────────────────────────────
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

// ── Decode Facebook's escaped JSON strings ────────────────────
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

// ── Extract raw CDN URLs from Meta snapshot page HTML ─────────
// Meta's snapshot pages include the creative data as inline JSON in
// <script> tags even before JavaScript executes. We parse that data
// to get the actual scontent/video CDN URLs for the raw creative file.
function extractCDNUrls(html: string): { imageUrl: string | null; videoUrl: string | null } {
  let imageUrl: string | null = null
  let videoUrl: string | null = null

  // ── Video: playable_url is embedded in inline JSON ───────────
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

  // ── Image: scontent CDN URLs in inline JSON or og:image ──────
  const imagePatterns: RegExp[] = [
    // og:image meta tag (server-rendered, most reliable)
    /property="og:image"\s+content="([^"]+)"/,
    /content="([^"]+)"\s+property="og:image"/,
    // Inline JSON patterns
    /"uri"\s*:\s*"(https?:\\?\/\\?\/scontent[^"\\]{20,}\.(?:jpg|jpeg|png|webp)[^"\\]*)"/i,
    /"image_url"\s*:\s*"(https?:\\?\/\\?\/scontent[^"\\]{20,})"/i,
    /"resized_image_url"\s*:\s*"(https?:\\?\/\\?\/scontent[^"\\]{20,})"/i,
    /"thumbnail_url"\s*:\s*"(https?:\\?\/\\?\/scontent[^"\\]{20,})"/i,
    /"imageURL"\s*:\s*"(https?:\\?\/\\?\/[^"\\]*fbcdn[^"\\]{20,}\.(?:jpg|jpeg|png|webp)[^"\\]*)"/i,
    // Direct scontent URL in any quoted context
    /"(https?:\\?\/\\?\/scontent[^"\\]{30,}\.(?:jpg|jpeg|png)[^"\\]*)"/i,
  ]
  for (const pat of imagePatterns) {
    const m = html.match(pat)
    const raw = m?.[1]
    if (!raw) continue
    const url = decFb(raw)
    // Must be a real CDN URL, not an emoji/icon/avatar
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

// ── Fetch the snapshot page HTML ─────────────────────────────
// Plain HTTP fetch — no headless Chrome, no cost, parallelizable.
// Facebook SSR includes creative data in inline <script> JSON for most ads.
async function fetchSnapshotHtml(snapshotUrl: string): Promise<string | null> {
  try {
    const res = await fetch(snapshotUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ── Browserless: real Chrome → extract CDN URLs from DOM ─────
// Meta's render_ad endpoint requires a real browser (plain HTTP always
// returns 400). Browserless loads it in actual Chrome, waits for images
// and videos to appear in the DOM, then extracts the raw fbcdn.net URLs.
// No screenshots — just DOM attribute extraction. Fast (~2-3s per ad).
// 10 concurrent = ~200 ads/min = millions per month on $29/mo plan.
async function fetchWithBrowserless(snapshotUrl: string): Promise<{ imageUrl: string | null; videoUrl: string | null }> {
  const token = process.env.BROWSERLESS_TOKEN
  if (!token) return { imageUrl: null, videoUrl: null }
  try {
    const res = await fetch(`https://chrome.browserless.io/function?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `
          module.exports = async ({ page }) => {
            // Block unnecessary resources to speed up load
            await page.setRequestInterception(true);
            page.on('request', (req) => {
              const type = req.resourceType();
              if (['font', 'stylesheet'].includes(type)) {
                req.abort();
              } else {
                req.continue();
              }
            });

            await page.goto(${JSON.stringify(snapshotUrl)}, {
              waitUntil: 'domcontentloaded',
              timeout: 15000,
            });

            // Wait up to 5s for images/videos to appear in the DOM
            try {
              await page.waitForFunction(
                () => {
                  const img = document.querySelector('img[src*="fbcdn"]') ||
                              document.querySelector('img[src*="scontent"]');
                  const vid = document.querySelector('video[src]') ||
                              document.querySelector('video source[src]');
                  return !!(img || vid);
                },
                { timeout: 5000 }
              );
            } catch (_) { /* timeout — still try to extract below */ }

            return page.evaluate(() => {
              // Video: prefer highest quality src
              let videoUrl = null;
              const videoEl = document.querySelector('video');
              if (videoEl) {
                videoUrl = videoEl.src || videoEl.currentSrc || null;
                if (!videoUrl) {
                  const src = videoEl.querySelector('source');
                  if (src) videoUrl = src.src || null;
                }
              }

              // Image: biggest fbcdn image that isn't a profile pic or icon
              let imageUrl = null;
              const imgs = Array.from(document.querySelectorAll('img'));
              const cdnImgs = imgs.filter(img =>
                img.src &&
                (img.src.includes('fbcdn.net') || img.src.includes('scontent')) &&
                !img.src.includes('/emoji') &&
                !img.src.includes('profile') &&
                !img.src.includes('picture') &&
                img.naturalWidth > 100
              );
              // Pick the largest image by width
              cdnImgs.sort((a, b) => b.naturalWidth - a.naturalWidth);
              if (cdnImgs[0]) imageUrl = cdnImgs[0].src;

              return { videoUrl, imageUrl };
            });
          };
        `,
        context: {},
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return { imageUrl: null, videoUrl: null }
    const json = await res.json() as { videoUrl?: string; imageUrl?: string }
    return {
      videoUrl: json?.videoUrl?.includes('fbcdn') ? json.videoUrl : null,
      imageUrl: json?.imageUrl?.includes('fbcdn') ? json.imageUrl : null,
    }
  } catch {
    return { imageUrl: null, videoUrl: null }
  }
}

// ── Download from CDN and upload to R2 ───────────────────────
async function downloadAndUploadToR2(
  cdnUrl: string,
  key: string,
  contentType: string,
): Promise<string | null> {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const {
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME, R2_PUBLIC_URL,
  } = process.env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_URL) return null

  try {
    // Download the raw file from Facebook's CDN
    const mediaRes = await fetch(cdnUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.facebook.com/',
        'Accept': contentType.startsWith('video') ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(30000),
    })
    if (!mediaRes.ok) return null

    const buffer = Buffer.from(await mediaRes.arrayBuffer())
    if (buffer.byteLength < 2000) return null // skip empty/broken files

    // Upload to R2
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    })
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }))

    return `${R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`
  } catch {
    return null
  }
}

// ── Process a single ad ───────────────────────────────────────
// Meta's render_ad endpoint requires a real browser — plain HTTP always
// returns 400. So Browserless (real Chrome) is the primary path.
// Each ad = 1 Browserless call (~2-3s) + 1-2 CDN downloads + 1-2 R2 uploads.
async function processAd(ad: {
  ad_id: string
  snapshot_url: string
  format: string | null
}): Promise<{ thumbnail: string | null; video: string | null; method: string }> {
  let imageUrl: string | null = null
  let videoUrl: string | null = null
  let method = 'none'

  // Primary: Browserless real Chrome — extracts raw CDN URLs from DOM
  if (process.env.BROWSERLESS_TOKEN) {
    const blResult = await fetchWithBrowserless(ad.snapshot_url)
    imageUrl = blResult.imageUrl
    videoUrl = blResult.videoUrl
    if (imageUrl || videoUrl) method = 'browserless'
  }

  if (!imageUrl && !videoUrl) {
    return { thumbnail: null, video: null, method }
  }

  // Download raw file from fbcdn.net and upload to R2
  const [thumbR2, videoR2] = await Promise.all([
    imageUrl ? downloadAndUploadToR2(imageUrl, `thumbnails/${ad.ad_id}.jpg`, 'image/jpeg') : Promise.resolve(null),
    videoUrl ? downloadAndUploadToR2(videoUrl, `videos/${ad.ad_id}.mp4`, 'video/mp4')     : Promise.resolve(null),
  ])

  return { thumbnail: thumbR2, video: videoR2, method }
}

// ── Main handler ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!await isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isR2Configured()) {
    return NextResponse.json({
      error: 'R2 not configured',
      required: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'],
      hint: 'Add these to Vercel env vars. R2 free tier: 10GB storage, unlimited egress.',
    }, { status: 501 })
  }

  const admin = createAdminClient()
  const batchSize = Math.min(parseInt(req.nextUrl.searchParams.get('batch') || '50'), 200)
  const onlyVideos = req.nextUrl.searchParams.get('videos') === '1'

  // Fetch ads that need thumbnail processing
  let query = admin
    .from('discovery_ads_index')
    .select('ad_id, snapshot_url, format')
    .not('snapshot_url', 'is', null)
    .is('thumbnail_url', null)
    .order('last_seen', { ascending: false })
    .limit(batchSize)

  if (onlyVideos) query = query.ilike('format', '%video%')

  const { data: ads, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!ads?.length) return NextResponse.json({ processed: 0, message: 'No ads need thumbnails' })

  // Process in parallel — concurrency of 10 to avoid CDN rate limits
  const CONCURRENCY = 10
  let thumbnailed = 0, videoed = 0, failed = 0
  const results: { ad_id: string; method: string; ok: boolean }[] = []

  for (let i = 0; i < ads.length; i += CONCURRENCY) {
    const batch = ads.slice(i, i + CONCURRENCY)
    await Promise.all(batch.map(async (ad: { ad_id: string; snapshot_url: string; format: string | null }) => {
      try {
        const { thumbnail, video, method } = await processAd(ad)
        if (thumbnail || video) {
          await admin.from('discovery_ads_index').update({
            ...(thumbnail ? { thumbnail_url: thumbnail } : {}),
            ...(video    ? { video_url: video }       : {}),
          }).eq('ad_id', ad.ad_id)
          if (thumbnail) thumbnailed++
          if (video) videoed++
          results.push({ ad_id: ad.ad_id, method, ok: true })
        } else {
          failed++
          results.push({ ad_id: ad.ad_id, method: 'none', ok: false })
        }
      } catch {
        failed++
        results.push({ ad_id: ad.ad_id, method: 'error', ok: false })
      }
    }))
  }

  // How many still need processing?
  const { count: remaining } = await admin
    .from('discovery_ads_index')
    .select('*', { count: 'exact', head: true })
    .is('thumbnail_url', null)
    .not('snapshot_url', 'is', null)

  return NextResponse.json({
    processed: ads.length,
    thumbnailed,
    videoed,
    failed,
    remaining: remaining ?? 0,
    message: `${thumbnailed} images + ${videoed} videos stored on R2. ${failed} failed. ${remaining ?? 0} remaining in queue.`,
  })
}
