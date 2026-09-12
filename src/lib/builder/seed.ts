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
