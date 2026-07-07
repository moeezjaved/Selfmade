/**
 * Clone a competitor's VIDEO ad into the user's own product ad. POST
 *   { sourceAdId, brandId?, productImages: string[], productDetails?: {name,benefits,tone},
 *     tier?: 'premium'|'fast', resolution?, duration?, aspect? }
 * → looks up the source ad's video (discovery_creatives.r2_url), reserves credits, writes a
 * 'processing' creative_generations row (type='video_clone') for the droplet video-clone-worker to
 * pick up, returns { jobId }. The client polls /api/discovery/clone-video/status. Result lands in
 * creative-studio ("My Creatives") like every other async generation.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { uploadBufferToR2 } from '@/lib/r2'

export const dynamic = 'force-dynamic'

// Seedance fetches image_urls by URL, so any uploaded data-URL product image must land in R2 first.
async function toPublicUrl(userId: string, src: string, i: number): Promise<string | null> {
  if (/^https?:\/\//i.test(src)) return src
  const m = src.match(/^data:(image\/[a-z+]+);base64,(.+)$/i)
  if (!m) return null
  const ext = (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg')
  const buf = Buffer.from(m[2], 'base64')
  return uploadBufferToR2(buf, `creatives/${userId}/product-${Date.now()}-${i}.${ext}`, m[1])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const sourceAdId = String(body.sourceAdId || '').trim()
  if (!sourceAdId) return NextResponse.json({ error: 'sourceAdId required' }, { status: 400 })

  const rawImages: string[] = Array.isArray(body.productImages)
    ? body.productImages.filter((u: any) => typeof u === 'string').slice(0, 9)
    : []
  const productImages = (await Promise.all(rawImages.map((s, i) => toPublicUrl(user.id, s, i)))).filter(Boolean) as string[]
  if (productImages.length === 0) return NextResponse.json({ error: 'add at least one product image to swap in' }, { status: 400 })

  const tier = body.tier === 'fast' ? 'fast' : 'premium'
  const admin = createAdminClient()

  // ── Resolve the competitor ad's playable video (the motion/pacing reference) ──
  const { data: ad } = await admin
    .from('discovery_ads_index')
    .select('ad_id, discovery_creatives(asset_type, r2_url, position)')
    .eq('ad_id', sourceAdId)
    .maybeSingle()
  const creatives = (((ad as any)?.discovery_creatives) || []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
  const sourceVideo = creatives.find((c: any) => c.asset_type === 'video' && c.r2_url)?.r2_url || null
  if (!sourceVideo) return NextResponse.json({ error: 'this ad has no video to clone (image-only ad)' }, { status: 400 })

  // NO credits reserved here — analysis (Gemini + gpt) is cheap and free to the user. Credits are
  // reserved at POST …/approve, once the user has SEEN and approved the script. status='analyzing'.
  const clone_meta = {
    product_image_urls: productImages,
    product_details: body.productDetails || null,
    resolution: body.resolution || '720p',
    duration: body.duration || 10,
    aspect: body.aspect || '9:16',
    tier,
  }

  const { data: row, error } = await admin.from('creative_generations').insert({
    user_id: user.id, brand_id: body.brandId || null, source_ad_id: sourceAdId,
    type: 'video_clone', media_type: 'video', status: 'analyzing', tier: tier === 'fast' ? 'default' : 'pro',
    source_video_url: sourceVideo, clone_meta, prompt: 'video clone', image_url: null,
  }).select('id').single()

  if (error || !row) return NextResponse.json({ error: 'could not start the clone' }, { status: 500 })
  return NextResponse.json({ jobId: (row as any).id, status: 'analyzing' })
}
