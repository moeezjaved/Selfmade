/**
 * Mello observability — one record per answer so we can always reconstruct "why did Mello say this?".
 * Logs a structured line (always) and best-effort inserts into mello_answer_log (migration 154). The
 * insert is fire-and-forget and swallows errors, so it NEVER affects the answer even if the table is
 * missing (pre-migration) — observability must not be able to break the product.
 */
export type MelloTrace = {
  userId: string
  brandId?: string | null
  surface: string            // brief | mello | slack | whatsapp | studio
  question: string
  intent: string
  path: string               // grounded:<intent> | agent
  sources?: string[]
  ms?: number
}

export function logMelloAnswer(admin: any, t: MelloTrace): void {
  const rec = { ...t, question: String(t.question || '').slice(0, 300), sources: t.sources || [] }
  try { console.log('[mello]', JSON.stringify({ intent: rec.intent, path: rec.path, surface: rec.surface, sources: rec.sources, ms: rec.ms })) } catch { /* ignore */ }
  try {
    admin.from('mello_answer_log').insert({
      user_id: rec.userId, brand_id: rec.brandId || null, surface: rec.surface,
      question: rec.question, intent: rec.intent, path: rec.path, sources: rec.sources, ms: rec.ms ?? null,
    }).then(() => {}, () => {})   // table may not exist yet — never throw
  } catch { /* never throw */ }
}
