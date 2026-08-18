/**
 * Poll a video-clone job. GET ?id=<jobId> → { status, done, url?, script?, error? }.
 * The modal polls this after POST /api/discovery/clone-video; the finished clip also shows up in
 * creative-studio ("My Creatives") on its own.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin
    .from('creative_generations')
    .select('id, user_id, status, image_url, clone_meta')
    .eq('id', id).eq('user_id', user.id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // "Your first ad is ready" — also fire on VIDEO (was image-only). claimOnceLog(FIRST_AD_EMAIL) makes
  // it idempotent and shared with the image path, so a user gets it exactly once, image or video.
  if ((row as any).status === 'done' && (row as any).image_url) {
    try { const { sendFirstAdEmail } = await import('@/lib/email'); await sendFirstAdEmail(user.id, user.email || '', (row as any).image_url) } catch { /* best-effort */ }
  }

  const meta = (row as any).clone_meta || {}
  return NextResponse.json({
    status: (row as any).status,
    done: (row as any).status === 'done',
    url: (row as any).image_url || null,
    script: meta.script || null,
    gloss: meta.script_gloss || null,
    // Faithful-mode hints for the review UI: what the analysis suggests + how many scenes it found.
    suggestedMode: meta.suggested_mode || 'ugc',
    sceneCount: meta.scene_count || 2,
    sourceSeconds: Number(meta?.beat_sheet?.duration_seconds) || null,
    progress: meta.progress || null,   // { label, pct, eta_sec } — live render step + ETA
    overlays: Array.isArray(meta.overlays) ? meta.overlays : [],   // auto-detected on-screen text callouts (editable)
    // ONE-SHOT shot list — the timestamped scene-by-scene decode the worker feeds Seedance. Surfaced so
    // the review step SHOWS the shots the ad will move through (person speaks → box opens → room b-roll…)
    // instead of a per-scene storyboard. Each beat gets an explicit Ns-Ms slot (synthesized if Gemini
    // left it blank). Read-only; the editable voiceover script stays separate.
    shotList: (() => {
      const beats = Array.isArray(meta?.beat_sheet?.beats) ? meta.beat_sheet.beats : []
      if (!beats.length) return []
      const total = Math.max(4, Number(meta.duration_target) || Number(meta?.beat_sheet?.duration_seconds) || 15)
      const n = beats.length
      const parse = (s: string) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)/); return m ? [parseFloat(m[1]), parseFloat(m[2])] : null }
      const ranges = beats.map((b: any) => parse(b.t || b.time))
      const srcMax = Math.max(0, ...ranges.map((r: any) => (r ? r[1] : 0)))
      const scale = srcMax > 0 ? total / srcMax : 0   // rescale real timestamps to the chosen duration (50s ad → 30s)
      return beats.map((b: any, i: number) => {
        const r = ranges[i]
        const t = (r && scale) ? `${Math.round(r[0] * scale)}s-${Math.round(r[1] * scale)}s` : `${Math.round((i * total) / n)}s-${Math.round(((i + 1) * total) / n)}s`
        return { t, action: String(b.action || b.visual || ''), lens: String(b.lens || ''), shows: (b.shows && b.shows !== 'none') ? String(b.shows) : '', line: String(b.script || '') }
      })
    })(),
    // Tweak panel: a finished faithful render with cached per-scene clips can be fixed per-scene.
    tweakable: (row as any).status === 'done' && meta.mode === 'faithful'
      && Array.isArray(meta.scene_plan) && meta.scene_plan.length > 0
      && !!meta.scene_clips && Object.keys(meta.scene_clips).length > 0,
    tweakScenes: Array.isArray(meta.scene_plan) ? meta.scene_plan.map((s: any) => ({ duration: s.duration, hasPeople: !!s.has_people })) : [],
    // Single-clip UGC renders get whole-clip fix chips (re-roll with a corrective prompt).
    ugcTweakable: (row as any).status === 'done' && meta.mode !== 'faithful' && Number(meta.segments || 1) === 1,
    // Long-form UGC (30/60s) with cached segment clips can fix ONE section at a time.
    segmentTweakable: (row as any).status === 'done' && meta.mode !== 'faithful' && Number(meta.segments || 1) > 1
      && Array.isArray(meta.segment_plan?.segments) && meta.segment_plan.segments.length > 0
      && !!meta.segment_clips && Object.keys(meta.segment_clips).length > 0,
    // Each section carries its start/end seconds (same words/2.6 formula the worker renders with) so
    // the UI can label "Section 2 · 0:10–0:19" and the user can point at a MOMENT, not guess.
    tweakSegments: (() => {
      const segs = Array.isArray(meta.segment_plan?.segments) ? meta.segment_plan.segments : []
      let at = 0
      return segs.map((s: any) => {
        const words = String(s.script || s.text || '').trim().split(/\s+/).filter(Boolean).length
        const secs = Math.max(5, Math.min(15, Math.round(words / 2.6) + 1))
        const out = { script: String(s.script || s.text || '').slice(0, 90), start: at, end: at + secs }
        at += secs
        return out
      })
    })(),
    tweaking: !!meta.tweak,
    tweakError: meta.tweak_error || null,
    finalScript: meta.final_script || meta.script || null,
    error: (row as any).status === 'failed' ? friendlyError(meta.error) : null,
  })
}

// Turn raw worker/fal errors into something a user can act on.
function friendlyError(raw?: string): string {
  const e = String(raw || '')
  if (/content_policy_images/.test(e)) return 'One of your product photos was flagged by the video model (it may show a person or private info). Pick a different product photo — a clean shot of just the product works best — and try again.'
  if (/content_policy_video/.test(e)) return 'The source ad was blocked for likeness — please try a different ad.'
  if (/insufficient/.test(e)) return 'Not enough credits.'
  return 'Generation failed — your credits were refunded. Please try again.'
}
