/**
 * POST /api/builder/section-agent — the "Add a section" agent behind the visual editor.
 * Input:  { instruction?, imageDataUrl?, context? }  (text and/or a screenshot to match, + page context)
 * Output: { type, content, html }  — the chosen Block Library block, filled on-brand, rendered to HTML
 *         the editor drops into the live page.
 *
 * Hybrid model: the agent MUST pick a curated block (always on-brand); the 'custom' block is the free-form
 * fallback for layouts the library can't express. Copy generation is free; AI images are NOT generated
 * here (a big_image defaults to the product photo — the user can click it to Upload/Generate afterward).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { blockCatalog, renderBlock, getBlock } from '@/lib/builder/blocks'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

let _oai: OpenAI | null = null
const oai = () => (_oai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }))

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const instruction = String(b?.instruction || '').slice(0, 1200)
  const context = String(b?.context || '').slice(0, 1500)
  const productImage = b?.productImage ? String(b.productImage).slice(0, 2000) : null
  const imageDataUrl = typeof b?.imageDataUrl === 'string' && /^data:image\//.test(b.imageDataUrl) ? b.imageDataUrl.slice(0, 8_000_000) : null
  if (!instruction && !imageDataUrl) return NextResponse.json({ error: 'Describe the section or attach a screenshot.' }, { status: 400 })

  const catalog = blockCatalog()
  const sys = `You are a landing-page section designer. Add ONE new section to an existing high-converting product page.

Pick the SINGLE best-fit block from the library below, then write its content in the brand's voice. Prefer a curated block; use "custom" ONLY when no other block fits (then write clean semantic HTML for the "html" field: headings, paragraphs, images, simple CSS-grid — style everything with the palette CSS variables var(--ink)/var(--accent)/var(--line)/var(--paper)/var(--body)/var(--muted)/var(--grad) and hex fallbacks; no <script>, no <style>, no external CSS).

BLOCK LIBRARY (type — description — fields):
${catalog.map((c) => `• ${c.type} — ${c.description} FIELDS: ${c.fields.join(', ')}`).join('\n')}

PAGE CONTEXT:
${context || '(a direct-to-consumer product landing page)'}

RULES
- Write real, specific, benefit-led copy grounded in the page context. Never use lorem ipsum or placeholder text.
- Accent the single most important word/phrase in a heading by wrapping it in **double asterisks**.
- For list blocks, fill the listed item fields for every item; respect the natural count.
- ${imageDataUrl ? 'A screenshot is attached — MATCH its section type, layout and intent as closely as a library block allows.' : 'No screenshot — design from the instruction.'}
${instruction ? `\nUSER REQUEST: ${instruction}` : ''}

Return ONLY JSON: { "type": "<block type>", "content": { ...fields for that block... } }`

  const userContent: any[] = [{ type: 'text', text: instruction || 'Add the section shown in the attached screenshot.' }]
  if (imageDataUrl) userContent.push({ type: 'image_url', image_url: { url: imageDataUrl } })

  let parsed: any = null
  try {
    const res = await oai().chat.completions.create({
      model: 'gpt-4o', max_tokens: 1800, temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: userContent as any }],
    })
    parsed = JSON.parse(res.choices[0]?.message?.content || '{}')
  } catch { parsed = null }

  const type = String(parsed?.type || '').trim()
  const content = parsed?.content && typeof parsed.content === 'object' ? parsed.content : {}
  const block = getBlock(type)
  if (!block) return NextResponse.json({ error: 'Could not design that section — try describing it differently.' }, { status: 422 })

  // A big_image defaults to the product photo so the section never renders empty; the user swaps it after.
  if (type === 'big_image' && !content.image && productImage) content.image = productImage

  const html = renderBlock(type, content, { productImage })
  if (!html) return NextResponse.json({ error: 'Could not render that section.' }, { status: 500 })

  return NextResponse.json({ type, content, html, label: block.label })
}
