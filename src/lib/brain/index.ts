/**
 * The Company Brain (Phase 1) — memory that operates, not remembers.
 *
 * Five layers, but only three code paths matter here:
 *   recordLearning() — L4, AUTO-written as departments act (the compounding layer). Append-only.
 *   teachRule()      — L2, the founder's beliefs (from "Teach Mello"). Mello may propose (created_by
 *                      'mello', inactive) but only the founder's yes activates a belief.
 *   recall()         — assembles a department's context in a FIXED order of authority:
 *                      department notebook (L3) → company DNA (L2) → recent learnings (L4) → CEO prefs (L5).
 *                      No vector search (we dropped pgvector for cost) — filter by department + recency.
 *
 * Everything is best-effort and never throws: memory writing must never break the action it's observing.
 */

export type Department = 'research' | 'creative' | 'media' | 'growth' | 'customer' | 'store' | 'finance'

/** Map a mello_task kind → the department that owns the learning. */
export function departmentForKind(kind: string): Department {
  switch (kind) {
    case 'research': return 'research'
    case 'creative': return 'creative'
    case 'video': return 'creative'
    case 'meta_pause':
    case 'meta_scale': return 'media'
    default: return 'media'
  }
}

// ── L4 · learnings (auto) ────────────────────────────────────────────────────
export async function recordLearning(admin: any, l: {
  userId: string; brandId?: string | null; department: Department | string;
  event: string; result?: string; metric?: Record<string, any>; confidence?: number; source?: 'auto' | 'founder';
}): Promise<void> {
  try {
    await admin.from('learnings').insert({
      user_id: l.userId, brand_id: l.brandId || null, department: l.department,
      event: l.event.slice(0, 500), result: (l.result || '').slice(0, 500) || null,
      metric: l.metric || {}, confidence: l.confidence ?? 70, source: l.source || 'auto',
    })
  } catch { /* memory writes never break the caller */ }
}

// ── L2 · DNA (beliefs) ───────────────────────────────────────────────────────
export async function teachRule(admin: any, r: {
  userId: string; brandId?: string | null; rule: string; department?: string | null;
  priority?: 'high' | 'normal' | 'low'; createdBy?: 'founder' | 'mello'; source?: string;
}): Promise<any> {
  const { data } = await admin.from('company_dna').insert({
    user_id: r.userId, brand_id: r.brandId || null, rule: r.rule.trim().slice(0, 400),
    department: r.department || null, priority: r.priority || 'normal',
    created_by: r.createdBy || 'founder', active: (r.createdBy || 'founder') === 'founder', source: r.source || 'teach',
  }).select('*').maybeSingle()
  return data
}

export async function getDna(admin: any, userId: string, opts?: { brandId?: string | null; department?: string | null; includeProposed?: boolean }): Promise<any[]> {
  let q = admin.from('company_dna').select('*').eq('user_id', userId)
  if (!opts?.includeProposed) q = q.eq('active', true)
  const { data } = await q.order('priority', { ascending: true }).order('created_at', { ascending: false })
  let rows = (data || []) as any[]
  // A department's context sees its own beliefs + company-wide ones (department is null).
  if (opts?.department) rows = rows.filter(d => !d.department || d.department === opts.department)
  if (opts?.brandId !== undefined) rows = rows.filter(d => !d.brand_id || d.brand_id === opts.brandId)
  return rows
}

// ── L5 · CEO preferences ─────────────────────────────────────────────────────
export async function getPrefs(admin: any, userId: string): Promise<Record<string, any>> {
  const { data } = await admin.from('ceo_preferences').select('key, value').eq('user_id', userId)
  const out: Record<string, any> = {}
  for (const r of (data || []) as any[]) out[r.key] = r.value
  return out
}

export async function setPref(admin: any, userId: string, key: string, value: any, inferred = false): Promise<void> {
  try {
    await admin.from('ceo_preferences').upsert({ user_id: userId, key, value, inferred, updated_at: new Date().toISOString() }, { onConflict: 'user_id,key' })
  } catch { /* best-effort */ }
}

// ── recall() — the fixed-order context bundle a department reads before it acts ──
export type Recall = {
  dna: any[]; deptMemory: any[]; learnings: any[]; prefs: Record<string, any>; prompt: string
}

export async function recall(admin: any, opts: { userId: string; department: Department | string; brandId?: string | null; limit?: number }): Promise<Recall> {
  const lim = opts.limit ?? 8
  const [dna, memRes, learnRes, prefs] = await Promise.all([
    getDna(admin, opts.userId, { brandId: opts.brandId ?? undefined, department: opts.department }),
    admin.from('mello_memory').select('content, category, confidence, department')
      .eq('user_id', opts.userId).or(`department.eq.${opts.department},department.is.null`)
      .order('confidence', { ascending: false }).limit(lim),
    admin.from('learnings').select('event, result, metric, confidence, created_at')
      .eq('user_id', opts.userId).eq('department', opts.department)
      .order('created_at', { ascending: false }).limit(lim),
    getPrefs(admin, opts.userId),
  ])
  const deptMemory = (memRes?.data || []) as any[]
  const learnings = (learnRes?.data || []) as any[]

  // Compact, prompt-ready rendering in the order of authority.
  const lines: string[] = []
  if (dna.length) lines.push(`Company beliefs (never break):\n${dna.map(d => `• ${d.rule}`).join('\n')}`)
  if (deptMemory.length) lines.push(`What ${opts.department} knows:\n${deptMemory.map(m => `• ${m.content}`).join('\n')}`)
  if (learnings.length) lines.push(`What ${opts.department} has learned:\n${learnings.map(l => `• ${l.event}${l.result ? ` → ${l.result}` : ''}`).join('\n')}`)
  const prefLines = Object.entries(prefs).map(([k, v]) => `• ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
  if (prefLines.length) lines.push(`Working with the founder:\n${prefLines.join('\n')}`)

  return { dna, deptMemory, learnings, prefs, prompt: lines.join('\n\n') }
}
