/**
 * Advanced Page Builder — generic Template → PageDoc adapter (makes the editor work for EVERY page).
 *
 * The editor edits a PageDoc; existing/generated pages store their copy as `content` (filled template
 * slots). This converts ANY template's `schema` + a page's `content` into a PageDoc, driven entirely by
 * the slot TYPES/ROLES — no per-template code. So every current template (advertorial/listicle/product/
 * home) and every future one (20–30 more) opens in the editor with its real content, just by declaring a
 * `schema` like they already do. The mapping favours faithful, fully-editable content over pixel-matching
 * each template's bespoke layout (that fidelity is the AI→schema path in Phase 5).
 */
import { nodeId, type PageDoc, type Section, type Block, type Element, type ProductBind } from './schema'
import type { PageTemplate, SlotDef, FilledContent, SlotValue, RenderOpts } from './types'
import { emptyDoc } from './seed'
import { bodyHtml } from './assemble'
import { paletteOverrideCss } from './palettes'
import { splitPageIntoSections } from './shopify-sections'

/* tiny node factories (local so this file doesn't depend on seed's private ones) */
const el = (type: Element['type'], content: Element['content'], style: Element['style'] = {}): Element => ({ id: nodeId('e'), type, content, style })
const block = (type: Block['type'], elements: Element[], style: Block['style'] = {}): Block => ({ id: nodeId('b'), type, elements, style })
const section = (type: Section['type'], blocks: Block[], style: Section['style'] = {}, name?: string): Section => ({ id: nodeId('s'), type, blocks, style, ...(name ? { name } : {}) })

const str = (v: SlotValue | undefined): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const plain = (v: SlotValue | undefined): string => str(v).replace(/\*\*(.+?)\*\*/g, '$1').trim() // drop **bold** markup
const arr = (v: SlotValue | undefined): Array<Record<string, string>> => (Array.isArray(v) ? (v as Array<Record<string, string>>) : [])
const isHeadKey = (k: string, role?: string) => role === 'headline' || /head|title|heading/i.test(k)

const heading = (text: string, style: Element['style'] = {}) => el('heading', { text }, { fontSize: '22px', fontWeight: 800, ...style })
const body = (text: string, style: Element['style'] = {}) => el('text', { text }, { color: 'Sub', ...style })

/**
 * Template-FAITHFUL doc: seed the editor from the template's REAL rendered HTML so the canvas and publish
 * keep the bespoke design pixel-for-pixel. Each of the template's visual sections becomes one `raw` doc
 * section (verbatim HTML) — still reorderable / hideable / deletable / duplicable, and its text stays
 * inline-editable. The template's own CSS travels on `doc.rawCss`. Preferred for any template that has a
 * `render` + `css`; falls back to the generic block adapter (pageDocFromContent) otherwise.
 */
export function pageDocFromTemplate(
  template: PageTemplate,
  content: FilledContent,
  renderOpts?: Partial<RenderOpts>,
  productRef: PageDoc['productRef'] = {},
  paletteId = 'greens',
  editedHtml?: string | null,
): PageDoc {
  const palette = renderOpts?.paletteId || paletteId
  const doc = emptyDoc(productRef, palette)
  const opts: RenderOpts = {
    productName: renderOpts?.productName || 'Product',
    productImage: renderOpts?.productImage || '',
    priceLabel: renderOpts?.priceLabel || '',
    ctaHref: renderOpts?.ctaHref || '#',
    rating: renderOpts?.rating,
    paletteId: palette,
  }
  const body = bodyHtml(template, content || {}, opts, editedHtml)
  const parts = splitPageIntoSections(body)
  doc.sections = parts.map((p) => section('raw', [block('group', [el('raw', { html: p.html }, {})], { width: '100%' })], { paddingY: '0' }, p.name))
  // Carry the template CSS (+ chosen palette) so raw sections render faithfully on canvas and publish.
  doc.rawCss = `${template.css}\n${paletteOverrideCss(palette) || ''}`.trim()

  // Expose every image URL in the content (+ product photo) so the editor's image control can "pick from product".
  const imgs: string[] = []
  const push = (u?: string) => { const s = (u || '').trim(); if (/^https?:\/\//.test(s) && !imgs.includes(s)) imgs.push(s) }
  push(renderOpts?.productImage)
  for (const v of Object.values(content || {})) {
    if (typeof v === 'string') push(v)
    else if (Array.isArray(v)) for (const it of v) { if (it && typeof it === 'object') { push((it as any).image); push((it as any).thumb) } }
  }
  doc.productRef = {
    ...doc.productRef,
    importedProduct: {
      ...(doc.productRef.importedProduct || {}),
      image: renderOpts?.productImage || doc.productRef.importedProduct?.image || null,
      images: imgs,
      ...(renderOpts?.productName ? { title: renderOpts.productName } : {}),
      ...(renderOpts?.priceLabel ? { price: renderOpts.priceLabel } : {}),
    },
  }
  return doc
}

/** Build a PageDoc from a template's schema + a page's filled content. Generic across all templates. */
export function pageDocFromContent(
  template: PageTemplate | undefined,
  content: FilledContent,
  renderOpts?: Partial<RenderOpts>,
  productRef: PageDoc['productRef'] = {},
  paletteId = 'greens',
): PageDoc {
  const doc = emptyDoc(productRef, renderOpts?.paletteId || paletteId)
  const schema = template?.schema || inferSchema(content)
  const c = content || {}
  const used = new Set<string>()
  const productImages: string[] = []                       // every image URL on the page → the "From product" picker
  const addImg = (u?: string) => { const s = (u || '').trim(); if (s && !productImages.includes(s)) productImages.push(s) }
  const val = (k: string) => { used.add(k); return c[k] }
  const firstKey = (pred: (s: SlotDef) => boolean) => schema.find(pred)?.key

  // ── hero / product section ── the lead: main image + headline + subhead + price + rating + CTA
  const headKey = firstKey((s) => (s.type === 'text' || s.type === 'richtext') && (s.role === 'headline' || s.key === 'headline'))
  const imgKey = firstKey((s) => s.type === 'image' && (s.role === 'product' || /main|hero/i.test(s.key))) || firstKey((s) => s.type === 'image')
  const subKey = firstKey((s) => (s.type === 'text' || s.type === 'richtext') && /new_line|subhead|summary|promise|sub$/i.test(s.key))
  const ctaKey = firstKey((s) => s.type === 'text' && /cta|button|buy|add_to_cart/i.test(s.key))
  const compareKey = firstKey((s) => s.type === 'text' && /compare/i.test(s.key))
  const saveKey = firstKey((s) => s.type === 'text' && /save/i.test(s.key))

  const headline = headKey ? plain(val(headKey)) : (renderOpts?.productName || '')
  const heroImg = imgKey ? str(val(imgKey)) : ''
  addImg(heroImg); addImg(renderOpts?.productImage)
  const price = renderOpts?.priceLabel || ''
  const detailEls: Element[] = []
  if (renderOpts?.rating?.stars) detailEls.push(el('stars', { stars: renderOpts.rating.stars }))
  if (renderOpts?.rating?.countLabel) detailEls.push(body(renderOpts.rating.countLabel, { fontSize: '13px' }))
  if (headline) detailEls.push(heading(headline, { fontSize: '30px', letterSpacing: 'tight' }))
  if (subKey) { const s = plain(val(subKey)); if (s) detailEls.push(body(s, { color: 'Ink', fontSize: '15px' })) }
  const priceText = price || (compareKey ? str(val(compareKey)) : '')
  if (priceText) detailEls.push(el('price', { text: priceText }, { fontSize: '20px', fontWeight: 800, color: 'Primary' }))
  else if (saveKey) { const s = str(val(saveKey)); if (s) detailEls.push(el('badge', { text: s }, { background: 'Primary', color: '#fff', paddingX: '10px', paddingY: '4px', radius: '999px', fontWeight: 700 })) }
  detailEls.push(el('button', { text: (ctaKey && str(val(ctaKey))) || 'Shop now', href: renderOpts?.ctaHref || '#' }, { background: 'Primary', color: '#fff', paddingX: '24px', paddingY: '13px', radius: '999px', fontWeight: 800 }))

  const heroBlocks: Block[] = []
  if (heroImg) heroBlocks.push(block('gallery', [el('image', { src: heroImg, alt: headline || 'Product' }, { radius: '14px', width: '100%' })], { width: '48%' }))
  heroBlocks.push(block('productDetails', detailEls, { gap: '12px', direction: 'column', width: heroImg ? '48%' : '100%' }))
  doc.sections.push(section('productInfo', heroBlocks, { paddingY: '32px', direction: 'row', gap: '32px', align: 'start' }))

  // ── remaining slots → grouped into visual sections ──────────────────────────────────────────────
  // A new section opens at each heading slot; the content that follows (lists, reviews, paragraphs, …)
  // accumulates into it until the next heading. This mirrors how the page actually reads AND keeps the
  // published Shopify section count ≈ the template's real sections. (Before: one section per array slot,
  // so a dense template blew past Shopify's 25-section limit and couldn't publish after editing.)
  const galleryImgs: Element[] = []
  const videos: Element[] = []

  // One slot's value → the block(s) that represent it. Layout comes from the section type + block classes.
  const contentBlocks = (slot: SlotDef, v: SlotValue): Block[] => {
    switch (slot.type) {
      case 'reasons': return arr(v).map((it, i) => { addImg(it.image); return block('benefitList', [
        el('badge', { text: it.label || `#${i + 1}` }, { background: 'Primary', color: '#fff', paddingX: '10px', paddingY: '4px', radius: '999px', fontSize: '12px', fontWeight: 800 }),
        heading(plain(it.title) || `Reason ${i + 1}`, { fontSize: '18px' }),
        ...(it.body ? [body(plain(it.body), { fontSize: '14px' })] : []),
        ...(it.image ? [el('image', { src: it.image, alt: '' }, { radius: '12px', width: '100%' })] : []),
      ], { direction: 'column', gap: '8px', width: '46%' }) })
      case 'testimonials': return arr(v).map((it) => block('reviewCard', [
        el('stars', { stars: 5 }),
        body(`“${plain(it.quote)}”`, { fontSize: '15px', color: 'Ink' }),
        heading([it.name, it.city].filter(Boolean).join(' · ') || 'Customer', { fontSize: '14px' }),
      ], { direction: 'column', gap: '10px', width: '300px', paddingX: '18px', paddingY: '18px', background: 'Paper', radius: '14px' }))
      case 'timeline': return arr(v).map((it) => block('timelineStep', [
        el('badge', { text: it.label || 'Step' }, { background: 'Primary', color: '#fff', paddingX: '10px', paddingY: '4px', radius: '999px', fontSize: '12px', fontWeight: 800 }),
        ...(it.body ? [body(plain(it.body), { fontSize: '14px' })] : []),
        ...(it.thumb ? [el('image', { src: it.thumb, alt: '' }, { radius: '10px', width: '120px' })] : []),
      ], { direction: 'column', gap: '8px', width: '100%' }))
      case 'list': case 'costs': {
        const items = arr(v)
        if (items.length && items.every((it) => it.label && !it.body)) return [block('logoStrip', items.map((it) => el('badge', { text: it.label || '' }, { background: 'Paper', color: 'Ink', paddingX: '12px', paddingY: '6px', radius: '999px', fontSize: '13px', fontWeight: 700 })), { direction: 'row', gap: '10px', align: 'center', width: '100%' })]
        return items.map((it) => block('benefitList', [
          ...(it.label ? [heading(plain(it.label), { fontSize: '16px' })] : []),
          ...(it.body ? [body(plain(it.body), { fontSize: '14px' })] : []),
        ], { direction: 'column', gap: '6px', width: '46%' }))
      }
      case 'faq': return arr(v).map((it) => block('text', [heading(str(it.q), { fontSize: '17px' }), ...(it.a ? [body(plain(it.a), { fontSize: '14px' })] : [])], { direction: 'column', gap: '6px', width: '100%' }))
      case 'text': case 'richtext': default: { const t = plain(v); return t ? [block('text', [body(t, { color: 'Ink', fontSize: '15px' })], { direction: 'column', width: '100%' })] : [] }
    }
  }
  // Section type → layout: a group led by cards wraps them in a centered row; text-only stays a column.
  const typeFor = (slot: SlotDef): Section['type'] =>
    slot.type === 'testimonials' ? 'reviewsCarousel'
    : slot.type === 'timeline' ? 'imageTimeline'
    : (slot.type === 'reasons' || slot.type === 'list' || slot.type === 'costs') ? 'imageBenefits'
    : 'imageText'

  let curBlocks: Block[] | null = null
  let curType: Section['type'] = 'imageText'
  let curName: string | undefined                 // section title (from its heading) → readable tree + Shopify
  let curHasBody = false                           // did a non-heading content group land in this section yet?
  const flushCur = () => { if (curBlocks && curBlocks.length) doc.sections.push(section(curType, curBlocks, { paddingY: '40px', direction: 'column', gap: '18px' }, curName)); curBlocks = null; curType = 'imageText'; curName = undefined; curHasBody = false }
  // Array-shaped content (a benefits list, reviews, a comparison, …) — each such group should be its OWN
  // clean section, not piled together, so the editor reads like PagePilot (one coherent block group per
  // section) instead of one 20+-block dumping ground.
  const isGroupSlot = (t: SlotDef['type']) => t === 'reasons' || t === 'testimonials' || t === 'timeline' || t === 'list' || t === 'costs' || t === 'faq'

  // Iterate the schema in order, then sweep any content keys the schema didn't declare so no copy is dropped.
  const extraSlots = inferSchema(Object.fromEntries(Object.entries(c).filter(([k]) => !schema.some((s) => s.key === k))))
  for (const slot of [...schema, ...extraSlots]) {
    if (used.has(slot.key)) continue
    const v = c[slot.key]
    if (v == null || (typeof v === 'string' && !v.trim())) { used.add(slot.key); continue }
    used.add(slot.key)
    if (slot.type === 'image') { addImg(str(v)); galleryImgs.push(el('image', { src: str(v), alt: slot.label || '' }, { radius: '12px', width: '31%' })); continue }
    if (slot.type === 'video') { videos.push(el('video', { src: str(v) }, { radius: '12px', width: '31%' })); continue }
    if (slot.type === 'number') continue // skip bare numbers (countdown handled elsewhere)
    // A heading slot opens a new section — its text becomes the section title.
    if ((slot.type === 'text' || slot.type === 'richtext') && isHeadKey(slot.key, slot.role)) {
      flushCur()
      curBlocks = []
      const t = plain(v)
      curName = t || undefined
      if (t) curBlocks.push(block('text', [heading(t, { fontSize: '26px', letterSpacing: 'tight', textAlign: 'center' })], { width: '100%', align: 'center' }))
      continue
    }
    const blocks = contentBlocks(slot, v)
    if (!blocks.length) continue
    // Start a fresh section when a NEW group would otherwise pile onto a section that already holds a group
    // (keeps each list/reviews/comparison as its own tidy section).
    if (isGroupSlot(slot.type) && curHasBody) flushCur()
    if (!curBlocks) curBlocks = []
    if (curType === 'imageText') curType = typeFor(slot)
    curBlocks.push(...blocks)
    // Only a GROUP (list/reviews/…) marks the section as "already holds a group" — a plain subhead does
    // not, so a heading + subhead + its first list stay together; a SECOND group opens a fresh section.
    if (isGroupSlot(slot.type)) curHasBody = true
  }
  flushCur()
  if (galleryImgs.length) doc.sections.push(section('recommendedProducts', [block('media', galleryImgs, { direction: 'row', gap: '14px', width: '100%' })], { paddingY: '32px' }))
  if (videos.length) doc.sections.push(section('reviewsCarousel', [block('media', videos, { direction: 'row', gap: '14px', width: '100%' })], { paddingY: '32px' }))

  // Expose the page's images (+ known product fields) so the editor's image control can "pick from product".
  doc.productRef = {
    ...doc.productRef,
    importedProduct: {
      ...(doc.productRef.importedProduct || {}),
      image: heroImg || renderOpts?.productImage || doc.productRef.importedProduct?.image || null,
      images: productImages,
      ...(renderOpts?.productName ? { title: renderOpts.productName } : {}),
      ...(renderOpts?.priceLabel ? { price: renderOpts.priceLabel } : {}),
    },
  }

  return doc
}

/** Fallback when a page has content but no known template — infer minimal slots from the content keys. */
function inferSchema(content: FilledContent): SlotDef[] {
  return Object.entries(content || {}).map(([key, v]): SlotDef => ({
    key, label: key.replace(/_/g, ' '),
    type: Array.isArray(v) ? 'list' : typeof v === 'number' ? 'number' : 'text',
  }))
}

export type { ProductBind }
