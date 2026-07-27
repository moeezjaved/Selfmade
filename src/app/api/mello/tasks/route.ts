/**
 * GET /api/mello/tasks?brandId=  → today's plan for the CEO desk: persisted tasks Mello is running /
 * has finished, plus fresh suggestions (decisions Mello made, one click to run). Deduped so a task the
 * user already ran/dismissed isn't re-proposed. Capped — the desk shows the plan, not a backlog.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { suggestTasks } from '@/lib/mello/tasks'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const brandId = req.nextUrl.searchParams.get('brandId')

  // Persisted tasks (things Mello is running or finished) from the last few days.
  const since = new Date(Date.now() - 3 * 86400e3).toISOString()
  let pq = admin.from('mello_tasks').select('*').eq('user_id', user.id).gte('created_at', since).order('created_at', { ascending: false }).limit(20)
  if (brandId) pq = pq.eq('brand_id', brandId)
  const persisted = (await pq).data || []

  const seenKeys = new Set(persisted.map((t: any) => t.suggested_key).filter(Boolean))
  const active = persisted.filter((t: any) => ['running', 'done', 'failed'].includes(t.status))

  // Fresh suggestions, minus anything already persisted (ran/dismissed/done).
  let suggestions: any[] = []
  try {
    suggestions = (await suggestTasks(admin, user.id, brandId)).filter((s) => !seenKeys.has(s.suggested_key))
  } catch { /* fail-soft: still return persisted */ }

  // The desk: running/failed first (needs attention), then fresh suggestions, then recent done. Cap 4.
  const running = active.filter((t: any) => t.status === 'running' || t.status === 'failed')
  const done = active.filter((t: any) => t.status === 'done')
  const tasks = [
    ...running.map((t: any) => ({ ...t, suggested: false })),
    ...suggestions.map((s) => ({ ...s, status: 'suggested', suggested: true })),
    ...done.slice(0, 2).map((t: any) => ({ ...t, suggested: false })),
  ].slice(0, 4)

  return NextResponse.json({ tasks })
}
