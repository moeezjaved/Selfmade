/**
 * Test endpoint — verifies Browserless CDN URL extraction WITHOUT R2.
 *
 * Runs SEQUENTIALLY (1 at a time) to respect Browserless concurrency limits.
 * Tries both v1 (chrome.browserless.io) and v2 (production-sfo.browserless.io)
 * endpoints automatically.
 *
 * GET /api/thumbnails/test?limit=2
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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

// Puppeteer script — extract raw CDN image/video URLs from DOM
const EXTRACT_SCRIPT = (snapshotUrl: string) => `
module.exports = async ({ page }) => {
  // Block fonts/CSS to speed up load
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const t = r.resourceType();
    if (t === 'font' || t === 'stylesheet') r.abort();
    else r.continue();
  });

  let httpStatus = 0;
  try {
    const resp = await page.goto(${JSON.stringify(snapshotUrl)}, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    httpStatus = resp ? resp.status() : 0;
  } catch (e) {
    return { error: 'goto_failed: ' + e.message, httpStatus };
  }

  // Wait up to 6s for an fbcdn image or video to appear
  try {
    await page.waitForFunction(() => {
      const img = document.querySelector('img[src*="fbcdn"]') ||
                  document.querySelector('img[src*="scontent"]');
      const vid = document.querySelector('video[src*="fbcdn"]') ||
                  document.querySelector('video source[src*="fbcdn"]');
      return !!(img || vid);
    }, { timeout: 6000 });
  } catch (_) { /* didn't appear — still try extraction */ }

  const result = await page.evaluate(() => {
    // Video URL
    let videoUrl = null;
    const videoEl = document.querySelector('video');
    if (videoEl) {
      videoUrl = videoEl.src || videoEl.currentSrc || null;
      if (!videoUrl) {
        const src = videoEl.querySelector('source');
        if (src) videoUrl = src.getAttribute('src');
      }
    }

    // Image URL — largest fbcdn img that isn't a profile/icon
    let imageUrl = null;
    const imgs = Array.from(document.querySelectorAll('img'));
    const cdnImgs = imgs.filter(img =>
      img.src &&
      (img.src.includes('fbcdn.net') || img.src.includes('scontent')) &&
      !img.src.includes('/emoji') &&
      !img.src.includes('profile') &&
      !img.src.includes('picture') &&
      img.naturalWidth > 50
    );
    cdnImgs.sort((a, b) => b.naturalWidth - a.naturalWidth);
    if (cdnImgs[0]) imageUrl = cdnImgs[0].src;

    // Debug: all img srcs on the page
    const allImgSrcs = imgs.slice(0, 10).map(i => i.src).filter(Boolean);
    const htmlLen = document.documentElement.outerHTML.length;
    const title = document.title;

    return { videoUrl, imageUrl, allImgSrcs, htmlLen, title };
  });

  return { ...result, httpStatus };
};
`

async function callBrowserless(
  token: string,
  snapshotUrl: string,
): Promise<{ ok: boolean; status: number; body: string; endpoint: string }> {
  // Try v2 endpoint first, fall back to v1
  const endpoints = [
    `https://production-sfo.browserless.io/function?token=${token}`,
    `https://chrome.browserless.io/function?token=${token}`,
  ]

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: EXTRACT_SCRIPT(snapshotUrl), context: {} }),
        signal: AbortSignal.timeout(35000),
      })
      const body = await res.text()
      if (res.status !== 404) {
        // 404 means wrong endpoint — try next. Any other status = this endpoint works
        return { ok: res.ok, status: res.status, body, endpoint: endpoint.split('?')[0] }
      }
    } catch (e) {
      // network error on this endpoint — try next
      continue
    }
  }
  return { ok: false, status: 0, body: 'all endpoints failed', endpoint: 'none' }
}

export async function GET(req: NextRequest) {
  if (!await isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const browserlessToken = process.env.BROWSERLESS_TOKEN
  if (!browserlessToken) {
    return NextResponse.json({
      error: 'BROWSERLESS_TOKEN not set',
      fix: 'Add BROWSERLESS_TOKEN to Vercel env vars → Settings → Environment Variables',
    }, { status: 400 })
  }

  const admin = createAdminClient()
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '2'), 5)

  const { data: ads, error } = await admin
    .from('discovery_ads_index')
    .select('ad_id, snapshot_url, format, page_name')
    .not('snapshot_url', 'is', null)
    .is('thumbnail_url', null)
    .order('last_seen', { ascending: false })
    .limit(limit)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!ads?.length) return NextResponse.json({ message: 'No ads found with snapshot URLs' })

  // SEQUENTIAL — one at a time to respect concurrency limit
  const results = []
  for (const ad of ads as { ad_id: string; snapshot_url: string; format: string | null; page_name: string | null }[]) {
    const result: Record<string, unknown> = {
      ad_id: ad.ad_id,
      page_name: ad.page_name,
      format: ad.format,
      image_url: null,
      video_url: null,
      status: 'pending',
    }

    try {
      const { ok, status, body, endpoint } = await callBrowserless(browserlessToken, ad.snapshot_url)
      result.browserless_endpoint = endpoint
      result.browserless_http = status

      if (!ok) {
        // Return the actual error body so we can debug
        let errDetail = body
        try { errDetail = JSON.stringify(JSON.parse(body)) } catch { /* raw text ok */ }
        result.status = `browserless_${status}`
        result.browserless_error = errDetail.slice(0, 500)
        results.push(result)
        continue
      }

      let json: Record<string, unknown>
      try { json = JSON.parse(body) } catch {
        result.status = 'json_parse_error'
        result.raw = body.slice(0, 300)
        results.push(result)
        continue
      }

      result.page_http_status = json.httpStatus
      result.html_len = json.htmlLen
      result.page_title = json.title
      result.debug_img_srcs = json.allImgSrcs
      result.goto_error = json.error || null

      const imgUrl = typeof json.imageUrl === 'string' && json.imageUrl.includes('fbcdn') ? json.imageUrl : null
      const vidUrl = typeof json.videoUrl === 'string' && json.videoUrl.includes('fbcdn') ? json.videoUrl : null

      result.image_url = imgUrl
      result.video_url = vidUrl
      result.status = (imgUrl || vidUrl) ? '✅ found' : `❌ not_found (page=${json.httpStatus}, html=${json.htmlLen})`
    } catch (e) {
      result.status = `exception: ${e instanceof Error ? e.message : String(e)}`
    }

    results.push(result)
  }

  const found = results.filter(r => r.image_url || r.video_url).length

  return NextResponse.json({
    summary: `${found}/${results.length} ads had extractable CDN URLs`,
    success_rate: `${Math.round((found / results.length) * 100)}%`,
    results,
    next_step: found > 0
      ? '✅ Works! Add R2 env vars then hit /api/thumbnails to start storing creatives.'
      : '⚠️ Check browserless_error and debug_img_srcs fields above to diagnose.',
  })
}
