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
import { blockCatalog, renderBlock, getBlock, IMG_PLACEHOLDER } from '@/lib/builder/blocks'
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
  const sys = `You are a landing-page section builder. Add ONE new section to a product landing page.

${imageDataUrl ? `A REFERENCE SCREENSHOT is attached. Your #1 job is to REPRODUCE IT FAITHFULLY — the SAME layout, the SAME number of items/columns, the SAME card structure, the SAME badges/tags, the SAME image placement and overall look. Never swap it for a generic section.

Choose how:
1. Use a curated block ONLY if one below has the SAME structure as the screenshot. Then fill its fields from what you actually see (names, tags, quotes, item COUNT).
2. If NO curated block matches the screenshot's layout, use type "custom" and WRITE HTML in content.html that replicates the screenshot precisely — reproduce the grid/columns, every card, before/after image pairs with BEFORE/AFTER badges, tag pills, italic quotes, author/"weeks in" lines, and any "product used" rows. Match the exact number of cards/columns you see.
Do NOT downgrade a rich reference (e.g. before/after result cards) to a plain star-review list.`
: `Pick the SINGLE best-fit curated block below and fill its content in the brand's voice. Use "custom" only if none fits.`}

BLOCK LIBRARY (type — description — fields):
${catalog.map((c) => `• ${c.type} — ${c.description} FIELDS: ${c.fields.join(', ')}`).join('\n')}

PAGE CONTEXT:
${context || '(a direct-to-consumer product landing page)'}

CUSTOM HTML RULES (when type = "custom")
- Put the whole section markup in content.html. Semantic tags + INLINE styles using the palette CSS variables var(--ink)/var(--accent)/var(--line)/var(--paper)/var(--body)/var(--muted)/var(--grad)/var(--good) with hex fallbacks. Use CSS grid/flex for layout so it matches the reference.
- For EVERY image use exactly src="{{PLACEHOLDER}}" (a placeholder the user swaps after) — NEVER invent image URLs.
- No <script>, no <style>, no external CSS or fonts.

CONTENT RULES
- Real, specific, benefit-led copy grounded in the page context and what the screenshot shows. Never lorem ipsum.
- Accent the single most important word/phrase in a heading with **double asterisks**.
- For list blocks, fill every item field; respect the item count.
${instruction ? `\nUSER REQUEST: ${instruction}` : ''}

Return ONLY JSON: { "type": "<block type>", "content": { ...fields, or html for custom... } }`

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

  // Custom HTML: swap the agent's {{PLACEHOLDER}} tokens (and any empty img srcs) for a visible, clickable
  // image placeholder, so a screenshot-matched section renders fully instead of showing broken images.
  if (type === 'custom' && typeof content.html === 'string') {
    content.html = content.html
      .replace(/\{\{\s*PLACEHOLDER\s*\}\}/g, IMG_PLACEHOLDER)
      .replace(/(<img\b[^>]*\ssrc=)["'](?:|#|placeholder)["']/gi, `$1"${IMG_PLACEHOLDER}"`)
      .replace(/<img\b(?![^>]*\ssrc=)([^>]*)>/gi, `<img src="${IMG_PLACEHOLDER}"$1>`)
  }

  const html = renderBlock(type, content, { productImage })
  if (!html) return NextResponse.json({ error: 'Could not render that section.' }, { status: 500 })

  return NextResponse.json({ type, content, html, label: block.label })
}
