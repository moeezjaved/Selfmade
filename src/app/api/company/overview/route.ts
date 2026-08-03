/**
 * GET /api/company/overview — the org, with each department's LIVE status computed from data we
 * already have (mello_tasks + learnings). This is the data layer for the company home screen (V3.1):
 * the org chart shows You → Mello → Marketing/Operations → departments, each with a status dot.
 *
 * Status, per live department:
 *   warning  — a recent failed task
 *   waiting  — a pending suggestion needing the founder
 *   working  — running now, or a learning in the last 48h
 *   finished — a task completed in the last 24h
 *   idle     — nothing lately
 * Non-live departments return 'hiring' (they appear on the chart and light up when their integration lands).
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DEPARTMENTS, MELLO, departmentForTaskKind, deptProgress, type DeptStatus } from '@/lib/company/departments'

export const dynamic = 'force-dynamic'

const H = 3600_000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const [taskRes, learnRes] = await Promise.all([
    admin.from('mello_tasks').select('kind, status, title, updated_at').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(200),
    admin.from('learnings').select('department, event, created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(200),
  ])
  const tasks = (taskRes.data || []) as any[]
  const learns = (learnRes.data || []) as any[]
  const now = Date.now()
  const age = (t: string) => now - new Date(t).getTime()

  const departments = DEPARTMENTS.map(d => {
    const prog = deptProgress(d)
    if (!d.live) return { key: d.key, name: d.name, division: d.division, role: d.role, personality: d.personality, live: false, unlockedBy: d.unlockedBy, status: 'hiring' as DeptStatus, detail: `Ready the moment ${d.unlockedBy} is connected`, progress: prog }

    const myTasks = tasks.filter(t => departmentForTaskKind(t.kind) === d.key)
    const myLearns = learns.filter(l => l.department === d.key)
    const failed = myTasks.find(t => t.status === 'failed' && age(t.updated_at) < 48 * H)
    const pending = myTasks.filter(t => t.status === 'suggested')
    const running = myTasks.find(t => t.status === 'running')
    const doneRecent = myTasks.find(t => t.status === 'done' && age(t.updated_at) < 24 * H)
    const learnRecent = myLearns.find(l => age(l.created_at) < 48 * H)

    let status: DeptStatus = 'idle'; let detail = 'Nothing needs attention'
    if (failed) { status = 'warning'; detail = failed.title || 'Something needs a look' }
    else if (pending.length) { status = 'waiting'; detail = pending[0].title || `${pending.length} waiting on you` }
    else if (running) { status = 'working'; detail = running.title || 'Working…' }
    else if (doneRecent) { status = 'finished'; detail = doneRecent.title || 'Just finished' }
    else if (learnRecent) { status = 'working'; detail = learnRecent.event || 'On it' }

    return { key: d.key, name: d.name, division: d.division, role: d.role, personality: d.personality, live: true, status, detail, pending: pending.length, learnings: myLearns.length, progress: prog }
  })

  const waiting = departments.filter(d => d.status === 'waiting' || d.status === 'warning')
  return NextResponse.json({
    ceo: { name: (user.user_metadata as any)?.full_name || 'You', role: 'CEO' },
    chief: MELLO,
    departments,
    needsYou: waiting.length,
  })
}
