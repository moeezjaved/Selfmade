/**
 * Mello Tasks — the decision engine behind the "CEO desk". Instead of showing analytics, Mello proposes
 * a small set of TASKS (decisions already made, one click to execute). Phase 1 = RESEARCH tasks:
 * "competitor X just pushed N ads → produce their intelligence report." Deterministic, from data the
 * brief already has (notifications + report history) — no extra AI cost to decide.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type TaskSuggestion = {
  kind: 'research' | 'creative' | 'video'
  title: string
  why: string
  evidence: Record<string, any>
  credits: number | null
  suggested_key: string
  brand_id: string | null
}

const H72 = () => new Date(Date.now() - 72 * 3600e3).toISOString()
const D7 = () => new Date(Date.now() - 7 * 86400e3).toISOString()
const isoDay = (d = new Date()) => d.toISOString().slice(0, 10)

/**
 * Propose today's tasks. Currently RESEARCH only (the loop-prover): a competitor that just launched a
 * burst of ads AND hasn't been reported on this week → "produce their report". Capped, deduped by key.
 */
export async function suggestTasks(admin: SupabaseClient, userId: string, brandId?: string | null): Promise<TaskSuggestion[]> {
  const out: TaskSuggestion[] = []

  // Recent competitor launches (the alert-worker writes these). A burst = a real push worth studying.
  const { data: notifs } = await admin.from('notifications')
    .select('brand_name, page_id, ad_count, created_at')
    .eq('user_id', userId).eq('type', 'new_ad').gte('created_at', H72())
    .order('created_at', { ascending: false }).limit(30)

  // Which competitors already have a fresh report — don't re-suggest those.
  const { data: docs } = await admin.from('mello_documents')
    .select('subject, created_at').eq('user_id', userId).gte('created_at', D7()).limit(50)
  const reported = new Set((docs || []).map((d: any) => String(d.subject || '').toLowerCase().trim()).filter(Boolean))

  // Aggregate launches per competitor (page_id), summing the burst size.
  const byPage = new Map<string, { name: string; pageId: string; ads: number }>()
  for (const n of (notifs || []) as any[]) {
    const pid = String(n.page_id || '')
    if (!pid) continue
    const cur = byPage.get(pid) || { name: n.brand_name || 'A competitor', pageId: pid, ads: 0 }
    cur.ads += Number(n.ad_count) || 1
    byPage.set(pid, cur)
  }

  for (const c of Array.from(byPage.values()).sort((a, b) => b.ads - a.ads)) {
    if (c.ads < 4) continue                                     // a real push, not routine rotation
    if (reported.has(c.name.toLowerCase().trim())) continue     // already reported this week
    out.push({
      kind: 'research',
      title: `Produce the ${c.name} intelligence report`,
      why: `${c.name} launched ${c.ads} ad${c.ads === 1 ? '' : 's'} in 48h — a real push, not rotation. You want their playbook before it compounds.`,
      evidence: { competitor: c.name, pageId: c.pageId, adCount: c.ads },
      credits: 50,
      suggested_key: `research:${c.pageId}:${isoDay()}`,
      brand_id: brandId || null,
    })
    if (out.length >= 3) break                                  // the CEO desk shows the plan, not a backlog
  }

  return out
}
