/**
 * POST /api/builder/image — get a hosted image URL for a Page Builder image slot, two ways:
 *   { mode:'upload',   dataB64, mimeType }         → host the user's own picture on R2
 *   { mode:'generate', prompt, referenceUrl? }     → make one with AI (Gemini), then host it
 * Returns { url }. Reuses the same R2 + Gemini bridge the builder pipeline uses.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uploadBufferToR2, isR2Configured } from '@/lib/r2'
import { generateAndHost, fetchImageInput } from '@/lib/builder/context'
import { generateImage, geminiEnabled } from '@/lib/gemini/image'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024   // 8MB decoded

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const mode = String(b?.mode || '')

  if (mode === 'upload') {
    if (!isR2Configured()) return NextResponse.json({ error: 'Image hosting is not configured.' }, { status: 503 })
    const dataB64 = String(b?.dataB64 || '')
    const mimeType = String(b?.mimeType || 'image/jpeg')
    if (!dataB64) return NextResponse.json({ error: 'No image data.' }, { status: 400 })
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mimeType)) return NextResponse.json({ error: 'Only JPEG, PNG, WebP or GIF images.' }, { status: 400 })
    let buf: Buffer
    try { buf = Buffer.from(dataB64, 'base64') } catch { return NextResponse.json({ error: 'Bad image data.' }, { status: 400 }) }
    if (!buf.length || buf.length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Image must be under 8MB.' }, { status: 400 })
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : 'jpg'
    const key = `builder/upload/${user.id}-${Date.now()}-${buf.length}.${ext}`
    const url = await uploadBufferToR2(buf, key, mimeType)
    if (!url) return NextResponse.json({ error: 'Upload failed — please try again.' }, { status: 502 })
    return NextResponse.json({ url })
  }

  if (mode === 'generate') {
    if (!geminiEnabled) return NextResponse.json({ error: 'AI image generation is not configured.' }, { status: 503 })
    if (!isR2Configured()) return NextResponse.json({ error: 'Image hosting is not configured.' }, { status: 503 })
    const prompt = String(b?.prompt || '').trim()
    if (!prompt) return NextResponse.json({ error: 'Describe the image you want.' }, { status: 400 })
    const referenceUrl = String(b?.referenceUrl || '').trim()
    const aspect = String(b?.aspectRatio || '1:1')
    try {
      // Prefer the builder's generate+host bridge (default tier, hosts to R2).
      const ref = referenceUrl ? await fetchImageInput(referenceUrl) : null
      const url = await generateAndHost(prompt, ref, `edit-${user.id}-${Date.now()}`, { aspectRatio: aspect })
      if (!url) {
        // Surface a clearer message when the model itself refused/was busy.
        const probe = await generateImage(prompt, ref ? [ref] : [], 'default', { aspectRatio: aspect })
        if (!probe.ok) return NextResponse.json({ error: probe.error === 'pro_model_busy' ? 'The image model is busy — try again in a moment.' : 'Could not generate that image.' }, { status: 502 })
        return NextResponse.json({ error: 'Could not host the generated image.' }, { status: 502 })
      }
      return NextResponse.json({ url })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'Could not generate that image.' }, { status: 502 })
    }
  }

  return NextResponse.json({ error: 'Unknown mode.' }, { status: 400 })
}
