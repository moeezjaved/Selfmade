/**
 * Advanced Page Builder — starter PageDoc factories (Phase 1). Produces a valid, renderable document so an
 * existing/new page can open in the structured model and save. Real per-section defaults + the AI→schema
 * generator land in later phases; this is enough to prove the model + runtime end-to-end.
 */
import { nodeId, type PageDoc, type Section, type Block, type Element, type DesignTokens, type FontSet } from './schema'

const DEFAULT_TOKENS: DesignTokens = {
  Primary: '#e02f06', Secondary: '#1b1a17', Ink: '#141d15', Sub: '#6b6a58', Paper: '#fbfaf8', Line: '#e7e3dd',
}
const DEFAULT_FONTS: FontSet = { heading: 'Inter', body: 'Inter' }

const el = (type: Element['type'], content: Element['content'], style: Element['style'] = {}): Element => ({ id: nodeId('e'), type, content, style })
const block = (type: Block['type'], elements: Element[], style: Block['style'] = {}): Block => ({ id: nodeId('b'), type, elements, style })
const section = (type: Section['type'], blocks: Block[], style: Section['style'] = {}): Section => ({ id: nodeId('s'), type, blocks, style })

// ── factories for the editor's Add menus (Phase 2). A minimal, valid default per type so inserting a
// node always renders. The full per-section defaults + block palettes land in Phase 4's section library. ──

export function newElement(type: Element['type']): Element {
  switch (type) {
    case 'heading': return el('heading', { text: 'Heading' }, { fontSize: '26px', fontWeight: 800 })
    case 'text': return el('text', { text: 'Add your text here.' }, { color: 'Sub' })
    case 'image': return el('image', { src: '', alt: '' }, { radius: '12px', width: '100%' })
    case 'video': return el('video', { src: '' }, { radius: '12px', width: '100%' })
    case 'button': return el('button', { text: 'Buy now', href: '#' }, { background: 'Primary', color: '#fff', paddingX: '24px', paddingY: '13px', radius: '999px', fontWeight: 800 })
    case 'badge': return el('badge', { text: 'New' }, { background: 'Primary', color: '#fff', paddingX: '10px', paddingY: '4px', radius: '999px', fontSize: '12px', fontWeight: 700 })
    case 'stars': return el('stars', { stars: 5 })
    case 'price': return el('price', { text: '$0.00' }, { fontSize: '20px', fontWeight: 800, color: 'Primary' })
    case 'divider': return el('divider', {}, { marginY: '16px' })
    case 'icon': return el('icon', { text: '★' })
    case 'countdown': return el('countdown', { text: 'Ends soon', until: '' })
    default: return el('text', { text: 'Add your text here.' })
  }
}

const LABELS_BLOCK: Partial<Record<Block['type'], string>> = { text: 'Text', media: 'Media', group: 'Group', gallery: 'Gallery', productDetails: 'Product details' }
export function newBlock(type: Block['type']): Block {
  switch (type) {
    case 'media': return block('media', [newElement('image')], { width: '100%' })
    case 'gallery': return block('gallery', [el('image', { bind: 'product.image', alt: 'Product' }, { radius: '14px', width: '100%' })], { width: '48%' })
    case 'productDetails': return block('productDetails', [newElement('heading'), newElement('price'), newElement('text'), newElement('button')], { gap: '12px', direction: 'column', width: '48%' })
    default: return block('text', [newElement('heading'), newElement('text')], { gap: '10px', direction: 'column' })
  }
}
export const BLOCK_LABEL = (t: Block['type']) => LABELS_BLOCK[t] || t

const LABELS_SECTION: Partial<Record<Section['type'], string>> = {
  productInfo: 'Product Information', imageText: 'Image with Text', imageBenefits: 'Image with Benefits',
  imageTimeline: 'Image with Timeline', imagePercentage: 'Image with Percentage', productDifferences: 'Product Differences',
  asSeenOn: 'As Seen On', reviewsCarousel: 'Reviews Carousel', recommendedProducts: 'Recommended Products',
  stickyAtc: 'Sticky Add to Cart', shapeDivider: 'Shape Divider',
}
export const SECTION_LABEL = (t: Section['type']) => LABELS_SECTION[t] || t

/** A new section of the given type with a sensible starter block set (Phase 2 minimal; Phase 4 enriches). */
export function newSection(type: Section['type']): Section {
  const base = (blocks: Block[], style: Section['style']): Section => section(type, blocks, style)
  switch (type) {
    case 'productInfo':
      return starterProductDoc().sections[0]!
    case 'imageText':
      return base([newBlock('media'), newBlock('text')], { paddingY: '32px', direction: 'row', gap: '32px', align: 'start' })
    case 'shapeDivider':
      return base([block('media', [el('divider', {}, { marginY: '0' })], {})], { paddingY: '0' })
    default:
      return base([newBlock('text')], { paddingY: '32px' })
  }
}

export function emptyDoc(productRef: PageDoc['productRef'] = {}, paletteId = 'greens'): PageDoc {
  return {
    id: nodeId('doc'),
    version: 1,
    productRef,
    theme: { paletteId, fonts: DEFAULT_FONTS, tokens: DEFAULT_TOKENS },
    settings: { locale: 'en' },
    sections: [],
  }
}

/** A minimal but real product page: gallery + details (title, rating, price, benefits, CTA). Product-bound
 * elements read from the live product at render time. */
export function starterProductDoc(productRef: PageDoc['productRef'] = {}, paletteId = 'greens'): PageDoc {
  const doc = emptyDoc(productRef, paletteId)
  doc.sections = [
    section('productInfo', [
      block('gallery', [
        el('image', { bind: 'product.image', alt: 'Product' }, { radius: '14px', width: '100%' }),
      ], { width: '48%' }),
      block('productDetails', [
        el('stars', { bind: 'product.rating' }),
        el('text', { bind: 'product.reviewCount' }, { color: 'Sub', fontSize: '13px' }),
        el('heading', { bind: 'product.title' }, { fontSize: '30px', fontWeight: 800, letterSpacing: 'tight' }),
        el('price', { bind: 'product.price' }, { fontSize: '20px', fontWeight: 800, color: 'Primary' }),
        el('text', { bind: 'product.description' }, { color: 'Sub', marginY: '10px' }),
        el('button', { text: 'Add to cart', href: '#' }, { background: 'Primary', color: '#fff', paddingX: '24px', paddingY: '13px', radius: '999px', fontWeight: 800 }),
      ], { gap: '12px', direction: 'column', width: '48%' }),
    ], { paddingY: '32px', direction: 'row', gap: '32px', align: 'start' }),
  ]
  return doc
}
