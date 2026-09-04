/**
 * Page Builder — the generation pipeline. Turns (template + product + persona + angle) into filled page
 * content: grounded copy for every text/list slot via ONE LLM call, and a resolved image URL for every
 * image slot (a real product photo where the role allows, an AI-generated shot where it doesn't). The
 * output is a `FilledContent` + `RenderOpts` the template's fixed `render()` turns into the page — the AI
 * never touches layout. Copy is grounded in the REAL product + chosen persona/angle + brand voice; we
 * never invent ingredients/results the product data doesn't support. Nothing here charges credits or
 * persists — the API route owns both.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { llm } from '@/lib/llm'
import { getTemplate } from './templates'
import type { FilledContent, RenderOpts, SlotDef, SlotValue, ImportedProduct } from './types'
import { getBuilderProduct } from './products'
import { loadBrandVoice, voiceBrief, productVision, fetchImageInput, generateAndHost, slugify, parseJsonObject } from './context'
import type { ImageInput } from '@/lib/gemini/image'

export interface GenerateResult {
  content: FilledContent
  renderOpts: RenderOpts
  productName: string
  ctaHref: string
  productImage: string | null
}

// Image roles the product's own photos can't cover → must be AI-generated.
const HARD_AI_ROLES = new Set(['hero', 'before_after'])
const SOFT_AI_ROLES = new Set(['editorial', 'lifestyle'])

export async function generatePage(
  userId: string,
  args: { templateId: string; productId: string; persona: any; angle: any; brandId?: string | null; research?: string; language?: string; paletteId?: string; importedProduct?: ImportedProduct | null },
): Promise<GenerateResult> {
  const template = getTemplate(args.templateId)
  if (!template) throw new Error(`Unknown template: ${args.templateId}`)

  const admin = createAdminClient()
  // Product source: an externally-imported product (pasted URL from Amazon/Etsy/etc.) wins; otherwise
  // pull the chosen product live from the connected Shopify store.
  const [product, voice] = await Promise.all([
    args.importedProduct
      ? Promise.resolve(args.importedProduct as any)
      : getBuilderProduct(userId, args.productId, args.brandId ?? null),
    loadBrandVoice(admin, userId, args.brandId ?? null),
  ])

  const personaName = String(args.persona?.name || args.persona?.title || '').slice(0, 120)
  const personaDesc = String(args.persona?.description || '').slice(0, 400)
  const angleTitle = String(args.angle?.title || '').slice(0, 160)
  const anglePromise = String(args.angle?.promise || '').slice(0, 400)

  const productName = product?.title || voice.name || 'this product'
  const handle = product?.handle || ''
  const productImages = product?.images || (product?.image ? [product.image] : [])
  const productImage = productImages[0] || product?.image || null

  // What the product ACTUALLY is (from its photo) — the primary grounding signal so copy tracks the
  // product, not the brand's category.
  const vision = await productVision(productImage)

  // ── b. COPY — one grounded LLM call fills every non-image slot ──
  const content = await generateCopy(template.schema, {
    productName,
    productBlock: productBlock(product, vision),
    voiceBrief: voiceBrief(voice),
    personaName, personaDesc, angleTitle, anglePromise,
    research: (args.research || '').trim().slice(0, 4000),
    language: (args.language || '').trim(),
  })

  // ── c. IMAGES — resolve a URL for every image slot ──
  await resolveImages(template.schema, content, {
    productImages, productImage,
    productName,
    // Vision (what the product really is) leads, so AI-generated shots match the product — not the
    // brand's category. Only fall back to the brand category when we couldn't read the product.
    productDesc: vision || product?.description || '',
    category: vision ? '' : (voice.category || voice.industry || ''),
    keyPrefix: `${slugify(voice.name || productName, 'store')}/${args.templateId}`,
  })

  // timeline thumbnails all use the main product image; listicle reason items cycle the product photos
  // (each reason gets a real product shot, so a store with several images shows variety).
  if (productImage) {
    const gallery = productImages.length ? productImages : [productImage]
    for (const slot of template.schema) {
      if (slot.type === 'timeline' && Array.isArray(content[slot.key])) {
        content[slot.key] = (content[slot.key] as any[]).map((it) => ({ ...it, thumb: productImage }))
      }
      if (slot.type === 'reasons' && Array.isArray(content[slot.key])) {
        content[slot.key] = (content[slot.key] as any[]).map((it, i) => ({ ...it, image: gallery[i % gallery.length] }))
      }
    }
  }

  // ── d. RENDER OPTS ──
  const renderOpts: RenderOpts = {
    productName,
    productImage: productImage || undefined,
    priceLabel: product?.price || undefined,
    ctaHref: handle ? `/products/${handle}` : '/',
    rating: ratingFor(product),
    paletteId: args.paletteId || undefined,
  }

  return { content, renderOpts, productName, ctaHref: renderOpts.ctaHref, productImage }
}

// ── copy ─────────────────────────────────────────────────────────────────────

// Real rating from an imported product when we scraped one; otherwise the house default.
function ratingFor(product: any): { stars: number; countLabel: string } {
  const r = Number(product?.rating)
  if (Number.isFinite(r) && r > 0) {
    const n = Number(product?.ratingCount)
    const count = Number.isFinite(n) && n > 0 ? n.toLocaleString('en-US') : '10,000+'
    return { stars: Math.min(5, Math.max(1, r)), countLabel: `[${r.toFixed(1)}] Rated by ${count} Customers` }
  }
  return { stars: 4.8, countLabel: '[4.8] Rated by 10,000+ Customers' }
}

function productBlock(product: any, vision?: string | null): string {
  if (!product) return 'No product data available — keep copy generic and make NO specific product claims.'
  const feats: string[] = Array.isArray(product.features) ? product.features : []
  const reviews: { name?: string; rating?: number; body: string }[] = Array.isArray(product.reviews) ? product.reviews : []
  return [
    `Title: ${product.title}`,
    product.brand && `Brand: ${product.brand}`,
    vision && `What it actually is (read from its photo): ${vision}`,
    product.price && `Price: ${product.price}`,
    product.compareAtPrice && `Original price (for a discount): ${product.compareAtPrice}`,
    product.rating && `Real average rating: ${product.rating}${product.ratingCount ? ` from ${product.ratingCount} reviews` : ''} — use THIS honest rating, don't invent one.`,
    product.sku && `SKU: ${product.sku}`,
    product.description && `Description: ${product.description}`,
    feats.length && `Real feature/benefit points from the source page (ground the benefit copy in these, don't fabricate):\n${feats.map((f) => `- ${f}`).join('\n')}`,
    reviews.length && `Real customer reviews from the source page (echo this genuine sentiment when writing testimonials; keep them believable, you may lightly clean wording):\n${reviews.map((r) => `- ${r.rating ? r.rating + '★ ' : ''}${r.name ? r.name + ': ' : ''}"${r.body}"`).join('\n')}`,
  ].filter(Boolean).join('\n')
}

const VALUE_FORMATS = `Value format by slot type:
- text: a plain string.
- richtext: a string; use **bold** for emphasis and blank lines to separate paragraphs.
- list / costs: an array of {"label": string, "body": string}.
- timeline: an array of {"label": string, "body": string}.
- reasons: an array of {"label": string (a 1-3 word category, e.g. "Natural Ingredients"), "title": string (the numbered reason heading, WITHOUT the number — e.g. "Nourish with natural botanicals"), "body": string (2-3 sentences)}.
- testimonials: an array of {"name": string, "city": string, "quote": string}.
- faq: an array of {"q": string, "a": string}.
- number: an integer.
For array slots, produce exactly the requested number of items.`

async function generateCopy(
  schema: SlotDef[],
  ctx: {
    productName: string; productBlock: string; voiceBrief: string
    personaName: string; personaDesc: string; angleTitle: string; anglePromise: string; research: string; language?: string
  },
): Promise<FilledContent> {
  const copySlots = schema.filter((s) => s.type !== 'image' && s.type !== 'video')
  const slotLines = copySlots.map((s) => {
    const bits = [`"${s.key}" (${s.type}${s.count ? `, ${s.count} items` : ''})`, s.label]
    if (s.role) bits.push(`role=${s.role}`)
    if (s.hint) bits.push(s.hint)
    return `- ${bits.join(' — ')}`
  }).join('\n')

  const lang = (ctx.language || '').trim()
  const langLine = lang && !/^english$/i.test(lang)
    ? `\n\nWRITE EVERY SLOT VALUE IN ${lang.toUpperCase()}. All copy the shopper reads — headlines, body, bullets, testimonials, FAQ, labels — must be natural, native-quality ${lang} (not a literal translation). Keep the product/brand name as-is. JSON keys stay in English.`
    : ''

  const sys = `You are a world-class direct-response copywriter filling a high-converting landing page that sells ONE specific product. Write copy that is specific, credible and emotionally resonant — built ENTIRELY around the real PRODUCT below, for the target persona and chosen angle.${langLine}

THE PRODUCT IS THE SUBJECT OF THE PAGE — every headline, story, benefit, testimonial and FAQ is about THIS product:
${ctx.productBlock}
${ctx.research ? `\nADDITIONAL RESEARCH the founder pasted (use where honest):\n${ctx.research}` : ''}

TARGET PERSONA: ${ctx.personaName || 'the product\'s core buyer'}${ctx.personaDesc ? ` — ${ctx.personaDesc}` : ''}
CHOSEN ANGLE: ${ctx.angleTitle || '(pick the strongest honest angle)'}${ctx.anglePromise ? ` — ${ctx.anglePromise}` : ''}

Brand voice (use ONLY for tone/style — NOT for what the product is; if the brand's category differs from the product, WRITE ABOUT THE PRODUCT, not the brand's category):
${ctx.voiceBrief}

HARD RULES:
- The page is about the PRODUCT above. Do NOT write about a different category (e.g. if the product is a t-shirt, never write about vaping/supplements just because the brand is in that space). Match the product.
- Speak to this persona in first person as a believable narrator who bought and loves THIS product.
- Do NOT invent ingredients, clinical results, statistics, prices, or claims the product data doesn't support. Where a specific fact isn't available, write honestly around it (the design, the feel, the experience, the vibe) rather than fabricating.
- Fill EVERY slot listed. Keep one consistent voice throughout.

${VALUE_FORMATS}

SLOTS TO FILL (the JSON key is in quotes):
${slotLines}

Return ONLY a JSON object mapping every slot key above to its value in the correct format. No commentary.`

  let parsed: any = null
  try {
    const res: any = await llm.messages.create({
      model: 'gpt-4o', max_tokens: 4000, temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: sys }],
    })
    parsed = parseJsonObject(res.content?.[0]?.text || '')
  } catch { parsed = null }
  const obj = parsed && typeof parsed === 'object' ? parsed : {}

  // Validate + coerce every slot to its expected shape; fill a safe default so render never breaks.
  const content: FilledContent = {}
  for (const slot of copySlots) content[slot.key] = coerce(slot, (obj as any)[slot.key])
  return content
}

function coerce(slot: SlotDef, v: any): SlotValue {
  const str = (x: any) => (typeof x === 'string' ? x : (x == null || typeof x === 'object' ? '' : String(x)))
  const n = slot.count && slot.count > 0 ? slot.count : undefined
  const takeArr = (a: any) => (Array.isArray(a) ? a : [])
  switch (slot.type) {
    case 'text':
    case 'richtext':
      return str(v)
    case 'number': {
      const num = parseInt(String(v), 10)
      return Number.isFinite(num) ? num : 12
    }
    case 'list':
    case 'costs':
    case 'timeline': {
      // "Label only" lists make the model emit plain strings (or use an alt key like title/name/text);
      // fall back through those so a single-field list never collapses to empty rows.
      const items = takeArr(v).map((i: any) =>
        typeof i === 'string'
          ? { label: i, body: '' }
          : { label: str(i?.label ?? i?.title ?? i?.name ?? i?.text ?? i?.feature), body: str(i?.body ?? i?.desc ?? i?.value) })
      return capItems(items, n)
    }
    case 'reasons': {
      const items = takeArr(v).map((i: any) => ({ label: str(i?.label), title: str(i?.title), body: str(i?.body) }))
      return capItems(items, n)
    }
    case 'testimonials': {
      const items = takeArr(v).map((i: any) => ({ name: str(i?.name), city: str(i?.city), quote: str(i?.quote) }))
      return capItems(items, n)
    }
    case 'faq': {
      const items = takeArr(v).map((i: any) => ({ q: str(i?.q), a: str(i?.a) }))
      return capItems(items, n)
    }
    default:
      return str(v)
  }
}

/** Trim to the requested count when the model overshoots; leave shorter arrays as-is (render tolerates). */
function capItems<T>(items: T[], count?: number): T[] {
  if (count && items.length > count) return items.slice(0, count)
  return items
}

// ── images ───────────────────────────────────────────────────────────────────

async function resolveImages(
  schema: SlotDef[],
  content: FilledContent,
  ctx: {
    productImages: string[]; productImage: string | null; productName: string
    productDesc: string; category: string; keyPrefix: string
  },
): Promise<void> {
  const imageSlots = schema.filter((s) => s.type === 'image')
  if (!imageSlots.length) return

  // A single product reference (base64) is fetched once and reused by every AI generation.
  let reference: ImageInput | null | undefined
  const getRef = async (): Promise<ImageInput | null> => {
    if (reference === undefined) reference = ctx.productImage ? await fetchImageInput(ctx.productImage) : null
    return reference
  }

  // Cursor over real product photos for plain product/editorial/lifestyle slots.
  let photoCursor = 0
  const nextPhoto = (): string | null => (photoCursor < ctx.productImages.length ? ctx.productImages[photoCursor++] : null)

  for (const slot of imageSlots) {
    const role = slot.role || ''
    let url: string | null = null

    if (HARD_AI_ROLES.has(role)) {
      url = await generateAndHost(imagePrompt(role, ctx), await getRef(), `${ctx.keyPrefix}-${slot.key}`, { aspectRatio: role === 'before_after' ? '16:9' : '1:1' })
      if (!url) url = ctx.productImage   // AI gen failed → use the product photo, never an empty placeholder
    } else if (SOFT_AI_ROLES.has(role)) {
      // Prefer an as-yet-unused real product photo; only generate when the store has none to spare.
      url = nextPhoto()
      if (!url) url = await generateAndHost(imagePrompt(role, ctx), await getRef(), `${ctx.keyPrefix}-${slot.key}`, { aspectRatio: '1:1' })
      if (!url) url = ctx.productImage   // fall back to the product photo rather than a blank block
    } else {
      // 'product' / default → a real product photo.
      url = nextPhoto() || ctx.productImage
    }

    if (url) content[slot.key] = url   // else leave empty → the template renders an on-brand placeholder
  }
}

function imagePrompt(role: string, ctx: { productName: string; productDesc: string; category: string }): string {
  const subject = ctx.productDesc || ctx.productName
  const base = `Product: ${ctx.productName}${ctx.productDesc ? ` — ${ctx.productDesc}` : ''}${ctx.category ? ` (category: ${ctx.category})` : ''}. Render the product faithfully from the reference photo — exact shape, label and colors. Photorealistic, premium, natural lighting. No text, no watermark, no logos other than the product's own.`
  switch (role) {
    case 'hero':
      return `A clean, scroll-stopping hero product shot of ${subject}. Studio-quality lighting, uncluttered on-brand background, generous negative space. ${base}`
    case 'before_after':
      return `A believable before-and-after style image relevant to ${subject}: a split composition contrasting the "before" problem state with the improved "after" state, honest and realistic (do not exaggerate results). ${base}`
    case 'editorial':
      return `An editorial, magazine-quality lifestyle photo featuring ${subject} in a real-world setting that fits its category. ${base}`
    case 'lifestyle':
      return `A warm lifestyle photo of ${subject} in natural use by a real person, authentic and relatable. ${base}`
    default:
      return `A clean product photo of ${subject}. ${base}`
  }
}
