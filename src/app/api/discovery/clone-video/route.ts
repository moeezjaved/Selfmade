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
import { uploadBufferToR2, r2PublicUrl } from '@/lib/r2'
import { isRateLimited } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120   // may fetch the source mp4 from fbcdn on-demand if it isn't drained yet

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
  const body = await req.json().catch(() => ({}))
  // Actor resolution: normal callers use their session. Server-to-server callers (the Slack "Make ours
  // like this" button, the Daily Ad Autopilot) pass the shared secret + the user they're generating for,
  // reusing the EXACT clone path (auth boundary only — nothing about the generation changes). Starting a
  // video clone charges NOTHING (status='analyzing' → worker → 'review'); credits are reserved at approve.
  const autopilotSecret = req.headers.get('x-autopilot-secret')
  const isAutopilot = !!autopilotSecret && !!process.env.AUTOPILOT_SECRET && autopilotSecret === process.env.AUTOPILOT_SECRET
  let uid: string
  if (isAutopilot) {
    if (typeof body.asUserId !== 'string' || !body.asUserId) return NextResponse.json({ error: 'asUserId required' }, { status: 400 })
    uid = body.asUserId
  } else {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    uid = user.id
  }
  // Burst guard (fail-open) — cap scripted generation floods. Server-paced callers are exempt.
  if (!isAutopilot && await isRateLimited(uid)) return NextResponse.json({ error: 'rate_limited', message: 'Too many generations in a short time — please wait a moment and try again.' }, { status: 429 })

  const sourceAdId = String(body.sourceAdId || '').trim()
  // Extension-saved ("Saved from Web") videos have no discovery_ads_index row — the caller passes the
  // stored R2 mp4 directly as sourceVideoUrl so those can be cloned too.
  const sourceVideoUrl = (typeof body.sourceVideoUrl === 'string' && /^https?:\/\//i.test(body.sourceVideoUrl)) ? body.sourceVideoUrl : null
  if (!sourceAdId && !sourceVideoUrl) return NextResponse.json({ error: 'sourceAdId or sourceVideoUrl required' }, { status: 400 })

  const rawImages: string[] = Array.isArray(body.productImages)
    ? body.productImages.filter((u: any) => typeof u === 'string').slice(0, 9)
    : []
  const productImages = (await Promise.all(rawImages.map((s, i) => toPublicUrl(uid, s, i)))).filter(Boolean) as string[]
  if (productImages.length === 0) return NextResponse.json({ error: 'add at least one product image to swap in' }, { status: 400 })

  const tier = body.tier === 'fast' ? 'fast' : 'premium'
  const admin = createAdminClient()

  // ── Resolve the competitor ad's playable video (the motion/pacing reference) ──
  // An explicit sourceVideoUrl (Saved-from-Web mp4 already on R2) wins — no index lookup needed.
  const { data: ad } = sourceAdId
    ? await admin
        .from('discovery_ads_index')
        .select('ad_id, format, raw_video_urls, discovery_creatives(asset_type, r2_url, position)')
        .eq('ad_id', sourceAdId)
        .maybeSingle()
    : { data: null }
  const creatives = (((ad as any)?.discovery_creatives) || []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
  let sourceVideo = sourceVideoUrl || creatives.find((c: any) => c.asset_type === 'video' && c.r2_url)?.r2_url || null

  // If the video isn't drained to R2 yet, fetch it ON-DEMAND from fbcdn (Meta's video CDN serves
  // to any IP), so a freshly-spied competitor can be cloned immediately instead of waiting on the
  // background drain. Only genuinely image-only ads (no video at all) get the hard error.
  if (!sourceVideo) {
    const rawVids: string[] = ((ad as any)?.raw_video_urls || []).filter((u: any) => typeof u === 'string')
    const isVideoAd = /video/i.test((ad as any)?.format || '') || rawVids.length > 0
    if (!isVideoAd) return NextResponse.json({ error: 'This is an image-only ad — use "Remake as image ad" instead.' }, { status: 400 })
    if (rawVids.length === 0) return NextResponse.json({ error: 'This video hasn\'t finished downloading yet. It\'s queued — please try again in a few minutes.' }, { status: 409 })
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 60_000)
      const vr = await fetch(rawVids[0], { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.facebook.com/' } })
      clearTimeout(timer)
      if (!vr.ok) throw new Error(`fbcdn ${vr.status}`)
      const buf = Buffer.from(await vr.arrayBuffer())
      if (buf.byteLength < 10_000) throw new Error('placeholder/empty')
      sourceVideo = await uploadBufferToR2(buf, `videos/${sourceAdId}.mp4`, 'video/mp4')
      // Persist so future clones/serving find it without re-fetching.
      if (sourceVideo) await admin.from('discovery_creatives').upsert(
        { ad_id: sourceAdId, position: 0, asset_type: 'video', r2_url: sourceVideo, hash: null },
        { onConflict: 'ad_id,position,asset_type' },
      ).then(() => {}, () => {})
    } catch {
      return NextResponse.json({ error: 'Couldn\'t fetch this video just now — the source link may have expired. Re-spy the brand to refresh it, then try again.' }, { status: 409 })
    }
    if (!sourceVideo) return NextResponse.json({ error: 'Couldn\'t stage the source video — please try again shortly.' }, { status: 502 })
  }

  // NO credits reserved here — analysis (Gemini + gpt) is cheap and free to the user. Credits are
  // reserved at POST …/approve, once the user has SEEN and approved the script. status='analyzing'.
  const clone_meta = {
    product_image_urls: productImages,
    product_details: body.productDetails || null,
    resolution: body.resolution || '720p',
    duration: body.duration || 10,
    aspect: body.aspect || '9:16',
    tier,
    // Creator-look override (Pakistani / Indian / Arab / …); 'match' or absent = copy the reference.
    character_look: typeof body.characterLook === 'string' && body.characterLook.trim() ? body.characterLook.trim().slice(0, 60) : null,
    // Script/voiceover language (transcreated natively, never translated) + narration voice.
    language: /^[a-z]{2}$/.test(String(body.language || '')) ? body.language : 'en',
    voice: ['nova', 'shimmer', 'onyx', 'echo'].includes(String(body.voice || '')) ? body.voice : 'nova',
    // Preview-accurate voice: when true the render uses the SAME overlaid TTS voice the user auditioned
    // (ElevenLabs non-EN / OpenAI EN) instead of Seedance's own native voice — so "what you heard is what
    // ships", word-perfect, at the cost of slightly looser lip-sync. Default false = native (best sync).
    tts_overlay: body.ttsOverlay === true,
    // 'service' = app/site/service brand → the worker's SERVICE prompt path (creator talks about it,
    // never renders a physical product). Absent/'physical' = today's product-hero flow.
    product_type: ['physical', 'service', 'app'].includes(body.productType) ? body.productType : 'physical',
    // Optional user-uploaded screen recording (R2 key from the presigned Assets upload) → shown in the
    // split-screen top half as MOVING UI. Resolved server-side to a public URL; ignored for physical.
    // Screencast applies to any NON-physical brand — 'app' most of all (it IS the app-demo source).
    screencast_url: ((body.productType === 'service' || body.productType === 'app') && typeof body.screencastKey === 'string' && body.screencastKey.trim())
      ? r2PublicUrl(body.screencastKey.trim()) : null,
  }

  const { data: row, error } = await admin.from('creative_generations').insert({
    user_id: uid, brand_id: body.brandId || null, source_ad_id: sourceAdId || null,
    type: 'video_clone', media_type: 'video', status: 'analyzing', tier: tier === 'fast' ? 'default' : 'pro',
    source_video_url: sourceVideo, clone_meta, prompt: 'video clone', image_url: null,
  }).select('id').single()

  if (error || !row) return NextResponse.json({ error: 'could not start the remake' }, { status: 500 })
  return NextResponse.json({ jobId: (row as any).id, status: 'analyzing' })
}
