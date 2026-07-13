/**
 * Approve a drafted video clone → spend credits + generate. POST { jobId, script? }.
 * Only valid on a job in status='review' (the worker has produced a draft script). Reserves the
 * video_clone credits, stores the final (possibly edited) script, and flips the row to
 * status='processing' so the worker generates the video. Refund is handled by the worker on failure.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, script, mode, durationBucket } = await req.json().catch(() => ({}))
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('creative_generations')
    .select('id, user_id, status, clone_meta')
    .eq('id', jobId).eq('user_id', user.id).eq('type', 'video_clone')
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if ((row as any).status !== 'review') return NextResponse.json({ error: `job is ${(row as any).status}, not awaiting approval` }, { status: 409 })

  const meta = (row as any).clone_meta || {}
  // Mode: 'ugc' (one talking-head clip, default) or 'faithful' (scene-by-scene + stitch — priced by
  // scene count via the video_clone_xN credit_pricing rows). Scene count is server-side (worker's
  // analysis), clamped 2-4, so the client can't pick a cheaper row than the work costs.
  const chosenMode = mode === 'faithful' ? 'faithful' : 'ugc'
  const nScenes = Math.min(4, Math.max(2, Number(meta.scene_count) || 2))

  // UGC length buckets: 15s = 1 clip (classic), 30s = 2 chained segments, 60s = 4. 'match' auto-picks
  // the nearest bucket from the source ad's analysed duration. Segments are priced by the same
  // video_clone_xN rows as faithful scenes (same per-clip cost), and clamped server-side.
  let nSeg = 1
  if (chosenMode === 'ugc') {
    let bucket: number = Number(durationBucket) || 15
    if (durationBucket === 'match') {
      const secs = Number(meta?.beat_sheet?.duration_seconds) || 15
      bucket = secs <= 22 ? 15 : secs <= 45 ? 30 : 60
    }
    nSeg = bucket >= 60 ? 4 : bucket >= 30 ? 2 : 1
  }

  const suffix = meta.tier === 'fast' ? '_fast' : ''
  const action = chosenMode === 'faithful'
    ? `video_clone_x${nScenes}${suffix}`
    : nSeg > 1
      ? `video_clone_x${nSeg}${suffix}`
      : (meta.tier === 'fast' ? 'video_clone_fast' : 'video_clone')

  // Reserve now — this is the billable moment (the user has approved the script).
  const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
  if (rErr) {
    const insufficient = String(rErr.message || '').includes('insufficient_credits')
    return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
  }
  const txId = Array.isArray(tx) ? tx[0]?.id : (tx as any)?.id

  const finalScript = (typeof script === 'string' && script.trim()) ? script.trim() : (meta.script || '')
  const { error } = await admin.from('creative_generations').update({
    status: 'processing', credit_tx: txId, clone_meta: { ...meta, final_script: finalScript, mode: chosenMode, scene_count: nScenes, segments: nSeg },
  }).eq('id', jobId).eq('user_id', user.id)

  if (error) {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    return NextResponse.json({ error: 'could not start generation' }, { status: 500 })
  }
  return NextResponse.json({ jobId, status: 'processing' })
}
