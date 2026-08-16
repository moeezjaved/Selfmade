/**
 * Add TikTok-style burned captions to a finished video clone (high-margin add-on).
 * POST { sourceId, style?, captionLang? } → reserves video_captions credits and enqueues a caption
 * job (a new creative_generations row the worker burns via Whisper→ASS→ffmpeg). Returns { jobId }.
 * The modal polls /api/discovery/clone-video/status?id=<jobId> like any other clone.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
const STYLES = new Set(['bold', 'minimal', 'boxed'])

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { sourceId, style, captionLang, color, size } = await req.json().catch(() => ({}))
  if (!sourceId) return NextResponse.json({ error: 'sourceId required' }, { status: 400 })

  const admin = createAdminClient()
  // The source must be the user's own FINISHED video with a playable url.
  const { data: src } = await admin
    .from('creative_generations')
    .select('id, user_id, brand_id, source_ad_id, image_url, media_type, status, clone_meta')
    .eq('id', sourceId).eq('user_id', user.id).maybeSingle()
  if (!src) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if ((src as any).media_type !== 'video' || (src as any).status !== 'done' || !(src as any).image_url) {
    return NextResponse.json({ error: 'source video not ready' }, { status: 409 })
  }

  // Billable moment: reserve the captions credits up front (worker refunds on failure).
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: 'video_captions' })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    try { const { logError } = await import('@/lib/admin/logError'); void logError({ user_id: user.id, user_email: user.email || null, error_message: insufficient ? `Insufficient credits — video captions` : `Credit reserve failed — video captions`, page_url: '/studio', extra: { kind: insufficient ? 'insufficient_credits' : 'render_failed', stage: 'captions' } }) } catch { /* never block */ }
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id

  const meta = (src as any).clone_meta || {}
  const { data: row, error } = await admin.from('creative_generations').insert({
    user_id: user.id, brand_id: (src as any).brand_id || null, source_ad_id: (src as any).source_ad_id || null,
    type: 'video_captions', media_type: 'video', status: 'processing',
    source_video_url: (src as any).image_url, credit_tx: txId, prompt: 'captions', image_url: null,
    clone_meta: {
      caption_source_url: (src as any).image_url,
      caption_style: STYLES.has(String(style)) ? style : 'bold',
      caption_color: /^#?[0-9a-fA-F]{6}$/.test(String(color || '')) ? String(color).replace(/^#?/, '#') : null,
      caption_size: ['s', 'm', 'l'].includes(String(size)) ? size : 'm',
      caption_lang: captionLang || meta.language || 'en',
      source_lang: meta.language || 'en',   // known VO language → reliable karaoke-vs-translate call
      script: meta.script || meta.final_script || null,
      captioned_from: sourceId,
    },
  }).select('id').single()

  if (error || !row) {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    return NextResponse.json({ error: 'could not start captions' }, { status: 500 })
  }
  return NextResponse.json({ jobId: (row as any).id, status: 'processing' })
}
