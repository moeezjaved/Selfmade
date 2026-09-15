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

const LABELS_BLOCK: Partial<Record<Block['type'], string>> = {
  text: 'Text', media: 'Media', group: 'Group', gallery: 'Gallery', productDetails: 'Product details',
  atc: 'Add to cart bar', benefitList: 'Benefit', reviewCard: 'Review card', logoStrip: 'Logo strip',
  timelineStep: 'Timeline step', diffTable: 'Comparison row', productCard: 'Product card', title: 'Title', price: 'Price', rating: 'Rating', options: 'Options',
}
export function newBlock(type: Block['type']): Block {
  switch (type) {
    case 'media': return block('media', [newElement('image')], { width: '100%' })
    case 'gallery': return block('gallery', [el('image', { bind: 'product.image', alt: 'Product' }, { radius: '14px', width: '100%' })], { width: '48%' })
    case 'productDetails': return block('productDetails', [newElement('heading'), newElement('price'), newElement('text'), newElement('button')], { gap: '12px', direction: 'column', width: '48%' })
    case 'atc': return atcBlock()
    case 'benefitList': return benefitBlock('✓', 'Benefit title', 'A short line on why this benefit matters to the buyer.')
    case 'reviewCard': return reviewBlock('Happy Customer', 'This product exceeded my expectations — would absolutely buy again.')
    case 'logoStrip': return logoBlock(['Forbes', 'Vogue', 'TechCrunch', 'GQ', 'Allure'])
    case 'timelineStep': return timelineBlock('Week 1', 'What changes', 'Describe what the customer notices at this stage.')
    case 'diffTable': return diffRow('Feature', '✓', '✕')
    case 'productCard': return productCardBlock()
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

/** Which block types the "Add Block" menu offers inside each section type. */
export const SECTION_BLOCK_PALETTE: Record<Section['type'], Block['type'][]> = {
  productInfo: ['gallery', 'productDetails', 'text', 'media'],
  stickyAtc: ['atc', 'text'],
  imageBenefits: ['benefitList', 'text', 'media'],
  reviewsCarousel: ['reviewCard', 'text'],
  asSeenOn: ['logoStrip', 'text'],
  imageTimeline: ['timelineStep', 'text', 'media'],
  imageText: ['media', 'text'],
  imagePercentage: ['group', 'text'],
  productDifferences: ['diffTable', 'text'],
  recommendedProducts: ['productCard', 'text'],
  shapeDivider: ['media'],
  raw: [], // bespoke-template section — edited in place, not via the add-block menu
}

// ── repeatable item builders (each item is its own block → reorder/duplicate as a unit in the tree) ──
const heading = (text: string, style: Element['style'] = {}) => el('heading', { text }, { fontSize: '20px', fontWeight: 800, ...style })
const body = (text: string, style: Element['style'] = {}) => el('text', { text }, { color: 'Sub', ...style })
const sectionHead = (title: string, sub?: string): Block =>
  block('text', [heading(title, { fontSize: '28px', letterSpacing: 'tight', textAlign: 'center' }), ...(sub ? [body(sub, { textAlign: 'center', fontSize: '15px' })] : [])], { direction: 'column', gap: '6px', width: '100%', align: 'center' })

function atcBlock(): Block {
  return block('atc', [
    el('image', { bind: 'product.image', alt: '' }, { width: '46px', radius: '8px' }),
    el('heading', { bind: 'product.title' }, { fontSize: '15px', fontWeight: 700 }),
    el('price', { bind: 'product.price' }, { fontSize: '16px', fontWeight: 800, color: 'Primary' }),
    el('button', { text: 'Add to cart', href: '#' }, { background: 'Primary', color: '#fff', paddingX: '22px', paddingY: '11px', radius: '999px', fontWeight: 800 }),
  ], {})
}
function benefitBlock(icon: string, title: string, desc: string): Block {
  return block('benefitList', [
    el('icon', { text: icon }, { fontSize: '22px', color: 'Primary' }),
    heading(title, { fontSize: '17px' }),
    body(desc, { fontSize: '14px' }),
  ], { direction: 'column', gap: '8px', width: '30%' })
}
function reviewBlock(name: string, quote: string): Block {
  return block('reviewCard', [
    el('stars', { stars: 5 }),
    body(`“${quote}”`, { fontSize: '15px', color: 'Ink' }),
    heading(name, { fontSize: '14px' }),
  ], { direction: 'column', gap: '10px', width: '300px', paddingX: '18px', paddingY: '18px', background: 'Paper', radius: '14px' })
}
function logoBlock(names: string[]): Block {
  return block('logoStrip', names.map((n) => el('text', { text: n }, { fontWeight: 800, fontSize: '18px', color: 'Sub', letterSpacing: 'loose' })), { direction: 'row', gap: '36px', align: 'center', width: '100%' })
}
function timelineBlock(when: string, title: string, desc: string): Block {
  return block('timelineStep', [
    el('badge', { text: when }, { background: 'Primary', color: '#fff', paddingX: '10px', paddingY: '4px', radius: '999px', fontSize: '12px', fontWeight: 800 }),
    heading(title, { fontSize: '18px' }),
    body(desc, { fontSize: '14px' }),
  ], { direction: 'column', gap: '8px', width: '100%' })
}
function statBlock(pct: string, label: string): Block {
  return block('group', [
    heading(pct, { fontSize: '44px', color: 'Primary', letterSpacing: 'tight' }),
    body(label, { fontSize: '14px', textAlign: 'center' }),
  ], { direction: 'column', gap: '4px', align: 'center', width: '30%' })
}
function diffRow(feature: string, us: string, them: string): Block {
  return block('diffTable', [
    body(feature, { fontSize: '15px', color: 'Ink' }),
    el('text', { text: us }, { fontWeight: 800, color: 'Primary', textAlign: 'center' }),
    el('text', { text: them }, { fontWeight: 800, color: 'Sub', textAlign: 'center' }),
  ], { width: '100%' })
}
function productCardBlock(): Block {
  return block('productCard', [
    el('image', { src: 'https://placehold.co/400x400/f2efe9/b8b2a8?text=Product', alt: '' }, { width: '100%', radius: '12px' }),
    heading('Product name', { fontSize: '16px' }),
    el('price', { text: '$00.00' }, { fontSize: '16px', fontWeight: 800, color: 'Primary' }),
    el('button', { text: 'View', href: '#' }, { background: 'Primary', color: '#fff', paddingX: '18px', paddingY: '9px', radius: '999px', fontWeight: 700, fontSize: '13px' }),
  ], { direction: 'column', gap: '8px', width: '30%' })
}

/** A new section of the given type with a full, realistic starter block set (Phase 4 — the section library). */
/** Build a bespoke-template RAW section from a self-contained HTML slice — same shape pageDocFromTemplate
 *  produces (section 'raw' → group block → raw element). Used by the "Add Section" library so a merchant can
 *  drop in a ready-made, PagePilot-style section that keeps its exact design and stays fully editable. */
export function newRawSection(html: string, name: string): Section {
  return { id: nodeId('s'), type: 'raw', name, style: { paddingY: '0' }, blocks: [
    { id: nodeId('b'), type: 'group', style: { width: '100%' }, elements: [
      { id: nodeId('e'), type: 'raw', content: { html }, style: {} },
    ] },
  ] }
}

export function newSection(type: Section['type']): Section {
  const base = (blocks: Block[], style: Section['style']): Section => section(type, blocks, style)
  // Grid/list sections keep a neutral style (padding only) and let render.ts own their inner layout per
  // section type (flex-wrap grids, timeline connectors, etc.) — inline flex would fight that CSS.
  const stack: Section['style'] = { paddingY: '40px' }
  switch (type) {
    case 'productInfo':
      return starterProductDoc().sections[0]!
    case 'stickyAtc':
      return base([atcBlock()], { paddingY: '12px', paddingX: '16px', background: 'Paper' })
    case 'imageBenefits':
      return base([sectionHead('Why you’ll love it'), benefitBlock('✦', 'Fast results', 'Visible change in the first few weeks of use.'), benefitBlock('❤', 'Gentle & safe', 'Dermatologist-tested, no harsh ingredients.'), benefitBlock('★', 'Loved by thousands', 'Backed by real five-star customer reviews.')], stack)
    case 'reviewsCarousel':
      return base([sectionHead('What customers say'), reviewBlock('Sarah M.', 'Honestly the best I’ve tried — I noticed a difference within days.'), reviewBlock('James T.', 'Worth every penny. Repurchasing for the third time now.'), reviewBlock('Aisha K.', 'Gentle, effective, and it actually works. Highly recommend.')], stack)
    case 'asSeenOn':
      return base([block('text', [heading('As seen on', { fontSize: '14px', letterSpacing: 'loose', textCase: 'upper', color: 'Sub', textAlign: 'center' })], { width: '100%', align: 'center' }), logoBlock(['Forbes', 'Vogue', 'TechCrunch', 'GQ', 'Allure'])], { paddingY: '28px', direction: 'column', gap: '16px', align: 'center' })
    case 'imageTimeline':
      return base([sectionHead('Your first 8 weeks'), timelineBlock('Week 1', 'Getting started', 'Begin your routine — skin adjusts and hydration improves.'), timelineBlock('Week 4', 'First results', 'Early visible changes start to show.'), timelineBlock('Week 8', 'Full effect', 'The complete transformation is here.')], stack)
    case 'imageText':
      return base([newBlock('media'), block('text', [heading('A headline that sells', { fontSize: '26px', letterSpacing: 'tight' }), body('Two or three lines describing the benefit in the customer’s own words, then a clear call to action.', { fontSize: '15px', marginY: '8px' }), el('button', { text: 'Shop now', href: '#' }, { background: 'Primary', color: '#fff', paddingX: '24px', paddingY: '13px', radius: '999px', fontWeight: 800 })], { direction: 'column', gap: '12px', width: '48%' })], { paddingY: '40px', direction: 'row', gap: '36px', align: 'center' })
    case 'imagePercentage':
      return base([sectionHead('The results speak for themselves'), statBlock('92%', 'saw visible results in 8 weeks'), statBlock('4.9★', 'average rating from 1,200+ reviews'), statBlock('30d', 'money-back guarantee, no questions')], stack)
    case 'productDifferences':
      return base([sectionHead('Us vs. the others'), diffRow('Feature', 'Us', 'Them'), diffRow('Clinically dosed actives', '✓', '✕'), diffRow('No fillers or fragrance', '✓', '✕'), diffRow('Money-back guarantee', '✓', '✕')], stack)
    case 'recommendedProducts':
      return base([sectionHead('You may also like'), productCardBlock(), productCardBlock(), productCardBlock()], stack)
    case 'shapeDivider':
      return base([], { paddingY: '0', background: 'Paper' })
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
