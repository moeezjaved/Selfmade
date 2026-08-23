/**
 * The AGENT ROUTER — turns a Strategist move into an EXECUTED one, without inventing a new execution
 * path. Each "agent" is a department from src/lib/company/departments.ts (v3 rule: departments are known
 * by FUNCTION — the personality lives in Mello alone) given an executable interface:
 *
 *   Strategist task (freeform, LLM)  →  routeStrategistTask()  →  one of:
 *     • run          — a CONCRETE, correctly-shaped TaskSuggestion (same shape tasks.ts produces),
 *                      executed through the EXISTING POST /api/mello/tasks/run → runTask spine, so it
 *                      inherits every guard: credit reserve, dedupe by suggested_key, no double-charge,
 *                      cookie s2s, learning log. The router NEVER executes anything itself.
 *     • run_existing — an already-suggested mello_tasks row (e.g. the nightly Meta audit's pause/scale
 *                      moves) that matches the strategist's intent — run by id, same spine.
 *     • connect      — the task needs an integration first (meta/shopify/klaviyo).
 *     • brief        — real advice Selfmade can't execute yet (seo/site/outreach…) → founder-facing brief.
 *
 * ADDITIVE + SAFE: read-only module — its only writes happen downstream in the existing run spine after
 * the founder's explicit approve. Approve-mode holds: resolve → show the founder WHO runs it and what it
 * costs → they confirm → /api/mello/tasks/run.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { departmentByKey, type DeptKey } from '@/lib/company/departments'
import { suggestTasks, type TaskSuggestion } from '@/lib/mello/tasks'
import type { StrategistTask } from '@/lib/mello/strategist'

export type AgentInfo = { key: DeptKey; name: string; emoji: string; role: string }

export type AgentResolution =
  | { action: 'run'; agent: AgentInfo; suggestion: TaskSuggestion; cost: string; note: string }
  | { action: 'run_existing'; agent: AgentInfo; taskId: string; title: string; cost: string; note: string }
  | { action: 'connect'; agent: AgentInfo | null; needs: 'meta' | 'shopify' | 'klaviyo'; note: string }
  | { action: 'brief'; agent: AgentInfo | null; note: string }

// strategist dept string → the department that would own it (strategist may emit depts that aren't
// departments yet — email/seo/site/outreach map to their future owner for honest attribution).
const DEPT_ALIAS: Record<string, DeptKey> = {
  media: 'media', creative: 'creative', research: 'research', customer: 'customer',
  reports: 'research', email: 'growth', seo: 'growth', outreach: 'growth', site: 'store', aov: 'store',
}

function agentFor(dept: string): AgentInfo | null {
  const d = departmentByKey(DEPT_ALIAS[dept] || dept)
  return d ? { key: d.key, name: `${d.name} agent`, emoji: d.emoji, role: d.role } : null
}

const isoDay = () => new Date().toISOString().slice(0, 10)
const fold = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Resolve which watched competitor a freeform strategist task is about — folded-name containment
 * against the founder's ACTUAL followed brands (never a guess outside the watch list).
 */
async function matchCompetitor(
  admin: SupabaseClient, userId: string, brandId: string | null, text: string,
): Promise<{ name: string; pageId: string } | null> {
  let q = admin.from('followed_brands').select('page_id, brand_name, brand_id').eq('user_id', userId)
  const { data } = await q
  const rows = ((data || []) as any[])
    .filter((r) => r.page_id && r.brand_name)
    .filter((r) => !brandId || String(r.brand_id) === brandId)   // strict brand-isolation (no unassigned leak)
  const hay = fold(text)
  // longest name first so "Aura Bura" beats "Aura"
  rows.sort((a, b) => String(b.brand_name).length - String(a.brand_name).length)
  for (const r of rows) {
    const key = fold(String(r.brand_name))
    if (key.length >= 3 && hay.includes(key)) return { name: String(r.brand_name), pageId: String(r.page_id) }
  }
  return null
}

/**
 * Route one strategist move to its agent + concrete execution. Never bills, never writes — it only
 * RESOLVES; the founder's confirm then goes through /api/mello/tasks/run.
 */
export async function routeStrategistTask(
  admin: SupabaseClient,
  opts: { userId: string; brandId: string | null; task: StrategistTask },
): Promise<AgentResolution> {
  const { task } = opts
  const agent = agentFor(task.dept)

  // 1) needs a connection → the honest Connect CTA (the UI already knows the hrefs)
  if (task.needs) {
    return { action: 'connect', agent, needs: task.needs, note: `Connect ${task.needs === 'meta' ? 'Meta' : task.needs === 'shopify' ? 'Shopify' : 'Klaviyo'} and the ${agent?.name || 'right agent'} can run this for you.` }
  }
  if (!task.runnable) {
    return { action: 'brief', agent, note: agent ? `The ${agent.name} drafted this as a brief — Selfmade can't execute this move autonomously yet.` : 'This move is a founder brief for now.' }
  }

  const dept = DEPT_ALIAS[task.dept] || task.dept

  // 2) RESEARCH — build the exact suggestion shape runTask's research executor expects.
  if (dept === 'research') {
    const comp = await matchCompetitor(admin, opts.userId, opts.brandId, `${task.title} ${task.why}`)
    if (!comp) return { action: 'brief', agent, note: 'I couldn’t match this to one of your watched competitors — add them in Brand Spy and I can produce the full report.' }
    return {
      action: 'run', agent: agent!, cost: '50 credits',
      note: `${agent!.name} will author the full ${comp.name} intelligence report (50 credits).`,
      suggestion: {
        kind: 'research',
        title: `Produce the ${comp.name} intelligence report`,
        why: task.why,
        evidence: { competitor: comp.name, pageId: comp.pageId, source: 'strategist' },
        credits: 50,
        suggested_key: `research:${comp.pageId}:${isoDay()}`,   // same key family as tasks.ts → natural dedupe
        brand_id: opts.brandId,
      },
    }
  }

  // 3) CREATIVE — reuse the deterministic engine to pick a REAL source ad + the brand's product photos
  //    (the strategist knows the angle; tasks.ts knows the concrete sourceAdId/media the executor needs).
  if (dept === 'creative') {
    let live: TaskSuggestion[] = []
    try { live = await suggestTasks(admin, opts.userId, opts.brandId) } catch { /* fall through */ }
    const comp = await matchCompetitor(admin, opts.userId, opts.brandId, `${task.title} ${task.why}`)
    const pick =
      live.find((s) => s.kind === 'creative' && comp && fold(String(s.evidence?.competitor)) === fold(comp.name)) ||
      live.find((s) => s.kind === 'creative') ||
      live.find((s) => s.kind === 'video')
    if (!pick) return { action: 'brief', agent, note: 'To build this I need a competitor winner in the index and at least one product photo on your brand — add a product photo and I’ll make it.' }
    return {
      action: 'run', agent: agent!, cost: pick.kind === 'video' ? 'storyboard free — video charged only on your approve' : 'covered by your plan',
      note: `${agent!.name} will ${pick.kind === 'video' ? 'build the shot-list storyboard' : 'build your version of the winning ad'}.`,
      suggestion: { ...pick, why: task.why || pick.why },
    }
  }

  // 4) MEDIA — the strategist can't invent campaign ids; the nightly audit already stages concrete
  //    pause/scale/tune moves as suggested mello_tasks. Route to the matching staged move if one exists.
  if (dept === 'media') {
    try {
      const { data } = await admin.from('mello_tasks')
        .select('id, title, kind, credits')
        .eq('user_id', opts.userId).eq('status', 'suggested')
        .in('kind', ['meta_pause', 'meta_scale', 'meta_audience', 'meta_placement'])
        .order('created_at', { ascending: false }).limit(5)
      const staged = (data || []) as any[]
      if (staged.length) {
        const wantScale = /scale|budget|winner/i.test(task.title + task.why)
        const wantPause = /pause|kill|bleed|waste|fatigu/i.test(task.title + task.why)
        const m = staged.find((s) => wantPause && s.kind === 'meta_pause') || staged.find((s) => wantScale && s.kind === 'meta_scale') || staged[0]
        return { action: 'run_existing', agent: agent!, taskId: String(m.id), title: String(m.title), cost: 'no credits — acts on your ad account', note: `${agent!.name} has this staged: “${m.title}”. Approve and it runs on your account.` }
      }
    } catch { /* fall through to brief */ }
    return { action: 'brief', agent, note: 'No concrete media move is staged yet — the nightly audit stages pause/scale moves from your real numbers; check back after the next audit or run one from the brief.' }
  }

  // 5) everything else (customer/reports/growth/store) — honest brief until those executors exist.
  return { action: 'brief', agent, note: agent ? `The ${agent.name} owns this — it ships as a brief today and becomes one-click once that department goes live.` : 'This move is a founder brief for now.' }
}
