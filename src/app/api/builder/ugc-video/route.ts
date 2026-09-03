/**
 * UGC video generation for a Page Builder video slot, reusing the studio's Seedance 2.5 pipeline
 * (video_clone). Product-locked to the page's product.
 *
 *   GET  ?cost=1            → { cost }                      (credits a generation will use; no charge)
 *   POST { pageId, duration, characterLook, language }
 *                           → { jobId, cost }              (kicks off analysis; charge happens at approve)
 *   GET  ?jobId=<id>        → { status, url?, progress?, error? }
 *                             (auto-approves one-shot when the draft is ready, then polls to done)
 *
 * The generator is a clone/transcreation pipeline, so it needs a reference clip:
 * BUILDER_UGC_REFERENCE_URL must point at a house UGC mp4 whose beats the product video follows.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { getActionCost } from '@/lib/credits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
const ACTION = 'video_clone'   // one-shot ≤22s bills as video_clone (see clone-video/approve)

async function cost(admin: any): Promise<number> {
  try { return (await getActionCost(admin, ACTION)) ?? 0 } catch { return 0 }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  if (req.nextUrl.searchParams.get('cost')) {
    return NextResponse.json({ cost: await cost(admin), configured: !!process.env.BUILDER_UGC_REFERENCE_URL })
  }

  const jobId = req.nextUrl.searchParams.get('jobId')
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const { data: row } = await admin.from('creative_generations')
    .select('status, image_url, clone_meta').eq('id', jobId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const meta = (row as any).clone_meta || {}
  const status = String((row as any).status || '')

  // When the worker has drafted the script (status='review'), approve it as a one-shot to start rendering.
  if (status === 'review') {
    try {
      await fetch(`${APP_URL}/api/discovery/clone-video/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-autopilot-secret': process.env.AUTOPILOT_SECRET || '' },
        body: JSON.stringify({ asUserId: user.id, jobId, mode: 'oneshot', durationBucket: meta.duration || 15 }),
      })
    } catch { /* next poll retries */ }
    return NextResponse.json({ status: 'processing', progress: { label: 'Starting render…', pct: 5 } })
  }

  if (status === 'done') return NextResponse.json({ status: 'done', url: (row as any).image_url || null })
  if (status === 'failed') return NextResponse.json({ status: 'failed', error: friendly(meta.error) })
  return NextResponse.json({ status: status || 'processing', progress: meta.progress || null })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ref = process.env.BUILDER_UGC_REFERENCE_URL
  if (!ref) return NextResponse.json({ error: 'UGC video generation isn’t set up yet — a house reference clip (BUILDER_UGC_REFERENCE_URL) is required.' }, { status: 503 })

  const b = await req.json().catch(() => ({}))
  const pageId = String(b?.pageId || '')
  if (!pageId) return NextResponse.json({ error: 'pageId is required' }, { status: 400 })
  const duration = Math.min(30, Math.max(6, Number(b?.duration) || 15))
  const characterLook = String(b?.characterLook || '').slice(0, 60)
  const language = String(b?.language || 'en').slice(0, 5)

  const admin = createAdminClient()
  const { data: page } = await admin.from('builder_pages').select('*').eq('id', pageId).eq('user_id', user.id).maybeSingle()
  if (!page) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Gather the product's real photos: the render_opts hero + any http image slots in the saved content.
  const opts = (page as any).render_opts || {}
  const content = (page as any).content || {}
  const imgs = new Set<string>()
  if (typeof opts.productImage === 'string' && /^https?:\/\//i.test(opts.productImage)) imgs.add(opts.productImage)
  for (const v of Object.values(content)) if (typeof v === 'string' && /^https?:\/\/.+\.(jpe?g|png|webp)(\?|$)/i.test(v)) imgs.add(v)
  const productImages = Array.from(imgs).slice(0, 9)
  if (!productImages.length) return NextResponse.json({ error: 'This page has no product photos to build the video from.' }, { status: 400 })

  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const productDetails = { name: (page as any).product_name || 'the product', benefits: '', tone: 'authentic, upbeat UGC creator' }

  let started
  try {
    started = await fetch(`${APP_URL}/api/discovery/clone-video`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-autopilot-secret': process.env.AUTOPILOT_SECRET || '' },
      body: JSON.stringify({
        asUserId: user.id, brandId,
        sourceVideoUrl: ref, productImages, productDetails,
        tier: 'premium', duration, aspect: '9:16', resolution: '720p',
        characterLook: characterLook || undefined, language,
      }),
    }).then((r) => r.json())
  } catch { return NextResponse.json({ error: 'Could not start generation — try again.' }, { status: 502 }) }

  if (!started?.jobId) return NextResponse.json({ error: started?.error || 'Could not start generation.' }, { status: 502 })
  return NextResponse.json({ jobId: started.jobId, cost: await cost(admin) })
}

function friendly(e?: string): string {
  if (e === 'content_policy_images') return 'The product photos were flagged by the video model — try different photos.'
  if (e === 'content_policy_video') return 'The reference clip was flagged — contact support.'
  if (e === 'insufficient') return 'Not enough credits to render this video.'
  return 'Video generation failed — you were not charged.'
}
