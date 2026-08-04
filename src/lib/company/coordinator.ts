/**
 * The coordinator — "prepare everything." One tap and Mello fans out across departments and gets the
 * day READY, without ever spending on its own:
 *   • Free prep it just does — draft any customer message that still needs a reply.
 *   • Anything that costs money (ad budget) or credits (a report, a creative) it STAGES for your OK,
 *     never executes. Money stays behind an explicit tap.
 * Returns what it prepared + what's now waiting on you, so "Done" is honest.
 */
import { triageMessage } from '@/lib/customer/triage'

export type PrepResult = {
  prepared: { dept: string; detail: string }[]
  awaiting: { title: string; kind: string; cost: string }[]
  summary: string
}

const COST = (t: any): string => {
  if (t.kind === 'meta_scale' || t.kind === 'meta_audience' || t.kind === 'meta_placement') return `spends ${t.evidence?.newBudget ? `$${t.evidence.newBudget}/day` : 'ad budget'}`
  if (t.kind === 'meta_pause') return 'no spend'
  if (t.credits) return `${t.credits} credits`
  return 'free'
}

export async function prepareEverything(admin: any, userId: string): Promise<PrepResult> {
  const prepared: PrepResult['prepared'] = []

  // ── Customer: draft any inbound that's still waiting for a reply (free — LLM tokens only). ──
  try {
    const { data: undrafted } = await admin.from('customer_messages').select('*')
      .eq('user_id', userId).eq('direction', 'in').eq('status', 'pending').is('suggested_reply', null).limit(20)
    const list = (undrafted || []) as any[]
    if (list.length) {
      // One brand name for grounding (the founder's first).
      let brandName = ''
      try { const { data } = await admin.from('brands').select('name').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle(); brandName = data?.name || '' } catch { /* ok */ }
      let n = 0
      for (const m of list) {
        try {
          const tr = await triageMessage(admin, userId, { body: m.body, brand: brandName })
          await admin.from('customer_messages').update({ suggested_reply: tr.draft, intent: tr.intent, priority: tr.priority }).eq('id', m.id)
          await admin.from('customer_threads').update({ priority: tr.priority, intent: tr.intent }).eq('id', m.thread_id)
          n++
        } catch { /* skip a bad one */ }
      }
      if (n) prepared.push({ dept: 'Customer', detail: `drafted ${n} repl${n === 1 ? 'y' : 'ies'}` })
    }
    // Also count replies already drafted and ready to send (staged earlier).
    const { count: ready } = await admin.from('customer_messages').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('direction', 'in').eq('status', 'pending').not('suggested_reply', 'is', null)
    if (ready && ready > 0) prepared.push({ dept: 'Customer', detail: `${ready} repl${ready === 1 ? 'y' : 'ies'} ready to send` })
  } catch { /* inbox best-effort */ }

  // ── Everything else: STAGE for approval — never auto-run (money / credits). ──
  const awaiting: PrepResult['awaiting'] = []
  try {
    const { data: tasks } = await admin.from('mello_tasks').select('*')
      .eq('user_id', userId).eq('status', 'suggested').order('created_at', { ascending: false }).limit(12)
    for (const t of (tasks || []) as any[]) awaiting.push({ title: String(t.title || 'A decision'), kind: t.kind, cost: COST(t) })
  } catch { /* tasks best-effort */ }

  const prepCount = prepared.reduce((s, p) => s + (parseInt(p.detail) || 0), 0)
  const bits: string[] = []
  if (prepCount) bits.push(`Prepared ${prepCount} customer repl${prepCount === 1 ? 'y' : 'ies'}`)
  if (awaiting.length) bits.push(`${awaiting.length} decision${awaiting.length === 1 ? '' : 's'} ready for your OK`)
  const summary = bits.length ? `${bits.join(' · ')}.` : `Everything's already handled — nothing needs prep right now.`

  return { prepared, awaiting, summary }
}
