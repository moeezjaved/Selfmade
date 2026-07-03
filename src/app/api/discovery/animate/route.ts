/**
 * Animate a static creative into a short video (Veo). POST { image, style?, aspectRatio?, brandId?,
 * sourceAdId?, parentId? } → reserves video_clone credits, kicks off the Veo job, writes a
 * 'processing' creative row, returns { jobId }. The client polls /api/discovery/animate/status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { startVideo, buildAnimatePrompt, veoEnabled } from '@/lib/gemini/video'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

async function toB64(src: string): Promise<{ mimeType: string; dataB64: string } | null> {
  const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(src)
  if (m) return { mimeType: m[1] || 'image/png', dataB64: m[2] }
  if (/^https?:\/\//i.test(src)) {
    try { const r = await fetch(src); if (!r.ok) return null; return { mimeType: r.headers.get('content-type') || 'image/png', dataB64: Buffer.from(await r.arrayBuffer()).toString('base64') } } catch { return null }
  }
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!veoEnabled) return NextResponse.json({ error: 'Video generation not configured (GEMINI_API_KEY)' }, { status: 503 })

  const { image, style, aspectRatio, brandId, sourceAdId, parentId, resolution } = await req.json().catch(() => ({}))
  if (!image) return NextResponse.json({ error: 'image required' }, { status: 400 })
  // User picks 1080p or 4K → sets the Veo resolution + the price.
  const is4k = resolution === '4K' || resolution === '4k'
  const veoRes = is4k ? '4k' : '1080p'
  const action = is4k ? 'video_clone_4k' : 'video_clone'

  const admin = createAdminClient()
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id
  const refund = async () => { if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {}) }

  try {
    const img = await toB64(String(image))
    if (!img) { await refund(); return NextResponse.json({ error: 'could not read the image' }, { status: 422 }) }

    const started = await startVideo(buildAnimatePrompt(style || 'subtle'), img, { aspectRatio, resolution: veoRes })
    if (!started.ok) { await refund(); return NextResponse.json({ error: started.error }, { status: 502 }) }

    const { data: row } = await admin.from('creative_generations').insert({
      user_id: user.id, brand_id: brandId || null, source_ad_id: sourceAdId || null, parent_id: parentId || null,
      type: 'animated', media_type: 'video', status: 'processing', tier: 'pro',
      operation: started.operation, credit_tx: txId, prompt: `animate:${style || 'subtle'}`,
      image_url: null,
    }).select('id').single()

    return NextResponse.json({ jobId: (row as any)?.id, status: 'processing' })
  } catch (e: any) {
    await refund()
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
