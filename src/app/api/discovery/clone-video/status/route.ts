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
