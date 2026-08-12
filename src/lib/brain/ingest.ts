/**
 * brainIngest — the Company Brain write pipeline (v4). Take raw content from any source (a customer
 * message, a founder line on Slack/WhatsApp, a decision) and: understand → extract → classify → store
 * into the right layer with a source + retention. Most text is noise and becomes nothing; only what a
 * company should durably remember is kept. Founder-stated rules activate; anything observed becomes a
 * candidate (created_by='mello', inactive) that needs the founder's yes.
 *
 * Best-effort by contract: never throws. A memory write must never break the action it observed, so every
 * caller can `void brainIngest(...)` fire-and-forget. No vector DB — atoms land in the structured stores.
 */
import { teachRule } from './index'

export type BrainSource = 'founder' | 'slack' | 'whatsapp' | 'inbox' | 'email' | 'meta' | 'shopify' | 'research'

type Atom =
  | { type: 'belief'; text: string; department?: string | null; priority?: 'high' | 'normal' | 'low' }
  | { type: 'decision'; text: string; department?: string | null }
  | { type: 'fact'; text: string; department?: string | null; confidence?: number }
  | { type: 'signal'; topic: string; sentiment?: 'pos' | 'neg' | 'neutral'; quote?: string }
  | { type: 'context'; body: string; kind: string; expiresDays?: number }

const CUSTOMER_SOURCES: BrainSource[] = ['inbox', 'whatsapp', 'email']

// #3 · anti-hallucination guard for FACTS: every number the extractor put in a fact ("serum costs $34")
// MUST appear in the source text, or we drop the fact — the model never gets to invent a price / percent
// / metric. Beliefs & decisions are rephrasings of what the founder said, so this applies only to facts.
export function factIsGrounded(text: string, raw: string): boolean {
  const nums = String(text).match(/\d[\d,.]*\d|\d/g) || []
  if (!nums.length) return true
  const src = String(raw).replace(/,/g, '')
  return nums.every((n) => src.includes(n.replace(/,/g, '')))
}

/** LLM extractor — returns typed atoms; the gatekeeper that keeps the Brain from becoming a landfill. */
async function classify(raw: string, source: BrainSource): Promise<Atom[]> {
  try {
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.MELLO_MODEL_MINI || 'gpt-4o-mini'
    const customer = CUSTOMER_SOURCES.includes(source)
    const system = `You extract COMPANY MEMORY from one piece of text for a DTC brand's Company Brain. Return strict JSON: {"atoms":[...]}.
Each atom is exactly one of:
- {"type":"belief","text":"<a durable rule/principle/preference the founder wants followed>","department":null|"research"|"creative"|"media"|"growth"|"customer","priority":"high"|"normal"|"low"}
- {"type":"decision","text":"<a concrete decision the founder just made>","department":null|"..."}
- {"type":"fact","text":"<an objective, durable fact worth remembering>","confidence":0-100}
- {"type":"signal","topic":"<short slug, e.g. delivery|ingredient_safety|applicator|price|sizing>","sentiment":"pos"|"neg"|"neutral","quote":"<=120 chars"}
- {"type":"context","body":"<a THIS-WEEK-ONLY fact>","kind":"active_campaign"|"priority"|"fresh_find","expiresDays":7}
RULES:
- MOST text is small talk / noise → return {"atoms":[]}. Only extract what a company should durably remember.
- ${customer ? 'This is a CUSTOMER message → prefer "signal" atoms (what the customer is asking/complaining about). Do NOT invent company rules from a customer.' : 'This is from the FOUNDER/team → prefer belief / decision / fact / context.'}
- Never invent. Keep text terse and self-contained. Max 6 atoms.
Source of this text: ${source}.`
    const resp: any = await Promise.race([
      openai.chat.completions.create({
        model, temperature: 0.1, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: raw.slice(0, 2000) }],
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ingest_timeout')), 12000)),
    ])
    const parsed = JSON.parse(resp?.choices?.[0]?.message?.content || '{}')
    const atoms = Array.isArray(parsed?.atoms) ? parsed.atoms : []
    return atoms.slice(0, 6)
  } catch { return [] }
}

export async function brainIngest(admin: any, opts: {
  userId: string; brandId?: string | null; source: BrainSource; raw: string; threadId?: string | null
}): Promise<{ stored: number }> {
  const raw = String(opts.raw || '').trim()
  if (!raw || raw.length < 4) return { stored: 0 }
  let stored = 0
  try {
    const atoms = await classify(raw, opts.source)
    for (const a of atoms) {
      try {
        if (a.type === 'belief') {
          if (opts.source === 'founder') {
            // Founder-stated rule → activate, but check it against existing beliefs first (v5 conflict flow).
            await teachWithConflictCheck(admin, { userId: opts.userId, brandId: opts.brandId, rule: a.text, department: a.department || null, priority: a.priority || 'normal', source: opts.source })
          } else {
            // Observed → a candidate (inactive) the founder can approve in the Review tab.
            await teachRule(admin, { userId: opts.userId, brandId: opts.brandId, rule: a.text, department: a.department || null, priority: a.priority || 'normal', createdBy: 'mello', source: `brain:${opts.source}` })
            await writeTimeline(admin, { userId: opts.userId, brandId: opts.brandId, actor: 'mello', department: a.department || null, event: `Proposed a rule: “${a.text}”` })
          }
          stored++
        } else if (a.type === 'decision') {
          if (opts.source === 'founder') {
            await teachWithConflictCheck(admin, { userId: opts.userId, brandId: opts.brandId, rule: a.text, department: a.department || null, source: opts.source })
          } else {
            await teachRule(admin, { userId: opts.userId, brandId: opts.brandId, rule: a.text, department: a.department || null, createdBy: 'mello', source: `brain:decision:${opts.source}` })
            await writeTimeline(admin, { userId: opts.userId, brandId: opts.brandId, actor: 'mello', department: a.department || null, event: `Proposed a decision: “${a.text}”` })
          }
          stored++
        } else if (a.type === 'fact') {
          if (!factIsGrounded(a.text, raw)) continue   // #3 · a number not in the source → dropped, not stored
          // #5 · a fact the FOUNDER stated is trusted (active); one derived from a customer/observed source
          // is a PROPOSED claim that awaits confirmation before it's reasoned over as truth.
          const status = CUSTOMER_SOURCES.includes(opts.source) ? 'proposed' : 'active'
          await admin.from('mello_memory').insert({
            user_id: opts.userId, brand_id: opts.brandId || null, content: a.text.slice(0, 400),
            category: 'fact', confidence: a.confidence ?? 60, source: `brain:${opts.source}`,
            department: a.department || null, source_kind: opts.source, status,
          })
          stored++
        } else if (a.type === 'signal') {
          await recordCustomerSignal(admin, {
            userId: opts.userId, brandId: opts.brandId, threadId: opts.threadId,
            topic: a.topic, sentiment: a.sentiment, quote: a.quote,
          })
          stored++
        } else if (a.type === 'context') {
          await recordContext(admin, {
            userId: opts.userId, brandId: opts.brandId, kind: a.kind, body: a.body, expiresDays: a.expiresDays ?? 7,
          })
          stored++
        }
      } catch { /* per-atom best effort */ }
    }
  } catch { /* never breaks the caller */ }
  return { stored }
}

// ── conflict detection (v5) ──────────────────────────────────────────────────
/**
 * Does a new rule contradict an ACTIVE belief? Returns the belief it clashes with, or null. Cheap-first:
 * skips the model when there are no beliefs. Never throws (best-effort — on error we assume no conflict).
 */
export async function detectConflict(admin: any, userId: string, rule: string): Promise<{ id: string | null; rule: string } | null> {
  try {
    const { data } = await admin.from('company_dna').select('id, rule').eq('user_id', userId).eq('active', true).limit(60)
    const beliefs = (data || []) as any[]
    if (!beliefs.length) return null
    const OpenAI = (await import('openai')).default
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const model = process.env.MELLO_MODEL_MINI || 'gpt-4o-mini'
    const system = `You detect CONTRADICTIONS between a new company rule and the company's existing rules. A conflict means they cannot both hold (e.g. "never discount" vs "20% off this weekend"). A mere addition or unrelated rule is NOT a conflict. Reply ONLY JSON: {"conflict": true|false, "index": <0-based index of the existing rule it conflicts with, or -1>}.`
    const list = beliefs.map((b, i) => `${i}. ${b.rule}`).join('\n')
    const resp: any = await Promise.race([
      openai.chat.completions.create({ model, temperature: 0, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: `NEW RULE: "${rule}"\n\nEXISTING RULES:\n${list}` }] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 9000)),
    ])
    const p = JSON.parse(resp?.choices?.[0]?.message?.content || '{}')
    if (p?.conflict === true && typeof p.index === 'number' && p.index >= 0 && p.index < beliefs.length) {
      return { id: beliefs[p.index].id, rule: beliefs[p.index].rule }
    }
    return null
  } catch { return null }
}

/**
 * Teach a belief, but first check it against active beliefs. On a clash: record a pending brain_conflict and
 * DON'T activate — the founder resolves it. Otherwise teach normally. Returns whether a conflict was raised.
 */
export async function teachWithConflictCheck(admin: any, r: {
  userId: string; brandId?: string | null; rule: string; department?: string | null;
  priority?: 'high' | 'normal' | 'low'; source?: BrainSource | string;
}): Promise<{ conflict: boolean; existingRule?: string }> {
  // Dedup — if the founder already has this exact rule active, don't teach it twice (any path can call this).
  try {
    const { data: dupe } = await admin.from('company_dna').select('id').eq('user_id', r.userId).eq('active', true).ilike('rule', r.rule.trim()).limit(1)
    if (dupe && dupe.length) return { conflict: false }
  } catch { /* best-effort */ }

  const clash = await detectConflict(admin, r.userId, r.rule)
  if (clash) {
    try {
      await admin.from('brain_conflicts').insert({
        user_id: r.userId, brand_id: r.brandId || null, existing_id: clash.id, existing_rule: clash.rule,
        incoming_rule: r.rule.slice(0, 400), department: r.department || null, source: r.source || 'founder',
      })
      await writeTimeline(admin, { userId: r.userId, brandId: r.brandId, actor: 'mello', department: r.department || null, event: `Flagged a conflict: “${r.rule}” vs “${clash.rule}”` })
    } catch { /* best-effort */ }
    return { conflict: true, existingRule: clash.rule }
  }
  const { teachRule } = await import('./index')
  await teachRule(admin, { userId: r.userId, brandId: r.brandId, rule: r.rule, department: r.department || null, priority: r.priority || 'normal', createdBy: 'founder', source: `brain:${r.source || 'founder'}` })
  await writeTimeline(admin, { userId: r.userId, brandId: r.brandId, actor: 'founder', department: r.department || null, event: `Learned a rule: “${r.rule}”` })
  return { conflict: false }
}

// ── history feed ─────────────────────────────────────────────────────────────
export async function writeTimeline(admin: any, e: {
  userId: string; brandId?: string | null; actor?: string; department?: string | null; event: string; memoryRef?: any
}): Promise<void> {
  try {
    await admin.from('brain_timeline').insert({
      user_id: e.userId, brand_id: e.brandId || null, actor: e.actor || 'mello',
      department: e.department || null, event: e.event.slice(0, 300), memory_ref: e.memoryRef || {},
    })
  } catch { /* best-effort */ }
}

// ── the "Now" layer (auto-expiring) ──────────────────────────────────────────
export async function recordContext(admin: any, c: {
  userId: string; brandId?: string | null; kind: string; body: string; expiresDays?: number; ref?: any
}): Promise<void> {
  try {
    const exp = new Date(Date.now() + (c.expiresDays ?? 7) * 86400000).toISOString()
    await admin.from('brain_context').insert({
      user_id: c.userId, brand_id: c.brandId || null, kind: c.kind, body: c.body.slice(0, 300),
      ref: c.ref || {}, expires_at: exp,
    })
  } catch { /* best-effort */ }
}

// ── customer signal (one row per conversation extraction) ────────────────────
export async function recordCustomerSignal(admin: any, s: {
  userId: string; brandId?: string | null; threadId?: string | null; topic: string; sentiment?: string; quote?: string
}): Promise<void> {
  try {
    await admin.from('customer_signals').insert({
      user_id: s.userId, brand_id: s.brandId || null, thread_id: s.threadId || null,
      topic: String(s.topic).slice(0, 60), sentiment: s.sentiment || null, quote: (s.quote || '').slice(0, 240) || null,
    })
  } catch { /* best-effort */ }
}
