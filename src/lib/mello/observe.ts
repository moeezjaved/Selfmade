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
  path: string               // grounded:<intent> | agent | item_reflect
  sources?: string[]         // what the answer used (live services + memory layers), e.g. ['Meta Ads audit']
  ms?: number
  createdMemory?: boolean     // did this turn extract a durable memory into the Company Brain?
  conflict?: boolean          // did a belief conflict get flagged?
  confidence?: 'high' | 'medium' | 'low'
  memoryIds?: string[]        // exact memory rows the answer used (dna:<id> / mem:<id> / learn:<id>)
}

export function logMelloAnswer(admin: any, t: MelloTrace): void {
  const rec = { ...t, question: String(t.question || '').slice(0, 300), sources: t.sources || [] }
  try { console.log('[mello]', JSON.stringify({ intent: rec.intent, path: rec.path, surface: rec.surface, sources: rec.sources, ms: rec.ms, createdMemory: !!rec.createdMemory })) } catch { /* ignore */ }
  try {
    admin.from('mello_answer_log').insert({
      user_id: rec.userId, brand_id: rec.brandId || null, surface: rec.surface,
      question: rec.question, intent: rec.intent, path: rec.path, sources: rec.sources, ms: rec.ms ?? null,
      created_memory: !!rec.createdMemory, conflict: !!rec.conflict, confidence: rec.confidence ?? null,
      memory_ids: rec.memoryIds || [],
    }).then(() => {}, () => {})   // columns/table may not exist yet — never throw
  } catch { /* never throw */ }
}
