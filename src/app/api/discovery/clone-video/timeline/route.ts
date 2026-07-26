/**
 * GET /api/discovery/clone-video/timeline?jobId=<id>
 * Computes a Remotion Timeline from a FINISHED remake (creative_generations + clone_meta) using the
 * shared builder. Read-only, no worker change — lets any existing remake be viewed/edited as a timeline.
 * With no jobId, returns the user's most recent finished video remake. (Persisting edits = Step 3.)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildTimelineFromJob } from '@/lib/video/build-timeline'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const jobId = req.nextUrl.searchParams.get('jobId')

  let q = admin.from('creative_generations')
    .select('id, user_id, status, image_url, clone_meta, brand_id')
    .eq('user_id', user.id).eq('media_type', 'video').eq('status', 'done')
  q = jobId ? q.eq('id', jobId) : q.order('created_at', { ascending: false })
  const { data: row } = await q.limit(1).maybeSingle()
  if (!row) return NextResponse.json({ error: 'no finished video remake found' }, { status: 404 })

  let brand: { brand_kit?: any; name?: string | null } | null = null
  const brandId = (row as any).brand_id
  if (brandId) {
    const { data: b } = await admin.from('brands').select('name, brand_kit').eq('id', brandId).maybeSingle()
    brand = b || null
  }

  const { timeline, editable, note } = buildTimelineFromJob(row as any, brand)
  return NextResponse.json({ jobId: (row as any).id, editable, note, timeline })
}
