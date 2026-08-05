/**
 * Customer Success trends — the "voice of the customer" report. Reads the customer inbox over a window
 * and tells the founder what people keep asking about and what to DO about it:
 *   "27 messages asked where their order is → add a shipping-times line to your FAQ."
 * Two layers, same as the rest of the Customer Employee:
 *   1. Deterministic — intent breakdown + trend vs the prior window (always works, no model).
 *   2. Reasoned — the model clusters the actual message text into themes, each with a concrete fix.
 * Read-only: it never messages a customer. It's a report the founder acts on.
 */

export type IntentTrend = { intent: string; count: number; delta: number }   // delta = vs the prior equal window
export type Theme = {
  title: string          // the recurring thing, in plain words ("Where is my order / shipping time")
  count: number          // how many messages touched it (model's best estimate)
  example: string        // one real customer line, verbatim-ish
  recommendation: string // the concrete move ("Add expected delivery time to the product page + FAQ")
  priority: 'high' | 'med' | 'low'
}
export type CustomerInsights = {
  days: number
  totalMessages: number
  totalThreads: number
  intents: IntentTrend[]
  themes: Theme[]
  summary: string        // one honest sentence the founder reads first
  reasoned: boolean      // true = themes came from the model, false = deterministic fallback
  generatedAt: string
}

const KNOWN = ['shipping', 'refund', 'price', 'complaint', 'question', 'other']

/** Deterministic themes from the intent counts — the always-works fallback, one suggested fix per intent. */
function fallbackThemes(curC: Record<string, number>, exampleFor: Record<string, string>): Theme[] {
  const REC: Record<string, { rec: string; pri: Theme['priority'] }> = {
    shipping: { rec: 'Add expected delivery times + a tracking link to your product page and FAQ.', pri: 'high' },
    refund: { rec: 'Publish a clear, easy refund/return policy and link it in order confirmations.', pri: 'high' },
    price: { rec: 'Make pricing, discounts and shipping cost obvious before checkout — buyers are asking.', pri: 'med' },
    complaint: { rec: 'These are unhappy customers — reply fast and look for the root cause to fix.', pri: 'high' },
    question: { rec: 'Turn the most common questions into an FAQ so people self-serve.', pri: 'med' },
    other: { rec: 'Skim these for anything recurring worth putting on the site.', pri: 'low' },
  }
  return Object.entries(curC)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([intent, n]) => ({
      title: intent === 'other' ? 'Other messages' : `${intent.charAt(0).toUpperCase()}${intent.slice(1)} questions`,
      count: n,
      example: exampleFor[intent] || '',
      recommendation: (REC[intent] || REC.other).rec,
      priority: (REC[intent] || REC.other).pri,
    }))
}

/** The model clusters the raw customer text into named themes with a fix each. Null on any failure. */
async function reasonedThemes(messages: { body: string; intent?: string }[]): Promise<Theme[] | null> {
  if (!process.env.OPENAI_API_KEY || !messages.length) return null
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.MELLO_MODEL || 'gpt-4o'
  // Cap the payload — a representative sample is plenty and keeps us fast/cheap.
  const sample = messages.slice(0, 200).map((m, i) => `${i + 1}. ${String(m.body || '').replace(/\s+/g, ' ').slice(0, 240)}`).join('\n')
  const system = `You are the Customer Success analyst for a small e-commerce brand. Below are real messages customers sent. Find the RECURRING themes — the things many people ask or complain about — and for each, a concrete, specific action the founder can take to reduce that question or fix the problem.
Rules:
- Merge similar messages into one theme (e.g. "where's my order", "how long is shipping", "tracking?" → one shipping theme).
- Only themes with real repetition. 3–6 themes max. Ignore one-offs.
- "count" = your best estimate of how many messages touch that theme.
- "example" = one short real customer line from the list (lightly cleaned, no names).
- "recommendation" = one specific move (update FAQ, add a size guide, show delivery time on the product page, fix a shipping delay…). Not generic advice.
- "priority": high if it hurts sales or signals a real problem (shipping delays, refunds, complaints); else med or low.
Return ONLY JSON: {"themes":[{"title","count","example","recommendation","priority"}]}. No prose.`
  try {
    const resp = await openai.chat.completions.create({
      model, temperature: 0.3, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: sample }],
    })
    const raw = String(resp.choices?.[0]?.message?.content || '{}')
    const parsed = JSON.parse(raw)
    const themes = Array.isArray(parsed?.themes) ? parsed.themes : []
    const clean: Theme[] = themes.map((t: any) => ({
      title: String(t.title || '').slice(0, 90),
      count: Math.max(1, Math.round(Number(t.count) || 1)),
      example: String(t.example || '').slice(0, 200),
      recommendation: String(t.recommendation || '').slice(0, 240),
      priority: (['high', 'med', 'low'].includes(t.priority) ? t.priority : 'med') as Theme['priority'],
    })).filter((t: Theme) => t.title && t.recommendation)
    return clean.length ? clean.slice(0, 6) : null
  } catch { return null }
}

export async function generateCustomerInsights(admin: any, userId: string, opts: { days?: number } = {}): Promise<CustomerInsights> {
  const days = Math.min(90, Math.max(7, opts.days || 30))
  const now = Date.now()
  const since = new Date(now - days * 86400000).toISOString()
  const prevSince = new Date(now - 2 * days * 86400000).toISOString()

  // Inbound customer messages across the current + prior window (for the trend arrow).
  const { data: msgs } = await admin.from('customer_messages')
    .select('body, intent, created_at, thread_id')
    .eq('user_id', userId).eq('direction', 'in').gte('created_at', prevSince)
    .order('created_at', { ascending: false }).limit(1500)
  const all = (msgs || []) as any[]
  const cur = all.filter(m => m.created_at >= since)
  const prev = all.filter(m => m.created_at < since)

  const countBy = (list: any[]) => { const o: Record<string, number> = {}; for (const m of list) { const k = (m.intent || 'other'); o[k] = (o[k] || 0) + 1 } return o }
  const curC = countBy(cur), prevC = countBy(prev)
  const exampleFor: Record<string, string> = {}
  for (const m of cur) { const k = m.intent || 'other'; if (!exampleFor[k] && m.body) exampleFor[k] = String(m.body).slice(0, 200) }

  const intentKeys = Array.from(new Set([...Object.keys(curC), ...KNOWN])).filter(k => (curC[k] || 0) > 0)
  const intents: IntentTrend[] = intentKeys
    .map(intent => ({ intent, count: curC[intent] || 0, delta: (curC[intent] || 0) - (prevC[intent] || 0) }))
    .sort((a, b) => b.count - a.count)

  const reasoned = await reasonedThemes(cur.map(m => ({ body: m.body, intent: m.intent })))
  const themes = reasoned || fallbackThemes(curC, exampleFor)

  const totalMessages = cur.length
  const totalThreads = new Set(cur.map(m => m.thread_id)).size
  const top = intents[0]
  const summary = totalMessages === 0
    ? `No customer messages in the last ${days} days yet — connect a channel and this fills in.`
    : `${totalMessages} customer message${totalMessages === 1 ? '' : 's'} across ${totalThreads} conversation${totalThreads === 1 ? '' : 's'} in ${days} days${top ? ` — mostly about ${top.intent}` : ''}.`

  return { days, totalMessages, totalThreads, intents, themes, summary, reasoned: !!reasoned, generatedAt: new Date().toISOString() }
}
