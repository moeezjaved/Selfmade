/**
 * Page Builder — core contract shared by the template registry, the generation pipeline, the publish
 * step, the API routes and the wizard. See docs/superpowers/specs/2026-09-03-page-builder-design.md.
 *
 * A template is a FIXED layout (the `render` function) plus a `schema` describing the slots the AI may
 * fill. The AI only produces `FilledContent` (slot key → value); it never touches layout — that's what
 * keeps every generated page on-template and high-converting.
 */

export type TemplateType = 'advertorial' | 'listicle' | 'product' | 'home'

/** The kinds of slot the AI fills. */
export type SlotType =
  | 'text'        // a single string (headline, subhead, paragraph, label)
  | 'richtext'    // a paragraph that may contain **bold** spans (rendered to <strong>)
  | 'image'       // an image URL (resolved from product photos or AI-generated)
  | 'video'       // a URL to a video (or a poster image) the merchant uploads — NOT AI-filled
  | 'list'        // an array of { label, body } (❌/✅ rows, benefit/ingredient lists)
  | 'costs'       // an array of { label, body } rendered as "At work: …" cost rows
  | 'timeline'    // an array of { label, body } (Week 1 / Month 2-4 rows, each with a thumb)
  | 'reasons'     // an array of { label (category pill), title (numbered heading), body } + an image the pipeline fills — the listicle's N items
  | 'testimonials'// an array of { name, city, quote }
  | 'faq'         // an array of { q, a }
  | 'number'      // an integer (countdown hours, etc.)

/** One fillable slot, described for the copy model + the wizard. */
export interface SlotDef {
  key: string
  type: SlotType
  /** semantic role — steers the copy model and image resolution (e.g. 'headline', 'hero', 'product') */
  role?: string
  label: string
  /** guidance for the copy model on what to write here */
  hint?: string
  /** for list/timeline/testimonials/faq/costs: how many items to generate */
  count?: number
}

/** The value the AI produces per slot. text/richtext/image → string; the rest → arrays. */
export type SlotValue =
  | string
  | number
  | Array<{ label?: string; title?: string; body?: string; image?: string; thumb?: string; name?: string; city?: string; quote?: string; q?: string; a?: string }>

/** slot key → value. The single source of truth a page renders from (persisted on builder_pages). */
export type FilledContent = Record<string, SlotValue>

/** A product scraped from an external URL (Amazon/Etsy/Shopify/AliExpress/any site) used to build a page. */
export interface ImportedProduct {
  title: string
  handle?: string
  price?: string
  /** original / "was" price, for a real discount pill */
  compareAtPrice?: string
  image?: string | null
  images?: string[]
  description?: string
  sku?: string | null
  /** the seller/brand name → wordmark + voice */
  brand?: string
  /** real average rating + how many reviews → an honest buy-box rating */
  rating?: number
  ratingCount?: number
  /** real feature/highlight bullets pulled off the page → grounds benefit copy */
  features?: string[]
  /** real customer review snippets → seeds testimonials with genuine sentiment */
  reviews?: { name?: string; rating?: number; body: string }[]
  sourceUrl?: string
}

export interface RenderOpts {
  /** product name shown in offer cards + CTAs */
  productName: string
  /** main product image URL for offer cards, the floating bar, and timeline thumbnails */
  productImage?: string
  /** currency-prefixed price string for the floating bar, e.g. "PKR 2,499" (optional) */
  priceLabel?: string
  /** destination the CTAs link to — the product's PDP or cart (absolute or /products/handle) */
  ctaHref: string
  /** star rating + review count shown in offer cards */
  rating?: { stars: number; countLabel: string }
  /** chosen colour palette id (see lib/builder/palettes) — re-skins the page via a CSS-var override */
  paletteId?: string
}

export interface PageTemplate {
  id: string
  type: TemplateType
  name: string
  description: string
  /** small preview image path (in /public) for the wizard's template picker */
  thumbnail?: string
  /** slots the copy model must fill (order irrelevant; keys are the contract) */
  schema: SlotDef[]
  /** shared CSS for this template (inlined into the published page so it's self-contained) */
  css: string
  /** FIXED layout — turns FilledContent into the page body HTML. Never AI-edited. */
  render: (content: FilledContent, opts: RenderOpts) => string
}
