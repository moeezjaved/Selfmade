/**
 * GET /api/discovery/clone-video/storyboard?jobId=<id>
 * The storyboard-BEFORE-generation view: turns a job's analysis (clone_meta.beat_sheet + script) into
 * scene cards, so the user edits the PLAN before Seedance runs. Works on a 'review' job (the normal
 * pre-generation gate) or any analyzed job (beat_sheet is retained). No generation, no credits.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Split the adapted script across N beats, proportionally, so each scene card carries its own line.
function splitScript(script: string, n: number): string[] {
  const words = String(script || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length || n <= 0) return Array(Math.max(0, n)).fill('')
  const per = Math.ceil(words.length / n)
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(words.slice(i * per, (i + 1) * per).join(' '))
  return out
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const jobId = req.nextUrl.searchParams.get('jobId')
  let q = admin.from('creative_generations')
    .select('id, user_id, status, image_url, clone_meta')
    .eq('user_id', user.id).eq('type', 'video_clone')
  q = jobId ? q.eq('id', jobId) : q.in('status', ['review', 'done']).order('created_at', { ascending: false })
  const { data: row } = await q.limit(1).maybeSingle()
  if (!row) return NextResponse.json({ error: 'no analyzed remake found' }, { status: 404 })

  const meta = (row as any).clone_meta || {}
  const beat = meta.beat_sheet || {}
  const beats: { t?: string; action?: string; thumb?: string; preview?: string; shows?: string }[] = Array.isArray(beat.beats) ? beat.beats : []
  const script = meta.final_script || meta.script || beat.transcript || ''

  // How many scene cards to SHOW = the analyzed scene_count (what the badge promises), never fewer than
  // the beats we have. Single-take UGC often analyzes with an EMPTY beats array — without this it would
  // say "3 scenes" but render one "Opening shot" card. We synthesize the missing cards by splitting the
  // script across them, so the storyboard always matches the count and every scene is editable.
  const wantN = Math.max(1, Math.min(10, Number(meta.scene_count) || beats.length || 1))
  const n = Math.max(beats.length, wantN)
  const srcBeats: { t?: string; action?: string; thumb?: string; preview?: string; preview_source?: string; shows?: string; script?: string }[] =
    Array.from({ length: n }, (_, i) => beats[i] || { action: i === 0 ? (beat.avatar || 'Opening shot') : '' })
  // Interview ads carry a per-beat ATTRIBUTED line (beats[i].script) — a coherent spoken turn on the
  // right person. Use those verbatim; otherwise split the flat narration evenly across the beats.
  const hasBeatScripts = beat.is_interview === true && srcBeats.some((b) => typeof b.script === 'string')
  const lines = hasBeatScripts ? srcBeats.map((b) => String(b.script || '')) : splitScript(script, srcBeats.length)
  const scenes = srcBeats.map((b, i) => ({
    index: i,
    role: i === 0 ? 'hook' : i === srcBeats.length - 1 ? 'cta' : 'body',
    time: b.t || null,
    action: b.action || '',
    scriptLine: lines[i] || '',
    thumb: b.thumb || null,       // reference frame from the source ad at this beat (worker-grabbed)
    preview: b.preview || null,   // GENERATED keyframe for THIS brand (your product/creator) — the model reference
    preview_source: b.preview_source || null,   // 'ai' | 'user' — a user-uploaded frame must survive reload + never be auto-overwritten
    // What product this beat shows: 'hero' (swapped to yours), 'rejected' (kept as the rival/bad thing), else null.
    shows: b.shows === 'hero' || b.shows === 'rejected' ? b.shows : null,
  }))

  return NextResponse.json({
    jobId: (row as any).id,
    status: (row as any).status,
    editable: (row as any).status === 'review',   // only a pre-generation job can still be changed + generated
    hookType: beat.hook_type || null,
    tone: beat.tone || null,
    isTalkingHead: beat.is_talking_head ?? null,
    suggestedMode: meta.suggested_mode || (beat.is_talking_head ? 'ugc' : 'faithful'),
    sceneCount: scenes.length,   // always equals the cards shown (badge ↔ cards can't disagree)
    durationSeconds: beat.duration_seconds || null,
    script,
    scenes,
    onScreenText: Array.isArray(beat.on_screen_text) ? beat.on_screen_text : [],
    // Story contrast: the hero (swapped to the user's product) vs the rejected/rival thing (kept as-is).
    // Surfaced so the storyboard can tag each scene 🚫/✅ and the founder sees the narrative before spend.
    heroProduct: beat.hero_product || null,
    rejectedProduct: beat.rejected_product || null,
    sourcePoster: meta.source_poster || null,
    // The locked HERO CHARACTER SHEET (the recast creator, e.g. "Pakistani" when the source was American)
    // — surfaced so the founder SEES who will be on camera and approves/regenerates BEFORE any video spend.
    castSheet: meta.cast_sheet || null,
    characterLook: meta.character_look || null,
    // FULL CAST (A, B, C…): every distinct on-camera person the analysis found, each with their look and
    // their locked sheet (if drawn yet) — so the founder can review/redraw/upload EACH person before spend,
    // not just the lead. Falls back to a single "A" from the avatar for older jobs with no people[] list.
    cast: buildCast(beat, meta),
  })
}

// Assemble the cast list for the storyboard: prefer the analysis people[] (A/B/C…), else synthesise a
// single "A" from the avatar. Each entry carries its locked sheet from meta.cast_sheets (or the legacy
// meta.cast_sheet for A) so the UI shows who's drawn and who still needs a sheet.
function buildCast(beat: any, meta: any): { id: string; look: string; sheet: string | null }[] {
  const sheets = (meta && meta.cast_sheets) || {}
  const people: any[] = Array.isArray(beat?.people) ? beat.people.filter((p: any) => p && p.id) : []
  if (people.length) {
    return people.slice(0, 5).map((p: any) => ({
      id: String(p.id),
      look: String(p.look || '').slice(0, 400),
      sheet: sheets[String(p.id)] || (String(p.id) === 'A' ? (meta?.cast_sheet || null) : null),
    }))
  }
  const avatar = String(beat?.avatar || '').trim()
  if (avatar && !/^none/i.test(avatar)) return [{ id: 'A', look: avatar.slice(0, 400), sheet: sheets.A || meta?.cast_sheet || null }]
  return []
}
