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
/* button behaviours: hover text colour (--hc) + hover animation (editor Button panel) */
.pgbld [style*="--hc"]:hover{color:var(--hc)!important}
.pgbld .sf-hover-anim{transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}
.pgbld .sf-hover-anim:hover{transform:translateY(-1px);filter:brightness(1.04)}
/* default CTA hover across all templates */
.pgbld .btn,.pgbld .hgbtn,.pgbld .satcbtn,.pgbld .cta a,.pgbld a.cta{transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}
.pgbld .btn:hover,.pgbld .hgbtn:hover,.pgbld .satcbtn:hover,.pgbld .cta a:hover,.pgbld a.cta:hover{transform:translateY(-1px);filter:brightness(1.04);box-shadow:0 10px 24px -12px rgba(20,18,15,.45)}
/* Modal (Add Block → Modal): shown inline & editable in the EDITOR; publish turns it into a :target overlay (PUBLISH_UTIL_CSS) */
.pgbld .sfmodal-card{background:#fff;border:1px solid var(--sf-line,#e7e3dd);border-radius:16px;padding:24px;position:relative;max-width:460px;margin:10px 0}
.pgbld .sfmodal-close{position:absolute;top:6px;right:14px;font-size:24px;line-height:1;color:#8a8a8a;text-decoration:none}
/* payment-icon size (editor "Icons → Size" sets --payw on the .pays row) */
.pgbld .pays[style*="--payw"] .payicon svg{width:var(--payw)!important;height:auto!important}
/* gallery thumbnail + arrow controls (editor sets CSS vars on the .thumbs / .gwrap elements; the targeted
   !important only takes effect once a var is present, so it overrides the template's baked thumb size). */
.pgbld .thumbs[style*="--thw"] img,.pgbld .thumbs[style*="--thw"] .ph{width:var(--thw)!important;height:var(--thw)!important}
.pgbld .thumbs[style*="--thop"] img:not(.on){opacity:var(--thop)!important}
.pgbld .thumbs[style*="--abw"] img.on{border-width:var(--abw)!important}
.pgbld .thumbs[style*="--abc"] img.on{border-color:var(--abc)!important}
.pgbld .gwrap[style*="--goff"] .gprev{left:var(--goff)!important}
.pgbld .gwrap[style*="--goff"] .gnext{right:var(--goff)!important}
/* variant picker "Swatches" style — options render as colour circles (editor sets --sw per option) */
.pgbld .vpick.swatch .vopts{display:flex;flex-wrap:wrap;gap:10px}
.pgbld .vpick.swatch .vopt{width:34px;height:34px;min-width:0;padding:0;border-radius:50%;background:var(--sw,#d7d5d0)!important;font-size:0;line-height:0;overflow:hidden;border:1px solid rgba(0,0,0,.12)}
.pgbld .vpick.swatch .vopt.on{outline:2px solid var(--blue,#3f4bd6);outline-offset:2px}

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

// ── Gallery → Swiper.js (matches PagePilot: a real swiper carousel — swipe, pagination dots, synced
// thumbnails — on the PUBLISHED storefront). The editor keeps the static `.gwrap`/`.thumbs` markup for
// editing; at publish time we rebuild that region into Swiper markup and inject the library + init once. */
const SWIPER_CSS_URL = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css'
const SWIPER_JS_URL = 'https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js'
const swiperInitScript = `<script>(function(){function go(){if(!window.Swiper){return setTimeout(go,120)}document.querySelectorAll('.pgsw').forEach(function(g){if(g.dataset.sw)return;g.dataset.sw='1';if(g.classList.contains('pgsw-rev')){new window.Swiper(g.querySelector('.pgsw-rmain'),{slidesPerView:1.15,spaceBetween:16,breakpoints:{640:{slidesPerView:2.2},1024:{slidesPerView:3.4}},navigation:{nextEl:g.querySelector('.pgsw-next'),prevEl:g.querySelector('.pgsw-prev')},pagination:{el:g.querySelector('.swiper-pagination'),clickable:true}});return}var t=g.querySelector('.pgsw-thumbs');var th=t?new window.Swiper(t,{slidesPerView:'auto',spaceBetween:8,watchSlidesProgress:true,freeMode:true}):null;var o={spaceBetween:12,pagination:{el:g.querySelector('.swiper-pagination'),clickable:true},navigation:{nextEl:g.querySelector('.pgsw-next'),prevEl:g.querySelector('.pgsw-prev')}};if(th)o.thumbs={swiper:th};new window.Swiper(g.querySelector('.pgsw-main'),o)})}go()})();</script>`
/** Rebuild the first `.gwrap`(+`.thumbs`) gallery in a body string into Swiper markup. Defensive: if the
 * expected structure isn't found, returns the body unchanged (no breakage). */
function swiperizeGallery(body: string): string {
  const gwrapM = body.match(/<div class="gwrap">([\s\S]*?)<\/div>/)
  if (!gwrapM) return body
  const thumbM = body.match(/<div class="thumbs"[^>]*>([\s\S]*?)<\/div>/)
  const mainImg = (gwrapM[1].match(/<img[^>]*>/) || [])[0] || ''
  const thumbImgs = thumbM ? (thumbM[1].match(/<img[^>]*>/g) || []) : []
  const srcOf = (t: string) => (t.match(/src="([^"]*)"/) || [])[1] || ''
  const srcs = (thumbImgs.length ? thumbImgs : [mainImg]).map(srcOf).filter(Boolean)
  if (!srcs.length) return body
  const cls = (t: string) => (t.match(/class="([^"]*)"/) || [])[1] || ''
  const mainCls = cls(mainImg) || 'hbottle'
  const mainSlides = srcs.map((s) => `<div class="swiper-slide"><img class="${mainCls}" src="${s}" alt="" loading="lazy"></div>`).join('')
  const thumbSlides = srcs.map((s) => `<div class="swiper-slide"><img src="${s}" alt="" loading="lazy"></div>`).join('')
  const arrows = (gwrapM[1].match(/<button class="garr[^>]*>[^<]*<\/button>/g) || [])
  const prev = (arrows.find((a) => /gprev/.test(a)) || '<button class="garr gprev pgsw-prev" aria-label="Previous image">‹</button>').replace('gprev', 'gprev pgsw-prev')
  const next = (arrows.find((a) => /gnext/.test(a)) || '<button class="garr gnext pgsw-next" aria-label="Next image">›</button>').replace('gnext', 'gnext pgsw-next')
  const sw = `<div class="pgsw"><div class="swiper pgsw-main"><div class="swiper-wrapper">${mainSlides}</div>${prev}${next}<div class="swiper-pagination"></div></div><div class="swiper pgsw-thumbs thumbs"><div class="swiper-wrapper">${thumbSlides}</div></div></div>`
  let out = body.replace(gwrapM[0], sw)
  if (thumbM) out = out.replace(thumbM[0], '')
  return out
}
/** Return the index just past the `</div>` that balances the `<div` starting at `start`. -1 if unbalanced. */
function endOfBalancedDiv(s: string, start: number): number {
  const re = /<\/?div\b[^>]*>/g
  re.lastIndex = start
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m[0][1] === '/') { depth--; if (depth === 0) return re.lastIndex }
    else if (!m[0].endsWith('/>')) depth++
  }
  return -1
}
/** Rebuild the `.rcar` review carousel into Swiper markup on publish (each `.frev` card → a slide). The editor
 * keeps the static horizontal-scroll `.rcar` markup. Defensive: returns the body unchanged if not found. */
function swiperizeCarousel(body: string, containerCls: string, cardCls: string): string {
  const marker = `<div class="${containerCls}">`
  const open = body.indexOf(marker)
  if (open < 0) return body
  const end = endOfBalancedDiv(body, open)
  if (end < 0) return body
  const inner = body.slice(open + marker.length, end - '</div>'.length)
  const cards: string[] = []
  const cardOpen = `<div class="${cardCls}">`
  let k = 0
  while (k < inner.length) {
    const s = inner.indexOf(cardOpen, k)
    if (s < 0) break
    const e = endOfBalancedDiv(inner, s)
    if (e < 0) break
    cards.push(inner.slice(s, e))
    k = e
  }
  if (!cards.length) return body
  const slides = cards.map((c) => `<div class="swiper-slide">${c}</div>`).join('')
  const prev = '<button class="rarr rprev pgsw-prev" aria-label="Previous">‹</button>'
  const next = '<button class="rarr rnext pgsw-next" aria-label="Next">›</button>'
  const sw = `<div class="pgsw pgsw-rev"><div class="swiper pgsw-rmain"><div class="swiper-wrapper">${slides}</div>${prev}${next}<div class="swiper-pagination"></div></div></div>`
  return body.slice(0, open) + sw + body.slice(end)
}
// Editor utilities that the raw publish path (doc.rawCss only, no baseCss) would otherwise miss — button hover
// colour/animation, per-element responsive visibility, and payment-icon sizing — so they work on the live page too.
const PUBLISH_UTIL_CSS = `
@media(max-width:768px){.sf-hide-mob{display:none!important}}
@media(min-width:769px){.sf-hide-desk{display:none!important}}
/* Mobile PDP: product image first, then pills, then headline (applies to older pages on re-publish too). */
@media(max-width:900px){.pgbld .hcre{display:flex;flex-direction:column}.pgbld .hcre .mid{order:-1;display:flex;flex-direction:column-reverse;gap:14px;grid-template-columns:1fr}.pgbld .hcre .ppills{flex-direction:row;flex-wrap:wrap;justify-content:center}}
.pgbld [style*="--hc"]:hover{color:var(--hc)!important}
.pgbld .sf-hover-anim{transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}
.pgbld .sf-hover-anim:hover{transform:translateY(-1px);filter:brightness(1.04)}
.pgbld .btn,.pgbld .hgbtn,.pgbld .satcbtn,.pgbld .cta a,.pgbld a.cta{transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}
.pgbld .btn:hover,.pgbld .hgbtn:hover,.pgbld .satcbtn:hover,.pgbld .cta a:hover,.pgbld a.cta:hover{transform:translateY(-1px);filter:brightness(1.04);box-shadow:0 10px 24px -12px rgba(20,18,15,.45)}
.pgbld .pays[style*="--payw"] .payicon svg{width:var(--payw)!important;height:auto!important}
.pgbld .sfmodal{display:none;position:fixed;inset:0;background:rgba(20,18,15,.5);z-index:9999;align-items:center;justify-content:center;padding:20px}
.pgbld .sfmodal:target{display:flex}
.pgbld .sfmodal-card{background:#fff;border-radius:16px;max-width:460px;width:100%;padding:28px 24px;position:relative;box-shadow:0 24px 70px -20px rgba(0,0,0,.5)}
.pgbld .sfmodal-close{position:absolute;top:8px;right:14px;font-size:26px;line-height:1;color:#8a8a8a;text-decoration:none}
`
// Wires button "Actions" (data-sfaction) on the published page: scroll, add-to-cart, checkout, do-nothing.
const sfActionScript = `<script>(function(){document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-sfaction]');if(!a)return;var k=a.getAttribute('data-sfaction');if(k==='nothing'){e.preventDefault();return}if(k==='scroll-top'){e.preventDefault();window.scrollTo({top:0,behavior:'smooth'})}else if(k==='scroll-el'){e.preventDefault();var t=document.querySelector('.buybox,.vpick,.hero');if(t)t.scrollIntoView({behavior:'smooth',block:'center'})}else if(k==='checkout'){e.preventDefault();window.location.href='/checkout'}else if(k==='add-cart'){e.preventDefault();var b=document.querySelector('form[action*="/cart/add"] [type=submit],form[action*="/cart/add"] button,[name=add],.buybox button');if(b){b.click()}else{window.location.href='/cart'}}});})();</script>`
const withActionScript = (body: string): string => body.includes('data-sfaction') ? `${body}${sfActionScript}` : body
/** Turn the review + recommended-product carousels into Swiper markup on publish (editor keeps static scroll). */
function swiperizeReviews(body: string): string {
  let out = swiperizeCarousel(body, 'rcar', 'frev')
  out = swiperizeCarousel(out, 'reccar', 'reccard')
  return out
}
/** Wrap a published body with the Swiper library + init, only when it actually contains a swiperized carousel. */
function withSwiperAssets(body: string): string {
  if (!body.includes('class="pgsw')) return body
  return `<link rel="stylesheet" href="${SWIPER_CSS_URL}"><script src="${SWIPER_JS_URL}"></script>${body}${swiperInitScript}`
}
// Layout CSS for the swiperized gallery (appended to the published css, since publish uses doc.rawCss not baseCss).
const GALLERY_SW_CSS = `
.pgbld .pgsw{position:relative}
.pgbld .pgsw-main{border-radius:12px;overflow:hidden;margin-bottom:12px}
.pgbld .pgsw-main .swiper-slide img{display:block;width:100%;aspect-ratio:4/5;object-fit:contain;background:var(--soft,#f3f4fb)}
.pgbld .pgsw-thumbs .swiper-wrapper{align-items:center}
.pgbld .pgsw-thumbs .swiper-slide{width:56px!important;height:auto}
.pgbld .pgsw-thumbs .swiper-slide img{display:block;width:56px;height:56px;object-fit:cover;border-radius:9px;border:1px solid var(--line,#e4e4ef);cursor:pointer;opacity:.6;transition:opacity .15s,border-color .15s}
.pgbld .pgsw-thumbs .swiper-slide-thumb-active img{opacity:1;border-color:var(--blue,#3f4bd6);border-width:2px}
.pgbld .pgsw .swiper-pagination{position:static;margin-top:8px}
.pgbld .pgsw .swiper-pagination-bullet-active{background:var(--blue,#3f4bd6)}
.pgbld .pgsw-main .garr{position:absolute;top:50%;transform:translateY(-50%);z-index:3}
.pgbld .pgsw-main .gprev{left:8px}.pgbld .pgsw-main .gnext{right:8px}
.pgbld .pgsw-main .swiper-button-disabled{opacity:.35;cursor:default}
`
// Layout CSS for the swiperized reviews carousel (appended on publish, since publish uses doc.rawCss not baseCss).
const REVIEWS_SW_CSS = `
.pgbld .pgsw-rev{position:relative;padding:0 4px}
.pgbld .pgsw-rev .swiper-slide{height:auto;display:flex}
.pgbld .pgsw-rev .swiper-slide>.frev{flex:1 1 auto;max-width:none}
.pgbld .pgsw-rev .rarr{position:absolute;top:44%;transform:translateY(-50%);z-index:3;width:34px;height:34px;border-radius:50%;background:#fff;border:1px solid var(--line,#e1e4f6);display:grid;place-items:center;font-size:18px;line-height:1;color:var(--ink,#191b3a);cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.12);padding:0}
.pgbld .pgsw-rev .rprev{left:-6px}.pgbld .pgsw-rev .rnext{right:-6px}
.pgbld .pgsw-rev .swiper-button-disabled{opacity:.35;cursor:default}
.pgbld .pgsw-rev .swiper-pagination{position:static;margin-top:12px}
.pgbld .pgsw-rev .swiper-pagination-bullet-active{background:var(--blue,#3f4bd6)}
`
const withSwiperCss = (css: string, body: string): string => {
  if (!body.includes('class="pgsw')) return css
  let out = css
  if (body.includes('class="pgsw"') || body.includes('pgsw-main')) out += `\n${GALLERY_SW_CSS}`
  if (body.includes('pgsw-rev')) out += `\n${REVIEWS_SW_CSS}`
  return out
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
    const body = withActionScript(withSwiperAssets(swiperizeReviews(swiperizeGallery(`<div class="pgbld">${inner}</div>`))))
    return { body, css: withSwiperCss(doc.rawCss, body) + PUBLISH_UTIL_CSS }
  }
  const { html, css } = renderDoc(doc, { mode: 'publish', device: 'base', product })
  const body = withActionScript(withSwiperAssets(swiperizeReviews(swiperizeGallery(html.replace('<div class="sf-page">', '<div class="pgbld sf-page">')))))
  return { body, css: withSwiperCss(css, body) }
}
