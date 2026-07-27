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

  const { jobId, script, mode, durationBucket, sceneCount, extraLangs, endCard, hookVariants, overlays } = await req.json().catch(() => ({}))
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
  // Cinematic length follows the user's script: the client sends how many scenes cover the narration.
  // Clamp to [2, the source ad's analysed cut count] — the client can pick FEWER (shorter/cheaper, less
  // work) but never MORE than the source has (that ceiling keeps pricing honest). Stored back into
  // scene_count so the worker renders exactly this many.
  const srcMaxScenes = Math.max(2, Math.min(16, Number(meta.scene_count) || 2))
  const reqScenes = Number(sceneCount)
  let nScenes = Number.isFinite(reqScenes) ? Math.max(2, Math.min(srcMaxScenes, Math.round(reqScenes))) : srcMaxScenes

  // UGC length buckets: 15s = 1 clip (classic), 30s = 2 chained segments, 60s = 4. 'match' auto-picks
  // the nearest bucket from the source ad's analysed duration. Segments are priced by the same
  // video_clone_xN rows as faithful scenes (same per-clip cost), and clamped server-side.
  // CLONE = MATCH THE SOURCE. Never render LONGER than the source ad — a 14s ad must not become a
  // 60s clone (that's what produced the padded/slow 3-minute video). The source's own analysed length
  // is the ceiling; the user may pick a SHORTER bucket but not a longer one.
  const srcSecs = Number(meta?.beat_sheet?.duration_seconds) || 15
  const srcBucketCap = srcSecs <= 22 ? 15 : srcSecs <= 45 ? 30 : 60

  // ── CINEMATIC LENGTH = the user's picked bucket, and it drives EVERYTHING: scene count (~1 scene per
  // 3s: 15s → 5, 30s → 10, 60s → 16) and, in the worker, per-scene durations + script pacing. This fixes
  // the core mismatch where scenes followed the SOURCE length (a 71s ad → 10 scenes) while the script
  // followed the CHOSEN length (15s) — which chopped the voiceover into 1-2-word fragments and rendered
  // minutes of footage for seconds of script. Never longer than the source (clone = match the source). ──
  let targetSecs = 0
  if (chosenMode === 'faithful') {
    let b = Number(durationBucket) || 15
    if (durationBucket === 'match') b = Math.round(srcSecs)
    targetSecs = Math.max(8, Math.min(b, Math.round(srcSecs) || b, 60))
    const lenCapScenes = Math.max(2, Math.min(16, Math.floor(targetSecs / 3)))
    nScenes = Math.min(nScenes, lenCapScenes)
  }
  let nSeg = 1
  if (chosenMode === 'ugc') {
    let bucket: number = Number(durationBucket) || 15
    if (durationBucket === 'match') bucket = srcBucketCap
    bucket = Math.min(bucket, srcBucketCap)   // hard ceiling: can't exceed the source's own length
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
  const reserved: string[] = txId ? [txId] : []
  const refundAll = async () => { for (const t of reserved) await admin.rpc('refund_credits', { p_tx: t }).then(() => {}, () => {}) }
  const reserve = async (a: string): Promise<string | null> => {
    const { data: t, error: e } = await admin.rpc('reserve_credits', { p_user: user.id, p_action: a })
    if (e) return null
    const id = Array.isArray(t) ? t[0]?.id : (t as any)?.id
    if (id) reserved.push(id)
    return id || null
  }

  // ── Add-ons — each gets its OWN credit tx so a single add-on failing refunds only itself. ──
  const LANGS = new Set(['en', 'ur', 'hi', 'ar', 'es', 'fr', 'de'])
  const addonMeta: any = {}
  // Extra language outputs (faithful only — remuxes the same rendered video with a new TTS track).
  if (chosenMode === 'faithful' && Array.isArray(extraLangs) && extraLangs.length) {
    const langs = Array.from(new Set(extraLangs.map(String))).filter((l) => LANGS.has(l) && l !== (meta.language || 'en')).slice(0, 2)
    const list: { lang: string; tx: string }[] = []
    for (const lang of langs) {
      const t = await reserve('video_lang_extra')
      if (!t) { await refundAll(); return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 }) }
      list.push({ lang, tx: t })
    }
    if (list.length) addonMeta.extra_langs = list
  }
  // Branded end-card (ffmpeg compose; offer + CTA text from the user).
  if (endCard && (endCard.offer || endCard.cta)) {
    const t = await reserve('video_endcard')
    if (!t) { await refundAll(); return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 }) }
    addonMeta.end_card = { offer: String(endCard.offer || '').slice(0, 60), cta: String(endCard.cta || 'Shop now').slice(0, 30), tx: t }
  }
  // 3 hook variants — faithful mode only (that's the only path the worker renders them in; billing
  // must never enable an add-on the worker won't produce, or the reservation strands).
  if (hookVariants && chosenMode === 'faithful') {
    const t = await reserve('video_hook_variants')
    if (!t) { await refundAll(); return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 }) }
    addonMeta.hook_variants_tx = t
  }

  // Single-clip UGC (the 15s bucket) must render a FULL 15s — Seedance supports 4-15s, but the clip
  // was defaulting to 10s, so the ad ended early and the end-card landed at ~10-12s. (Multi-clip
  // segments already render 15s each.)
  const clipDuration = chosenMode === 'ugc' && nSeg === 1 ? 15 : (meta.duration || 10)

  const finalScript = (typeof script === 'string' && script.trim()) ? script.trim() : (meta.script || '')
  const { error } = await admin.from('creative_generations').update({
    // User-edited on-screen text callouts (falls back to the auto-detected ones). Sanitized + capped.
    status: 'processing', credit_tx: txId, clone_meta: { ...meta, ...addonMeta, final_script: finalScript, mode: chosenMode, scene_count: nScenes, segments: nSeg, duration: clipDuration, ...(targetSecs ? { duration_target: targetSecs } : {}),
      overlays: Array.isArray(overlays)
        ? overlays.filter((o: any) => o && String(o.text || '').trim()).slice(0, 8).map((o: any) => ({ t: String(o.t || '').slice(0, 12), text: String(o.text).trim().slice(0, 60) }))
        : (meta.overlays || []) },
  }).eq('id', jobId).eq('user_id', user.id)

  if (error) {
    await refundAll()
    return NextResponse.json({ error: 'could not start generation' }, { status: 500 })
  }
  // Credits were just spent on a video — if they're now too low for another, nudge them (once/month).
  try { const { maybeLowCreditsEmail } = await import('@/lib/email'); await maybeLowCreditsEmail(user.id, user.email || '') } catch { /* best-effort */ }

  return NextResponse.json({ jobId, status: 'processing' })
}
