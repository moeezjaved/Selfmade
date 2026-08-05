/**
 * The UGC brief/script we hand a creator once they're in — so the content they make is built to convert,
 * not random. Grounded in the brand + what's already winning (top rival angles from Brand Spy). Returns a
 * short, shoot-ready script: hook, 3 beats, do's & don'ts. Model-reasoned with a deterministic fallback.
 */
import { getCompetitorWinners } from '@/lib/meta/competitor-winners'

function fallbackScript(brand: string, product: string): string {
  const b = brand || 'the brand'
  const p = product || 'the product'
  return `UGC brief — ${b}

HOOK (first 3 sec): Start mid-action with ${p} in hand + a bold line, e.g. "I did not expect this to actually work."

BEATS
1. The problem — the everyday frustration ${p} solves, said like a friend.
2. The turn — show ${p} in real use, natural lighting, your real reaction.
3. The proof — one specific result + why you'd tell a friend.

CLOSE: Soft call to action in your own words ("link's in my bio if you want to try it").

DO: film vertical (9:16), natural light, talk to camera, keep it under 30s, be yourself.
DON'T: read like an ad, over-edit, or over-claim. Authentic beats polished.`
}

export async function generateCreatorScript(admin: any, userId: string, input: { brand?: string; product?: string }): Promise<string> {
  const brand = String(input.brand || '').trim()
  const product = String(input.product || '').trim()
  if (!process.env.OPENAI_API_KEY) return fallbackScript(brand, product)

  let angles = ''
  try {
    const winners = await getCompetitorWinners(admin, userId, { poolSize: 4 })
    angles = winners.slice(0, 4).map(w => `- ${w.brandName}: "${w.title || w.hook || 'winning ad'}" (${w.isVideo ? 'video' : 'static'}, live ${w.daysRunning}d)`).join('\n')
  } catch { /* best-effort */ }

  const { default: OpenAI } = await import('openai')
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.MELLO_MODEL || 'gpt-4o'
  const system = `You are a UGC creative director for ${brand || 'a small e-commerce brand'}. Write a SHORT, shoot-ready brief a creator can film on their phone for ${product || 'the product'}.
${angles ? `Angles proven to convert in this market (emulate the winning style, do NOT copy):\n${angles}\n` : ''}
Include, in this order:
- HOOK: the exact first line + first 3 seconds.
- 3 BEATS: problem → product in real use → proof, one line each.
- CLOSE: a soft call to action.
- DO / DON'T: 3 quick rules each (vertical, natural, authentic; no over-claiming).
Keep it under ~180 words, plain and practical. Return ONLY the brief.`
  try {
    const resp = await openai.chat.completions.create({ model, temperature: 0.6, messages: [{ role: 'system', content: system }, { role: 'user', content: 'Write the brief.' }] })
    const t = String(resp.choices?.[0]?.message?.content || '').trim()
    return t || fallbackScript(brand, product)
  } catch { return fallbackScript(brand, product) }
}
