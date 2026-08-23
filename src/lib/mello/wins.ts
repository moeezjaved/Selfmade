/**
 * The Wins Ledger — the spine of the revenue game. Every money-moving action the founder takes is recorded
 * here as a "win", with an honest split: projected_value (an ESTIMATE, only set when defensible) and
 * banked_value (VERIFIED later from real orders/Meta — starts null). The ledger is permanent, so nothing the
 * agents produce evaporates, and it's the archive the "Banked this month" scoreboard reads from.
 *
 * HONESTY: projected is grey/estimate; banked is green/verified. Never conflate them. recordWin never invents
 * a banked number — that only comes from the proof loop later.
 */

export type WinCategory = 'catalog' | 'content' | 'programmatic' | 'ads' | 'geo' | 'seo' | 'site'

export type RecordWinInput = {
  userId: string
  brandId: string | null
  category: WinCategory
  title: string
  detail?: string | null
  projectedValue?: number | null   // €/mo estimate — omit unless defensible
  currency?: string | null
  meta?: Record<string, any> | null
}

/** Log a completed action to the ledger. Best-effort — a ledger write must never break the action itself. */
export async function recordWin(admin: any, w: RecordWinInput): Promise<void> {
  try {
    await admin.from('wins').insert({
      user_id: w.userId, brand_id: w.brandId, category: w.category,
      title: w.title, detail: w.detail || null,
      projected_value: w.projectedValue ?? null, currency: w.currency || null,
      meta: w.meta || null,
    })
  } catch { /* ledger is additive; never throw into the caller */ }
}

export type WinRow = {
  id: string; category: WinCategory; title: string; detail: string | null
  projected_value: number | null; banked_value: number | null; currency: string | null
  verified_at: string | null; created_at: string
}

export type WinsSummary = {
  windowDays: number
  moves: number
  projectedTotal: number
  bankedTotal: number
  currency: string | null
  byCategory: Record<string, number>
  recent: WinRow[]
}

/** Roll up the ledger for the scoreboard: moves made, € projected (est), € banked (verified). */
export async function winsSummary(admin: any, userId: string, brandId: string | null, days = 30): Promise<WinsSummary> {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  let q = admin.from('wins').select('*').eq('user_id', userId).gte('created_at', since).order('created_at', { ascending: false }).limit(500)
  if (brandId) q = q.eq('brand_id', brandId)
  const { data } = await q
  const rows: WinRow[] = (data || []) as any[]
  let projectedTotal = 0, bankedTotal = 0, currency: string | null = null
  const byCategory: Record<string, number> = {}
  for (const r of rows) {
    if (r.projected_value != null) projectedTotal += Number(r.projected_value)
    if (r.banked_value != null) bankedTotal += Number(r.banked_value)
    if (!currency && r.currency) currency = r.currency
    byCategory[r.category] = (byCategory[r.category] || 0) + 1
  }
  return {
    windowDays: days, moves: rows.length,
    projectedTotal: Math.round(projectedTotal), bankedTotal: Math.round(bankedTotal),
    currency, byCategory, recent: rows.slice(0, 40),
  }
}

/** All-time totals for the ladder/level (not windowed). */
export async function winsLifetime(admin: any, userId: string, brandId: string | null): Promise<{ moves: number; banked: number }> {
  let q = admin.from('wins').select('banked_value', { count: 'exact' }).eq('user_id', userId)
  if (brandId) q = q.eq('brand_id', brandId)
  try {
    const { data, count } = await q.limit(2000)
    const banked = (data || []).reduce((s: number, r: any) => s + (Number(r.banked_value) || 0), 0)
    return { moves: count || 0, banked: Math.round(banked) }
  } catch { return { moves: 0, banked: 0 } }
}
