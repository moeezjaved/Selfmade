/**
 * Debug — inspect what Browserless actually finds on a specific ad's snapshot page.
 * Returns ALL image URLs (not just the "best" one) so we can identify
 * what Meta is serving and fix the filter.
 *
 * GET /api/admin/inspect-ad?ad_id=1906791959892692
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adId = req.nextUrl.searchParams.get('ad_id')
  if (!adId) return NextResponse.json({ error: 'ad_id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: ad } = await admin
    .from('discovery_ads_index')
    .select('snapshot_url, thumbnail_url, video_url, page_name, format')
    .eq('ad_id', adId)
    .maybeSingle()

  if (!ad?.snapshot_url) return NextResponse.json({ error: 'Ad not found or no snapshot_url' }, { status: 404 })

  const token = process.env.BROWSERLESS_TOKEN
  if (!token) return NextResponse.json({ error: 'BROWSERLESS_TOKEN not set' }, { status: 400 })

  // Fetch the page via Browserless and dump every <img> + <video>
  const code = `
    export default async ({ page }) => {
      await page.setRequestInterception(true);
      page.on('request', (r) => {
        const t = r.resourceType();
        if (t === 'font' || t === 'stylesheet') r.abort();
        else r.continue();
      });
      const resp = await page.goto(${JSON.stringify(ad.snapshot_url)}, {
        waitUntil: 'domcontentloaded', timeout: 12000,
      });
      try {
        await page.waitForFunction(() => {
          return document.querySelectorAll('img').length > 5;
        }, { timeout: 5000 });
      } catch (_) {}
      await new Promise(r => setTimeout(r, 2000));
      return page.evaluate(() => {
        const allImgs = Array.from(document.querySelectorAll('img')).map(img => ({
          src: img.src,
          width: img.naturalWidth,
          height: img.naturalHeight,
          alt: img.alt,
        }));
        const allVideos = Array.from(document.querySelectorAll('video')).map(v => ({
          src: v.src || v.currentSrc,
          poster: v.poster,
        }));
        return {
          httpStatus: ${0},
          title: document.title,
          htmlLen: document.documentElement.outerHTML.length,
          allImgs,
          allVideos,
        };
      });
    };
  `

  try {
    const res = await fetch(`https://production-sfo.browserless.io/function?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const t = await res.text()
      return NextResponse.json({ error: `browserless_${res.status}`, detail: t.slice(0, 500) })
    }
    const json = await res.json() as any

    const stpSize = (url: string): number => {
      const m = url?.match(/_s(\d+)x\d+/)
      return m ? parseInt(m[1]) : 0
    }
    const classify = (src: string): string => {
      if (!src) return 'empty'
      if (!src.includes('fbcdn') && !src.includes('scontent')) return 'non-fbcdn'
      if (src.includes('static.xx.fbcdn')) return 'STATIC_UI'
      if (src.includes('/emoji')) return 'emoji'
      if (src.includes('hsts-pixel')) return 'hsts-pixel'
      // Path-based classification
      if (src.match(/\/v\/t39\.35426-6\//)) return 'AD_CREATIVE_t39.35426-6'  // standard ad media
      if (src.match(/\/v\/t39\.30808-6\//)) return 'AD_CREATIVE_t39.30808-6'
      if (src.match(/\/v\/t45\.5328-4\//)) return 'AD_CREATIVE_t45.5328-4'
      if (src.match(/\/v\/t1\.\d+/)) return 'STATIC_UI_t1'
      if (src.match(/\/v\/t39\.\d+/)) return 'unknown_t39'
      return 'unclassified'
    }

    const enriched = (json.allImgs || []).map((img: any) => ({
      ...img,
      stp_size: stpSize(img.src),
      classification: classify(img.src),
    }))

    return NextResponse.json({
      ad_id: adId,
      page_name: ad.page_name,
      format: ad.format,
      snapshot_url: ad.snapshot_url,
      currently_stored_thumbnail: ad.thumbnail_url,
      currently_stored_video: ad.video_url,
      page: {
        title: json.title,
        html_len: json.htmlLen,
      },
      images_found: enriched,
      videos_found: json.allVideos,
      summary: {
        total_imgs: enriched.length,
        ad_creatives: enriched.filter((i: any) => i.classification.startsWith('AD_CREATIVE')).length,
        static_ui: enriched.filter((i: any) => i.classification.startsWith('STATIC_UI')).length,
        unclassified: enriched.filter((i: any) => i.classification === 'unclassified').length,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
