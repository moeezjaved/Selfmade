/**
 * Page Builder — persona + angle generation. Given the chosen product and the brand voice (plus optional
 * pasted research), the model proposes 1-2 target personas, each with 3-4 marketing angles the page can be
 * built around. Everything is grounded in the REAL product — we never invent claims/ingredients/results the
 * product data doesn't support. The wizard shows these; the founder picks one persona + one angle, which
 * then flow into generatePage().
 */
import { createAdminClient } from '@/lib/supabase/server'
import { llm } from '@/lib/llm'
import { getBuilderProduct } from './products'
import { loadBrandVoice, voiceBrief, slugify, parseJsonObject } from './context'

export interface BuilderAngle { id: string; title: string; promise: string }
export interface BuilderPersona { id: string; name: string; description: string; angles: BuilderAngle[] }

export async function generatePersonas(
  userId: string,
  args: { productId: string; brandId?: string | null; research?: string },
): Promise<{ personas: BuilderPersona[] }> {
  const admin = createAdminClient()
  const [product, voice] = await Promise.all([
    getBuilderProduct(userId, args.productId, args.brandId ?? null),
    loadBrandVoice(admin, userId, args.brandId ?? null),
  ])

  const productBlock = product
    ? [
        `Title: ${product.title}`,
        product.price && `Price: ${product.price}`,
        product.description && `Description: ${product.description}`,
      ].filter(Boolean).join('\n')
    : 'No product data available.'
  const research = (args.research || '').trim().slice(0, 4000)

  const sys = `You are a senior DTC direct-response strategist. From the REAL product and brand voice below, propose the target CUSTOMERS and the marketing ANGLES a high-converting landing page could be built around.

${voiceBrief(voice)}

PRODUCT (ground everything in this — do NOT invent ingredients, results, or claims it doesn't support):
${productBlock}
${research ? `\nADDITIONAL RESEARCH the founder pasted (use it, but stay honest):\n${research}` : ''}

Rules:
- Return 1-2 distinct personas (2 only if the product genuinely serves two different buyers).
- Each persona: a short human "name" label (e.g. "Busy new moms"), and a one-sentence description of who they are + their core pain.
- Each persona has 3-4 angles. An angle = a single marketing hook this specific buyer responds to: a "title" (a few words, e.g. "The 5-minute morning fix") and a "promise" (one honest sentence on the transformation, supported by the product).
- Be specific to THIS product and category. No generic filler. Never promise outcomes the product can't deliver.

Return ONLY JSON:
{"personas":[{"name":"...","description":"...","angles":[{"title":"...","promise":"..."}]}]}`

  let parsed: any = null
  try {
    const res: any = await llm.messages.create({
      model: 'gpt-4o', max_tokens: 1400, temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: sys }],
    })
    parsed = parseJsonObject(res.content?.[0]?.text || '')
  } catch { parsed = null }

  const raw: any[] = Array.isArray(parsed?.personas) ? parsed.personas : []
  const seenP = new Set<string>()
  const personas: BuilderPersona[] = raw.slice(0, 2).map((p: any, pi: number) => {
    const name = String(p?.name || `Audience ${pi + 1}`).slice(0, 80)
    let pid = slugify(name, `persona-${pi + 1}`)
    while (seenP.has(pid)) pid = `${pid}-${pi + 1}`
    seenP.add(pid)
    const seenA = new Set<string>()
    const angles: BuilderAngle[] = (Array.isArray(p?.angles) ? p.angles : []).slice(0, 4).map((a: any, ai: number) => {
      const title = String(a?.title || `Angle ${ai + 1}`).slice(0, 100)
      let aid = slugify(title, `angle-${ai + 1}`)
      while (seenA.has(aid)) aid = `${aid}-${ai + 1}`
      seenA.add(aid)
      return { id: aid, title, promise: String(a?.promise || '').slice(0, 280) }
    })
    return { id: pid, name, description: String(p?.description || '').slice(0, 280), angles }
  })

  return { personas }
}
