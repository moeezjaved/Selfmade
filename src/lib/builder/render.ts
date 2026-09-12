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

function renderSection(s: Section, tokens: DesignTokens, o: Required<Pick<RenderOpts, 'device' | 'mode'>> & { product?: RenderProduct }): string {
  if (s.hidden) return ''
  const css = compileStyle(s.style, tokens, o.device)
  const styleAttr = css ? ` style="${attr(css)}"` : ''
  const idAttr = o.mode === 'edit' ? ` data-node-id="${attr(s.id)}" data-node-type="section:${attr(s.type)}"` : ''
  const inner = s.blocks.map((b) => renderBlock(b, tokens, o)).join('')
  return `<section class="sf-section sf-section-${attr(s.type)}"${styleAttr}${idAttr}><div class="sf-section-inner">${inner}</div></section>`
}

/** Base CSS shared by every rendered page (the design-token vars come from the theme). */
function baseCss(tokens: DesignTokens): string {
  const vars = Object.entries(tokens).map(([k, v]) => `--sf-${k.toLowerCase()}:${v}`).join(';')
  return `
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
`.trim()
}

/** Render the whole document. Returns the page HTML and the compiled CSS (caller decides how to inline). */
export function renderDoc(doc: PageDoc, opts: RenderOpts = {}): { html: string; css: string } {
  const o = { device: opts.device || 'base', mode: opts.mode || 'publish', product: opts.product } as Required<Pick<RenderOpts, 'device' | 'mode'>> & { product?: RenderProduct }
  const tokens = doc.theme?.tokens || {}
  const body = (doc.sections || []).map((s) => renderSection(s, tokens, o)).join('')
  return { html: `<div class="sf-page">${body}</div>`, css: baseCss(tokens) }
}

/** Convenience: a full standalone HTML document (used by the editor iframe + as a publish fallback). */
export function renderDocHtml(doc: PageDoc, opts: RenderOpts = {}): string {
  const { html, css } = renderDoc(doc, opts)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}</body></html>`
}
