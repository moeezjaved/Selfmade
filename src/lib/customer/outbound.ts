/**
 * The Customer Employee's OUTBOUND brain: Mello starts the conversation. Given a trigger (a cart left
 * behind, a customer gone quiet, a delivery that just landed), it drafts a proactive, on-brand message
 * for the founder to approve. Never sends on its own. Reasoned via the model + Company Brain; a
 * deterministic template is the always-works fallback so drafting can't hang or fail.
 */
import { recall } from '@/lib/brain'

export type OutboundType = 'cart_recovery' | 'winback' | 'review_request' | 'reengage'
export const OUTBOUND_LABEL: Record<OutboundType, string> = {
  cart_recovery: 'Abandoned cart',
  winback: 'Win-back',
  review_request: 'Review request',
  reengage: 'Re-engage',
}

/** Phase 1 — safe, human template per trigger. Always available. */
function template(type: OutboundType, name: string, brand: string, product: string): string {
  const who = name || 'there'
  const p = product || 'your order'
  const b = brand || 'us'
  switch (type) {
    case 'cart_recovery':
      return `Hi ${who}! I noticed ${p} is still sitting in your cart 🛒 — want me to hold it for you? Happy to answer any questions before you check out.`
    case 'winback':
      return `Hey ${who}! It's been a little while — thought you might be running low on ${p}. Want me to set up a quick reorder? I can throw in a little thank-you for coming back.`
    case 'review_request':
      return `Hi ${who}! Hope you're loving ${p} 💛 Would you mind leaving a quick review? It takes 20 seconds and genuinely helps ${b} a lot. Thank you!`
    case 'reengage':
    default:
      return `Hi ${who}! Just checking in from ${b} — anything I can help you with today? New arrivals just dropped if you'd like a peek.`
  }
}

/** Phase 2 — the model drafts in the brand's voice, grounded in Company Brain. */
async function reasoned(admin: any, userId: string, type: OutboundType, name: string, brand: string, product: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  let memory = ''
  try { memory = (await recall(admin, { userId, department: 'customer' })).prompt } catch { /* best-effort */ }
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.MELLO_MODEL || 'gpt-4o'
  const goal: Record<OutboundType, string> = {
    cart_recovery: 'gently recover an abandoned cart — remind, remove friction, offer help; do NOT be pushy.',
    winback: 'win back a customer who has gone quiet — warm, personal, a small reason to return.',
    review_request: 'ask a happy customer for a quick review — grateful, low-effort, no pressure.',
    reengage: 're-engage a quiet contact — friendly check-in, a light reason to look again.',
  }
  const system = `You are Mello, the customer voice for ${brand || 'this brand'}. Write ONE short outbound message to a customer whose name is "${name || 'the customer'}" about "${product || 'their order'}". Goal: ${goal[type]}
Rules: 1-3 sentences, first person, warm and human (never salesy or robotic), on-brand. Do NOT invent discounts, order numbers, or delivery dates you can't know — offer to check or keep it soft. Return ONLY the message text, no quotes, no preamble.${memory ? `\n\n--- Company memory (obey the beliefs) ---\n${memory}` : ''}`
  try {
    const resp = await openai.chat.completions.create({
      model, temperature: 0.6,
      messages: [{ role: 'system', content: system }, { role: 'user', content: `Write the ${OUTBOUND_LABEL[type]} message.` }],
    })
    const text = String(resp.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '')
    return text || null
  } catch { return null }
}

/** Draft one proactive outbound message: reasoned if we can, template otherwise. Capped so it can't hang. */
export async function draftOutbound(admin: any, userId: string, input: { type: OutboundType; name?: string; brand?: string; product?: string }): Promise<string> {
  const type = (['cart_recovery', 'winback', 'review_request', 'reengage'].includes(input.type) ? input.type : 'reengage') as OutboundType
  const name = String(input.name || '').trim()
  const brand = String(input.brand || '').trim()
  const product = String(input.product || '').trim()
  try {
    const r = await Promise.race([
      reasoned(admin, userId, type, name, brand, product),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15000)),
    ])
    if (r) return r
  } catch { /* fall through */ }
  return template(type, name, brand, product)
}
