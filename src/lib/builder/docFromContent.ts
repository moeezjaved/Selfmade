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

/* tiny node factories (local so this file doesn't depend on seed's private ones) */
const el = (type: Element['type'], content: Element['content'], style: Element['style'] = {}): Element => ({ id: nodeId('e'), type, content, style })
const block = (type: Block['type'], elements: Element[], style: Block['style'] = {}): Block => ({ id: nodeId('b'), type, elements, style })
const section = (type: Section['type'], blocks: Block[], style: Section['style'] = {}): Section => ({ id: nodeId('s'), type, blocks, style })

const str = (v: SlotValue | undefined): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const plain = (v: SlotValue | undefined): string => str(v).replace(/\*\*(.+?)\*\*/g, '$1').trim() // drop **bold** markup
const arr = (v: SlotValue | undefined): Array<Record<string, string>> => (Array.isArray(v) ? (v as Array<Record<string, string>>) : [])
const isHeadKey = (k: string, role?: string) => role === 'headline' || /head|title|heading/i.test(k)

const heading = (text: string, style: Element['style'] = {}) => el('heading', { text }, { fontSize: '22px', fontWeight: 800, ...style })
const body = (text: string, style: Element['style'] = {}) => el('text', { text }, { color: 'Sub', ...style })

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

  // ── remaining slots in schema order → one section per array slot, scalars grouped into text sections ──
  let textRun: Block[] = []
  const flushText = () => { if (textRun.length) { doc.sections.push(section('imageText', textRun, { paddingY: '32px', direction: 'column', gap: '16px' })); textRun = [] } }
  const galleryImgs: Element[] = []
  const videos: Element[] = []

  // Iterate the schema in order, then sweep any content keys the schema didn't declare (schema/content
  // drift, or a template that under-declares) so no real copy is ever silently dropped.
  const extraSlots = inferSchema(Object.fromEntries(Object.entries(c).filter(([k]) => !schema.some((s) => s.key === k))))
  for (const slot of [...schema, ...extraSlots]) {
    if (used.has(slot.key)) continue
    const v = c[slot.key]
    if (v == null || (typeof v === 'string' && !v.trim())) { used.add(slot.key); continue }
    used.add(slot.key)
    switch (slot.type) {
      case 'reasons': {
        flushText()
        const blocks = arr(v).map((it, i) => { addImg(it.image); return block('benefitList', [
          el('badge', { text: it.label || `#${i + 1}` }, { background: 'Primary', color: '#fff', paddingX: '10px', paddingY: '4px', radius: '999px', fontSize: '12px', fontWeight: 800 }),
          heading(plain(it.title) || `Reason ${i + 1}`, { fontSize: '18px' }),
          ...(it.body ? [body(plain(it.body), { fontSize: '14px' })] : []),
          ...(it.image ? [el('image', { src: it.image, alt: '' }, { radius: '12px', width: '100%' })] : []),
        ], { direction: 'column', gap: '8px', width: '46%' }) })
        doc.sections.push(withHead(slot, section('imageBenefits', blocks, { paddingY: '40px' })))
        break
      }
      case 'testimonials': {
        flushText()
        const blocks = arr(v).map((it) => block('reviewCard', [
          el('stars', { stars: 5 }),
          body(`“${plain(it.quote)}”`, { fontSize: '15px', color: 'Ink' }),
          heading([it.name, it.city].filter(Boolean).join(' · ') || 'Customer', { fontSize: '14px' }),
        ], { direction: 'column', gap: '10px', width: '300px', paddingX: '18px', paddingY: '18px', background: 'Paper', radius: '14px' }))
        doc.sections.push(withHead(slot, section('reviewsCarousel', blocks, { paddingY: '40px' })))
        break
      }
      case 'timeline': {
        flushText()
        const blocks = arr(v).map((it) => block('timelineStep', [
          el('badge', { text: it.label || 'Step' }, { background: 'Primary', color: '#fff', paddingX: '10px', paddingY: '4px', radius: '999px', fontSize: '12px', fontWeight: 800 }),
          ...(it.body ? [body(plain(it.body), { fontSize: '14px' })] : []),
          ...(it.thumb ? [el('image', { src: it.thumb, alt: '' }, { radius: '10px', width: '120px' })] : []),
        ], { direction: 'column', gap: '8px', width: '100%' }))
        doc.sections.push(withHead(slot, section('imageTimeline', blocks, { paddingY: '40px' })))
        break
      }
      case 'list': case 'costs': {
        flushText()
        const items = arr(v)
        const shortLabels = items.every((it) => it.label && !it.body) // pill-style label-only list
        if (shortLabels) {
          doc.sections.push(withHead(slot, section('asSeenOn', [block('logoStrip', items.map((it) => el('badge', { text: it.label || '' }, { background: 'Paper', color: 'Ink', paddingX: '12px', paddingY: '6px', radius: '999px', fontSize: '13px', fontWeight: 700 })), { direction: 'row', gap: '10px', align: 'center', width: '100%' })], { paddingY: '24px' })))
        } else {
          const blocks = items.map((it) => block('benefitList', [
            ...(it.label ? [heading(plain(it.label), { fontSize: '16px' })] : []),
            ...(it.body ? [body(plain(it.body), { fontSize: '14px' })] : []),
          ], { direction: 'column', gap: '6px', width: '46%' }))
          doc.sections.push(withHead(slot, section('imageBenefits', blocks, { paddingY: '36px' })))
        }
        break
      }
      case 'faq': {
        flushText()
        const blocks = arr(v).map((it) => block('text', [heading(str(it.q), { fontSize: '17px' }), ...(it.a ? [body(plain(it.a), { fontSize: '14px' })] : [])], { direction: 'column', gap: '6px', width: '100%' }))
        doc.sections.push(withHead(slot, section('imageText', blocks, { paddingY: '32px', direction: 'column', gap: '14px' })))
        break
      }
      case 'image': addImg(str(v)); galleryImgs.push(el('image', { src: str(v), alt: slot.label || '' }, { radius: '12px', width: '31%' })); break
      case 'video': videos.push(el('video', { src: str(v) }, { radius: '12px', width: '31%' })); break
      case 'number': break // skip bare numbers (countdown handled elsewhere)
      case 'text': case 'richtext': default: {
        const t = plain(v)
        if (t) textRun.push(block('text', [isHeadKey(slot.key, slot.role) ? heading(t, { fontSize: '20px' }) : body(t, { color: 'Ink', fontSize: '15px' })], { direction: 'column', width: '100%' }))
        break
      }
    }
  }
  flushText()
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

/** Prefix an array section with a heading block if the schema slot has a human label worth showing. */
function withHead(slot: SlotDef, s: Section): Section {
  const title = (slot.label || '').trim()
  if (!title || /image|logo|video/i.test(title)) return s
  const head = block('text', [heading(title, { fontSize: '26px', letterSpacing: 'tight', textAlign: 'center' })], { width: '100%', align: 'center' })
  return { ...s, blocks: [head, ...s.blocks] }
}

/** Fallback when a page has content but no known template — infer minimal slots from the content keys. */
function inferSchema(content: FilledContent): SlotDef[] {
  return Object.entries(content || {}).map(([key, v]): SlotDef => ({
    key, label: key.replace(/_/g, ' '),
    type: Array.isArray(v) ? 'list' : typeof v === 'number' ? 'number' : 'text',
  }))
}

export type { ProductBind }
