/**
 * computeCompanyStatus — the live state of every department, from real data (mello_tasks + learnings).
 * One source of truth for the org page (/company), the overview API, and the "overnight shift" report.
 */
import { DEPARTMENTS, departmentForTaskKind, deptProgress, type DeptStatus } from '@/lib/company/departments'

const H = 3600_000

export type DeptView = {
  key: string; name: string; emoji: string; division: string; role: string; personality: string
  live: boolean; unlockedBy?: string; status: DeptStatus; detail: string
  pending?: number; learnings?: number; progress: { built: number; total: number }
}

export async function computeCompanyStatus(admin: any, userId: string): Promise<{ departments: DeptView[]; tasks: any[] }> {
  const now = Date.now()
  const weekAgo = new Date(now - 7 * 24 * H).toISOString()
  // A department is never "quiet" while it's actually doing ongoing work — count the live signals so the
  // board reflects reality (running ads, tracked competitors, recent creatives, open chats), not just tasks.
  const count = async (fn: () => any): Promise<number> => { try { const { count } = await fn(); return count || 0 } catch { return 0 } }
  const [taskRes, learnRes, competitors, creativesWk, campaignsN, openChats] = await Promise.all([
    admin.from('mello_tasks').select('id, kind, status, title, evidence, updated_at, created_at').eq('user_id', userId).order('updated_at', { ascending: false }).limit(200),
    admin.from('learnings').select('department, event, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(200),
    count(() => admin.from('followed_brands').select('id', { count: 'exact', head: true }).eq('user_id', userId)),
    count(() => admin.from('creative_generations').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', weekAgo)),
    count(() => admin.from('campaigns').select('id', { count: 'exact', head: true }).eq('user_id', userId)),
    count(() => admin.from('customer_threads').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'open')),
  ])
  const ongoing: Record<string, { detail: string } | undefined> = {
    research: competitors > 0 ? { detail: `Watching ${competitors} competitor${competitors === 1 ? '' : 's'} for new ads` } : undefined,
    creative: creativesWk > 0 ? { detail: `Made ${creativesWk} ad${creativesWk === 1 ? '' : 's'} this week` } : undefined,
    media: campaignsN > 0 ? { detail: `Managing ${campaignsN} live campaign${campaignsN === 1 ? '' : 's'}` } : undefined,
    customer: openChats > 0 ? { detail: `${openChats} conversation${openChats === 1 ? '' : 's'} in the inbox` } : undefined,
  }
  const tasks = (taskRes.data || []) as any[]
  const learns = (learnRes.data || []) as any[]
  const age = (t: string) => now - new Date(t).getTime()

  const departments: DeptView[] = DEPARTMENTS.map(d => {
    const prog = deptProgress(d)
    const base = { key: d.key, name: d.name, emoji: d.emoji, division: d.division, role: d.role, personality: d.personality, live: d.live, unlockedBy: d.unlockedBy, progress: prog }
    if (!d.live) return { ...base, status: 'hiring' as DeptStatus, detail: `Ready the moment ${d.unlockedBy} is connected` }

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
    else if (ongoing[d.key]) { status = 'working'; detail = ongoing[d.key]!.detail }   // actively working, just no task pending

    return { ...base, status, detail, pending: pending.length, learnings: myLearns.length }
  })

  return { departments, tasks }
}
