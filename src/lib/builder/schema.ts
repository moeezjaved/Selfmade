/**
 * Advanced Page Builder — the structured page model (Phase 1 of docs/specs/2026-09-12-advanced-page-builder.md).
 *
 *   PageDoc → Section[] → Block[] → Element[], every node carrying per-device StyleProps.
 *
 * ONE model powers three things: the live editor canvas, the property panel (which reads/writes StyleProps),
 * and the published Shopify HTML (via render.ts). This file is PURE types + a StyleProps→CSS compiler — no
 * React, no DB — so it's safe to import anywhere (server render, client editor) and nothing depends on it yet.
 */

// ── enums ──────────────────────────────────────────────────────────────────
export type SectionType =
  | 'productInfo' | 'stickyAtc' | 'imageBenefits' | 'reviewsCarousel' | 'asSeenOn'
  | 'imageTimeline' | 'imageText' | 'imagePercentage' | 'productDifferences'
  | 'recommendedProducts' | 'shapeDivider'

export type BlockType =
  | 'gallery' | 'productDetails' | 'title' | 'price' | 'rating' | 'benefitList'
  | 'timelineStep' | 'reviewCard' | 'logoStrip' | 'diffTable' | 'productCard'
  | 'options' | 'atc' | 'text' | 'media' | 'group'

export type ElementType =
  | 'text' | 'heading' | 'image' | 'video' | 'icon' | 'button' | 'badge'
  | 'divider' | 'stars' | 'countdown' | 'price' | 'bind'

// Product-bound values (read live from the Shopify product; still individually stylable).
export type ProductBind =
  | 'product.title' | 'product.price' | 'product.compareAtPrice' | 'product.savePct'
  | 'product.rating' | 'product.reviewCount' | 'product.image' | 'product.description'

// ── style ───────────────────────────────────────────────────────────────────
export type Len = string           // '16px' | '1.5rem' | '60%' | '0'
export type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
export type LetterSpacing = 'tight' | 'normal' | 'loose' | Len
export type TextCase = 'default' | 'upper' | 'lower' | 'capitalize'
export type ShadowToken = 'none' | 'sm' | 'md' | 'lg' | 'xl'
/** A design-token name (resolved against PageDoc.theme.tokens, e.g. "Primary") OR a raw CSS color. */
export type TokenOrColor = string

/** Every property-panel control maps to one of these keys. A value may be a flat value OR a
 * { base, mobile } responsive override — resolveStyle() collapses it for a target device. */
export type Responsive<T> = T | { base?: T; mobile?: T }

export interface StyleProps {
  // typography
  fontFamily?: Responsive<string>
  fontSize?: Responsive<Len>
  fontWeight?: Responsive<Weight>
  lineHeight?: Responsive<Len>
  letterSpacing?: Responsive<LetterSpacing>
  textCase?: Responsive<TextCase>
  color?: Responsive<TokenOrColor>
  textAlign?: Responsive<'left' | 'center' | 'right' | 'justify'>
  // layout / spacing
  gap?: Responsive<Len>
  paddingX?: Responsive<Len>
  paddingY?: Responsive<Len>
  marginX?: Responsive<Len>
  marginY?: Responsive<Len>
  width?: Responsive<Len>
  maxWidth?: Responsive<Len>
  align?: Responsive<'start' | 'center' | 'end' | 'stretch'>
  direction?: Responsive<'row' | 'column'>
  // background / border
  background?: Responsive<TokenOrColor>
  backgroundImage?: Responsive<string>
  radius?: Responsive<Len>
  borderWidth?: Responsive<Len>
  borderColor?: Responsive<TokenOrColor>
  shadow?: Responsive<ShadowToken>
}

export type Device = 'base' | 'mobile'

// ── tree ──────────────────────────────────────────────────────────────────
export interface ElementContent {
  text?: string
  src?: string
  alt?: string
  href?: string
  bind?: ProductBind          // product-bound value
  stars?: number              // for 'stars'
  until?: string              // ISO for 'countdown'
  [k: string]: unknown
}

export interface Element {
  id: string
  type: ElementType
  content: ElementContent
  style: StyleProps
  hidden?: boolean
}

export interface Block {
  id: string
  type: BlockType
  elements: Element[]
  style: StyleProps
  hidden?: boolean
  settings?: Record<string, unknown>
}

export interface Section {
  id: string
  type: SectionType
  blocks: Block[]
  style: StyleProps
  hidden?: boolean
  settings?: Record<string, unknown>
}

export interface FontSet { heading?: string; body?: string }
export interface DesignTokens {
  // name → CSS value; e.g. { Primary: '#e02f06', Secondary: '#1b1a17', Ink: '#141d15', Paper: '#fbfaf8' }
  [name: string]: string
}
export interface ImportedProductRef {
  title?: string; price?: string; compareAtPrice?: string; image?: string | null
  images?: string[]; description?: string; rating?: number; ratingCount?: number
}

export interface PageDoc {
  id: string
  version: number
  productRef: { productId?: string; importedProduct?: ImportedProductRef | null }
  theme: { paletteId: string; fonts: FontSet; tokens: DesignTokens }
  settings: { seo?: { title?: string; description?: string }; locale?: string }
  sections: Section[]
}

// ── StyleProps → CSS ─────────────────────────────────────────────────────────
/** Collapse a Responsive<T> to the value for a device (mobile inherits base when unset). */
export function resolveStyle<T>(v: Responsive<T> | undefined, device: Device): T | undefined {
  if (v == null) return undefined
  if (typeof v === 'object' && v !== null && ('base' in (v as any) || 'mobile' in (v as any))) {
    const r = v as { base?: T; mobile?: T }
    return device === 'mobile' ? (r.mobile ?? r.base) : r.base
  }
  return v as T
}

const LETTER: Record<string, string> = { tight: '-0.02em', normal: '0', loose: '0.08em' }
const CASE: Record<TextCase, string> = { default: 'none', upper: 'uppercase', lower: 'lowercase', capitalize: 'capitalize' }
const SHADOW: Record<ShadowToken, string> = {
  none: 'none', sm: '0 1px 2px rgba(20,18,15,.08)', md: '0 6px 18px -8px rgba(20,18,15,.25)',
  lg: '0 20px 50px -24px rgba(20,18,15,.35)', xl: '0 40px 90px -40px rgba(20,18,15,.5)',
}

/** Resolve a token name against the theme, else pass through a raw color. */
export function resolveColor(v: string | undefined, tokens: DesignTokens): string | undefined {
  if (!v) return undefined
  return tokens[v] ?? v
}

/** Compile a node's StyleProps into a CSS declaration string for one device. Used by render.ts for both
 * the editor canvas and the published HTML, so they can never visually diverge. */
export function compileStyle(style: StyleProps, tokens: DesignTokens, device: Device): string {
  const r = <T>(v: Responsive<T> | undefined) => resolveStyle(v, device)
  const out: string[] = []
  const push = (prop: string, val: string | number | undefined) => { if (val != null && val !== '') out.push(`${prop}:${val}`) }

  push('font-family', r(style.fontFamily))
  push('font-size', r(style.fontSize))
  push('font-weight', r(style.fontWeight) as any)
  push('line-height', r(style.lineHeight))
  { const ls = r(style.letterSpacing); if (ls) push('letter-spacing', LETTER[ls] ?? ls) }
  { const tc = r(style.textCase); if (tc && tc !== 'default') push('text-transform', CASE[tc]) }
  push('color', resolveColor(r(style.color), tokens))
  push('text-align', r(style.textAlign))
  push('gap', r(style.gap))
  { const px = r(style.paddingX), py = r(style.paddingY); if (py != null || px != null) push('padding', `${py ?? '0'} ${px ?? '0'}`) }
  { const mx = r(style.marginX), my = r(style.marginY); if (my != null || mx != null) push('margin', `${my ?? '0'} ${mx ?? 'auto'}`) }
  push('width', r(style.width))
  push('max-width', r(style.maxWidth))
  { const a = r(style.align); if (a) { push('align-items', a); push('justify-content', a) } }
  { const d = r(style.direction); if (d) { push('display', 'flex'); push('flex-direction', d) } }
  push('background', resolveColor(r(style.background), tokens))
  { const bi = r(style.backgroundImage); if (bi) push('background-image', `url(${bi})`) }
  push('border-radius', r(style.radius))
  { const bw = r(style.borderWidth); if (bw) { push('border-style', 'solid'); push('border-width', bw); push('border-color', resolveColor(r(style.borderColor), tokens) || 'currentColor') } }
  { const sh = r(style.shadow); if (sh && sh !== 'none') push('box-shadow', SHADOW[sh]) }

  return out.join(';')
}

let _n = 0
/** Stable-ish id for new nodes (client + server safe; not cryptographic). */
export function nodeId(prefix = 'n'): string {
  _n = (_n + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${_n.toString(36)}`
}
