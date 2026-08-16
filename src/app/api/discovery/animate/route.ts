/**
 * Animate a static creative into a short motion MP4 (Ken Burns zoom / shine sweep), rendered by the
 * droplet animate-worker via FFmpeg — keeps the ad pixel-exact. POST { image (http URL), style,
 * resolution, brandId?, sourceAdId?, parentId? } → reserves credits, writes a 'processing' job row
 * for the worker to pick up, returns { jobId }. The client polls /api/discovery/animate/status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { image, style, resolution, brandId, sourceAdId, parentId } = await req.json().catch(() => ({}))
  if (!image || !/^https?:\/\//i.test(String(image))) {
    return NextResponse.json({ error: 'a saved image is required — generate/download the ad first' }, { status: 400 })
  }
  const motion = style === 'shine' ? 'shine' : 'zoom'
  const is4k = resolution === '4K' || resolution === '4k'
  const action = is4k ? 'animate_motion_4k' : 'animate_motion'

  const admin = createAdminClient()
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    try { const { logError } = await import('@/lib/admin/logError'); void logError({ user_id: user.id, user_email: user.email || null, error_message: insufficient ? `Insufficient credits — animation` : `Credit reserve failed — animation`, page_url: '/studio', extra: { kind: insufficient ? 'insufficient_credits' : 'render_failed', stage: 'animate' } }) } catch { /* never block */ }
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id

  const { data: row, error } = await admin.from('creative_generations').insert({
    user_id: user.id, brand_id: brandId || null, source_ad_id: sourceAdId || null, parent_id: parentId || null,
    type: 'animated', media_type: 'video', status: 'processing', tier: is4k ? '4k' : '1080p',
    source_image_url: String(image), prompt: `motion:${motion}`, credit_tx: txId, image_url: null,
  }).select('id').single()

  if (error || !row) {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    return NextResponse.json({ error: 'could not queue the animation' }, { status: 500 })
  }
  return NextResponse.json({ jobId: (row as any).id, status: 'processing' })
}
