/**
 * Advanced Page Builder runtime (Phase 1). ONE renderer for the whole PageDoc → HTML, used by BOTH the
 * editor canvas and the Shopify publish path, so the two can never visually diverge (the hard correctness
 * bar in the spec). Pure string output + a compiled <style> block from schema.compileStyle.
 *
 *   renderDoc(doc, { mode, product })  →  { html, css }
 *
 * `mode: 'edit'` adds data-node-id + data-node-type attributes so the editor can map DOM ↔ model and show
 * the selection toolbar. `mode: 'publish'` omits them for clean output.
 */
import { compileStyle, type PageDoc, type Section, type Block, type Element, type DesignTokens, type Device, type ProductBind } from './schema'

export interface RenderProduct {
  title?: string; price?: string; compareAtPrice?: string; savePct?: string
  rating?: number; reviewCount?: number; image?: string | null; description?: string
}
export interface RenderOpts { mode?: 'edit' | 'publish'; device?: Device; product?: RenderProduct }

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const attr = (s: unknown): string => esc(s)

function bindValue(bind: ProductBind, p?: RenderProduct): string {
  switch (bind) {
    case 'product.title': return p?.title || ''
    case 'product.price': return p?.price || ''
    case 'product.compareAtPrice': return p?.compareAtPrice || ''
    case 'product.savePct': return p?.savePct || ''
    case 'product.rating': return p?.rating != null ? String(p.rating) : ''
    case 'product.reviewCount': return p?.reviewCount != null ? String(p.reviewCount) : ''
    case 'product.image': return p?.image || ''
    case 'product.description': return p?.description || ''
    default: return ''
  }
}

function stars(n: number): string {
  const full = Math.round(Math.max(0, Math.min(5, n)))
  return `<span class="sf-stars" aria-label="${full} out of 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`
}

function renderElement(el: Element, tokens: DesignTokens, o: Required<Pick<RenderOpts, 'device' | 'mode'>> & { product?: RenderProduct }): string {
  if (el.hidden) return ''
  const css = compileStyle(el.style, tokens, o.device)
  const styleAttr = css ? ` style="${attr(css)}"` : ''
  const idAttr = o.mode === 'edit' ? ` data-node-id="${attr(el.id)}" data-node-type="element:${attr(el.type)}"` : ''
  const c = el.content

  switch (el.type) {
    case 'heading': {
      const t = c.bind ? bindValue(c.bind, o.product) : (c.text || '')
      return `<h2 class="sf-el sf-heading"${styleAttr}${idAttr}>${esc(t)}</h2>`
    }
    case 'text': {
      const t = c.bind ? bindValue(c.bind, o.product) : (c.text || '')
      return `<div class="sf-el sf-text"${styleAttr}${idAttr}>${esc(t)}</div>`
    }
    case 'price': {
      const now = c.bind ? bindValue(c.bind, o.product) : (c.text || o.product?.price || '')
      const was = o.product?.compareAtPrice
      const save = o.product?.savePct
      return `<div class="sf-el sf-price"${styleAttr}${idAttr}><span class="sf-price-now">${esc(now)}</span>${was ? `<span class="sf-price-was">${esc(was)}</span>` : ''}${save ? `<span class="sf-price-save">${esc(save)}</span>` : ''}</div>`
    }
    case 'stars':
      return `<div class="sf-el"${styleAttr}${idAttr}>${stars(Number(c.stars ?? o.product?.rating ?? 5))}</div>`
    case 'badge':
      return `<span class="sf-el sf-badge"${styleAttr}${idAttr}>${esc(c.text || '')}</span>`
    case 'button':
      return `<a class="sf-el sf-btn" href="${attr(c.href || '#')}"${styleAttr}${idAttr}>${esc(c.text || 'Buy now')}</a>`
    case 'image': {
      const src = c.bind ? bindValue(c.bind, o.product) : (c.src || o.product?.image || '')
      return `<img class="sf-el sf-img" src="${attr(src)}" alt="${attr(c.alt || '')}" loading="lazy"${styleAttr}${idAttr} />`
    }
    case 'video':
      return `<video class="sf-el sf-video" src="${attr(c.src || '')}" muted playsinline${styleAttr}${idAttr}></video>`
    case 'icon':
      return `<span class="sf-el sf-icon"${styleAttr}${idAttr}>${esc(c.text || '•')}</span>`
    case 'divider':
      return `<hr class="sf-el sf-divider"${styleAttr}${idAttr} />`
    case 'countdown':
      return `<div class="sf-el sf-countdown" data-until="${attr(c.until || '')}"${styleAttr}${idAttr}>${esc(c.text || '')}</div>`
    case 'bind':
      return `<div class="sf-el"${styleAttr}${idAttr}>${esc(c.bind ? bindValue(c.bind, o.product) : '')}</div>`
    case 'raw':
      // Verbatim bespoke-template HTML. NOT escaped — this is the template's own markup, rendered as-is
      // so the design stays pixel-faithful. In edit mode it's a selectable, inline-editable unit.
      return `<div class="sf-el sf-raw"${styleAttr}${idAttr}>${typeof c.html === 'string' ? c.html : ''}</div>`
    default:
      return `<div class="sf-el"${styleAttr}${idAttr}>${esc(c.text || '')}</div>`
  }
}

function renderBlock(b: Block, tokens: DesignTokens, o: Required<Pick<RenderOpts, 'device' | 'mode'>> & { product?: RenderProduct }): string {
  if (b.hidden) return ''
  const css = compileStyle(b.style, tokens, o.device)
  const styleAttr = css ? ` style="${attr(css)}"` : ''
  const idAttr = o.mode === 'edit' ? ` data-node-id="${attr(b.id)}" data-node-type="block:${attr(b.type)}"` : ''
  const inner = b.elements.map((e) => renderElement(e, tokens, o)).join('')
  return `<div class="sf-block sf-block-${attr(b.type)}"${styleAttr}${idAttr}>${inner}</div>`
}

// Background/full-bleed props live on the outer <section>; layout props (flex direction, gap, align,
// padding) live on .sf-section-inner — the element that actually contains the blocks — so the section's
// layout reaches its blocks instead of stopping at the inner wrapper.
const OUTER_STYLE_KEYS = new Set(['background', 'backgroundImage', 'shadow'])
function renderSection(s: Section, tokens: DesignTokens, o: Required<Pick<RenderOpts, 'device' | 'mode'>> & { product?: RenderProduct }): string {
  if (s.hidden) return ''
  const style = s.style || {}
  const outerStyle: typeof style = {}
  const innerStyle: typeof style = {}
  for (const [k, v] of Object.entries(style)) (OUTER_STYLE_KEYS.has(k) ? outerStyle : innerStyle)[k as keyof typeof style] = v as never
  const outerCss = compileStyle(outerStyle, tokens, o.device)
  const innerCss = compileStyle(innerStyle, tokens, o.device)
  const outerAttr = outerCss ? ` style="${attr(outerCss)}"` : ''
  const innerAttr = innerCss ? ` style="${attr(innerCss)}"` : ''
  const idAttr = o.mode === 'edit' ? ` data-node-id="${attr(s.id)}" data-node-type="section:${attr(s.type)}"` : ''
  // A raw (bespoke-template) section renders its slice FULL-BLEED — no .sf-section-inner max-width wrapper —
  // so the template's own bands/wraps keep their exact widths. The bespoke CSS (doc.rawCss) does the rest.
  if (s.type === 'raw') {
    const inner = s.blocks.map((b) => renderBlock(b, tokens, o)).join('')
    return `<section class="sf-section sf-section-raw"${outerAttr}${idAttr}>${inner}</section>`
  }
  // Shape divider is a decorative section — a full-width SVG wave (color = its background/Primary token).
  const inner = s.type === 'shapeDivider'
    ? `<svg class="sf-shape-divider" viewBox="0 0 1200 70" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg"><path d="M0,32 C240,88 480,0 720,24 C960,48 1080,16 1200,36 L1200,70 L0,70 Z"></path></svg>`
    : s.blocks.map((b) => renderBlock(b, tokens, o)).join('')
  return `<section class="sf-section sf-section-${attr(s.type)}"${outerAttr}${idAttr}><div class="sf-section-inner"${innerAttr}>${inner}</div></section>`
}

/** Base CSS shared by every rendered page (the design-token vars come from the theme). */
function baseCss(tokens: DesignTokens): string {
  const vars = Object.entries(tokens).map(([k, v]) => `--sf-${k.toLowerCase()}:${v}`).join(';')
  return `@import url('https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Lato:wght@300;400;700;900&family=Playfair+Display:wght@400;600;700&family=Poppins:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap');
:root{${vars}}
.sf-page{font-family:Inter,system-ui,sans-serif;color:var(--sf-ink,#1b1a17);line-height:1.5}
.sf-section{width:100%}
.sf-section-inner{max-width:1080px;margin:0 auto;padding:0 20px}
.sf-block{display:block}
.sf-img,.sf-video{max-width:100%;display:block}
.sf-btn{display:inline-block;text-decoration:none;cursor:pointer}
.sf-stars{letter-spacing:2px;color:#f5a623}
.sf-price-was{text-decoration:line-through;opacity:.55;margin-left:8px}
.sf-price-save{margin-left:8px;font-weight:700}
/* per-element responsive visibility ("Show on" — desktop / mobile) */
@media(max-width:768px){.sf-hide-mob{display:none!important}}
@media(min-width:769px){.sf-hide-desk{display:none!important}}
/* payment-icon size (editor "Icons → Size" sets --payw on the .pays row) */
.pgbld .pays[style*="--payw"] .payicon svg{width:var(--payw)!important;height:auto!important}

/* ── section library layouts (Phase 4) — driven by section/block classes so canvas == publish ── */
/* grid/list sections: a centered wrapping row; the section head (width:100%) sits on its own line */
/* card/grid sections lay out as a centered wrapping ROW — !important so a section's inline
   direction:column (set by the adapter) can't collapse the grid into a single stacked column. */
.sf-section-imageBenefits .sf-section-inner,
.sf-section-reviewsCarousel .sf-section-inner,
.sf-section-imagePercentage .sf-section-inner,
.sf-section-recommendedProducts .sf-section-inner,
.sf-section-productDifferences .sf-section-inner,
.sf-section-imageText .sf-section-inner,
.sf-section-imageTimeline .sf-section-inner{display:flex!important;flex-direction:row!important;flex-wrap:wrap!important;justify-content:center;align-items:stretch;gap:22px}
/* a full-width child (a section heading, a paragraph) always sits on its own line above the grid */
.sf-section-imageText .sf-section-inner > .sf-block-text{flex:1 1 100%}
/* sticky add-to-cart bar */
.sf-section-stickyAtc{position:sticky;bottom:0;z-index:5;border-top:1px solid var(--sf-line,#e7e3dd);box-shadow:0 -6px 20px -12px rgba(20,18,15,.3)}
.sf-block-atc{display:flex;align-items:center;gap:14px;width:100%}
.sf-block-atc .sf-heading{flex:1;margin:0}
/* benefit cards */
.sf-block-benefitList{text-align:center;align-items:center;padding:6px}
/* review cards */
.sf-block-reviewCard{box-shadow:0 1px 2px rgba(20,18,15,.06)}
/* logo strip */
.sf-block-logoStrip{flex-wrap:wrap;justify-content:center;opacity:.85}
/* timeline steps: left accent + connector */
.sf-block-timelineStep{width:100%;max-width:640px;border-left:2px solid var(--sf-line,#e7e3dd);padding-left:18px;position:relative}
.sf-block-timelineStep .sf-badge{align-self:flex-start}
/* comparison rows as a 3-column grid */
.sf-block-diffTable{display:grid;grid-template-columns:1fr 90px 90px;align-items:center;gap:10px;max-width:640px;padding:12px 4px;border-bottom:1px solid var(--sf-line,#e7e3dd)}
/* product cards */
.sf-block-productCard{align-items:center;text-align:center}
/* shape divider */
.sf-shape-divider{display:block;width:100%;height:70px}
.sf-shape-divider path{fill:var(--sf-primary,#e02f06)}

/* ── polished, PagePilot-style defaults (element inline styles still override these) ── */
.sf-heading{color:var(--sf-ink,#1b1a17);font-weight:800;text-wrap:balance;line-height:1.16}
.sf-text{color:var(--sf-sub,#5b5750);line-height:1.6}
.sf-img{border-radius:14px;object-fit:cover}
.sf-btn{font-weight:800;border-radius:999px;padding:14px 26px}
/* a heading-led section title block: centered, roomy */
.sf-section-inner > .sf-block-text:first-child .sf-heading{font-size:30px;text-align:center;margin:0 auto 4px}
/* cards: reviews / product / feature groups read as tidy cards */
.sf-block-reviewCard,.sf-block-productCard{background:#fff;border:1px solid var(--sf-line,#e7e3dd);border-radius:16px;padding:20px 18px;box-shadow:0 2px 10px -6px rgba(20,18,15,.18)}
/* benefit cards: soft tinted tile so a benefits grid looks designed, not a bare list */
.sf-block-benefitList{background:var(--sf-paper,#faf9f7);border:1px solid var(--sf-line,#e7e3dd);border-radius:16px;padding:20px 16px;gap:8px}
/* image blocks/galleries: never a lonely column — wrap into a centered responsive grid */
.sf-block-media,.sf-block-gallery{display:flex;flex-wrap:wrap;justify-content:center;gap:14px}
.sf-block-media .sf-img,.sf-block-gallery .sf-img{flex:1 1 220px;max-width:320px;aspect-ratio:1/1}
/* card images stay a tidy banner, not a giant square that turns the card into a column of photos */
.sf-block-benefitList .sf-img,.sf-block-reviewCard .sf-img,.sf-block-timelineStep .sf-img,.sf-block-productCard .sf-img{max-height:190px;object-fit:cover}
/* alternating section bands give vertical rhythm like a designed page */
.sf-page > .sf-section:nth-of-type(even){background:var(--sf-paper,#faf9f7)}
.sf-section-productInfo{background:transparent!important}
/* hero: two balanced columns, comfortably centered */
.sf-section-productInfo .sf-section-inner{gap:40px;align-items:center;flex-wrap:wrap}
`.trim()
}

/** Render the whole document. Returns the page HTML and the compiled CSS (caller decides how to inline). */
export function renderDoc(doc: PageDoc, opts: RenderOpts = {}): { html: string; css: string } {
  const o = { device: opts.device || 'base', mode: opts.mode || 'publish', product: opts.product } as Required<Pick<RenderOpts, 'device' | 'mode'>> & { product?: RenderProduct }
  const tokens = doc.theme?.tokens || {}
  const body = (doc.sections || []).map((s) => renderSection(s, tokens, o)).join('')
  // A template-faithful doc carries the bespoke template's own CSS → append it so `raw` sections render
  // pixel-identically on the canvas and on publish.
  const css = doc.rawCss ? `${baseCss(tokens)}\n${doc.rawCss}` : baseCss(tokens)
  return { html: `<div class="sf-page">${body}</div>`, css }
}

/** Convenience: a full standalone HTML document (used by the editor iframe + as a publish fallback). */
export function renderDocHtml(doc: PageDoc, opts: RenderOpts = {}): string {
  const { html, css } = renderDoc(doc, opts)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`
}

/** Return the inner HTML of the first `.pgbld` wrapper (depth-balanced), else the html unchanged. Used to
 * peel a faithful raw slice (`<div class="pgbld">…</div>`) back to its bare template markup for publish. */
function pgbldInner(html: string): string {
  const open = /<(\w+)([^>]*\bclass=["'][^"']*\bpgbld\b[^"']*["'][^>]*)>/i.exec(html)
  if (!open) return html
  const tag = open[1].toLowerCase()
  const start = open.index + open[0].length
  let depth = 1
  const re = new RegExp(`<(/?)(${tag})\\b[^>]*?(/?)>`, 'gi')
  re.lastIndex = start
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[3] === '/') continue
    if (m[1] === '/') { if (--depth === 0) return html.slice(start, m.index) } else depth++
  }
  return html.slice(start)
}

/** Collect the raw HTML carried by a section's `raw` elements (a faithful template slice). */
function sectionRawHtml(s: Section): string {
  const out: string[] = []
  for (const b of s.blocks || []) for (const e of b.elements || []) {
    if (e.type === 'raw' && typeof (e.content as any)?.html === 'string') out.push((e.content as any).html)
  }
  return out.join('')
}

/** Render the doc for Shopify publish: body + css where each <section> becomes an editable native theme
 * section. The wrapper is renamed to `pgbld` so shopify-sections.splitPageIntoSections() splits per section
 * (matching every other builder template's publish path — canonical structure / native-theme editability). */
export function renderDocForPublish(doc: PageDoc, product?: RenderProduct): { body: string; css: string } {
  // A template-faithful doc is a set of `raw` sections, each carrying one original template slice
  // (`<div class="pgbld">…</div>`, with any inline text edits baked in). Publishing those slices wrapped in
  // the editor's own sf-section/sf-raw scaffolding gives the page an EXTRA nesting layer, and the theme's
  // section-style controls (which target `.pgbld > :first-child` / `.pgbld .wrap`) then hit those wrappers
  // instead of the real bands — collapsing the hero grid ("compressed to the left / overlapping", QA). So
  // for a faithful doc we reconstruct the template's NATIVE body (the slices concatenated back into one
  // `.pgbld`), making publish byte-identical to the direct-template path that renders correctly — while the
  // per-section split still yields independent, editable Shopify sections.
  const sections = doc.sections || []
  const visible = sections.filter((s) => !s.hidden)
  const allRaw = visible.length > 0 && visible.every((s) => s.type === 'raw' && !!sectionRawHtml(s))
  if (doc.rawCss && allRaw) {
    const inner = visible.map((s) => pgbldInner(sectionRawHtml(s)).trim()).filter(Boolean).join('\n')
    return { body: `<div class="pgbld">${inner}</div>`, css: doc.rawCss }
  }
  const { html, css } = renderDoc(doc, { mode: 'publish', device: 'base', product })
  const body = html.replace('<div class="sf-page">', '<div class="pgbld sf-page">')
  return { body, css }
}
