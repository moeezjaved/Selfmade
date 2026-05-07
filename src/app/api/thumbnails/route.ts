/**
 * Thumbnail & Video Extractor — background job
 *
 * Processes ads that have snapshot_url but no thumbnail_url.
 * Uses Browserless (real Chrome) to:
 *   1. Navigate to the Meta ad snapshot page
 *   2. For IMAGE ads: screenshot the creative area → upload JPEG to R2
 *   3. For VIDEO ads: extract the <video> src URL → download MP4 → upload to R2
 *
 * Run via: GET /api/thumbnails?secret=CRON_SECRET
 * Or add a Vercel cron: every 30 min → /api/thumbnails
 *
 * Requires env vars:
 *   BROWSERLESS_TOKEN   — Browserless.io API token (runs real Chrome)
 *   R2_ACCOUNT_ID       — Cloudflare R2 account
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME      — e.g. "selfmade-ads"
 *   R2_PUBLIC_URL       — public URL prefix, e.g. "https://cdn.tryselfmade.ai"
 *
 * Falls back gracefully if Browserless or R2 is not configured.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { uploadToR2, isR2Configured } from '@/lib/r2'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BATCH = 30          // ads to process per run (Browserless ~5s each → 150s total)
const SCREENSHOT_TIMEOUT = 20_000  // 20s per ad max

// ── Auth ─────────────────────────────────────────────────────
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = req.nextUrl.searchParams.get('secret')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || secret === cronSecret) return true
  const header = req.headers.get('authorization')
  if (header === `Bearer ${cronSecret}`) return true
  try {
    const sb = await createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (user) return true
  } catch { /* ignore */ }
  return false
}

// ── Browserless screenshot ────────────────────────────────────
// Renders the Meta snapshot URL with real Chrome and returns a JPEG buffer.
async function screenshotAd(snapshotUrl: string): Promise<Buffer | null> {
  const token = process.env.BROWSERLESS_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`https://chrome.browserless.io/screenshot?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: snapshotUrl,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 15000 },
        waitFor: 3000,           // let ad creative fully render
        options: {
          type: 'jpeg',
          quality: 85,
          // Clip to the creative area — Meta's snapshot page shows the ad
          // centered in the viewport. Capture the top portion where the creative is.
          clip: { x: 0, y: 0, width: 540, height: 540 },
          fullPage: false,
        },
        viewport: { width: 540, height: 800 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      }),
      signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength < 5000) return null  // empty/broken screenshot
    return Buffer.from(buf)
  } catch {
    return null
  }
}

// ── Browserless video URL extraction ────────────────────────
// Renders the snapshot page, evaluates JS to find the <video> src,
// and returns the direct fbcdn.net video URL.
async function extractVideoUrl(snapshotUrl: string): Promise<string | null> {
  const token = process.env.BROWSERLESS_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`https://chrome.browserless.io/function?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: `
          module.exports = async ({ page }) => {
            await page.goto(${JSON.stringify(snapshotUrl)}, { waitUntil: 'networkidle2', timeout: 15000 });
            await page.waitForTimeout(3000);
            // Try to find video element src
            const videoSrc = await page.evaluate(() => {
              const v = document.querySelector('video');
              return v ? (v.src || v.currentSrc || null) : null;
            });
            if (videoSrc && videoSrc.includes('fbcdn.net')) return { videoSrc };
            // Fallback: search in page source for playable_url
            const html = await page.content();
            const m = html.match(/"playable_url":"([^"]+)"/);
            return { videoSrc: m ? m[1].replace(/\\\\u0026/g, '&').replace(/\\\\\//g, '/') : null };
          };
        `,
        context: {},
      }),
      signal: AbortSignal.timeout(SCREENSHOT_TIMEOUT),
    })
    if (!res.ok) return null
    const json = await res.json() as { videoSrc?: string | null }
    const url = json?.videoSrc
    if (!url || !url.includes('fbcdn.net')) return null
    return url
  } catch {
    return null
  }
}

// ── Upload Buffer to R2 ───────────────────────────────────────
async function uploadBufferToR2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string | null> {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL } = process.env
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_URL) return null
  try {
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

// ── Main handler ─────────────────────────────────────────────
export async function GET(req: NextRequest) {
  if (!await isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const blToken = process.env.BROWSERLESS_TOKEN
  const r2Ready = isR2Configured()

  if (!blToken) {
    return NextResponse.json({
      error: 'BROWSERLESS_TOKEN not set — add it in Vercel env vars',
      hint: 'Sign up at browserless.io ($29/mo) for real Chrome rendering',
    }, { status: 501 })
  }
  if (!r2Ready) {
    return NextResponse.json({
      error: 'R2 not configured — add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL to Vercel env vars',
    }, { status: 501 })
  }

  const admin = createAdminClient()

  // Fetch ads that have snapshot_url but no real thumbnail
  const { data: ads } = await admin
    .from('discovery_ads_index')
    .select('ad_id, snapshot_url, format, page_id')
    .not('snapshot_url', 'is', null)
    .is('thumbnail_url', null)
    .order('last_seen', { ascending: false })
    .limit(BATCH)

  if (!ads?.length) {
    return NextResponse.json({ processed: 0, message: 'No ads need thumbnails' })
  }

  let thumbnailed = 0
  let videoed = 0
  let failed = 0

  for (const ad of ads) {
    const isVideo = (ad.format || '').toLowerCase().includes('video')

    try {
      if (isVideo) {
        // ── Video: extract playable URL, download, upload to R2 ──────
        const videoUrl = await extractVideoUrl(ad.snapshot_url)
        if (videoUrl) {
          // Also screenshot for thumbnail
          const [thumbBuf, videoR2] = await Promise.all([
            screenshotAd(ad.snapshot_url),
            uploadToR2(videoUrl, `videos/${ad.ad_id}.mp4`, 'video/mp4'),
          ])
          const thumbR2 = thumbBuf
            ? await uploadBufferToR2(thumbBuf, `thumbnails/${ad.ad_id}.jpg`, 'image/jpeg')
            : null
          await admin.from('discovery_ads_index').update({
            thumbnail_url: thumbR2,
            video_url: videoR2,
          }).eq('ad_id', ad.ad_id)
          videoed++
        } else {
          // Can't get video URL — just screenshot for thumbnail
          const thumbBuf = await screenshotAd(ad.snapshot_url)
          if (thumbBuf) {
            const thumbR2 = await uploadBufferToR2(thumbBuf, `thumbnails/${ad.ad_id}.jpg`, 'image/jpeg')
            await admin.from('discovery_ads_index').update({ thumbnail_url: thumbR2 }).eq('ad_id', ad.ad_id)
            thumbnailed++
          } else {
            failed++
          }
        }
      } else {
        // ── Image: screenshot the rendered ad → upload JPEG to R2 ────
        const thumbBuf = await screenshotAd(ad.snapshot_url)
        if (thumbBuf) {
          const thumbR2 = await uploadBufferToR2(thumbBuf, `thumbnails/${ad.ad_id}.jpg`, 'image/jpeg')
          await admin.from('discovery_ads_index').update({ thumbnail_url: thumbR2 }).eq('ad_id', ad.ad_id)
          thumbnailed++
        } else {
          failed++
        }
      }
    } catch {
      failed++
    }
  }

  return NextResponse.json({
    processed: ads.length,
    thumbnailed,
    videoed,
    failed,
    message: `${thumbnailed} image thumbnails + ${videoed} videos uploaded to R2. ${failed} failed.`,
  })
}
