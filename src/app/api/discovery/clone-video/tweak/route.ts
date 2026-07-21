/**
 * Tweak a FINISHED video remake without a full re-render. POST { jobId, type, scene?, chip?, script? }.
 *   type: 'redo_scene' (600cr, chip = product|action|person|closeup|redo) · 'remove_scene' (free)
 *       · 'trim' (free) · 'redo_vo' (50cr, script = edited narration)
 * Only valid on a DONE faithful render that still has cached scene clips. Reserves the tweak's
 * credits (free ops reserve nothing), stamps clone_meta.tweak and flips status → processing; the
 * worker's tweakJob regenerates ≤1 scene and re-stitches from cache. On worker failure the original
 * video is restored and the tx auto-refunds.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const CHIPS = new Set(['redo', 'size', 'product', 'action', 'person', 'closeup'])
const ACTIONS: Record<string, string | null> = {
  redo_scene: 'video_tweak_scene',
  redo_ugc: 'video_tweak_ugc',        // re-roll the single UGC clip with a corrective prompt
  redo_segment: 'video_tweak_scene',  // re-roll ONE segment of a long-form UGC video (same cost as a scene)
  patch_broll: 'video_tweak_patch',   // cutaway patch: 5s silent product close-up over just the flawed seconds
  redo_vo: 'video_tweak_vo',
  remove_scene: null,   // ffmpeg-only → free
  trim: null,           // ffmpeg-only → free
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, type, scene, chip, script, note, from, to, prevUrl } = await req.json().catch(() => ({}))
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 })

  const admin = createAdminClient()

  // ── UNDO: restore a previous version of THIS finished video. Synchronous + FREE — the earlier file
  // still lives on R2 (tweaks upload a new versioned key, they never delete the old). We only accept a
  // URL that belongs to this user + this job's creatives path, so it can't point anywhere arbitrary.
  if (type === 'restore') {
    const url = String(prevUrl || '')
    if (!url || !url.includes(`creatives/${user.id}/`) || !url.includes(String(jobId)))
      return NextResponse.json({ error: 'invalid restore target' }, { status: 400 })
    const { error } = await admin.from('creative_generations')
      .update({ image_url: url }).eq('id', jobId).eq('user_id', user.id).eq('type', 'video_clone')
    if (error) return NextResponse.json({ error: 'could not undo' }, { status: 500 })
    return NextResponse.json({ jobId, status: 'done', url, restored: true, charged: false })
  }

  if (!(type in ACTIONS)) return NextResponse.json({ error: 'a valid type is required' }, { status: 400 })
  const { data: row } = await admin
    .from('creative_generations')
    .select('id, user_id, status, image_url, clone_meta')
    .eq('id', jobId).eq('user_id', user.id).eq('type', 'video_clone')
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if ((row as any).status !== 'done' || !(row as any).image_url)
    return NextResponse.json({ error: 'only a finished video can be tweaked' }, { status: 409 })

  const meta = (row as any).clone_meta || {}
  const scenes = Array.isArray(meta.scene_plan) ? meta.scene_plan : []
  const hasClips = meta.scene_clips && Object.keys(meta.scene_clips).length > 0
  if ((type === 'redo_scene' || type === 'remove_scene') && (!scenes.length || !hasClips))
    return NextResponse.json({ error: 'this render has no per-scene cache (older video) — re-generate instead' }, { status: 409 })

  const idx = Number(scene)
  if (type === 'redo_scene' || type === 'remove_scene') {
    if (!(Number.isInteger(idx) && idx >= 0 && idx < scenes.length)) return NextResponse.json({ error: 'bad scene index' }, { status: 400 })
    if (type === 'remove_scene' && scenes.length < 3) return NextResponse.json({ error: 'keep at least 2 scenes' }, { status: 400 })
  }
  // Long-form UGC segment re-roll: needs cached segment clips + a valid segment index.
  const segCount = Array.isArray(meta.segment_plan?.segments) ? meta.segment_plan.segments.length : 0
  const hasSegClips = meta.segment_clips && Object.keys(meta.segment_clips).length > 0
  if (type === 'redo_segment') {
    if (!segCount || !hasSegClips) return NextResponse.json({ error: 'this render has no per-section cache (older video) — re-generate instead' }, { status: 409 })
    if (!(Number.isInteger(idx) && idx >= 0 && idx < segCount)) return NextResponse.json({ error: 'bad section index' }, { status: 400 })
  }
  // UGC clip re-roll: single-clip UGC renders only (multi-segment 30/60s would need a full re-render).
  if (type === 'redo_ugc' && (meta.mode === 'faithful' || Number(meta.segments) > 1))
    return NextResponse.json({ error: 'this fix applies to single-clip UGC videos' }, { status: 409 })
  // Cutaway patch: needs a sane seconds window (worker clamps to 2–5s inside the video's length).
  const pFrom = Number(from), pTo = Number(to)
  if (type === 'patch_broll' && !(Number.isFinite(pFrom) && pFrom >= 0 && Number.isFinite(pTo) && pTo > pFrom))
    return NextResponse.json({ error: 'pick the seconds to patch (from/to)' }, { status: 400 })

  // Reserve credits for paid tweaks (free ops skip billing entirely).
  let txId: string | null = null
  const action = ACTIONS[type]
  if (action) {
    const { data: tx, error: rErr } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: action })
    if (rErr) {
      const insufficient = String(rErr.message || '').includes('insufficient_credits')
      return NextResponse.json({ error: insufficient ? 'insufficient_credits' : 'reserve_failed' }, { status: insufficient ? 402 : 500 })
    }
    txId = Array.isArray(tx) ? (tx as any)[0]?.id : (tx as any)?.id
  }

  const tweak: Record<string, unknown> = {
    type,
    ...(type === 'redo_scene' || type === 'remove_scene' || type === 'redo_segment' ? { scene: idx } : {}),
    ...(type === 'redo_scene' || type === 'redo_ugc' || type === 'redo_segment' ? { chip: CHIPS.has(String(chip)) ? String(chip) : 'redo' } : {}),
    // "Fix a moment" free-text: the user's own description of what's wrong (pronunciation, invented
    // cap, …) — worker respells the spoken line if it's about speech + injects it into the prompt.
    ...((type === 'redo_segment' || type === 'redo_ugc' || type === 'patch_broll' || type === 'redo_scene') && typeof note === 'string' && note.trim() ? { note: note.trim().slice(0, 400) } : {}),
    ...(type === 'patch_broll' ? { from: Math.max(0, pFrom), to: pTo } : {}),
    ...(type === 'redo_vo' && typeof script === 'string' && script.trim() ? { script: script.trim().slice(0, 2000) } : {}),
    ...(txId ? { tx: txId } : {}),
  }

  const { error } = await admin.from('creative_generations')
    .update({ status: 'processing', clone_meta: { ...meta, tweak, tweak_error: null } })
    .eq('id', jobId).eq('user_id', user.id)
  if (error) {
    if (txId) await admin.rpc('refund_credits', { p_tx: txId }).then(() => {}, () => {})
    return NextResponse.json({ error: 'could not start the tweak' }, { status: 500 })
  }
  return NextResponse.json({ jobId, status: 'processing', charged: action ? true : false })
}
