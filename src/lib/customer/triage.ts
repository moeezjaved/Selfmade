/**
 * The Customer Employee's brain: read one inbound message and decide (1) how urgent it is, (2) what it's
 * about, and (3) what to say back — a draft grounded in the brand's voice + Company Brain. NEVER sends;
 * it only proposes. Phase 2 (reasoned) uses the model; Phase 1 (deterministic) is the always-works
 * fallback, so triage can't hang or fail an inbound.
 */
import { recall } from '@/lib/brain'

export type Intent = 'shipping' | 'refund' | 'price' | 'complaint' | 'question' | 'other'
export type Priority = 'high' | 'med' | 'low'
export type Triage = { priority: Priority; intent: Intent; draft: string }

const RX: { intent: Intent; re: RegExp; priority: Priority }[] = [
  { intent: 'refund', re: /\b(refund|money back|return|cancel(?:\s|l)|charge ?back)\b/i, priority: 'high' },
  { intent: 'complaint', re: /\b(broken|leak|damaged|defect|not work|disappointed|worst|angry|useless|scam|never (?:got|received))\b/i, priority: 'high' },
  { intent: 'price', re: /\b(price|cost|how much|discount|coupon|promo|offer|bundle|deal|afford)\b/i, priority: 'high' },
  { intent: 'shipping', re: /\b(ship|shipping|track|tracking|deliver|delivery|where.*order|arrive|dispatch|courier)\b/i, priority: 'med' },
  { intent: 'question', re: /\b(how|what|does|can i|is it|are they|question|help|waterproof|ingredient|size|work)\b/i, priority: 'med' },
]

/** Phase 1 — keyword classify + a safe, human template reply. Always available. */
function deterministic(body: string, brand: string): Triage {
  const hit = RX.find(r => r.re.test(body)) || { intent: 'other' as Intent, priority: 'low' as Priority }
  const b = brand || 'the team'
  const drafts: Record<Intent, string> = {
    refund: `Hi — I'm really sorry to hear that. I've got you covered: I can arrange a replacement or a full refund right away. Which would you prefer?`,
    complaint: `Oh no — I'm so sorry this happened. That's not the experience we want for you. I'll make it right immediately — a replacement is on its way and I'll follow up with tracking today.`,
    price: `Great question! I'd love to help you get the best value — here's our current bundle and today's offer. Want me to send the link so you can grab it?`,
    shipping: `Thanks for checking in! Let me pull up your order and get you the latest tracking right away. Give me one moment.`,
    question: `Happy to help! Here's the quick answer — and if anything's unclear just let me know and I'll walk you through it.`,
    other: `Thanks so much for reaching out to ${b}! How can I help you today?`,
  }
  return { priority: hit.priority, intent: hit.intent, draft: drafts[hit.intent] }
}

/** Phase 2 — the model classifies + drafts in the brand's voice, grounded in Company Brain. */
async function reasoned(admin: any, userId: string, body: string, brand: string, brandId?: string | null): Promise<Triage | null> {
  if (!process.env.OPENAI_API_KEY) return null
  let memory = ''
  try { memory = (await recall(admin, { userId, department: 'customer', brandId })).prompt } catch { /* best-effort */ }
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.MELLO_MODEL || 'gpt-4o'
  const system = `You are Mello, the customer-support voice for ${brand || 'this brand'}. Read one inbound customer message and reply ONLY as JSON:
{"priority":"high"|"med"|"low","intent":"shipping"|"refund"|"price"|"complaint"|"question"|"other","draft":string}
- priority: refunds, complaints, and buying-intent (price) are high; shipping/questions are med; small talk is low.
- draft: a warm, on-brand reply the founder can send as-is — 1-3 sentences, first person, specific, never robotic. Do not invent order numbers or promise dates you can't know; offer to check instead.
- Obey the company's memory below (its beliefs are rules).${memory ? `\n\n--- Company memory ---\n${memory}` : ''}`
  try {
    const resp = await openai.chat.completions.create({
      model, temperature: 0.4, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: body.slice(0, 2000) }],
    })
    const p = JSON.parse(resp.choices?.[0]?.message?.content || '{}')
    const intent: Intent = ['shipping', 'refund', 'price', 'complaint', 'question', 'other'].includes(p.intent) ? p.intent : 'other'
    const priority: Priority = ['high', 'med', 'low'].includes(p.priority) ? p.priority : 'low'
    const draft = String(p.draft || '').trim()
    if (!draft) return null
    return { priority, intent, draft }
  } catch { return null }
}

/** Triage one inbound message: reasoned if we can, deterministic otherwise. Capped so it can't hang. */
export async function triageMessage(admin: any, userId: string, input: { body: string; brand?: string; brandId?: string | null; threadId?: string | null }): Promise<Triage> {
  const body = String(input.body || '').trim()
  const brand = String(input.brand || '').trim()
  if (!body) return { priority: 'low', intent: 'other', draft: '' }
  // Feed the Company Brain: extract customer signals from this inbound so patterns aggregate over time
  // ("18 customers mentioned the applicator this week"). Fire-and-forget — never blocks or breaks triage.
  try { const { brainIngest } = await import('@/lib/brain'); void brainIngest(admin, { userId, brandId: input.brandId, source: 'inbox', raw: body, threadId: input.threadId }) } catch { /* best-effort */ }
  try {
    const r = await Promise.race([
      reasoned(admin, userId, body, brand, input.brandId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ])
    if (r) return r
  } catch { /* fall through */ }
  return deterministic(body, brand)
}
