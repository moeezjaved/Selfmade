/**
 * Mello persistent memory — facts/preferences/goals Mello learns about the user, carried across
 * conversations (agent-core rebuild). Read at the start of every turn (injected into the system
 * prompt) and written via the `remember` tool. Best-effort: never blocks the chat.
 */
import { createAdminClient } from '@/lib/supabase/server'

export interface Memory { kind: string; content: string }

/** Recent memories for a user (most relevant first — capped so the prompt stays lean). */
export async function getMemories(userId: string, limit = 40): Promise<Memory[]> {
  try {
    const admin = createAdminClient() as any
    const { data } = await admin.from('mello_memory')
      .select('kind, content').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
    return (data || []) as Memory[]
  } catch { return [] }
}

/** Store a fact Mello learned. Idempotent on (user_id, content). */
export async function addMemory(userId: string, content: string, kind = 'fact'): Promise<void> {
  const c = String(content || '').trim().slice(0, 400)
  if (!c) return
  try {
    const admin = createAdminClient() as any
    await admin.from('mello_memory').upsert({ user_id: userId, kind, content: c }, { onConflict: 'user_id,content', ignoreDuplicates: true })
  } catch { /* best-effort */ }
}

/** Render memories as a compact system-prompt block. */
export function renderMemories(mem: Memory[]): string {
  if (!mem.length) return '  (nothing remembered yet — use the `remember` tool when the user shares durable facts about their business, goals, or preferences)'
  return mem.map(m => `  - [${m.kind}] ${m.content}`).join('\n')
}
