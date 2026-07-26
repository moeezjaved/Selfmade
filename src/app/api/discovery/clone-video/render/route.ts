/**
 * POST /api/discovery/clone-video/render  { jobId, timeline?, aspects? }
 * Kicks off an export: persists the current timeline and flags the job for the selfmade-render worker
 * (droplet), which runs Remotion → MP4s → R2 and writes clone_meta.exports. Poll status via GET
 * /timeline (returns clone_meta.render + exports). Owner-scoped; enqueue only, returns immediately.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Aspect } from '@/lib/video/timeline'

export const dynamic = 'force-dynamic'

const VALID: Aspect[] = ['9:16', '4:5', '1:1', '16:9']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const jobId = b?.jobId ? String(b.jobId) : null
  if (!jobId) return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  const aspects: Aspect[] = Array.isArray(b?.aspects) && b.aspects.length ? b.aspects.filter((a: any) => VALID.includes(a)) : ['9:16']

  const admin = createAdminClient()
  const { data: row } = await admin.from('creative_generations').select('id, clone_meta').eq('id', jobId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const meta = { ...((row as any).clone_meta || {}) }
  if (b?.timeline && Array.isArray(b.timeline.scenes)) meta.timeline = b.timeline   // save what's on screen
  if (!meta.timeline) return NextResponse.json({ error: 'no timeline to render' }, { status: 400 })
  meta.render = { status: 'requested', aspects, requestedAt: new Date().toISOString() }
  // Clear stale exports for the aspects we're about to re-render.
  meta.exports = { ...(meta.exports || {}) }
  for (const a of aspects) delete meta.exports[a]

  const { error } = await admin.from('creative_generations').update({ clone_meta: meta }).eq('id', jobId).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, jobId, aspects, status: 'requested' })
}
