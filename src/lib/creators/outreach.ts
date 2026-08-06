/**
 * Creator outreach brain: draft the recruitment offer (bulk or one-by-one) and the ongoing reply. Warm,
 * personal, in the brand voice, with a clear offer (gifted / paid / affiliate). Reasoned via the model,
 * deterministic template fallback so it never fails. Never sends — the founder approves every message.
 */
import { recall } from '@/lib/brain'

export type OfferType = 'gifted' | 'paid' | 'affiliate'
export const OFFER_LABEL: Record<OfferType, string> = { gifted: 'Free product', paid: 'Paid', affiliate: 'Affiliate' }

function offerLine(type: OfferType, details: string): string {
  if (details) return details
  switch (type) {
    case 'paid': return 'a paid collaboration'
    case 'affiliate': return 'a commission on every sale from your code'
    case 'gifted': default: return 'our product, free, to keep'
  }
}

/** Deterministic invite — always available. */
function inviteTemplate(handle: string, name: string, brand: string, type: OfferType, details: string): string {
  const who = name || `@${handle}`
  const b = brand || 'our brand'
  return `Hi ${who}! We love your content 💛 We're ${b} and we'd love to send you ${offerLine(type, details)} to create a short UGC video. No pressure and totally your style — interested? If so I'll share the details.`
}

/** Model-drafted invite, grounded in Company Brain. Null on failure. */
async function reasonedInvite(admin: any, userId: string, input: { handle: string; name: string; brand: string; type: OfferType; details: string; bio?: string; category?: string; brandId?: string | null }): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null
  let memory = ''
  try { memory = (await recall(admin, { userId, department: 'customer', brandId: input.brandId })).prompt } catch { /* ok */ }
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.MELLO_MODEL || 'gpt-4o'
  const system = `You are the creator-partnerships voice for ${input.brand || 'a small e-commerce brand'}. Write ONE short outreach DM to an Instagram creator (@${input.handle}${input.name ? `, ${input.name}` : ''}${input.category ? `, niche: ${input.category}` : ''}) inviting them to make a UGC video. Offer: ${OFFER_LABEL[input.type]}${input.details ? ` — ${input.details}` : ''}.
Rules: 2-4 sentences, warm and specific (not a mass blast), first person, on-brand. Compliment something real about a ${input.category || 'creator'} like them. State the offer plainly. End with a low-pressure question. No hashtags, no emojis overload (one is fine). Return ONLY the message.${input.bio ? `\nTheir bio: "${input.bio}"` : ''}${memory ? `\n\n--- Company memory ---\n${memory}` : ''}`
  try {
    const resp = await openai.chat.completions.create({ model, temperature: 0.6, messages: [{ role: 'system', content: system }, { role: 'user', content: 'Write the invite.' }] })
    const t = String(resp.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '')
    return t || null
  } catch { return null }
}

export async function draftCreatorOffer(admin: any, userId: string, input: { handle: string; name?: string; brand?: string; type?: OfferType; details?: string; bio?: string; category?: string; brandId?: string | null }): Promise<string> {
  const type = (['gifted', 'paid', 'affiliate'].includes(input.type || '') ? input.type : 'gifted') as OfferType
  const name = String(input.name || '').trim()
  const brand = String(input.brand || '').trim()
  const details = String(input.details || '').trim()
  try {
    const r = await Promise.race([
      reasonedInvite(admin, userId, { handle: input.handle, name, brand, type, details, bio: input.bio, category: input.category, brandId: input.brandId }),
      new Promise<null>((res) => setTimeout(() => res(null), 15000)),
    ])
    if (r) return r
  } catch { /* fall through */ }
  return inviteTemplate(input.handle, name, brand, type, details)
}

/**
 * Draft the next reply in an ongoing creator conversation. Given the thread so far + the creator's stage,
 * moves it forward: answer questions, confirm terms, and — once they've agreed — ask for the name, full
 * shipping address, and phone so we can send the product. Never invents rates/terms the founder didn't set.
 */
export async function draftCreatorReply(admin: any, userId: string, input: { brand: string; stage: string; history: { direction: 'in' | 'out'; body: string }[]; offerType?: OfferType; offerDetails?: string; needDetails?: boolean }): Promise<string> {
  const askForDetails = 'Amazing — so glad you’re in! 🎉 To send your product, could you share:\n• Full name\n• Shipping address\n• Phone number\n\nOnce I have those I’ll get it shipped and send over a short, easy script.'
  if (!process.env.OPENAI_API_KEY) {
    return input.needDetails ? askForDetails : 'Thanks so much for the reply! Happy to answer any questions — want to go ahead?'
  }
  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.MELLO_MODEL || 'gpt-4o'
  const convo = input.history.slice(-8).map(m => `${m.direction === 'in' ? 'Creator' : 'You'}: ${m.body}`).join('\n')
  const system = `You are the creator-partnerships voice for ${input.brand || 'a small e-commerce brand'}, replying to a UGC creator in DMs. Offer on the table: ${input.offerType ? OFFER_LABEL[input.offerType as OfferType] : 'gifted product'}${input.offerDetails ? ` — ${input.offerDetails}` : ''}.
Goal: keep it warm and human, answer their questions, and move toward a yes. ${input.needDetails ? 'They have AGREED — now collect their full name, full shipping address, and phone number so we can ship the product, and tell them a short script will follow. Ask for all three clearly.' : 'If they seem ready, gently confirm and move to next steps. Do NOT collect address yet unless they’ve clearly agreed.'}
Rules: 1-4 sentences (or a short list when collecting details), never invent prices/terms not given, no pressure, on-brand. Return ONLY the message.

Conversation so far:
${convo}`
  try {
    const resp = await openai.chat.completions.create({ model, temperature: 0.5, messages: [{ role: 'system', content: system }, { role: 'user', content: 'Write the next reply.' }] })
    const t = String(resp.choices?.[0]?.message?.content || '').trim().replace(/^["']|["']$/g, '')
    return t || (input.needDetails ? askForDetails : 'Thanks for the reply! Any questions before we go ahead?')
  } catch { return input.needDetails ? askForDetails : 'Thanks for the reply! Any questions before we go ahead?' }
}
