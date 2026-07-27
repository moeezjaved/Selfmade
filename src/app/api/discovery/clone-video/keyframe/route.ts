/**
 * POST /api/discovery/clone-video/keyframe  { jobId, sceneIndex, action?, look? }
 * Generates a cheap image KEYFRAME for one storyboard scene — recreating the source beat's composition
 * with the user's product + a fresh (legal) creator, NOT the competitor's pixels. The founder approves
 * the look scene-by-scene before paying video prices; on generate, the worker animates these keyframes.
 * Stores the URL at clone_meta.beat_sheet.beats[i].preview. Only valid on a job in review.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { generateImage, geminiEnabled, geminiImageMime } from '@/lib/gemini/image'
import { uploadBufferToR2 } from '@/lib/r2'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

async function fetchImageB64(url: string): Promise<{ mimeType: string; dataB64: string } | null> {
  try {
    const u = /^\/\/[^/]/.test(url) ? `https:${url}` : url
    if (!/^https?:\/\//i.test(u)) return null
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    const mime = geminiImageMime(r.headers.get('content-type'), buf)
    return mime ? { mimeType: mime, dataB64: buf.toString('base64') } : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  if (!geminiEnabled) return NextResponse.json({ error: 'image generation unavailable' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const jobId = b?.jobId ? String(b.jobId) : null
  const sceneIndex = Number.isInteger(b?.sceneIndex) ? b.sceneIndex : null
  if (!jobId || sceneIndex == null || sceneIndex < 0) return NextResponse.json({ error: 'jobId and sceneIndex required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('creative_generations').select('id, clone_meta').eq('id', jobId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const meta = (row as any).clone_meta || {}
  const beat = meta.beat_sheet || {}
  const beats: any[] = Array.isArray(beat.beats) ? beat.beats : []
  // Single-take UGC analyzes with no beats; the storyboard synthesizes scene cards, so a preview can
  // target an index that has no beat row yet. Pad the array so the preview always has a slot to persist.
  while (beats.length <= sceneIndex) beats.push({ action: '' })
  const action = String(b?.action || b?.scriptLine || beats[sceneIndex]?.action || beats[sceneIndex]?.scriptLine || 'Opening shot').slice(0, 300)
  const look = String(b?.look || meta.character_look || '').trim()
  const productName = meta.product_details?.name || meta.brand_name || ''

  // Product photos ground the render (pixel-perfect product). Cap 3.
  const rawImgs: string[] = Array.isArray(meta.product_image_urls) ? meta.product_image_urls.slice(0, 3) : []
  const productImgs = (await Promise.all(rawImgs.map(fetchImageB64))).filter(Boolean) as { mimeType: string; dataB64: string }[]

  const isService = meta.product_type === 'service' || meta.product_type === 'app'
  const creatorClause = look && look.toLowerCase() !== 'match'
    ? `Feature a ${look} creator/person as the scene calls for.`
    : 'Cast whatever people the scene naturally needs (or none).'
  const productClause = isService || !productImgs.length
    ? 'This is a service/brand — do NOT invent a physical product; lead with the person, setting, or an on-phone app view.'
    : `The attached image(s) are the user's product${productName ? ` ("${productName}")` : ''} — render it 1:1 (exact silhouette, label, materials); do NOT reshape or invent a different product.`

  const prompt = [
    `Create ONE photorealistic vertical 9:16 video KEYFRAME that recreates this ad scene's composition for the brand — the FIRST FRAME of a short video clip.`,
    `SCENE TO RECREATE: ${action}.`,
    `Match that scene's shot type (close-up / wide / over-the-shoulder), framing, and energy — but make it an ORIGINAL image (never copy any real person's face).`,
    productClause,
    creatorClause,
    `Natural, real, ad-quality lighting. Leave headroom for motion. NO on-screen text, NO captions, NO watermark, NO other brand's logo.`,
  ].filter(Boolean).join(' ')

  // A storyboard PREVIEW is a disposable reference, not the final ad — so unlike the clone (Pro-only,
  // never downgrade), if Pro is busy we fall back to the standard model so the preview reliably appears.
  let gen = await generateImage(prompt, productImgs, 'pro', { aspectRatio: '9:16' })
  if (!gen.ok && gen.error === 'pro_model_busy') gen = await generateImage(prompt, productImgs, 'default', { aspectRatio: '9:16' })
  if (!gen.ok) return NextResponse.json({ error: gen.error === 'pro_model_busy' ? 'The image model is busy right now — try again in a moment.' : gen.error }, { status: 502 })

  const url = await uploadBufferToR2(Buffer.from(gen.dataB64, 'base64'), `creatives/keyframes/${jobId}/${sceneIndex}-${Date.now()}.jpg`, gen.mimeType)
  if (!url) return NextResponse.json({ error: 'could not store the keyframe' }, { status: 500 })

  // Persist the preview onto the beat so the storyboard + generation can use it.
  if (beats[sceneIndex]) beats[sceneIndex].preview = url
  const nextMeta = { ...meta, beat_sheet: { ...beat, beats } }
  await admin.from('creative_generations').update({ clone_meta: nextMeta }).eq('id', jobId).eq('user_id', user.id)

  return NextResponse.json({ ok: true, sceneIndex, preview: url })
}
