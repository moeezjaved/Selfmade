/**
 * Timeline API for the Remotion editor (Phase 1 Step 4).
 *   GET   ?jobId=<id>  → compute/return the Timeline for a finished remake (latest if no id) + any
 *                        saved edits (clone_meta.timeline) + render status/exports.
 *   PATCH { jobId, timeline } → persist edited timeline to clone_meta.timeline (free — no render).
 * Owner-scoped. Export (kick off a render) lives in ./render.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildTimelineFromJob } from '@/lib/video/build-timeline'

export const dynamic = 'force-dynamic'

async function loadRow(admin: ReturnType<typeof createAdminClient>, userId: string, jobId: string | null) {
  let q = admin.from('creative_generations')
    .select('id, user_id, status, image_url, clone_meta, brand_id')
    .eq('user_id', userId).eq('media_type', 'video').eq('status', 'done')
  q = jobId ? q.eq('id', jobId) : q.order('created_at', { ascending: false })
  const { data } = await q.limit(1).maybeSingle()
  return data as any
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const row = await loadRow(admin, user.id, req.nextUrl.searchParams.get('jobId'))
  if (!row) return NextResponse.json({ error: 'no finished video remake found' }, { status: 404 })

  // A user's SAVED timeline (clone_meta.timeline) wins over a freshly-computed one.
  const saved = (row.clone_meta || {}).timeline
  let brand: { brand_kit?: any; name?: string | null } | null = null
  if (!saved && row.brand_id) {
    const { data: b } = await admin.from('brands').select('name, brand_kit').eq('id', row.brand_id).maybeSingle()
    brand = b || null
  }
  const built = saved ? { timeline: saved, editable: true, note: undefined } : buildTimelineFromJob(row, brand)
  const render = (row.clone_meta || {}).render || null
  const exports = (row.clone_meta || {}).exports || null
  return NextResponse.json({ jobId: row.id, editable: built.editable, note: built.note, timeline: built.timeline, render, exports })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const jobId = b?.jobId ? String(b.jobId) : null
  const timeline = b?.timeline
  if (!jobId || !timeline || !Array.isArray(timeline.scenes)) return NextResponse.json({ error: 'jobId and a valid timeline are required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: row } = await admin.from('creative_generations').select('id, clone_meta').eq('id', jobId).eq('user_id', user.id).maybeSingle()
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const meta = { ...((row as any).clone_meta || {}), timeline }
  const { error } = await admin.from('creative_generations').update({ clone_meta: meta }).eq('id', jobId).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, jobId })
}
