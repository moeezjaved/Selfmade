'use client'
/**
 * Advanced Page Builder — 3-pane editor shell (Phase 2). Section/block tree · live canvas · property panel,
 * over the PageDoc model. Structural editing end-to-end: select, reorder, duplicate, hide, delete, add
 * section/block, inline text edit, device toggle, debounced autosave to /api/builder/doc.
 *
 * The canvas uses ONE runtime (render.ts) in mode:'edit' so what you edit is pixel-identical to what
 * publishes — the hard correctness bar in the spec. The property panel is intentionally minimal here
 * (hidden toggle + inline text); the full control system is Phase 3.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Mark } from '@/components/brand/Mark'
import { renderDoc, type RenderProduct } from '@/lib/builder/render'
import type { PageDoc, Section, Block, Element, Device } from '@/lib/builder/schema'
import {
  type NodeRef, findNode, findElement, descendantCount,
  moveNode, moveSectionToIndex, moveBlockToIndex, moveElementToIndex, levelOf, setHidden, removeNode, duplicateNode, insertSection, insertBlock, patchElementContent, patchStyle,
} from '@/lib/builder/docOps'
import { writeField, type StyleKey } from '@/lib/builder/styleField'
import { newSection, newBlock, newRawSection, SECTION_LABEL, BLOCK_LABEL, SECTION_BLOCK_PALETTE } from '@/lib/builder/seed'
import { PAY_PROVIDERS, payIcon } from '@/lib/builder/payicons'
import PropertyPanel from './PropertyPanel'

/* theme tokens (shared with the builder / HqRunable) */
const INK = '#1b1a17', SUB = '#6e6a63', FAINT = '#a6a29a'
const LINE = 'rgba(20,18,15,.10)', ORANGE = '#e02f06', WASH = '#fdeee9', INSET = '#f7f6f4'
// The editor UI font. PagePilot's builder is a clean sans throughout (no serif headings), so the editor
// chrome uses a system sans stack to match; `SERIF` keeps its name only to avoid churn across usages.
const SERIF = "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

// Unwrap the template's mobile `@media (max-width: N)` blocks (N ≥ ~500) so their rules apply directly in the
// editor's shrunk mobile canvas — a real @media keys off the wide viewport and never fires there. Applied
// in-place (after the base rules) so the mobile overrides still win; smaller breakpoints are left intact.
function activateMobileCss(css: string): string {
  let out = '', i = 0
  while (i < css.length) {
    if (css.startsWith('@media', i)) {
      const brace = css.indexOf('{', i)
      if (brace === -1) { out += css.slice(i); break }
      const cond = css.slice(i, brace)
      let depth = 1, j = brace + 1
      while (j < css.length && depth > 0) { const ch = css[j]; if (ch === '{') depth++; else if (ch === '}') depth--; j++ }
      const inner = css.slice(brace + 1, j - 1)
      const m = cond.match(/max-width:\s*(\d+)/)
      out += (m && parseInt(m[1], 10) >= 500) ? inner : css.slice(i, j)   // unwrap wide breakpoints; keep the rest
      i = j
    } else { out += css[i]; i++ }
  }
  return out
}
const sameRef = (a: NodeRef | null, b: NodeRef | null) =>
  !!a && !!b && a.sectionId === b.sectionId && a.blockId === b.blockId && a.elementId === b.elementId
const refKey = (r: NodeRef) => `${r.sectionId}/${r.blockId || ''}/${r.elementId || ''}`

/** A placeholder product so product-bound elements show something legible on the canvas while editing. */
function editorProduct(doc: PageDoc): RenderProduct {
  const p = doc.productRef?.importedProduct || {}
  return {
    title: p.title || 'Your product name',
    price: p.price || '$49.00',
    compareAtPrice: p.compareAtPrice || '$69.00',
    savePct: 'SAVE 29%',
    rating: p.rating ?? 4.9,
    reviewCount: p.ratingCount ?? 1240,
    image: p.image || 'https://placehold.co/600x750/f2efe9/b8b2a8?text=Product',
    description: p.description || 'A short product description your buyers will read here.',
  }
}

const SECTION_TYPES: Section['type'][] = ['productInfo', 'imageText', 'imageBenefits', 'imageTimeline', 'imagePercentage', 'productDifferences', 'asSeenOn', 'reviewsCarousel', 'recommendedProducts', 'stickyAtc', 'shapeDivider']
const BLOCK_TYPES: Block['type'][] = ['text', 'media', 'gallery', 'productDetails']

/* ── granular editing inside a `raw` (bespoke-template) section ──────────────────────────────────────
 * A raw section renders its template slice verbatim (pixel-perfect). To let merchants edit/hide/delete/
 * move/swap the INDIVIDUAL pieces inside it (not just the whole section), we operate on the slice's HTML:
 * a click resolves the clicked DOM node to a child-index PATH from the raw root, and each op re-writes the
 * slice's HTML. Design is preserved (verbatim HTML in, verbatim HTML out) — only the edited node changes. */

/** Snap a clicked node up to the nearest MEANINGFUL item: climb through only-child wrappers (e.g. a lone
 * <span> inside a pill → the pill) so move/hide/delete act on the piece the user means, not a bare leaf. */
function snapUp(el: HTMLElement, rawRoot: HTMLElement): HTMLElement {
  let n = el
  while (n !== rawRoot && n.parentElement && n.parentElement !== rawRoot && n.parentElement.children.length === 1) {
    n = n.parentElement
  }
  return n
}

/** Child-index path from `clicked` up to (but excluding) `rawRoot`; null if not a descendant. [] = the root itself. */
function subPathTo(clicked: HTMLElement, rawRoot: HTMLElement): number[] | null {
  const path: number[] = []
  let n: HTMLElement | null = clicked
  while (n && n !== rawRoot) {
    const p: HTMLElement | null = n.parentElement
    if (!p) return null
    path.unshift(Array.prototype.indexOf.call(p.children, n as HTMLElement))
    n = p
  }
  return n === rawRoot ? path : null
}

type RawOp = 'up' | 'down' | 'hide' | 'delete' | 'img' | 'style' | 'insert' | 'sethtml' | 'settext' | 'dup' | 'appendchild' | 'sethref' | 'setname'
// Inline tags a rich-text piece may contain and still be safely edited as one text block (not a container).
const RICH_INLINE = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'A', 'BR', 'SUP', 'SUB', 'MARK', 'SMALL', 'FONT'])
// Ready-made pieces you can drop into a template section (styled to sit in the .pgbld design generically).
const RAW_INSERTS: { id: string; label: string; html: string }[] = [
  { id: 'heading', label: 'Heading', html: '<div class="wrap" style="padding:6px 0"><h3 style="font-size:24px;font-weight:800;text-align:center;margin:10px 0;color:#1b1a17">New heading</h3></div>' },
  { id: 'text', label: 'Text', html: '<div class="wrap" style="padding:6px 0"><p style="font-size:15px;line-height:1.6;text-align:center;margin:8px auto;max-width:640px;color:#5b5750">New paragraph — double-click to edit this text.</p></div>' },
  { id: 'image', label: 'Image', html: '<div class="wrap" style="padding:6px 0;text-align:center"><img src="https://placehold.co/900x520/eeeeee/999999?text=Image" alt="" style="max-width:100%;border-radius:14px"></div>' },
  { id: 'button', label: 'Button', html: '<div class="wrap" style="padding:10px 0;text-align:center"><a href="#" style="display:inline-block;background:#3f4bd6;color:#fff;padding:14px 30px;border-radius:999px;font-weight:800;text-decoration:none">Button</a></div>' },
  { id: 'divider', label: 'Divider', html: '<div class="wrap" style="padding:6px 0"><hr style="border:0;border-top:1px solid #e7e3dd;margin:14px 0"></div>' },
]
// Richer ready-made blocks for the "Add block" LIBRARY (self-contained inline styles → render in previews
// and drop cleanly into any template section). Each is inserted after the selected piece.
const RAW_LIBRARY: { id: string; label: string; html: string }[] = [
  ...RAW_INSERTS,
  { id: 'headsub', label: 'Heading + subtext', html: '<div class="wrap" style="text-align:center;padding:14px 0"><h2 style="font-size:30px;font-weight:800;color:#1b1a17;margin:0 0 8px">Section heading</h2><p style="font-size:15px;color:#6a6e93;max-width:560px;margin:0 auto;line-height:1.6">A short supporting sentence that explains this section.</p></div>' },
  { id: 'cta', label: 'CTA band', html: '<div class="wrap" style="text-align:center;background:#3f4bd6;border-radius:18px;padding:34px 24px;margin:12px 0"><h3 style="color:#fff;font-size:24px;font-weight:800;margin:0 0 14px">Ready to get started?</h3><a href="#" style="display:inline-block;background:#fff;color:#3f4bd6;padding:14px 30px;border-radius:999px;font-weight:800;text-decoration:none">Buy now</a></div>' },
  { id: 'feature', label: 'Feature card', html: '<div style="flex:1 1 220px;max-width:300px;background:#fff;border:1px solid #e7e3dd;border-radius:16px;padding:22px 18px;text-align:center;box-shadow:0 2px 10px -6px rgba(20,18,15,.18)"><div style="font-size:30px;margin-bottom:8px">✨</div><h4 style="font-size:17px;font-weight:800;color:#1b1a17;margin:0 0 6px">Feature title</h4><p style="font-size:14px;color:#6a6e93;line-height:1.6;margin:0">A benefit customers care about, in one line.</p></div>' },
  { id: 'review', label: 'Review card', html: '<div style="flex:1 1 240px;max-width:320px;background:#fff;border:1px solid #e7e3dd;border-radius:16px;padding:20px 18px;box-shadow:0 2px 10px -6px rgba(20,18,15,.18)"><div style="color:#f5a623;letter-spacing:2px;margin-bottom:8px">★★★★★</div><p style="font-size:15px;color:#1b1a17;line-height:1.5;margin:0 0 10px">"Genuinely the best I have tried — worth every penny."</p><div style="font-size:13px;font-weight:700;color:#6a6e93">— Happy customer</div></div>' },
  { id: 'stat', label: 'Stat', html: '<div style="flex:1 1 160px;max-width:220px;text-align:center;padding:16px"><div style="font-size:40px;font-weight:900;color:#3f4bd6">90%</div><div style="font-size:13px;color:#6a6e93;margin-top:4px">reported better results</div></div>' },
  { id: 'badges', label: 'Badge row', html: '<div class="wrap" style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px;padding:12px 0"><span style="background:#eef0fe;color:#3f4bd6;font-weight:700;font-size:13px;padding:7px 14px;border-radius:999px">Vegan</span><span style="background:#eef0fe;color:#3f4bd6;font-weight:700;font-size:13px;padding:7px 14px;border-radius:999px">Cruelty-free</span><span style="background:#eef0fe;color:#3f4bd6;font-weight:700;font-size:13px;padding:7px 14px;border-radius:999px">Lab tested</span></div>' },
  { id: 'spacer', label: 'Spacer', html: '<div style="height:40px"></div>' },
]
// ── Section LIBRARY ─────────────────────────────────────────────────────────────────────────────────
// Ready-made, PagePilot-style SECTIONS a merchant can drop into the page (matching PagePilot's Add Section
// catalog). Each is a self-contained HTML slice (inline styles → renders in any doc + previews) and inserts
// as a raw section, so it shows in the tree as named, per-piece-editable blocks and publishes as native
// editable Shopify blocks. Neutral palette (indigo accent) so it blends with any template.
const SL_ACCENT = '#3f4bd6', SL_INK = '#14120f', SL_SUB = '#6a6e93', SL_LINE = '#e7e3dd', SL_WASH = '#eef0fe'
const slWrap = (inner: string, bg = 'transparent') => `<section style="padding:44px 20px;background:${bg}"><div style="max-width:1040px;margin:0 auto">${inner}</div></section>`
const slHead = (t: string, s?: string) => `<div style="text-align:center;margin:0 0 26px"><h2 style="font-size:30px;font-weight:800;color:${SL_INK};margin:0 0 8px">${t}</h2>${s ? `<p style="font-size:15px;color:${SL_SUB};max-width:620px;margin:0 auto;line-height:1.6">${s}</p>` : ''}</div>`
// A row of payment badges (styled text chips) — matches PagePilot's CTA payment strip without external images.
const slPays = () => `<div class="pays" style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:18px">${['AMEX', 'Pay', 'VISA', 'MC', 'PayPal', 'GPay', 'Shop'].map((p) => `<span style="background:#fff;color:#1b1a17;font-size:11px;font-weight:800;padding:5px 9px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.12)">${p}</span>`).join('')}</div>`
// A conic-gradient percentage RING with the number inside, on a gradient card — PagePilot's Statistics look.
const slRing = (pct: number, label: string) => `<div class="stat" style="flex:1 1 210px;max-width:250px;background:linear-gradient(160deg,#6a5cf0,#4433c4);border-radius:18px;padding:26px 18px;text-align:center;color:#fff"><div style="width:104px;height:104px;border-radius:50%;background:conic-gradient(#fff ${pct}%, rgba(255,255,255,.22) 0);display:flex;align-items:center;justify-content:center;margin:0 auto 14px"><div style="width:82px;height:82px;border-radius:50%;background:#5245d6;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900">${pct}%</div></div><div style="font-size:14px;line-height:1.5;opacity:.95">${label}</div></div>`
// A colored circular icon chip (PagePilot uses these beside numbered benefits + feature cards).
const slChip = (icon: string, bg = SL_WASH, color = SL_ACCENT) => `<span style="flex:none;width:46px;height:46px;border-radius:14px;background:${bg};color:${color};display:inline-flex;align-items:center;justify-content:center;font-size:22px">${icon}</span>`
const SECTION_LIBRARY: { id: string; label: string; html: string }[] = [
  { id: 'rotating-benefits', label: 'Rotating Benefits', html: slWrap(`<div class="ppills" style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center">${['Boosts hydration', 'Strengthens', 'Adds shine', 'Reduces breakage', 'All-day hold'].map((b) => `<span class="pill" style="background:${SL_WASH};color:${SL_ACCENT};font-weight:700;font-size:14px;padding:10px 18px;border-radius:999px">${b}</span>`).join('')}</div>`) },
  { id: 'statistics', label: 'Statistics', html: slWrap(slHead('The results speak for themselves') + `<div class="sgrid" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">${([[100, 'Loved the lightness of their hair after one use.'], [99, 'Quickly lifted away buildup before the actual shower.'], [97, 'Felt purified and ready for their weekly hair routine.'], [98, 'Enjoyed the breezy scent of lemon on their scalp.']] as [number, string][]).map(([n, t]) => slRing(n, t)).join('')}</div>`) },
  { id: 'feature-cards', label: 'Feature Cards', html: slWrap(slHead('Why customers love it') + `<div class="fgrid" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">${[['✨', 'Fast results', 'Visible change within the first few weeks of use.'], ['🌿', 'Clean formula', 'No harsh chemicals — gentle enough for daily use.'], ['🛡', 'Guaranteed', 'Love it or your money back, no questions asked.']].map(([i, h, p]) => `<div class="feat" style="flex:1 1 240px;max-width:320px;background:#fff;border:1px solid ${SL_LINE};border-radius:18px;padding:26px 22px;box-shadow:0 4px 16px -8px rgba(20,18,15,.2)"><div style="margin-bottom:14px">${slChip(i)}</div><h4 style="font-size:17px;font-weight:800;color:${SL_INK};margin:0 0 6px">${h}</h4><p style="font-size:14px;color:${SL_SUB};line-height:1.6;margin:0">${p}</p></div>`).join('')}</div>`) },
  { id: 'reviews', label: 'Reviews Carousel', html: slWrap(slHead('What our community is saying', 'Join thousands of people loving the feeling of truly fresh, healthy hair.') + `<div class="revs" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">${([['S', 'Sarah M.', 'Honestly the best I have tried — noticed a difference within days.'], ['J', 'James T.', 'Worth every penny. Repurchasing for the third time now.'], ['A', 'Aisha K.', 'Gentle, effective, and it actually works. Highly recommend.']] as [string, string, string][]).map(([ini, n, q]) => `<div class="rev" style="flex:1 1 260px;max-width:330px;background:#fff;border:1px solid ${SL_LINE};border-radius:16px;padding:22px 20px;box-shadow:0 4px 16px -8px rgba(20,18,15,.2)"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span class="avim" style="flex:none;width:40px;height:40px;border-radius:50%;background:${SL_WASH};color:${SL_ACCENT};font-weight:800;display:inline-flex;align-items:center;justify-content:center">${ini}</span><div><div style="font-size:13.5px;font-weight:700;color:${SL_INK}">${n} <span style="color:${SL_ACCENT}">✔</span></div><div style="color:#f5a623;letter-spacing:1px;font-size:12px">★★★★★</div></div></div><p style="font-size:14.5px;color:${SL_INK};line-height:1.55;margin:0">"${q}"</p></div>`).join('')}</div>`, '#faf9ff') },
  { id: 'as-seen-on', label: 'As Seen On', html: slWrap(`<div style="text-align:center;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${SL_SUB};margin-bottom:16px">As seen on</div><div class="press" style="display:flex;flex-wrap:wrap;gap:26px;justify-content:center;align-items:center">${['Forbes', 'Vogue', 'TechCrunch', 'GQ', 'Allure'].map((l) => `<span class="plogo" style="font-size:20px;font-weight:800;color:#9a9aa8">${l}</span>`).join('')}</div>`) },
  { id: 'comparison', label: 'Product Differences', html: slWrap(slHead('Why we’re different') + `<div class="vs" style="max-width:640px;margin:0 auto;border:1px solid ${SL_LINE};border-radius:16px;overflow:hidden">${[['Clinically tested formula', true], ['No harsh chemicals', true], ['Money-back guarantee', true], ['Cheap synthetic fillers', false], ['Hidden subscription traps', false]].map(([t, ok]) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid ${SL_LINE}"><span style="font-size:15px;color:${SL_INK}">${t}</span><span style="font-size:18px;color:${ok ? '#1ea672' : '#d64316'};font-weight:800">${ok ? '✓ Us' : '✕ Them'}</span></div>`).join('')}</div>`) },
  { id: 'guarantee', label: 'Happiness Guarantee', html: slWrap(`<div style="background:#fff;border:1px solid ${SL_LINE};border-radius:20px;padding:34px 26px;text-align:center;box-shadow:0 4px 18px -10px rgba(20,18,15,.2)"><div style="font-size:40px;margin-bottom:10px">🛡</div><h3 style="font-size:24px;font-weight:800;color:${SL_INK};margin:0 0 8px">30-Day Happiness Guarantee</h3><p style="font-size:15px;color:${SL_SUB};max-width:560px;margin:0 auto;line-height:1.6">Try it risk-free. If you don’t love it, we’ll refund every penny — no questions asked.</p></div>`) },
  { id: 'numbered', label: 'Numbered Benefits', html: slWrap(`<div style="display:flex;flex-wrap:wrap;gap:36px;align-items:center"><div style="flex:1 1 300px"><img src="https://placehold.co/620x640/eef0fe/3f4bd6?text=Product" alt="" style="width:100%;border-radius:18px"></div><div class="hchecks" style="flex:1 1 320px;display:flex;flex-direction:column;gap:20px">${([['💧', 'Absorbs excess oil', 'Effortlessly lift away buildup for a fresh, airy finish that lasts all week.'], ['✨', 'Refreshes flat hair', 'Transform dull strands with clarifying botanicals so hair looks vibrant again.'], ['☀', 'Natural citrus boost', 'Cold-pressed oils purify your scalp for an invigorating pre-wash experience.'], ['🔄', 'Pre-wash prep', 'Balance your hair for a total reset before your favourite shampoo.']] as [string, string, string][]).map(([i, h, p]) => `<div style="display:flex;gap:16px;align-items:flex-start">${slChip(i)}<div><h4 style="font-size:17px;font-weight:800;color:${SL_INK};margin:0 0 4px">${h}</h4><p style="font-size:14px;color:${SL_SUB};line-height:1.55;margin:0">${p}</p></div></div>`).join('')}</div></div>`) },
  { id: 'image-text', label: 'Image with Text', html: slWrap(`<div style="display:flex;flex-wrap:wrap;gap:36px;align-items:center"><div style="flex:1 1 300px"><img src="https://placehold.co/640x460/eef0fe/3f4bd6?text=Image" alt="" style="width:100%;border-radius:16px"></div><div style="flex:1 1 300px"><h2 style="font-size:28px;font-weight:800;color:${SL_INK};margin:0 0 12px">A headline that sells</h2><p style="font-size:15px;color:${SL_SUB};line-height:1.65;margin:0 0 18px">Two or three lines describing the benefit in the customer’s own words, then a clear reason to buy today.</p><a href="#" style="display:inline-block;background:${SL_ACCENT};color:#fff;padding:14px 28px;border-radius:999px;font-weight:800;text-decoration:none">Shop now</a></div></div>`) },
  { id: 'cta', label: 'CTA Band', html: slWrap(`<div style="display:flex;flex-wrap:wrap;border-radius:20px;overflow:hidden;box-shadow:0 8px 30px -14px rgba(20,18,15,.3)"><div style="flex:1 1 300px;min-height:300px"><img src="https://placehold.co/700x600/eef0fe/3f4bd6?text=Product" alt="" style="width:100%;height:100%;object-fit:cover;display:block"></div><div style="flex:1 1 340px;background:linear-gradient(160deg,#4b3fd6,#3a2cb8);color:#fff;padding:46px 36px;text-align:center;display:flex;flex-direction:column;justify-content:center"><div style="font-size:40px;margin-bottom:6px">♡</div><h3 style="font-size:30px;font-weight:800;margin:0 0 12px">Refresh your roots</h3><p style="color:#dfe3ff;font-size:15px;line-height:1.6;margin:0 0 22px">Reset your hair and regain that light, airy feeling today. A simple ritual that makes self-care easy.</p><a class="buy" href="#" style="display:block;background:#fff;color:${SL_ACCENT};padding:16px 24px;border-radius:12px;font-weight:800;text-decoration:none;font-size:15px">BUY IT NOW →</a>${slPays()}</div></div>`) },
  { id: 'trust-icons', label: 'Trust Icons', html: slWrap(`<div class="hchecks" style="display:flex;flex-wrap:wrap;gap:22px;justify-content:center">${[['🚚', 'Free shipping'], ['↩', '30-day returns'], ['🔒', 'Secure checkout'], ['🌿', 'Cruelty-free']].map(([i, t]) => `<div class="ti" style="display:flex;align-items:center;gap:9px;font-size:14px;font-weight:600;color:${SL_INK}"><span style="font-size:20px">${i}</span>${t}</div>`).join('')}</div>`) },
  { id: 'faq', label: 'FAQ', html: slWrap(slHead('Frequently asked questions') + `<div style="max-width:680px;margin:0 auto;display:flex;flex-direction:column;gap:12px">${[['How long until I see results?', 'Most customers notice a difference within the first two to three weeks of daily use.'], ['Is it safe for sensitive skin?', 'Yes — our formula is dermatologist-tested and free from harsh chemicals.'], ['What’s your return policy?', 'Every order is covered by a 30-day money-back guarantee.']].map(([q, a]) => `<details style="background:#fff;border:1px solid ${SL_LINE};border-radius:12px;padding:14px 18px"><summary style="font-size:15px;font-weight:700;color:${SL_INK};cursor:pointer">${q}</summary><div style="font-size:14px;color:${SL_SUB};line-height:1.6;margin-top:8px">${a}</div></details>`).join('')}</div>`) },
  { id: 'how-it-works', label: 'How It Works', html: slWrap(`<div style="display:flex;flex-wrap:wrap;gap:36px;align-items:center"><div style="flex:1 1 320px"><h2 style="font-size:30px;font-weight:800;color:${SL_INK};margin:0 0 16px">How does it work?</h2><p style="font-size:15px;color:${SL_SUB};line-height:1.7;margin:0 0 12px">This treatment uses <b style="color:${SL_INK}">cold-pressed</b> oils to dissolve heavy buildup before you even start.</p><p style="font-size:15px;color:${SL_SUB};line-height:1.7;margin:0 0 22px">It revitalises tired roots, leaving hair feeling airy and genuinely clean after your main wash.</p><a class="buy" href="#" style="display:inline-block;background:${SL_ACCENT};color:#fff;padding:15px 34px;border-radius:12px;font-weight:800;text-decoration:none">BUY IT NOW</a></div><div style="flex:1 1 320px"><img src="https://placehold.co/640x620/f6e9b0/8a6d1f?text=Infographic" alt="" style="width:100%;border-radius:18px"></div></div>`, '#faf9ff') },
  { id: 'trusted-by', label: 'Trusted By', html: slWrap(`<div style="display:flex;flex-wrap:wrap;gap:36px;align-items:center"><div style="flex:1 1 320px"><h2 style="font-size:32px;font-weight:800;color:${SL_INK};line-height:1.2;margin:0 0 14px">Trusted by thousands.<br><i>Confident</i> customers choose us.</h2><p style="font-size:15px;color:${SL_SUB};line-height:1.65;margin:0 0 20px">Experience a purified, healthier result before every single wash.</p><a class="buy" href="#" style="display:inline-block;background:${SL_ACCENT};color:#fff;padding:15px 34px;border-radius:12px;font-weight:800;text-decoration:none">GET YOURS NOW</a><div style="margin-top:14px;color:#f5a623;font-size:14px">★★★★★ <span style="color:${SL_SUB}">Rated 4.9/5 by 1,207+ happy customers</span></div></div><div style="flex:1 1 320px;display:flex;gap:12px"><img src="https://placehold.co/300x420/eef0fe/3f4bd6?text=Before" alt="" style="width:50%;border-radius:14px;object-fit:cover"><img src="https://placehold.co/300x420/e7e3dd/6a6e93?text=After" alt="" style="width:50%;border-radius:14px;object-fit:cover"></div></div>`) },
  // ── PagePilot-parity additions ──────────────────────────────────────────────────────────────────────
  { id: 'text-rotating', label: 'Text with Rotating images', html: slWrap(`<div style="display:flex;flex-wrap:wrap;gap:36px;align-items:center"><div style="flex:1 1 320px"><h2 style="font-size:32px;font-weight:800;color:${SL_INK};line-height:1.2;margin:0 0 14px">Thousands trust this <i>everyday</i> result.</h2><p style="font-size:15px;color:${SL_SUB};line-height:1.65;margin:0 0 20px">Experience <b style="color:${SL_INK}">reliable</b> results during your busiest days.</p><a class="buy" href="#" style="display:inline-block;background:${SL_ACCENT};color:#fff;padding:15px 34px;border-radius:12px;font-weight:800;text-decoration:none">GET YOURS NOW</a><div style="margin-top:14px;color:#f5a623;font-size:14px">★★★★★ <span style="color:${SL_SUB}">Rated 4.9/5 by 1,411+ happy customers</span></div></div><div class="gtrack" style="flex:1 1 340px;display:flex;gap:12px;overflow:hidden">${[0, 1, 2].map((i) => `<img src="https://placehold.co/320x420/eef0fe/3f4bd6?text=Photo+${i + 1}" alt="" style="width:33%;border-radius:16px;object-fit:cover">`).join('')}</div></div>`) },
  { id: 'reviews-photos', label: 'Reviews (with photos)', html: slWrap(slHead('What real people are saying', 'Join our growing community who trust us every day.') + `<div class="rgrid" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">${([['Maya', '★★★★☆', 'It is such a simple way to find some peace during a hectic day.'], ['Sarah', '★★★★★', 'I love how this feels in my hand. Reaching for it every time now.'], ['Marcus', '★★★★★', 'Such a beautiful little thing. It fits perfectly on my desk.'], ['Elena', '★★★★★', 'A total game changer for my nervous energy. Highly recommend.']] as [string, string, string][]).map(([n, s, q]) => `<div class="rc" style="flex:1 1 220px;max-width:270px;background:#fff;border:1px solid ${SL_LINE};border-radius:16px;overflow:hidden;box-shadow:0 4px 16px -8px rgba(20,18,15,.2)"><img src="https://placehold.co/540x420/eef0fe/3f4bd6?text=${encodeURIComponent(n)}" alt="" style="width:100%;height:170px;object-fit:cover"><div style="padding:16px 16px 18px"><div style="display:flex;align-items:center;gap:7px;margin-bottom:6px"><span class="who" style="font-size:13.5px;font-weight:700;color:${SL_INK}">${n} <span style="color:${SL_ACCENT}">✔</span></span></div><div style="color:#f5a623;letter-spacing:1px;font-size:13px;margin-bottom:8px">${s}</div><p style="font-size:14px;color:${SL_INK};line-height:1.55;margin:0">${q}</p></div></div>`).join('')}</div>`, '#faf9ff') },
  { id: 'recommended', label: 'Recommended Products', html: slWrap(slHead('Recommended Products') + `<div class="fgrid" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">${[1, 2, 3, 4].map((i) => `<div class="feat" style="flex:1 1 200px;max-width:250px;background:#fff;border:1px solid ${SL_LINE};border-radius:16px;overflow:hidden"><img src="https://placehold.co/500x500/eef0fe/3f4bd6?text=Product+${i}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover"><div style="padding:14px"><div style="font-size:14px;font-weight:700;color:${SL_INK};margin-bottom:4px">Product ${i}</div><div style="color:#f5a623;font-size:12px;margin-bottom:8px">★★★★★</div><div style="display:flex;align-items:center;justify-content:space-between"><span class="price" style="font-size:15px;font-weight:800;color:${SL_INK}">$29</span><a class="buy" href="#" style="background:${SL_ACCENT};color:#fff;padding:7px 14px;border-radius:9px;font-size:12.5px;font-weight:800;text-decoration:none">Add</a></div></div></div>`).join('')}</div>`) },
  { id: 'sticky-atc', label: 'Sticky Add to Cart', html: `<div class="sticky-atc" style="position:sticky;bottom:0;z-index:20;background:${SL_ACCENT};display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 18px"><div style="display:flex;align-items:center;gap:12px;min-width:0"><img src="https://placehold.co/64x64/ffffff/3f4bd6?text=%20" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;flex:none"><span style="color:#fff;font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Your Product Name</span></div><a class="buy" href="#" style="flex:none;background:#fff;color:${SL_INK};padding:12px 26px;border-radius:10px;font-size:14px;font-weight:800;text-decoration:none;display:inline-flex;align-items:center;gap:8px">🛒 ADD TO CART</a></div>` },
]
/** Resolve the node at `path` inside a raw slice's HTML; returns {box,node} or null on miss. */
function rawNodeAt(html: string, path: number[]): { box: HTMLElement; node: HTMLElement } | null {
  if (!path.length) return null
  const box = document.createElement('div')
  box.innerHTML = html
  let node: HTMLElement = box
  for (const idx of path) { const kid = node.children[idx] as HTMLElement | undefined; if (!kid) return null; node = kid }
  return node === box ? null : { box, node }
}
/** Apply an op to the node at `path` within a raw slice's HTML; returns the new HTML (unchanged on miss).
 * op 'style' sets/clears one inline CSS property (arg = "prop::value"; empty value removes it) so a piece of
 * the bespoke template can be restyled (colour, size, padding, margin, background, radius) IN PLACE. */
function rawHtmlOp(html: string, path: number[], op: RawOp, arg?: string): string {
  const hit = rawNodeAt(html, path)
  if (!hit) return html
  const { box, node } = hit
  const parent = node.parentElement
  if (op === 'delete') node.remove()
  else if (op === 'hide') node.style.display = node.style.display === 'none' ? '' : 'none'
  else if (op === 'up') { const s = node.previousElementSibling; if (s && parent) parent.insertBefore(node, s) }
  else if (op === 'down') { const s = node.nextElementSibling; if (s && parent) parent.insertBefore(s, node) }
  else if (op === 'img' && arg != null) { const img = node.tagName === 'IMG' ? node : node.querySelector('img'); if (img) img.setAttribute('src', arg) }
  else if (op === 'style' && arg != null) {
    const i = arg.indexOf('::'); const prop = arg.slice(0, i); const val = arg.slice(i + 2)
    if (val) node.style.setProperty(prop, val); else node.style.removeProperty(prop)
  }
  else if (op === 'insert' && arg != null) node.insertAdjacentHTML('afterend', arg)
  else if (op === 'sethtml' && arg != null) node.innerHTML = arg      // replace ONE piece's text/inner markup (inline edit)
  else if (op === 'settext' && arg != null) node.textContent = arg    // set a piece's plain text (panel content field)
  else if (op === 'dup') { const c = node.cloneNode(true) as HTMLElement; if (parent) parent.insertBefore(c, node.nextSibling) }
  else if (op === 'appendchild' && arg != null) node.insertAdjacentHTML('beforeend', arg)   // add a child (gallery image)
  else if (op === 'sethref' && arg != null) { const a = (node.tagName === 'A' ? node : node.querySelector('a')) as HTMLAnchorElement | null; if (a) a.setAttribute('href', arg) }   // button/link destination
  else if (op === 'setname') { if (arg && arg.trim()) node.setAttribute('data-name', arg.trim()); else node.removeAttribute('data-name') }   // custom tree name (rename)
  return box.innerHTML
}
/** Move the node at `from` to just before/after the node at `to` (same slice). Returns new HTML. */
function rawHtmlMove(html: string, from: number[], to: number[], after: boolean): string {
  const box = document.createElement('div')
  box.innerHTML = html
  const at = (path: number[]): HTMLElement | null => { let n: HTMLElement = box; for (const i of path) { const k = n.children[i] as HTMLElement | undefined; if (!k) return null; n = k } return n === box ? null : n }
  const src = at(from), dst = at(to)
  if (!src || !dst || src === dst || !dst.parentElement) return html
  if (src.contains(dst)) return html
  dst.parentElement.insertBefore(src, after ? dst.nextSibling : dst)
  return box.innerHTML
}

// ── Raw section OUTLINE ─────────────────────────────────────────────────────────────────────────────
// A bespoke-template section is stored as one raw HTML slice. To give it PagePilot-style editing, we parse
// that HTML into a nested, NAMED outline of its real pieces (Headline, Price, Add-to-Cart, each pill, …) so
// the left tree shows individual blocks instead of a single "raw" node. Each outline node carries the
// child-path used by rawHtmlOp, so selecting / moving / editing a node maps straight onto the slice.
export type RawOutlineNode = { path: number[]; label: string; isImg: boolean; hidden: boolean; children: RawOutlineNode[] }
// Friendly, PagePilot-style names for the class vocabulary our templates use, so the tree reads like theirs
// ("Product Title", "Reviews Number", "Best Seller Badge") instead of raw text/tag guesses.
const RAW_FRIENDLY: Record<string, string> = {
  // buy-box / hero
  ptitle: 'Product Title', bestseller: 'Best Seller Badge', rlabel: 'Reviews Number', rpill: 'Eyebrow Badge',
  price: 'Price', now: 'Sale Price', was: 'Compare Price', save: 'Save Badge', hchecks: 'Benefit Checks',
  ti: 'Check', pays: 'Payment Icons', grow: 'Brand Trust', acc: 'Accordion', pdetails: 'Details', pdesc: 'Description',
  hrev: 'Featured Review', warn: 'Stock Notice', hclaim: 'Guarantee', qty: 'Quantity', newline: 'Tagline',
  brow: 'Benefit Row', rc: 'Featured Review', rgrid: 'Featured Reviews Carousel', hcheck: 'Benefit Check',
  vpick: 'Variant Picker', vopt: 'Option', ring: 'Percentage Circle', sc: 'Percentage Circle', logo: 'Logo',
  // gallery / creative
  gallery: 'Product Gallery', thumbs: 'Thumbnails', hbottle: 'Product Image', gimg: 'Product Image',
  hcre: 'Creative', mid: 'Image + Pills', hd: 'Headline', sd: 'Subhead', ppills: 'Benefit Pills', pill: 'Pill',
  // sections / lists
  strip: 'Pill Strip', stars: 'Stars', stat: 'Stat', sgrid: 'Stats', card: 'Card', feat: 'Feature',
  fgrid: 'Feature Cards', rev: 'Review', revs: 'Reviews', press: 'Press', plogo: 'Logo', vs: 'Comparison',
  gold: 'Comparison', avim: 'Avatar', q: 'Quote', who: 'Reviewer', buy: 'Add to Cart', btn: 'Button',
  buybox: 'Product Details', grid: 'Row', wrap: 'Row',
}
// Pick the class on this element that has a friendly name (so "rpill foo" → Eyebrow Badge), else the first.
function friendlyClassOf(el: HTMLElement): string {
  const classes = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)
  return classes.find((c) => RAW_FRIENDLY[c]) || classes[0] || ''
}
function rawFriendly(cls: string): string {
  if (!cls) return ''
  if (RAW_FRIENDLY[cls]) return RAW_FRIENDLY[cls]
  return cls.length <= 14 ? cls.charAt(0).toUpperCase() + cls.slice(1) : ''
}
function rawLabelFor(el: HTMLElement): string {
  const custom = el.getAttribute('data-name'); if (custom) return custom   // user rename wins
  const tag = el.tagName.toLowerCase()
  const cls = friendlyClassOf(el)
  // A known class wins for BOTH leaves and containers → clean PagePilot-style names everywhere we know them.
  if (RAW_FRIENDLY[cls]) return RAW_FRIENDLY[cls]
  if (tag === 'img') return 'Image'
  if (tag === 'hr') return 'Divider'
  if (tag === 'table') return 'Table'
  if (tag === 'ul' || tag === 'ol') return 'List'
  const txt = (el.textContent || '').replace(/\s+/g, ' ').trim()
  const kids = el.children.length
  // PagePilot labels pieces by TYPE, not by their text ("Text", "Heading", "Icon", "Button", "Image").
  const symbolic = !!txt && txt.length <= 2 && !/[a-z0-9]/i.test(txt)   // a lone glyph/emoji like ★ 🛒 ✓
  const isIcon = (!!el.querySelector('svg') && txt.length <= 2) || symbolic
  if (kids === 0) {
    if (!txt) return el.querySelector('svg') ? 'Icon' : (el.querySelector('img') ? 'Image' : (rawFriendly(cls) || 'Text'))
    if (isIcon) return 'Icon'
    if (/^h[1-6]$/.test(tag) || /^(hd|sd|secttl|sectitle|stitle)$/.test(cls)) return 'Heading'
    if (tag === 'a' || tag === 'button') return 'Button'
    return 'Text'
  }
  // A gallery container (main image + thumbnail strip / slider) wins BEFORE the generic image check — a clean
  // product gallery is image-only, so it must read as "Product Gallery", not a bare "Image".
  if (el.querySelector('.thumbs, .gtrack, .gallery, .hbottle')) return 'Product Gallery'
  if (el.querySelector('img') && !txt) return el.querySelector('svg') && !el.querySelector('img') ? 'Icon' : 'Image'
  if (isIcon) return 'Icon'
  if (/^h[1-6]$/.test(tag)) return 'Heading'
  if (tag === 'a' || tag === 'button') return 'Button'
  // Unclassed container (a hero column) → infer a PagePilot-style group name from what it holds. The outer
  // row keeps its own friendly class ('grid'→'Row'), so only real columns reach here.
  if (el.querySelector('.ptitle, h1') && el.querySelector('.price, .now, .buy, .btn, [class*="cart"], [class*="atc"]')) return 'Product Details'
  if (rawIsImg(el)) return 'Product Gallery'
  // Generic container → PagePilot's "Group (Horizontal/Vertical)" (direction inferred from inline style/class).
  const st = (el.getAttribute('style') || '')
  if (/flex-direction\s*:\s*column/.test(st) || /(^|\s)(ppills|col|vstack|vertical)(\s|$)/.test(el.className)) return 'Group (Vertical)'
  return 'Group (Horizontal)'
}
function rawIsImg(el: HTMLElement): boolean {
  return el.tagName === 'IMG' || (!!el.querySelector('img') && !(el.textContent || '').trim())
}
// Derive a meaningful section name from its raw HTML (PagePilot-style: name by heading, else by content type)
// so the tree never shows a bare "Section 2". Falls back to the stored name only if nothing is detectable.
// PagePilot's exact section names, keyed by the bespoke templates' section-root class. These WIN over the
// stored/heading name so the tree reads one-to-one with PagePilot (e.g. the reviews grid → "Reviews Carousel").
const PP_SECTION_NAME: Record<string, string> = {
  pcre: 'Image with Numbered Benefits',
  strip: 'Rotating Benefits', vs: 'Product Differences', revs: 'Reviews Carousel', stats: 'Statistics With Percentages',
  feat: 'Image with Feature Cards', how: 'Image with Text', gold: 'Product Comparison',
  seen: 'As Seen On with Quotes', hguar: 'Happiness Guarantee', recs: 'Recommended Products', satc: 'Sticky Add to Cart',
}
function rawSectionName(html: string, fallback: string): string {
  if (typeof document === 'undefined' || !html) return fallback
  const box = document.createElement('div'); box.innerHTML = html
  const custom = (box.children[0] as HTMLElement | undefined)?.getAttribute('data-name'); if (custom) return custom   // user rename wins
  // 1) Known section type → PagePilot's exact name (matches the live app one-to-one). The section's own class
  // (.strip / .revs / .stats …) sits on a <section> INSIDE the .pgbld wrapper, so search the whole slice.
  for (const cls of Object.keys(PP_SECTION_NAME)) if (box.querySelector('section.' + cls + ', .' + cls)) return PP_SECTION_NAME[cls]
  // 2) Keep a good stored name as-is (only fix bare "Section N" / empty). A long name is trimmed, not replaced.
  const stored = (fallback || '').trim()
  const generic = !stored || /^section\s*\d+$/i.test(stored)
  if (!generic) return stored.length > 30 ? stored.slice(0, 30) + '…' : stored
  // 3) Generic name → prefer a real heading (How It Works, Why Choose Us…), else classify by content.
  const h = box.querySelector('h1, h2, h3, h4, .hd, .eyebrow, .kicker, .sectitle, .stitle, .secttl') as HTMLElement | null
  const ht = (h?.textContent || '').replace(/\s+/g, ' ').trim()
  if (ht && ht.length <= 40) return ht.length > 30 ? ht.slice(0, 30) + '…' : ht
  if (box.querySelector('.pays, .payicon')) return 'Payment Icons'
  if (box.querySelector('.hchecks, .checks, .benefit, .ppill, .ppills, .strip .p, [class*="benefit"]') || /✓|✔/.test(box.textContent || '')) return 'Benefits'
  if (box.querySelector('.stars, [class*="rating"], [class*="review"]') || /★/.test(box.textContent || '')) return 'Reviews Carousel'
  if (box.querySelector('.thumbs, .gtrack, .hbottle, .gallery, .gimg')) return 'Product Gallery'
  if (box.querySelector('[class*="stat"], [class*="percent"], [class*="ring"]')) return 'Statistics With Percentages'
  return fallback || 'Section'
}
/** Stamp a friendly tree name onto an inserted block's root element (as data-name, which rawLabelFor honours
 *  first) so a library block lands in the tree under the name you picked — "Heading + subtext", not "Row".
 *  Matches PagePilot, where an added block keeps the library name. */
function stampName(html: string, label: string): string {
  if (typeof document === 'undefined' || !label) return html
  const box = document.createElement('div'); box.innerHTML = html
  const first = box.firstElementChild as HTMLElement | null
  if (first && !first.getAttribute('data-name')) { first.setAttribute('data-name', label); return box.innerHTML }
  return html
}
/** Parse a raw slice's HTML into a nested outline. Collapses single-child layout wrappers so the tree shows
 *  meaningful pieces, not scaffolding; caps nodes + depth so it stays fast and legible. */
function buildRawOutline(html: string): RawOutlineNode[] {
  if (typeof document === 'undefined' || !html) return []
  const box = document.createElement('div'); box.innerHTML = html
  let budget = 800
  // Decorative gallery arrows (‹ ›) aren't structural blocks — hide them from the outline so the gallery
  // still reads as one "Product Image" (matches PagePilot). Keep original child indices for the path.
  const realKids = (el: HTMLElement) => (Array.from(el.children) as HTMLElement[]).map((k, i) => ({ k, i })).filter((x) => !x.k.classList.contains('garr') && x.k.tagName !== 'STYLE')
  const walk = (el: HTMLElement, path: number[], depth: number): RawOutlineNode | null => {
    if (budget-- <= 0) return null
    let cur: HTMLElement = el, curPath = path
    // descend through wrappers that hold a single element child and add no own text (pure layout)
    while (depth < 12) {
      const rk = realKids(cur)
      if (rk.length !== 1) break
      const only = rk[0].k
      // "own text" ignores decorative arrow buttons (‹ ›) so the gallery's .gwrap collapses to its image —
      // reads as one "Product Image", not a nested "Product Gallery" with its own duplicate Images panel.
      let ownRaw = cur.textContent || ''
      for (const c of Array.from(cur.children) as HTMLElement[]) if (c.classList?.contains('garr')) ownRaw = ownRaw.replace(c.textContent || '', '')
      const own = ownRaw.replace(only.textContent || '', '').trim()
      if (own) break
      cur = only; curPath = [...curPath, rk[0].i]
    }
    const kids = realKids(cur)
    let children: RawOutlineNode[] = []
    // Some pieces are ONE self-contained block with a dedicated panel (Payment Icons has its own provider
    // toggles + alignment). Don't expand them into per-icon Group/Text rows — that just duplicates the same
    // settings on every descendant. Treat them as a single leaf, matching PagePilot's one "Payment Icons" block.
    const atomic = cur.classList?.contains('pays') || cur.classList?.contains('payicon')
    if (!atomic && kids.length > 1 && depth < 6) children = kids.map(({ k, i }) => walk(k, [...curPath, i], depth + 1)).filter(Boolean) as RawOutlineNode[]
    return { path: curPath, label: rawLabelFor(cur), isImg: rawIsImg(cur), hidden: cur.style?.display === 'none', children }
  }
  return (Array.from(box.children) as HTMLElement[]).map((k, i) => walk(k, [i], 0)).filter(Boolean) as RawOutlineNode[]
}

export default function AdvEditor({ pageId }: { pageId: string }) {
  const [doc, setDoc] = useState<PageDoc | null>(null)
  const [sel, setSel] = useState<NodeRef | null>(null)
  const [device, setDevice] = useState<Device>('base')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [dirty, setDirty] = useState(false)   // unsaved changes (Save is manual — no autosave)
  const [err, setErr] = useState('')
  const [addMenu, setAddMenu] = useState<null | { kind: 'section' } | { kind: 'block'; sectionId: string }>(null)
  const [sectionLibOpen, setSectionLibOpen] = useState(false)   // the "Add section" library (PagePilot-style)
  const [drag, setDrag] = useState<NodeRef | null>(null)   // node being dragged in the tree
  const [dropKey, setDropKey] = useState<string | null>(null)   // refKey of the node hovered as a drop target
  const [publishing, setPublishing] = useState<'idle' | 'saving' | 'publishing'>('idle')
  const [pubResult, setPubResult] = useState<null | { url?: string; previewUrl?: string; error?: string }>(null)
  const [showProduct, setShowProduct] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [topMenu, setTopMenu] = useState(false)   // the top-bar "Menu" dropdown (holds undo/redo + settings)
  const [rawAIbusy, setRawAIbusy] = useState(false)   // "Edit with AI" on the canvas toolbar
  const [histDepth, setHistDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
  const [tb, setTb] = useState<null | { top: number; left: number; below: boolean }>(null)
  const [zoom, setZoom] = useState(1)
  // Sub-selection INSIDE a raw (bespoke-template) section: the raw element + the clicked node's child-path.
  const [rawSel, setRawSel] = useState<null | { ref: NodeRef; path: number[]; isImg: boolean }>(null)
  const [imgUrlOpen, setImgUrlOpen] = useState(false)   // image "Use image URL" inline field (replaces browser prompt)
  const [rawTb, setRawTb] = useState<null | { top: number; left: number; below: boolean }>(null)
  const [rawBox, setRawBox] = useState<null | { top: number; left: number; width: number; height: number }>(null)  // selection highlight rect
  const [hoverBox, setHoverBox] = useState<null | { top: number; left: number; width: number; height: number }>(null)  // hover highlight rect (PagePilot-style)
  const hoverRaf = useRef(0)
  // Highlight the specific piece under the cursor inside a raw section (PagePilot highlights the exact block).
  const onCanvasHover = useCallback((e: React.MouseEvent) => {
    if (hoverRaf.current) return
    const t = e.target as HTMLElement
    hoverRaf.current = requestAnimationFrame(() => {
      hoverRaf.current = 0
      const target = t.closest('[data-node-type="element:raw"]') as HTMLElement | null
      if (!target) { setHoverBox(null); return }
      const item = snapUp(t, target)
      if (!item || item === target || item.classList?.contains('garr')) { setHoverBox(null); return }
      const r = item.getBoundingClientRect()
      setHoverBox({ top: r.top, left: r.left, width: r.width, height: r.height })
    })
  }, [])
  // Close the inline image-URL field whenever the selected piece changes.
  useEffect(() => { setImgUrlOpen(false) }, [rawSel?.ref.elementId, rawSel?.path.join('.')])
  const [rawAddOpen, setRawAddOpen] = useState(false)          // the quick "add a piece" menu for a raw section
  const [rawLibOpen, setRawLibOpen] = useState(false)          // the full block LIBRARY (previews) modal
  const [rawInsertTarget, setRawInsertTarget] = useState<null | { path: number[]; mode: 'after' | 'append' }>(null)  // where a picked block lands
  const rawDrag = useRef<number[] | null>(null)                // path of the raw piece being dragged

  const history = useRef<PageDoc[]>([])
  const future = useRef<PageDoc[]>([])
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const version = useRef(0)
  const syncDepth = () => { setHistDepth(history.current.length); setRedoDepth(future.current.length) }

  /* ── load ── */
  useEffect(() => {
    let live = true
    setStatus('loading')
    fetch(`/api/builder/doc?pageId=${encodeURIComponent(pageId)}`)
      .then((r) => r.json())
      .then((d) => { if (!live) return; if (d?.error) { setErr(d.error); setStatus('error'); return } version.current = d.version || 0; setDoc(d.doc); setStatus('idle') })
      .catch(() => { if (live) { setErr('Could not load the page.'); setStatus('error') } })
    return () => { live = false }
  }, [pageId])

  /* ── explicit save (NO autosave — changes persist only when the user clicks Save) ── */
  const saveNow = useCallback(async () => {
    if (!doc) return
    setStatus('saving')
    try {
      const r = await fetch('/api/builder/doc', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, doc }) })
      const d = await r.json()
      if (d?.error) throw new Error(d.error)
      version.current = d.version || version.current + 1
      setDirty(false); setStatus('saved'); setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500)
    } catch { setStatus('error') }
  }, [doc, pageId])

  /* ── apply a doc mutation: push undo, set, mark dirty (Save is manual) ── */
  const apply = useCallback((mut: (d: PageDoc) => PageDoc, nextSel?: NodeRef | null) => {
    setDoc((cur) => {
      if (!cur) return cur
      history.current.push(cur); if (history.current.length > 80) history.current.shift()
      future.current = []                    // a new edit clears the redo stack
      const next = mut(cur)
      setDirty(true)
      if (nextSel !== undefined) setSel(nextSel)
      syncDepth()
      return next
    })
  }, [])

  const undo = useCallback(() => {
    setDoc((cur) => { if (!cur) return cur; const prev = history.current.pop(); if (!prev) return cur; future.current.push(cur); setDirty(true); syncDepth(); return prev })
  }, [])
  const redo = useCallback(() => {
    setDoc((cur) => { if (!cur) return cur; const nxt = future.current.pop(); if (!nxt) return cur; history.current.push(cur); setDirty(true); syncDepth(); return nxt })
  }, [])

  /* ── property-panel writes (style is written for the device shown on the canvas) ── */
  const onStyle = useCallback((key: StyleKey, value: unknown) => {
    if (!sel) return
    apply((d) => { const n = findNode(d, sel); if (!n) return d; return patchStyle(d, sel, writeField(n.style, key, device, value)) })
  }, [sel, device, apply])
  const onHidden = useCallback(() => { if (sel) apply((d) => setHidden(d, sel)) }, [sel, apply])
  const onContent = useCallback((patch: Partial<Element['content']>) => { if (sel) apply((d) => patchElementContent(d, sel, patch)) }, [sel, apply])
  const fitZoom = useCallback(() => {
    const w = mainRef.current?.clientWidth || 900
    const target = Math.min(1, Math.max(0.4, (w - 56) / (device === 'mobile' ? 402 : 1000)))
    setZoom(Math.round(target * 20) / 20)
  }, [device])
  // Fit the canvas to the available width when a page loads or the device changes, so the preview is
  // never cropped by the side panels.
  useEffect(() => { const t = setTimeout(fitZoom, 60); return () => clearTimeout(t) }, [status, device, fitZoom])

  /* ── drag-to-reorder (sections, blocks within a section, elements within a block) ── */
  const canDropOn = (ref: NodeRef): boolean => {
    if (!drag || sameRef(drag, ref) || levelOf(drag) !== levelOf(ref)) return false
    if (levelOf(ref) === 'section') return true
    if (levelOf(ref) === 'block') return drag.sectionId === ref.sectionId
    return drag.sectionId === ref.sectionId && drag.blockId === ref.blockId
  }
  const dragProps = (ref: NodeRef) => ({
    draggable: true, dragging: sameRef(drag, ref), dropHint: dropKey === refKey(ref) && canDropOn(ref),
    onDragStart: () => setDrag(ref), onDragEnd: () => { setDrag(null); setDropKey(null) },
    onDragOver: (e: React.DragEvent) => { if (canDropOn(ref)) { e.preventDefault(); setDropKey(refKey(ref)) } },
    onDrop: () => {
      const d0 = drag
      if (d0 && canDropOn(ref)) apply((d) => {
        if (levelOf(ref) === 'section') return moveSectionToIndex(d, d0.sectionId, d.sections.findIndex((x) => x.id === ref.sectionId))
        const sec = d.sections.find((x) => x.id === ref.sectionId)
        if (levelOf(ref) === 'block') return moveBlockToIndex(d, d0.sectionId, d0.blockId!, sec ? sec.blocks.findIndex((b) => b.id === ref.blockId) : 0)
        const blk = sec?.blocks.find((b) => b.id === ref.blockId)
        return moveElementToIndex(d, d0.sectionId, d0.blockId!, d0.elementId!, blk ? blk.elements.findIndex((e) => e.id === ref.elementId) : 0)
      })
      setDrag(null); setDropKey(null)
    },
  })

  /* ── publish: save the current doc, then push it to Shopify as native sections ── */
  const publish = useCallback(async () => {
    if (!doc) return
    setPublishing('saving')
    setPubResult(null)
    try {
      await fetch('/api/builder/doc', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, doc }) })
      setDirty(false)   // publish persists the current doc
      setPublishing('publishing')
      const r = await fetch('/api/builder/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId, target: 'this' }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d?.error) setPubResult({ error: d?.message || d?.error || 'Publish failed' })
      else setPubResult({ url: d.url, previewUrl: d.previewUrl })
    } catch (e) { setPubResult({ error: (e as Error)?.message || 'Publish failed' }) }
    setPublishing('idle')
  }, [doc, pageId])

  /* ── canvas render (edit mode) ── */
  const product = useMemo(() => (doc ? editorProduct(doc) : {}), [doc])
  const canvasHtml = useMemo(() => {
    if (!doc) return ''
    const rendered = renderDoc(doc, { mode: 'edit', device, product })
    const html = rendered.html
    // Mobile preview: @media rules key off the browser VIEWPORT (still wide), not the shrunk canvas — so the
    // template's mobile breakpoints never fire. Activate them here so the mobile preview reflows correctly.
    const css = device === 'mobile' ? activateMobileCss(rendered.css) : rendered.css
    // Also inline any per-section `data-mob` overrides (their @media rule wouldn't fire in the wide viewport).
    let body = html
    if (device === 'mobile' && typeof document !== 'undefined' && html.includes('data-mob')) {
      const box = document.createElement('div'); box.innerHTML = html
      box.querySelectorAll('[data-mob]').forEach((el) => { try { const o = JSON.parse(el.getAttribute('data-mob') || '{}'); for (const k in o) (el as HTMLElement).style.setProperty(k, o[k]) } catch { /* noop */ } })
      body = box.innerHTML
    }
    return `<style>${css}
[data-node-id]{outline:1px dashed transparent;outline-offset:-1px;transition:outline-color .1s}
[data-node-id]:hover{outline-color:rgba(224,47,6,.35);cursor:pointer}
[data-sel="1"]{outline:2px solid ${ORANGE} !important;outline-offset:-2px}
</style>${body}`
  }, [doc, device, product])

  /* mark the selected node in the rendered DOM + attach click selection */
  useEffect(() => {
    const root = canvasRef.current
    if (!root) return
    root.querySelectorAll('[data-sel="1"]').forEach((n) => n.removeAttribute('data-sel'))
    if (sel) {
      const node = root.querySelector(`[data-node-id="${sel.elementId || sel.blockId || sel.sectionId}"]`) as HTMLElement | null
      node?.setAttribute('data-sel', '1')
      // Selecting a section/block/element (from the tree or canvas) scrolls the preview to it — like Shopify.
      // 'nearest' means a canvas click on an already-visible node won't jump.
      node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [sel, canvasHtml])

  const onCanvasClick = useCallback((e: React.MouseEvent) => {
    const clicked = e.target as HTMLElement
    // In the editor a click SELECTS a piece — it must never follow a link or submit a form (e.g. the Add-to-Cart
    // <a> would otherwise navigate away from the editor).
    if (clicked.closest('a,button')) e.preventDefault()
    // Gallery: clicking a thumbnail swaps the MAIN image (preview interaction, like PagePilot and the
    // published storefront). Replacing/editing gallery images is still available from the tree.
    const thumb = clicked.closest('.thumbs img, img.gthumb, .gthumb img') as HTMLImageElement | null
    if (thumb && thumb.tagName === 'IMG') {
      const scope = (clicked.closest('[data-node-type^="section:"]') as HTMLElement | null) || canvasRef.current
      const main = scope?.querySelector('.hbottle, .gimg, .gtrack img, .gallery img:not(.thumbs img)') as HTMLImageElement | null
      const src = thumb.getAttribute('src')
      if (main && src && main !== thumb) {
        main.setAttribute('src', src)
        const ts = Array.from(scope?.querySelectorAll('.thumbs img') || []) as HTMLImageElement[]
        ts.forEach((t) => t.classList.toggle('on', t === thumb))
        e.stopPropagation(); return
      }
    }
    // Gallery prev/next arrows (‹ ›): cycle the main image through the thumbnail sources — same as PagePilot
    // and the published storefront. Works on the canvas even though the published driver script doesn't run here.
    const arrow = clicked.closest('.gprev, .gnext') as HTMLElement | null
    if (arrow) {
      const scope = (clicked.closest('[data-node-type^="section:"]') as HTMLElement | null) || canvasRef.current
      const main = scope?.querySelector('.hbottle, .gimg, .gallery img:not(.thumbs img)') as HTMLImageElement | null
      const ts = Array.from(scope?.querySelectorAll('.thumbs img') || []) as HTMLImageElement[]
      const srcs = ts.map((t) => t.getAttribute('src') || '').filter(Boolean)
      if (main && srcs.length) {
        const d = arrow.classList.contains('gnext') ? 1 : -1
        // Track the index on the element — indexOf(src) breaks when gallery images repeat (it always finds the
        // first duplicate, so the ring never advances past it).
        const cur = parseInt(main.getAttribute('data-gi') || '', 10)
        const base = Number.isFinite(cur) ? cur : Math.max(0, srcs.indexOf(main.getAttribute('src') || ''))
        const i = (base + d + srcs.length) % srcs.length
        main.setAttribute('src', srcs[i]); main.setAttribute('data-gi', String(i))
        ts.forEach((t, j) => t.classList.toggle('on', j === i))
      }
      e.stopPropagation(); return
    }
    const target = clicked.closest('[data-node-id]') as HTMLElement | null
    if (!target || !doc) { setSel(null); setRawSel(null); return }
    const id = target.getAttribute('data-node-id') || ''
    const nodeType = target.getAttribute('data-node-type') || ''
    const type = nodeType.split(':')[0]
    // Click INSIDE a raw section on one of its inner pieces → sub-select that piece so it can be moved,
    // hidden, deleted or (if an image) swapped — granular editing that keeps the template's exact design.
    if (nodeType === 'element:raw' && clicked !== target) {
      const item = snapUp(clicked, target)
      const path = subPathTo(item, target)
      if (path && path.length) {
        const isImg = item.tagName === 'IMG' || !!item.querySelector('img')
        for (const s of doc.sections) for (const b of s.blocks) for (const el of b.elements) if (el.id === id) {
          setExpanded((x) => { const n = new Set(x); n.add(s.id); n.add(b.id); return n })
          setSel({ sectionId: s.id, blockId: b.id, elementId: el.id })
          setRawSel({ ref: { sectionId: s.id, blockId: b.id, elementId: el.id }, path, isImg })
          return
        }
        return
      }
    }
    setRawSel(null)
    // resolve id → NodeRef by walking the model; also expand the tree so the selected node is revealed there
    for (const s of doc.sections) {
      if (s.id === id) { setSel({ sectionId: s.id }); return }
      for (const b of s.blocks) {
        if (b.id === id) { setExpanded((x) => new Set(x).add(s.id)); setSel({ sectionId: s.id, blockId: b.id }); return }
        for (const el of b.elements) if (el.id === id) { setExpanded((x) => { const n = new Set(x); n.add(s.id); n.add(b.id); return n }); setSel({ sectionId: s.id, blockId: b.id, elementId: el.id }); return }
      }
    }
    void type
  }, [doc])

  /* inline text edit: double-click a text/heading element */
  const onCanvasDouble = useCallback((e: React.MouseEvent) => {
    const clicked = e.target as HTMLElement
    const target = clicked.closest('[data-node-type^="element:"]') as HTMLElement | null
    if (!target || !doc) return
    const type = (target.getAttribute('data-node-type') || '').split(':')[1]
    if (!['text', 'heading', 'price', 'button', 'badge', 'raw'].includes(type)) return
    const id = target.getAttribute('data-node-id') || ''
    let ref: NodeRef | null = null
    for (const s of doc.sections) for (const b of s.blocks) for (const el of b.elements) if (el.id === id) ref = { sectionId: s.id, blockId: b.id, elementId: el.id }
    if (!ref) return
    const cur = findElement(doc, ref)
    if (cur?.content.bind) return // bound to product — not free-text editable here
    const isRaw = type === 'raw'
    // A `raw` (bespoke-template) section holds the whole slice's HTML. Editing the ENTIRE slice as one
    // contentEditable blob is fragile and unlike PagePilot — so make ONLY the piece the user double-clicked
    // editable (the h1, the price span, that paragraph…) and save just that piece back into the slice by its
    // child-path. The template's layout/CSS is untouched, so the design stays identical. Falls back to the
    // whole slice only when the click can't be resolved to a sub-piece.
    let editEl: HTMLElement = target
    let subPath: number[] | null = null
    if (isRaw && clicked !== target) {
      const item = snapUp(clicked, target)
      const p = subPathTo(item, target)
      if (p && p.length) { editEl = item; subPath = p }
    }
    editEl.setAttribute('contenteditable', 'true')
    editEl.focus()
    // Place the caret where the user clicked so they can type immediately (PagePilot-style).
    try {
      const doc2 = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }
      const r = doc2.caretRangeFromPoint?.(e.clientX, e.clientY)
      if (r) { const sgel = window.getSelection(); sgel?.removeAllRanges(); sgel?.addRange(r) }
    } catch { /* caret is best-effort */ }
    const finish = () => {
      editEl.removeAttribute('contenteditable')
      const nextInner = editEl.innerHTML
      const rf = ref!
      if (isRaw && subPath) {
        apply((d) => {
          const el = findElement(d, rf)
          const h = (el?.content as { html?: string } | undefined)?.html
          if (typeof h !== 'string') return d
          const next = rawHtmlOp(h, subPath!, 'sethtml', nextInner)
          return next === h ? d : patchElementContent(d, rf, { html: next })
        })
      } else if (isRaw) {
        apply((d) => patchElementContent(d, rf, { html: nextInner }))
      } else {
        apply((d) => patchElementContent(d, rf, { text: editEl.textContent || '' }))
      }
      editEl.removeEventListener('blur', finish)
    }
    editEl.addEventListener('blur', finish)
  }, [doc, apply])

  /* keyboard: cmd/ctrl+Z undo, Delete removes selection */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement)?.isContentEditable || ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      if (editing) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) saveNow() }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); redo() }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo() }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo() }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) { e.preventDefault(); apply((d) => removeNode(d, sel), null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sel, undo, redo, apply, dirty, saveNow])

  /* ── Edit Product + page settings write into the doc ── */
  const onProduct = useCallback((patch: Record<string, unknown>) => {
    apply((d) => ({ ...d, productRef: { ...d.productRef, importedProduct: { ...(d.productRef?.importedProduct || {}), ...patch } } }))
  }, [apply])
  const onSettings = useCallback((patch: Record<string, unknown>) => {
    apply((d) => ({ ...d, settings: { ...(d.settings || { locale: 'en' }), seo: { ...((d.settings as { seo?: object })?.seo || {}), ...patch } } as PageDoc['settings'] }))
  }, [apply])

  /* ── floating canvas toolbar: fixed to the viewport over the selected node (survives scroll + zoom) ── */
  const measureTb = useCallback(() => {
    const root = canvasRef.current
    if (!root || !sel) { setTb(null); return }
    const node = root.querySelector(`[data-node-id="${sel.elementId || sel.blockId || sel.sectionId}"]`) as HTMLElement | null
    if (!node) { setTb(null); return }
    const r = node.getBoundingClientRect()
    const below = r.top < 96                              // node hugs the top bar → drop the toolbar below it
    setTb({ top: below ? r.top + 6 : r.top - 6, left: Math.max(8, r.left), below })
  }, [sel])
  useEffect(() => { measureTb() }, [measureTb, canvasHtml, device, zoom])
  useEffect(() => {
    const main = mainRef.current
    const on = () => measureTb()
    main?.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on)
    return () => { main?.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [measureTb])

  /* ── raw sub-selection toolbar: over the individual piece clicked inside a raw section ── */
  const rawNodeEl = useCallback((): HTMLElement | null => {
    const root = canvasRef.current
    if (!root || !rawSel) return null
    const rawRoot = root.querySelector(`[data-node-id="${rawSel.ref.elementId}"]`) as HTMLElement | null
    if (!rawRoot) return null
    let node: HTMLElement = rawRoot
    for (const idx of rawSel.path) { const kid = node.children[idx] as HTMLElement | undefined; if (!kid) return null; node = kid }
    return node === rawRoot ? null : node
  }, [rawSel])
  const measureRawTb = useCallback(() => {
    const node = rawNodeEl()
    if (!node) { setRawTb(null); setRawBox(null); return }
    const r = node.getBoundingClientRect()
    const below = r.top < 96
    setRawTb({ top: below ? r.bottom + 6 : r.top - 6, left: Math.max(8, r.left), below })
    setRawBox({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [rawNodeEl])
  useEffect(() => { measureRawTb() }, [measureRawTb, canvasHtml, device, zoom])
  useEffect(() => {
    const main = mainRef.current
    const on = () => measureRawTb()
    main?.addEventListener('scroll', on, { passive: true }); window.addEventListener('resize', on)
    return () => { main?.removeEventListener('scroll', on); window.removeEventListener('resize', on) }
  }, [measureRawTb])
  // Drop the raw sub-selection when the main selection moves off the raw element (tree click, etc.).
  useEffect(() => { if (rawSel && (!sel || sel.elementId !== rawSel.ref.elementId)) setRawSel(null) }, [sel, rawSel])
  useEffect(() => { if (!rawSel) setRawAddOpen(false) }, [rawSel])
  // Make the selected raw piece draggable so it can be dragged to reorder among its siblings.
  useEffect(() => { const n = rawNodeEl(); if (n) { n.setAttribute('draggable', 'true'); return () => n.removeAttribute('draggable') } }, [rawNodeEl, canvasHtml])
  // Apply a raw op to ANY piece by (ref, path) — the core used by both the canvas toolbar (via rawSel) and
  // the left outline tree's per-row buttons (move / hide / duplicate / delete on a specific piece).
  const rawApplyAt = useCallback((ref: NodeRef, path: number[], op: RawOp, arg?: string) => {
    if (!doc) return
    const cur = findElement(doc, ref)
    const html = (cur?.content as { html?: string } | undefined)?.html
    if (typeof html !== 'string') return
    let a = arg
    // Image URL is set from an inline panel field now (no browser prompt) — a bare 'img' op just no-ops.
    if (op === 'img' && (a == null || !a.trim())) return
    const next = rawHtmlOp(html, path, op, a)
    if (next === html) return
    apply((d) => patchElementContent(d, ref, { html: next }))
    if (op === 'delete' && rawSel && rawSel.ref.elementId === ref.elementId && rawSel.path.join('.') === path.join('.')) setRawSel(null)
  }, [doc, apply, rawSel])
  const rawOp = useCallback((op: RawOp) => {
    if (!rawSel) return
    rawApplyAt(rawSel.ref, rawSel.path, op)
  }, [rawSel, rawApplyAt])
  // Select a raw piece from the left tree: mirror a canvas click (main sel + raw sub-selection) and scroll
  // the piece into view so the canvas + settings panel follow the tree.
  const selectRawPath = useCallback((ref: NodeRef, path: number[], isImg: boolean) => {
    setExpanded((x) => { const n = new Set(x); n.add(ref.sectionId); if (ref.blockId) n.add(ref.blockId); return n })
    setSel(ref); setRawSel({ ref, path, isImg })
    queueMicrotask(() => {
      const root = canvasRef.current?.querySelector(`[data-node-id="${ref.elementId}"]`) as HTMLElement | null
      if (!root) return
      let node: HTMLElement = root
      for (const idx of path) { const kid = node.children[idx] as HTMLElement | undefined; if (!kid) return; node = kid }
      node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
  }, [])
  // When a raw piece is selected (from the canvas OR the tree), open EVERY ancestor node in the left tree so the
  // selected row is actually rendered — only then can it show its highlight and scroll into view. Fixes "select a
  // block in the center preview → it isn't highlighted in the left panel" (the row was inside a collapsed group).
  const revealRawInTree = useCallback((ref: NodeRef, path: number[]) => {
    const s = doc?.sections.find((x) => x.id === ref.sectionId); if (!s || s.blocks.length !== 1) return
    const el0 = s.blocks[0].elements[0]
    const html = el0 && el0.type === 'raw' ? (el0.content as { html?: string } | undefined)?.html : undefined
    if (typeof html !== 'string') return
    let nodes = buildRawOutline(html)
    // mirror flattenOutline: drop leading generic wrappers so node paths line up with the rendered tree
    let guard = 0
    while (nodes.length === 1 && nodes[0].children.length > 1 && /^(Row|Group|Section|Group \((Horizontal|Vertical)\))$/.test(nodes[0].label) && guard++ < 4) nodes = nodes[0].children
    const isPrefix = (a: number[]) => a.length <= path.length && a.every((v, i) => v === path[i])
    const keys: string[] = []
    const walk = (arr: RawOutlineNode[]) => { for (const n of arr) if (isPrefix(n.path)) { if (n.children.length) keys.push(`${ref.elementId}#${n.path.join('.')}`); walk(n.children) } }
    walk(nodes)
    setExpanded((x) => { const nx = new Set(x); nx.add(ref.sectionId); if (ref.blockId) nx.add(ref.blockId); keys.forEach((k) => nx.add(k)); return nx })
    queueMicrotask(() => { if (typeof document !== 'undefined') document.querySelector(`[data-rawkey="${ref.elementId}#${path.join('.')}"]`)?.scrollIntoView({ block: 'nearest' }) })
  }, [doc])
  useEffect(() => { if (rawSel) revealRawInTree(rawSel.ref, rawSel.path) }, [rawSel, revealRawInTree])
  // Set one inline CSS property on the selected raw piece (colour, size, padding, …) — edits the real
  // template design in place so the look is preserved and every piece is individually styleable.
  const rawStyle = useCallback((prop: string, value: string) => {
    if (!rawSel || !doc) return
    const cur = findElement(doc, rawSel.ref)
    const html = (cur?.content as { html?: string } | undefined)?.html
    if (typeof html !== 'string') return
    const next = rawHtmlOp(html, rawSel.path, 'style', `${prop}::${value}`)
    if (next === html) return
    const ref = rawSel.ref
    apply((d) => patchElementContent(d, ref, { html: next }))
  }, [rawSel, doc, apply])
  // Current inline value of a CSS prop on the selected raw piece (for the settings panel inputs).
  const rawStyleVal = useCallback((prop: string): string => {
    const n = rawNodeEl(); return n ? (n.style.getPropertyValue(prop) || '') : ''
  }, [rawNodeEl])
  // The selected piece's PagePilot-style name (panel heading) + its editable text (panel content field, only
  // when the piece is a text leaf — a container with child pieces has no single text field).
  const rawName = useCallback((): string => { const n = rawNodeEl(); return n ? rawLabelFor(n) : 'Item' }, [rawNodeEl])
  const rawText = useCallback((): string => {
    const n = rawNodeEl(); if (!n) return ''
    if (Array.from(n.children).some((c) => (c.textContent || '').trim())) return ''   // container → edit its sub-pieces instead
    return n.textContent || ''
  }, [rawNodeEl])
  const rawSetText = useCallback((t: string) => { if (rawSel) rawApplyAt(rawSel.ref, rawSel.path, 'settext', t) }, [rawSel, rawApplyAt])
  // "Edit with AI" straight from the canvas toolbar — rewrites the selected text piece in the brand voice.
  const rawEditAI = useCallback(async () => {
    if (!rawSel) return
    const t = rawText(); if (!t.trim()) return
    setRawAIbusy(true)
    try {
      const r = await fetch('/api/builder/rewrite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t, context: doc?.productRef?.importedProduct?.title || '' }) })
      const j = await r.json()
      if (j.text) rawSetText(j.text); else window.alert(j.error || 'Could not rewrite.')
    } catch { window.alert('Could not rewrite — please try again.') }
    finally { setRawAIbusy(false) }
  }, [rawSel, rawText, rawSetText, doc])
  // Rich text (PagePilot-style editor): a piece is "text" when it's not an image/gallery/pays row and its
  // children (if any) are only inline formatting — so its innerHTML can be edited safely with a toolbar.
  const rawIsText = useCallback((): boolean => {
    const n = rawNodeEl(); if (!n || rawSel?.isImg) return false
    if (n.classList?.contains('pays') || n.querySelector('.pays, .payicon, .thumbs, .gtrack, .hbottle, .gimg')) return false
    const kids = Array.from(n.children) as HTMLElement[]
    if (kids.length && !kids.every((k) => RICH_INLINE.has(k.tagName))) return false
    return !!(n.textContent || '').trim()
  }, [rawNodeEl, rawSel])
  const rawHtml = useCallback((): string => { const n = rawNodeEl(); return n ? n.innerHTML : '' }, [rawNodeEl])
  const rawSetHtml = useCallback((h: string) => { if (rawSel) rawApplyAt(rawSel.ref, rawSel.path, 'sethtml', h) }, [rawSel, rawApplyAt])
  // Link/button destination editing (bug: "Shop Now button not working" — make its link editable in-editor).
  const rawIsLink = useCallback((): boolean => { const n = rawNodeEl(); return !!n && (n.tagName === 'A' || !!n.querySelector('a')) }, [rawNodeEl])
  const rawHref = useCallback((): string => { const n = rawNodeEl(); if (!n) return ''; const a = (n.tagName === 'A' ? n : n.querySelector('a')) as HTMLAnchorElement | null; return a?.getAttribute('href') || '' }, [rawNodeEl])
  const rawSetHref = useCallback((url: string) => { if (rawSel) rawApplyAt(rawSel.ref, rawSel.path, 'sethref', url) }, [rawSel, rawApplyAt])
  const rawRename = useCallback((name: string) => { if (rawSel) rawApplyAt(rawSel.ref, rawSel.path, 'setname', name) }, [rawSel, rawApplyAt])
  // Upload an image file → presigned R2 PUT → returns the public URL (matches PagePilot's "Select files").
  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const r = await fetch('/api/builder/upload-url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contentType: file.type, size: file.size }) })
      const j = await r.json()
      if (!j.uploadUrl) throw new Error(j.error || 'upload failed')
      const put = await fetch(j.uploadUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file })
      if (!put.ok) throw new Error('upload failed')
      return j.publicUrl as string
    } catch { window.alert('Image upload failed — please try again.'); return null }
  }, [])
  // Flexible raw editor: parse the selected slice's HTML, let a mutator edit any descendants, save the result.
  const rawEditHtml = useCallback((ref: NodeRef, mutate: (box: HTMLElement) => void) => {
    if (!doc) return
    const cur = findElement(doc, ref)
    const html = (cur?.content as { html?: string } | undefined)?.html
    if (typeof html !== 'string') return
    const box = document.createElement('div'); box.innerHTML = html
    mutate(box)
    const next = box.innerHTML
    if (next !== html) apply((d) => patchElementContent(d, ref, { html: next }))
  }, [doc, apply])
  // ── Add to Cart button (matches PagePilot: Label + Icon; the product is ALWAYS dynamic, so no editable link) ──
  const cartBtnEl = useCallback((): HTMLElement | null => {
    const n = rawNodeEl(); if (!n) return null
    const el = (n.matches?.('a,button') ? n : (n.closest('a,button') || n.querySelector('a,button'))) as HTMLElement | null
    if (!el) return null
    const t = el.textContent || ''
    const cart = t.includes('🛒') || /add to cart|add to bag/i.test(t) || el.classList.contains('buy') || el.classList.contains('atc')
    return cart ? el : null
  }, [rawNodeEl])
  const rawIsCart = useCallback((): boolean => !!cartBtnEl(), [cartBtnEl])
  const cartParseEl = (btn: HTMLElement): { icon: string; label: string; show: boolean; pos: 'left' | 'right'; size: number } => {
    const ds = btn.dataset
    if (ds.lbl != null) return { icon: ds.ico || '🛒', label: ds.lbl || '', show: ds.icoShow !== '0', pos: (ds.icoPos === 'right' ? 'right' : 'left'), size: ds.icoSize ? parseInt(ds.icoSize) : 0 }
    const raw = (btn.textContent || '').trim()
    let i = 0; while (i < raw.length && !/[A-Za-z0-9]/.test(raw[i]) && raw[i] !== ' ') i++
    const rawIcon = raw.slice(0, i).trim(); const label = raw.slice(i).trim()
    const icon = rawIcon === '🛒' ? 'cart' : (rawIcon || 'cart')   // default the legacy emoji cart to the SVG cart
    return { icon, label: label || raw, show: !!rawIcon, pos: 'left', size: 0 }
  }
  const cartCfg = useCallback(() => { const b = cartBtnEl(); return b ? cartParseEl(b) : { icon: '🛒', label: '', show: true, pos: 'left' as const, size: 0 } }, [cartBtnEl])
  const setCart = useCallback((patch: Partial<{ icon: string; label: string; show: boolean; pos: 'left' | 'right'; size: number }>) => {
    if (!rawSel) return
    rawEditHtml(rawSel.ref, (box) => {
      let node: HTMLElement = box
      for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k }
      const btn = (node.matches?.('a,button') ? node : (node.closest('a,button') || node.querySelector('a,button'))) as HTMLElement | null
      if (!btn) return
      const cfg = { ...cartParseEl(btn), ...patch }
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const ico = cfg.show && cfg.icon
        ? (LINE_ICONS[cfg.icon]
          ? `<span class="atcico" style="display:inline-flex;align-items:center">${svgIcon(LINE_ICONS[cfg.icon], cfg.size || 18)}</span>`
          : `<span class="atcico" style="${cfg.size ? `font-size:${cfg.size}px;` : ''}">${esc(cfg.icon)}</span>`)
        : ''
      const lbl = `<span class="atclbl">${esc(cfg.label)}</span>`
      btn.innerHTML = cfg.pos === 'right' ? `${lbl}${ico ? ' ' + ico : ''}` : `${ico ? ico + ' ' : ''}${lbl}`
      btn.setAttribute('data-ico', cfg.icon); btn.setAttribute('data-ico-show', cfg.show ? '1' : '0'); btn.setAttribute('data-ico-pos', cfg.pos); btn.setAttribute('data-lbl', cfg.label)
      if (cfg.size) btn.setAttribute('data-ico-size', String(cfg.size)); else btn.removeAttribute('data-ico-size')
    })
  }, [rawSel, rawEditHtml])
  // ── Save Badge (matches PagePilot: dynamic saving computed from Price & Compare price; Percentage or Value) ──
  const saveEl = useCallback((): HTMLElement | null => {
    const n = rawNodeEl(); if (!n) return null
    return (n.classList?.contains('save') ? n : (n.querySelector('.save') || n.closest('.save'))) as HTMLElement | null
  }, [rawNodeEl])
  const rawIsSave = useCallback((): boolean => !!saveEl(), [saveEl])
  const saveCfg = useCallback(() => { const el = saveEl(); return { mode: (el?.dataset.saveMode === 'value' ? 'value' : 'percent') as 'percent' | 'value', show: el ? el.dataset.saveShow !== '0' : true } }, [saveEl])
  const parseMoney = (s: string): { num: number; prefix: string } => {
    const num = parseFloat((s || '').replace(/[^\d.]/g, '')) || 0
    const m = (s || '').match(/^[^\d]*/); const raw = (m ? m[0] : '').trim()
    // a word prefix ("PKR", "Rs") gets a space ("PKR 600"); a symbol ("$", "€", "₹") does not ("$8")
    return { num, prefix: raw ? (/[A-Za-z]$/.test(raw) ? raw + ' ' : raw) : '' }
  }
  const setSaveBadge = useCallback((patch: Partial<{ mode: 'percent' | 'value'; show: boolean }>) => {
    if (!rawSel) return
    rawEditHtml(rawSel.ref, (box) => {
      let node: HTMLElement = box
      for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k }
      const el = (node.classList?.contains('save') ? node : (node.querySelector('.save') || node.closest('.save'))) as HTMLElement | null
      if (!el) return
      const mode = patch.mode ?? (el.dataset.saveMode === 'value' ? 'value' : 'percent')
      const show = patch.show ?? (el.dataset.saveShow !== '0')
      // read Compare (.was) & Sale (.now) from the same price row so the badge is dynamic, not typed
      const row = (el.closest('.price') || el.parentElement || box) as HTMLElement
      const was = parseMoney((row.querySelector('.was')?.textContent) || '')
      const now = parseMoney((row.querySelector('.now')?.textContent) || '')
      let txt = el.textContent || 'SAVE'
      if (was.num > 0 && now.num > 0 && was.num > now.num) {
        txt = mode === 'value' ? `SAVE ${now.prefix}${Math.round(was.num - now.num).toLocaleString()}` : `SAVE ${Math.round((1 - now.num / was.num) * 100)}%`
      }
      el.textContent = txt
      el.setAttribute('data-save-mode', mode); el.setAttribute('data-save-show', show ? '1' : '0')
      el.style.display = show ? '' : 'none'
    })
  }, [rawSel, rawEditHtml])
  // ── List-item icon (matches PagePilot: pick / remove the icon on a benefit or ingredient row) ────────────
  const iconHolderEl = useCallback((): HTMLElement | null => {
    const n = rawNodeEl(); if (!n) return null
    if (/^(t|ic|chip|slchip)$/.test(n.className)) return n
    return (n.querySelector('.t, .slchip, .chip, .ic') || (n.closest('.c, .hchecks .c, .slchip') ? n.closest('.c, .slchip')?.querySelector('.t, .slchip, .chip, .ic') : null)) as HTMLElement | null
  }, [rawNodeEl])
  const rawIsIconItem = useCallback((): boolean => !!iconHolderEl(), [iconHolderEl])
  const itemIcon = useCallback((): string => { const h = iconHolderEl(); if (!h || h.style.display === 'none') return ''; return h.dataset.ico || '' }, [iconHolderEl])
  const setItemIcon = useCallback((icon: string) => {
    if (!rawSel) return
    rawEditHtml(rawSel.ref, (box) => {
      let node: HTMLElement = box
      for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k }
      const h = (/^(t|ic|chip|slchip)$/.test(node.className) ? node : (node.querySelector('.t, .slchip, .chip, .ic') || node.closest('.c, .slchip')?.querySelector('.t, .slchip, .chip, .ic'))) as HTMLElement | null
      if (!h) return
      if (!icon) { h.style.display = 'none'; h.removeAttribute('data-ico') }
      else { h.style.display = ''; h.setAttribute('data-ico', icon); h.innerHTML = LINE_ICONS[icon] ? svgIcon(LINE_ICONS[icon], 16) : icon }
    })
  }, [rawSel, rawEditHtml])
  // ── Percentage Circle (stat ring) — PagePilot's Animation/size panel for the .ring conic circles ─────────
  const ringNodeEl = useCallback((): HTMLElement | null => {
    const n = rawNodeEl(); if (!n) return null
    return (n.classList?.contains('ring') ? n : (n.querySelector('.ring') || n.closest('.ring'))) as HTMLElement | null
  }, [rawNodeEl])
  const rawIsRing = useCallback((): boolean => !!ringNodeEl(), [ringNodeEl])
  const ringVal = useCallback((prop: string): string => { const r = ringNodeEl(); return r ? r.style.getPropertyValue(prop) : '' }, [ringNodeEl])
  const ringPct = useCallback((): string => { const r = ringNodeEl(); if (!r) return ''; return r.style.getPropertyValue('--pt') || ((r.textContent || '').match(/\d+/)?.[0] || '') }, [ringNodeEl])
  const ringSize = useCallback((): string => { const r = ringNodeEl(); return r ? (parseFloat(getComputedStyle(r).width) ? String(Math.round(parseFloat(r.style.width || getComputedStyle(r).width))) : '') : '' }, [ringNodeEl])
  const editRing = useCallback((mutate: (ring: HTMLElement) => void) => {
    if (!rawSel) return
    rawEditHtml(rawSel.ref, (box) => {
      let node: HTMLElement = box
      for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k }
      const ring = (node.classList?.contains('ring') ? node : (node.querySelector('.ring') || node.closest('.ring'))) as HTMLElement | null
      if (ring) mutate(ring)
    })
  }, [rawSel, rawEditHtml])
  const setRingPct = useCallback((v: string) => { const n = (v || '').replace(/[^\d.]/g, '') || '0'; editRing((r) => { r.style.setProperty('--pt', n); const rc = r.querySelector('.rc'); if (rc) rc.textContent = `${n}%` }) }, [editRing])
  const setRingStyle = useCallback((prop: string, v: string) => editRing((r) => { if (v) r.style.setProperty(prop, v); else r.style.removeProperty(prop) }), [editRing])
  const setRingSize = useCallback((v: string) => editRing((r) => { if (v) { r.style.width = `${v}px`; r.style.height = `${v}px` } else { r.style.removeProperty('width'); r.style.removeProperty('height') } }), [editRing])
  // ── Logo (As Seen On / press logos) — upload a logo IMAGE in place of the text name (like PagePilot) ─────
  const rawIsLogo = useCallback((): boolean => { const n = rawNodeEl(); return !!n && (n.classList?.contains('logo') || n.classList?.contains('plogo')) }, [rawNodeEl])
  const rawLogoImg = useCallback((): string => { const n = rawNodeEl(); const im = n?.querySelector('img'); return im?.getAttribute('src') || '' }, [rawNodeEl])
  const setLogoImage = useCallback((url: string) => { if (!rawSel) return; rawEditHtml(rawSel.ref, (box) => { let node: HTMLElement = box; for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k } if (node) node.innerHTML = url ? `<img src="${url}" alt="logo" style="height:30px;max-width:130px;object-fit:contain;display:block">` : (node.getAttribute('data-name') || 'Logo') }) }, [rawSel, rawEditHtml])
  // ── Accordion (the .acc info block of <details> rows) — PagePilot lets you add/remove rows ────────────────
  const accEl = useCallback((): HTMLElement | null => { const n = rawNodeEl(); if (!n) return null; return (n.classList?.contains('acc') ? n : (n.querySelector('.acc') || n.closest('.acc'))) as HTMLElement | null }, [rawNodeEl])
  const rawIsAcc = useCallback((): boolean => !!accEl(), [accEl])
  const accRows = useCallback((): string[] => { const a = accEl(); return a ? Array.from(a.querySelectorAll(':scope > details')).map((d) => (d.querySelector('summary')?.textContent || 'Section')) : [] }, [accEl])
  const editAcc = useCallback((mutate: (acc: HTMLElement) => void) => { if (!rawSel) return; rawEditHtml(rawSel.ref, (box) => { let node: HTMLElement = box; for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k } const a = (node.classList?.contains('acc') ? node : (node.querySelector('.acc') || node.closest('.acc'))) as HTMLElement | null; if (a) mutate(a) }) }, [rawSel, rawEditHtml])
  const accAddRow = useCallback(() => editAcc((a) => a.insertAdjacentHTML('beforeend', '<details><summary>New section</summary><div class="body">Add details here.</div></details>')), [editAcc])
  const accRemoveRow = useCallback((i: number) => editAcc((a) => { const d = a.querySelectorAll(':scope > details')[i] as HTMLElement | undefined; d?.remove() }), [editAcc])
  // ── Variant Picker (the .vpick "Make a Choice" options) — Style (Buttons/Dropdown) + add/remove options ──
  const vpickEl = useCallback((): HTMLElement | null => { const n = rawNodeEl(); if (!n) return null; return (n.classList?.contains('vpick') ? n : (n.querySelector('.vpick') || n.closest('.vpick'))) as HTMLElement | null }, [rawNodeEl])
  const rawIsVpick = useCallback((): boolean => !!vpickEl(), [vpickEl])
  const vpickIsList = useCallback((): boolean => !!vpickEl()?.classList.contains('list'), [vpickEl])
  const vpickOpts = useCallback((): string[] => { const v = vpickEl(); return v ? Array.from(v.querySelectorAll('.vopt')).map((o) => o.textContent || 'Option') : [] }, [vpickEl])
  const editVpick = useCallback((mutate: (v: HTMLElement) => void) => { if (!rawSel) return; rawEditHtml(rawSel.ref, (box) => { let node: HTMLElement = box; for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k } const v = (node.classList?.contains('vpick') ? node : (node.querySelector('.vpick') || node.closest('.vpick'))) as HTMLElement | null; if (v) mutate(v) }) }, [rawSel, rawEditHtml])
  const vpickSetList = useCallback((list: boolean) => editVpick((v) => v.classList.toggle('list', list)), [editVpick])
  const vpickAdd = useCallback(() => editVpick((v) => { const o = v.querySelector('.vopts'); if (o) o.insertAdjacentHTML('beforeend', '<button class="vopt" type="button">New option</button>') }), [editVpick])
  const vpickRemove = useCallback((i: number) => editVpick((v) => { const o = v.querySelectorAll('.vopt')[i] as HTMLElement | undefined; o?.remove() }), [editVpick])
  // Variant Picker option text styling (matches PagePilot: size / weight / spacing / case / colour + gap)
  const vpickStyleVal = useCallback((prop: string): string => { const v = vpickEl(); const o = v?.querySelector('.vopt') as HTMLElement | null; return o?.style.getPropertyValue(prop) || '' }, [vpickEl])
  const setVpickTextStyle = useCallback((prop: string, val: string) => { editVpick((v) => v.querySelectorAll('.vopt').forEach((o) => { if (val) (o as HTMLElement).style.setProperty(prop, val); else (o as HTMLElement).style.removeProperty(prop) })) }, [editVpick])
  const vpickGapVal = useCallback((): string => { const v = vpickEl(); const o = v?.querySelector('.vopts') as HTMLElement | null; return o?.style.gap || '' }, [vpickEl])
  const setVpickGap = useCallback((val: string) => { editVpick((v) => { const o = v.querySelector('.vopts') as HTMLElement | null; if (o) { if (val) o.style.gap = val; else o.style.removeProperty('gap') } }) }, [editVpick])
  // Gallery manager: list every <img> inside the selected gallery node with its child-path from the raw root,
  // so add / remove / replace work whether you select "Product Gallery" or the thumbnail strip (PagePilot).
  const rawGallery = useCallback((): { src: string; path: number[] }[] | null => {
    if (!rawSel) return null
    const root = canvasRef.current?.querySelector(`[data-node-id="${rawSel.ref.elementId}"]`) as HTMLElement | null
    const n = rawNodeEl(); if (!root || !n) return null
    const out = (Array.from(n.querySelectorAll('img')) as HTMLImageElement[])
      .map((im) => ({ src: im.getAttribute('src') || '', path: subPathTo(im, root) || [] }))
      .filter((x) => x.src && x.path.length) as { src: string; path: number[] }[]
    return out.length ? out : null
  }, [rawSel, rawNodeEl])
  const rawGalleryReplace = useCallback((path: number[], url: string) => { if (rawSel) rawApplyAt(rawSel.ref, path, 'img', url) }, [rawSel, rawApplyAt])
  const rawGalleryRemove = useCallback((path: number[]) => { if (rawSel) rawApplyAt(rawSel.ref, path, 'delete') }, [rawSel, rawApplyAt])
  const rawGalleryAdd = useCallback((url: string) => {
    if (!rawSel) return
    rawEditHtml(rawSel.ref, (box) => {
      let node: HTMLElement = box
      for (const idx of rawSel.path) { const kid = node.children[idx] as HTMLElement | undefined; if (!kid) { node = box; break } node = kid }
      const target = (node.querySelector('.thumbs') as HTMLElement | null) || node
      target.insertAdjacentHTML('beforeend', `<img src="${url.replace(/"/g, '&quot;')}" alt="" loading="lazy">`)
    })
  }, [rawSel, rawEditHtml])
  const rawSetImg = useCallback((url: string) => { if (rawSel) rawApplyAt(rawSel.ref, rawSel.path, 'img', url) }, [rawSel, rawApplyAt])
  // ── Product Gallery settings (matches PagePilot: Images + Select files + Create with AI + Sticky) ──────
  const galleryMainSel = '.hbottle, .gimg, .gtrack img'
  // A raw piece is a "gallery" when it (or the slice under it) has a .thumbs strip or a known main image.
  const rawIsGallery = useCallback((): boolean => {
    const n = rawNodeEl(); if (!n) return false
    // The bare thumbnail strip is NOT the gallery manager — the Images panel belongs on the ONE gallery
    // container (it already lists the thumbs), so selecting "Thumbnails" alone doesn't duplicate the panel.
    if (n.classList?.contains('thumbs')) return false
    return !!(n.querySelector('.thumbs, .hbottle, .gimg, .gtrack') || (Array.from(n.children).filter((c) => c.tagName === 'IMG' || c.querySelector('img')).length >= 2))
  }, [rawNodeEl])
  // The gallery COLUMN (direct child of the .grid that holds the main image) — the element we make sticky.
  const galleryColOf = (box: HTMLElement): HTMLElement | null => {
    const main = box.querySelector(galleryMainSel) as HTMLElement | null; if (!main) return null
    const grid = (main.closest('.grid') as HTMLElement | null) || (main.closest('.wrap') as HTMLElement | null)
    if (!grid) return (main.closest('.hcre') as HTMLElement | null) || main.parentElement
    let col: HTMLElement | null = main
    while (col && col.parentElement && col.parentElement !== grid) col = col.parentElement
    return col
  }
  const rawGallerySticky = useCallback((): boolean => {
    if (!rawSel || !doc) return false
    const cur = findElement(doc, rawSel.ref); const html = (cur?.content as { html?: string } | undefined)?.html
    if (typeof html !== 'string' || typeof document === 'undefined') return false
    const box = document.createElement('div'); box.innerHTML = html
    const col = galleryColOf(box); return !!(col && col.style.position === 'sticky')   // read the same node setGallerySticky writes
  }, [rawSel, doc])
  const setGallerySticky = useCallback((on: boolean) => {
    if (!rawSel) return
    rawEditHtml(rawSel.ref, (box) => {
      const col = galleryColOf(box); if (!col) return
      if (on) { col.style.position = 'sticky'; col.style.top = '16px'; col.style.alignSelf = 'flex-start' }
      else { col.style.position = ''; col.style.top = ''; col.style.alignSelf = '' }
    })
  }, [rawSel, rawEditHtml])
  const [galleryAIbusy, setGalleryAIbusy] = useState(false)
  // Create with AI — generate a product image (Gemini) via /api/builder/image and add it to the gallery.
  const galleryCreateAI = useCallback(async () => {
    if (!rawSel) return
    const prompt = window.prompt('Describe the product image you want to create:')
    if (!prompt || !prompt.trim()) return
    const n = rawNodeEl()
    const ref = (n?.querySelector(galleryMainSel) as HTMLImageElement | null)?.getAttribute('src') || undefined
    setGalleryAIbusy(true)
    try {
      const r = await fetch('/api/builder/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'generate', prompt: prompt.trim(), referenceUrl: ref }) })
      const j = await r.json()
      if (j.url) rawGalleryAdd(j.url); else window.alert(j.error || 'Could not generate the image.')
    } catch { window.alert('Could not generate the image — please try again.') }
    finally { setGalleryAIbusy(false) }
  }, [rawSel, rawNodeEl, rawGalleryAdd])
  // ── Payment Providers (matches PagePilot: real icons + a show/hide toggle list) ───────────────────────
  const rawIsPays = useCallback((): boolean => {
    const n = rawNodeEl(); if (!n) return false
    // Only the Payment Icons block itself gets the provider panel — not a container that merely holds it
    // (that container has its own things), so the settings live in ONE place. (.payicon = a single icon inside.)
    return !!(n.classList?.contains('pays') || n.classList?.contains('payicon') || n.closest('.pays'))
  }, [rawNodeEl])
  // Payment Icons row alignment (matches PagePilot: Left / Center / Right / Space between — real flex, not text)
  const paysRow = useCallback((): HTMLElement | null => { const n = rawNodeEl(); if (!n) return null; return (n.classList?.contains('pays') ? n : (n.closest('.pays') || n.querySelector('.pays'))) as HTMLElement | null }, [rawNodeEl])
  const paysAlignVal = useCallback((): string => { const p = paysRow(); const j = p?.style.justifyContent || ''; return j === 'flex-start' ? 'left' : j === 'center' ? 'center' : j === 'flex-end' ? 'right' : j === 'space-between' ? 'between' : (j || '') }, [paysRow])
  const paysGapVal = useCallback((): string => (paysRow()?.style.gap || '').replace('px', ''), [paysRow])
  const setPaysStyle = useCallback((prop: string, val: string) => { if (!rawSel) return; rawEditHtml(rawSel.ref, (box) => { let node: HTMLElement = box; for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k } const p = (node.classList?.contains('pays') ? node : (node.closest('.pays') || node.querySelector('.pays'))) as HTMLElement | null; if (!p) return; if (val) p.style.setProperty(prop, val); else p.style.removeProperty(prop) }) }, [rawSel, rawEditHtml])
  const setPaysAlign = useCallback((v: string) => { const map: Record<string, string> = { left: 'flex-start', center: 'center', right: 'flex-end', between: 'space-between' }; setPaysStyle('justify-content', map[v] || '') }, [setPaysStyle])
  const rawPaysActive = useCallback((): string[] => {
    const n = rawNodeEl(); if (!n) return []
    const pays = (n.classList?.contains('pays') ? n : (n.closest('.pays') || n.querySelector('.pays'))) as HTMLElement | null
    if (!pays) return []
    return Array.from(pays.querySelectorAll('.payicon')).map((e) => e.getAttribute('data-pay') || '').filter(Boolean)
  }, [rawNodeEl])
  const togglePayProvider = useCallback((id: string) => {
    if (!rawSel) return
    rawEditHtml(rawSel.ref, (box) => {
      let node: HTMLElement = box
      for (const i of rawSel.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k }
      const pays = (node.classList?.contains('pays') ? node : (node.closest('.pays') || node.querySelector('.pays'))) as HTMLElement | null
      if (!pays) return
      const existing = pays.querySelector(`.payicon[data-pay="${id}"]`)
      if (existing) { existing.remove(); return }
      const order = PAY_PROVIDERS.map((p) => p.id)
      const tmp = document.createElement('div'); tmp.innerHTML = payIcon(id)
      const el = tmp.firstElementChild as HTMLElement | null; if (!el) return
      const idxNew = order.indexOf(id)
      const after = Array.from(pays.querySelectorAll('.payicon')).find((s) => order.indexOf(s.getAttribute('data-pay') || '') > idxNew)
      if (after) pays.insertBefore(el, after); else pays.appendChild(el)
    })
  }, [rawSel, rawEditHtml])
  // Insert a ready-made piece right AFTER the selected raw piece (a sibling), then keep design intact.
  const rawInsert = useCallback((insertHtml: string) => {
    if (!rawSel || !doc) return
    const cur = findElement(doc, rawSel.ref)
    const html = (cur?.content as { html?: string } | undefined)?.html
    if (typeof html !== 'string') return
    const next = rawHtmlOp(html, rawSel.path, 'insert', insertHtml)
    if (next === html) return
    const ref = rawSel.ref
    apply((d) => patchElementContent(d, ref, { html: next }))
  }, [rawSel, doc, apply])
  // Insert a block at a chosen spot: 'append' drops it INSIDE the target container (PagePilot's per-container
  // "Add block" — e.g. below Product Gallery / inside Product Details); 'after' drops it as a sibling.
  const rawInsertAt = useCallback((insertHtml: string) => {
    if (!rawSel) return
    const target = rawInsertTarget || { path: rawSel.path, mode: 'after' as const }
    rawEditHtml(rawSel.ref, (box) => {
      let node: HTMLElement = box
      for (const i of target.path) { const k = node.children[i] as HTMLElement | undefined; if (!k) { node = box; break } node = k }
      if (target.mode === 'append') node.insertAdjacentHTML('beforeend', insertHtml)
      else node.insertAdjacentHTML('afterend', insertHtml)
    })
    setRawInsertTarget(null)
  }, [rawSel, rawInsertTarget, rawEditHtml])
  // Drag-reorder a raw piece: move the dragged path to before/after the drop-target path.
  const rawMove = useCallback((fromPath: number[], toPath: number[], after: boolean) => {
    if (!rawSel || !doc) return
    const cur = findElement(doc, rawSel.ref)
    const html = (cur?.content as { html?: string } | undefined)?.html
    if (typeof html !== 'string') return
    const next = rawHtmlMove(html, fromPath, toPath, after)
    if (next === html) return
    const ref = rawSel.ref
    apply((d) => patchElementContent(d, ref, { html: next }))
  }, [rawSel, doc, apply])
  // Drag-to-reorder a raw piece on the canvas: grab the selected piece, drop it on a sibling.
  const onCanvasDragStart = useCallback((e: React.DragEvent) => {
    if (!rawSel) return
    rawDrag.current = rawSel.path
    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'raw') } catch { /* noop */ }
  }, [rawSel])
  const onCanvasDragOver = useCallback((e: React.DragEvent) => { if (rawDrag.current) e.preventDefault() }, [])
  const onCanvasDrop = useCallback((e: React.DragEvent) => {
    const from = rawDrag.current; rawDrag.current = null
    if (!from || !rawSel) return
    e.preventDefault()
    const root = canvasRef.current?.querySelector(`[data-node-id="${rawSel.ref.elementId}"]`) as HTMLElement | null
    if (!root) return
    const item = snapUp(e.target as HTMLElement, root)
    const toPath = subPathTo(item, root)
    if (!toPath || !toPath.length) return
    const r = item.getBoundingClientRect()
    rawMove(from, toPath, e.clientY > r.top + r.height / 2)
  }, [rawSel, rawMove])

  // "Add block" into a container: if its children are homogeneous (all the same tag+class — e.g. review
  // cards, benefit rows, pills), one-click DUPLICATE the last one (PagePilot's "+ Add Block" on a carousel
  // adds another item of the same kind). Otherwise open the block library to insert into this container.
  const addIntoContainer = useCallback((ref: NodeRef, node: RawOutlineNode) => {
    const root = canvasRef.current?.querySelector(`[data-node-id="${ref.elementId}"]`) as HTMLElement | null
    let el: HTMLElement | null = root
    if (el) for (const i of node.path) { el = (el.children[i] as HTMLElement) || null; if (!el) break }
    const kids = el ? (Array.from(el.children) as HTMLElement[]).filter((k) => !k.classList.contains('garr')) : []
    const sig = (k: HTMLElement) => k.tagName + '.' + (k.className || '')
    const homogeneous = kids.length >= 2 && new Set(kids.map(sig)).size === 1
    if (homogeneous) {
      const lastPath = [...node.path, kids.length - 1]
      rawApplyAt(ref, lastPath, 'dup')
      selectRawPath(ref, lastPath, false)
    } else {
      selectRawPath(ref, node.path, node.isImg)
      setRawInsertTarget({ path: node.path, mode: 'append' })
      setRawLibOpen(true)
    }
  }, [rawApplyAt, selectRawPath])

  if (status === 'loading') return <Center>Loading editor…</Center>
  if (status === 'error' && !doc) return <Center>{err || 'Could not load the page.'} <Link href="/builder" style={{ color: ORANGE, marginLeft: 8 }}>Back</Link></Center>
  if (!doc) return <Center>No page.</Center>

  const canvasWidth = device === 'mobile' ? 402 : 1000

  // A "raw section" = one group block wrapping a single bespoke-template raw element. We render its parsed
  // OUTLINE (named pieces) in place of the "Group"/"raw" rows, so the tree looks like PagePilot.
  const rawSectionEl = (s: PageDoc['sections'][number]): { ref: NodeRef; html: string } | null => {
    if (s.blocks.length !== 1) return null
    const b = s.blocks[0]
    if (b.elements.length !== 1 || b.elements[0].type !== 'raw') return null
    const html = (b.elements[0].content as { html?: string } | undefined)?.html
    if (typeof html !== 'string') return null
    return { ref: { sectionId: s.id, blockId: b.id, elementId: b.elements[0].id }, html }
  }
  // ── Section-level settings (bug D): style the raw section's OUTER wrapper (path [0]) so the user can set the
  // whole section's background, padding, width and alignment — matching PagePilot's section panel. ──────────
  const secRaw = (sectionId: string) => { const s = doc?.sections.find((x) => x.id === sectionId); return s ? rawSectionEl(s) : null }
  const sectionRename = (sectionId: string, name: string) => { const re = secRaw(sectionId); if (re) rawApplyAt(re.ref, [0], 'setname', name) }
  const sectionStyleVal = (sectionId: string, prop: string): string => {
    const re = secRaw(sectionId); if (!re || typeof document === 'undefined') return ''
    const box = document.createElement('div'); box.innerHTML = re.html
    const root = box.children[0] as HTMLElement | undefined
    return root?.style.getPropertyValue(prop) || ''
  }
  const sectionStyle = (sectionId: string, prop: string, value: string) => {
    const re = secRaw(sectionId); if (!re) return
    const next = rawHtmlOp(re.html, [0], 'style', `${prop}::${value}`)
    if (next !== re.html) apply((d) => patchElementContent(d, re.ref, { html: next }))
  }
  // The section's main content grid (for Gap / Columns) — the first grid/flex row inside the section.
  const sectionGridEl = (box: HTMLElement): HTMLElement | null =>
    (box.querySelector('.grid, .row, .rgrid, .fgrid, .sgrid, [style*="grid-template"], [style*="display:flex"], [style*="display: flex"]') as HTMLElement | null)
  const sectionInnerVal = (sectionId: string, prop: string): string => {
    const re = secRaw(sectionId); if (!re || typeof document === 'undefined') return ''
    const box = document.createElement('div'); box.innerHTML = re.html
    return (sectionGridEl(box)?.style.getPropertyValue(prop)) || ''
  }
  const sectionInnerStyle = (sectionId: string, prop: string, value: string) => {
    const re = secRaw(sectionId); if (!re || typeof document === 'undefined') return
    const box = document.createElement('div'); box.innerHTML = re.html
    const g = sectionGridEl(box); if (!g) return
    if (value) g.style.setProperty(prop, value); else g.style.removeProperty(prop)
    apply((d) => patchElementContent(d, re.ref, { html: box.innerHTML }))
  }
  const sectionColumns = (sectionId: string): string => {
    const v = sectionInnerVal(sectionId, 'grid-template-columns')
    const m = v.match(/repeat\((\d+)/); if (m) return m[1]
    return v ? String(v.split(' ').length) : ''
  }
  const setSectionColumns = (sectionId: string, n: string) => {
    const c = parseInt(n, 10)
    sectionInnerStyle(sectionId, 'grid-template-columns', c > 0 ? `repeat(${c}, minmax(0, 1fr))` : '')
  }
  // ── Per-device (mobile) section styles ───────────────────────────────────────────────────────────────
  // Mobile overrides live as JSON on the section root (data-mob) + a real `@media` rule (data-sid) that ships
  // to the storefront; the editor previews them by inlining the values when the canvas is in mobile mode.
  const readMob = (root: HTMLElement): Record<string, string> => { try { return JSON.parse(root.getAttribute('data-mob') || '{}') } catch { return {} } }
  const writeMob = (root: HTMLElement, obj: Record<string, string>) => {
    let sid = root.getAttribute('data-sid'); if (!sid) { sid = 'sf' + Math.random().toString(36).slice(2, 8); root.setAttribute('data-sid', sid) }
    const keys = Object.keys(obj)
    if (keys.length) root.setAttribute('data-mob', JSON.stringify(obj)); else root.removeAttribute('data-mob')
    let st = (Array.from(root.children).find((c) => c.tagName === 'STYLE' && (c as HTMLElement).classList.contains('sf-mob'))) as HTMLStyleElement | undefined
    if (keys.length) {
      const css = `@media (max-width:768px){[data-sid="${sid}"]{${keys.map((k) => `${k}:${obj[k]} !important`).join(';')}}}`
      if (!st) { st = document.createElement('style'); st.className = 'sf-mob'; root.insertBefore(st, root.firstChild) }
      st.textContent = css
    } else if (st) { st.remove() }
  }
  const sectionMobileVal = (sectionId: string, prop: string): string => {
    const re = secRaw(sectionId); if (!re || typeof document === 'undefined') return ''
    const box = document.createElement('div'); box.innerHTML = re.html
    const root = box.children[0] as HTMLElement | undefined; return root ? (readMob(root)[prop] || '') : ''
  }
  const sectionMobileStyle = (sectionId: string, prop: string, value: string) => {
    const re = secRaw(sectionId); if (!re || typeof document === 'undefined') return
    const box = document.createElement('div'); box.innerHTML = re.html
    const root = box.children[0] as HTMLElement | undefined; if (!root) return
    const obj = readMob(root); if (value) obj[prop] = value; else delete obj[prop]; writeMob(root, obj)
    apply((d) => patchElementContent(d, re.ref, { html: box.innerHTML }))
  }
  // Section background IMAGE (set image + cover/center in one write; clear all three together).
  const sectionBgImageUrl = (sectionId: string): string => {
    const v = sectionStyleVal(sectionId, 'background-image'); const m = v.match(/url\(["']?([^"')]+)["']?\)/); return m ? m[1] : ''
  }
  const sectionSetBgImage = (sectionId: string, url: string) => {
    const re = secRaw(sectionId); if (!re || typeof document === 'undefined') return
    const box = document.createElement('div'); box.innerHTML = re.html
    const root = box.children[0] as HTMLElement | undefined; if (!root) return
    if (url) { root.style.backgroundImage = `url("${url}")`; root.style.backgroundSize = 'cover'; root.style.backgroundPosition = 'center' }
    else { root.style.removeProperty('background-image'); root.style.removeProperty('background-size'); root.style.removeProperty('background-position') }
    apply((d) => patchElementContent(d, re.ref, { html: box.innerHTML }))
  }
  // Full-width vs contained: toggle the inner .wrap max-width (contained = the template default, full = edge to edge).
  const sectionFullWidth = (sectionId: string): boolean => {
    const re = secRaw(sectionId); if (!re || typeof document === 'undefined') return false
    const box = document.createElement('div'); box.innerHTML = re.html
    const wrap = box.querySelector('.wrap') as HTMLElement | null
    return wrap ? wrap.style.maxWidth === 'none' : false
  }
  const setSectionFullWidth = (sectionId: string, full: boolean) => {
    const re = secRaw(sectionId); if (!re || typeof document === 'undefined') return
    const box = document.createElement('div'); box.innerHTML = re.html
    const wrap = box.querySelector('.wrap') as HTMLElement | null; if (!wrap) return
    if (full) wrap.style.maxWidth = 'none'; else wrap.style.removeProperty('max-width')
    apply((d) => patchElementContent(d, re.ref, { html: box.innerHTML }))
  }
  // Skip leading generic layout wrappers (the .grid "Row" / "Group") so the real blocks — Product Gallery,
  // Product Details, etc. — sit at the top of the section, matching PagePilot's two-block hero.
  const flattenOutline = (nodes: RawOutlineNode[]): RawOutlineNode[] => {
    let out = nodes
    let guard = 0
    while (out.length === 1 && out[0].children.length > 1 && /^(Row|Group|Section|Group \((Horizontal|Vertical)\))$/.test(out[0].label) && guard++ < 4) out = out[0].children
    return out
  }
  // Recursively render outline rows for a raw slice. Each row selects / moves / hides / dups / deletes its
  // exact piece by child-path (rawApplyAt), and expands to reveal nested pieces.
  const renderRawOutline = (nodes: RawOutlineNode[], ref: NodeRef, depth: number): React.ReactNode =>
    nodes.map((n) => {
      const key = `${ref.elementId}#${n.path.join('.')}`
      const isOpen = expanded.has(key)
      const selected = !!rawSel && rawSel.ref.elementId === ref.elementId && rawSel.path.join('.') === n.path.join('.')
      return (
        <div key={key} data-rawkey={key}>
          <TreeRow
            depth={depth} open={isOpen} hasChildren={n.children.length > 0}
            onToggle={() => setExpanded((x) => toggle(x, key))}
            label={n.label} hidden={n.hidden}
            selected={selected} onSelect={() => selectRawPath(ref, n.path, n.isImg)}
            onUp={() => rawApplyAt(ref, n.path, 'up')} onDown={() => rawApplyAt(ref, n.path, 'down')}
            onDup={() => rawApplyAt(ref, n.path, 'dup')}
            onHide={() => rawApplyAt(ref, n.path, 'hide')} onDel={() => rawApplyAt(ref, n.path, 'delete')}
          />
          {isOpen && n.children.length > 0 && renderRawOutline(n.children, ref, depth + 1)}
          {/* PagePilot-style: add a block INSIDE this container, at this exact spot */}
          {isOpen && n.children.length > 0 && (
            <AddBtn label="Add block" depth={depth + 1} onClick={() => addIntoContainer(ref, n)} />
          )}
        </div>
      )
    })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 55, display: 'flex', flexDirection: 'column', height: '100vh', background: '#f4f2ee', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>
      {/* top bar — Selfmade mark + a soft orange tint (PagePilot uses a blue tint; ours is orange) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px', borderBottom: `1px solid #f2e3da`, background: 'linear-gradient(180deg,#fff6f1,#fff)' }}>
        <Link href="/builder" title="Back to Builder" style={{ color: SUB, textDecoration: 'none', fontSize: 18, fontWeight: 600, display: 'inline-flex', alignItems: 'center', width: 30, height: 30, justifyContent: 'center', borderRadius: 8, border: `1px solid #f2e3da`, background: '#fff' }}>←</Link>
        <Link href="/" title="Selfmade" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <Mark size={26} />
          <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.02em', color: INK }}>Selfmade</span>
        </Link>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE, background: WASH, borderRadius: 999, padding: '3px 9px' }}>Advanced</span>
        <div style={{ flex: 1 }} />
        {/* center tool group — Edit product + inspector / device / fullscreen (matches PagePilot) */}
        <button onClick={() => setShowProduct(true)} style={{ ...btn, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20.6 3.4a2 2 0 0 0-2.8 0l-1 1 2.8 2.8 1-1a2 2 0 0 0 0-2.8z"/><path d="M16.6 5.4 4 18v2.8h2.8L19.4 8.2z"/></svg>Edit product</button>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#fff', border: `1px solid #f2e3da`, borderRadius: 10, padding: 2 }}>
          <button title="Select tool" onClick={() => { setSel(null); setRawSel(null) }} style={{ ...iconTopBtn, border: 0, background: 'transparent', color: INK }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 3l7 17 2.2-6.8L20 11z"/></svg></button>
          <DeviceToggle value={device} onChange={(d) => setDevice(d)} />
          <button title="Fullscreen" onClick={() => { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.() } catch { /* ignore */ } }} style={{ ...iconTopBtn, border: 0, background: 'transparent', color: SUB }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>
        </div>
        <ZoomControl zoom={zoom} setZoom={setZoom} onFit={fitZoom} />
        <div style={{ flex: 1 }} />
        <SaveBadge status={status} />
        <button onClick={saveNow} disabled={!dirty || status === 'saving'} title="Save (⌘S)" style={{ border: `1px solid ${dirty ? ORANGE : LINE}`, background: dirty ? WASH : '#fff', color: dirty ? ORANGE : SUB, borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: dirty && status !== 'saving' ? 'pointer' : 'default' }}>
          {status === 'saving' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        <button onClick={publish} disabled={publishing !== 'idle'} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: publishing === 'idle' ? 'pointer' : 'default', opacity: publishing === 'idle' ? 1 : 0.7 }}>
          {publishing === 'saving' ? 'Saving…' : publishing === 'publishing' ? 'Publishing…' : 'Publish →'}
        </button>
        <div style={{ position: 'relative' }}>
          <button title="Menu" onClick={() => setTopMenu((o) => !o)} style={{ border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 10, padding: '7px 13px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>Menu</button>
          {topMenu && (<>
            <div onClick={() => setTopMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, boxShadow: '0 12px 30px -8px rgba(20,18,15,.28)', padding: 6, minWidth: 190, zIndex: 41 }}>
              <button onClick={() => { undo(); setTopMenu(false) }} disabled={!histDepth} style={{ ...menuItem, opacity: histDepth ? 1 : 0.4 }}>↶ Undo</button>
              <button onClick={() => { redo(); setTopMenu(false) }} disabled={!redoDepth} style={{ ...menuItem, opacity: redoDepth ? 1 : 0.4 }}>↷ Redo</button>
              <div style={{ height: 1, background: LINE, margin: '4px 6px' }} />
              <button onClick={() => { setShowProduct(true); setTopMenu(false) }} style={menuItem}>✎ Edit product</button>
              <button onClick={() => { setShowMenu(true); setTopMenu(false) }} style={menuItem}>⚙ Page settings</button>
            </div>
          </>)}
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* ── left: section/block tree ── */}
        <aside style={{ width: 264, borderRight: `1px solid ${LINE}`, background: '#fff', overflowY: 'auto', padding: 10 }}>
          <Row label="PAGE" faint />
          {doc.sections.map((s) => {
            const sRef: NodeRef = { sectionId: s.id }
            const open = expanded.has(s.id)
            const rawEl = rawSectionEl(s)
            // PagePilot names the buy-box section "Product Information" (not "Hero"); detect a buy-box slice.
            const isBuyBoxSec = !!rawEl && /\bptitle\b/.test(rawEl.html) && /\b(now|price|buy)\b/.test(rawEl.html)
            const secLabel = isBuyBoxSec ? 'Product Information' : (rawEl ? rawSectionName(rawEl.html, s.name || SECTION_LABEL(s.type)) : (s.name || SECTION_LABEL(s.type)))
            // Flatten a single generic wrapper (the .grid "Row") so its columns (Product Gallery / Product
            // Details) sit directly under the section — matching PagePilot's two-block hero.
            const outlineNodes = rawEl ? flattenOutline(buildRawOutline(rawEl.html)) : []
            return (
              <div key={s.id}>
                <TreeRow
                  depth={0} open={open} hasChildren={s.blocks.length > 0}
                  onToggle={() => setExpanded((x) => toggle(x, s.id))}
                  label={secLabel} count={descendantCount(s)} hidden={s.hidden}
                  selected={sameRef(sel, sRef)} onSelect={() => setSel(sRef)}
                  onUp={() => apply((d) => moveNode(d, sRef, -1))} onDown={() => apply((d) => moveNode(d, sRef, 1))}
                  onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, sRef); queueMicrotask(() => setSel(newRef)); return nd })}
                  onHide={() => apply((d) => setHidden(d, sRef))} onDel={() => apply((d) => removeNode(d, sRef), sameRef(sel, sRef) ? null : sel)}
                  {...dragProps(sRef)}
                />
                {/* Bespoke-template section → PagePilot-style outline of its real pieces (not a "raw" blob). */}
                {open && rawEl && (
                  <>
                    {renderRawOutline(outlineNodes, rawEl.ref, 1)}
                    <AddBtn label="Add block" onClick={() => { const kids = buildRawOutline(rawEl.html); const last = kids[kids.length - 1]; if (last) { selectRawPath(rawEl.ref, last.path, last.isImg); setRawInsertTarget({ path: last.path, mode: 'after' }) } setRawLibOpen(true) }} depth={1} />
                  </>
                )}
                {open && !rawEl && s.blocks.map((b) => {
                  const bRef: NodeRef = { sectionId: s.id, blockId: b.id }
                  const bOpen = expanded.has(b.id)
                  return (
                    <div key={b.id}>
                      <TreeRow
                        depth={1} open={bOpen} hasChildren={b.elements.length > 0}
                        onToggle={() => setExpanded((x) => toggle(x, b.id))}
                        label={BLOCK_LABEL(b.type)} count={descendantCount(b)} hidden={b.hidden}
                        selected={sameRef(sel, bRef)} onSelect={() => setSel(bRef)}
                        onUp={() => apply((d) => moveNode(d, bRef, -1))} onDown={() => apply((d) => moveNode(d, bRef, 1))}
                        onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, bRef); queueMicrotask(() => setSel(newRef)); return nd })}
                        onHide={() => apply((d) => setHidden(d, bRef))} onDel={() => apply((d) => removeNode(d, bRef), sameRef(sel, bRef) ? null : sel)}
                        {...dragProps(bRef)}
                      />
                      {bOpen && b.elements.map((el) => {
                        const eRef: NodeRef = { sectionId: s.id, blockId: b.id, elementId: el.id }
                        return (
                          <TreeRow key={el.id} depth={2} label={elLabel(el)} hidden={el.hidden}
                            selected={sameRef(sel, eRef)} onSelect={() => setSel(eRef)}
                            onUp={() => apply((d) => moveNode(d, eRef, -1))} onDown={() => apply((d) => moveNode(d, eRef, 1))}
                            onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, eRef); queueMicrotask(() => setSel(newRef)); return nd })}
                            onHide={() => apply((d) => setHidden(d, eRef))} onDel={() => apply((d) => removeNode(d, eRef), sameRef(sel, eRef) ? null : sel)} {...dragProps(eRef)} />
                        )
                      })}
                      <AddBtn label="Add block" onClick={() => setAddMenu({ kind: 'block', sectionId: s.id })} depth={1} />
                    </div>
                  )
                })}
              </div>
            )
          })}
          <AddBtn label="Add section" onClick={() => setSectionLibOpen(true)} depth={0} primary />
        </aside>

        {/* ── center: live canvas ── */}
        <main ref={mainRef} style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) setSel(null) }}>
          <div style={{ zoom, width: canvasWidth, background: '#fff', borderRadius: 12, boxShadow: '0 2px 20px rgba(20,18,15,.08)', overflow: 'hidden', alignSelf: 'flex-start' } as React.CSSProperties}>
            <div ref={canvasRef} onClick={onCanvasClick} onDoubleClick={onCanvasDouble} onMouseMove={onCanvasHover} onMouseLeave={() => setHoverBox(null)} onDragStart={onCanvasDragStart} onDragOver={onCanvasDragOver} onDrop={onCanvasDrop} dangerouslySetInnerHTML={{ __html: canvasHtml }} />
          </div>
        </main>

        {/* ── right: property panel ── raw sub-selection gets the in-place element settings ── */}
        <aside style={{ width: 300, borderLeft: `1px solid ${LINE}`, background: '#fff', overflowY: 'auto', padding: 16 }}>
          {rawSel ? (
            <RawElementSettings key={rawSel.path.join('.')} name={rawName()} text={rawText()} onText={rawSetText} isImg={rawSel.isImg}
              isText={rawIsText()} html={rawHtml()} onHtml={rawSetHtml} textContext={doc.productRef?.importedProduct?.title || ''}
              isLink={rawIsLink()} href={rawHref()} onHref={rawSetHref}
              gallery={rawGallery()} onGalleryAdd={rawGalleryAdd} onGalleryRemove={rawGalleryRemove} onGalleryReplace={rawGalleryReplace} onSetImg={rawSetImg} uploadImage={uploadImage}
              isGallery={rawIsGallery()} sticky={rawGallerySticky()} onSticky={setGallerySticky} onCreateAI={galleryCreateAI} aiBusy={galleryAIbusy}
              isPays={rawIsPays()} paysActive={rawPaysActive()} onTogglePay={togglePayProvider}
              paysAlign={paysAlignVal()} paysGap={paysGapVal()} onPaysAlign={setPaysAlign} onPaysGap={(v) => setPaysStyle('gap', v ? `${v}px` : '')}
              isRing={rawIsRing()} ringPct={ringPct()} ringSize={ringSize()} ringDur={(ringVal('--dur') || '').replace('s', '')}
              onRingPct={setRingPct} onRingSize={setRingSize} onRingDur={(v) => setRingStyle('--dur', v ? `${v}s` : '')}
              isLogo={rawIsLogo()} logoImg={rawLogoImg()} onLogoImage={setLogoImage}
              isAcc={rawIsAcc()} accRows={accRows()} onAccAdd={accAddRow} onAccRemove={accRemoveRow}
              isVpick={rawIsVpick()} vpickList={vpickIsList()} vpickOpts={vpickOpts()} onVpickStyle={vpickSetList} onVpickAdd={vpickAdd} onVpickRemove={vpickRemove}
              vpickStyleVal={vpickStyleVal} onVpickTextStyle={setVpickTextStyle} vpickGap={vpickGapVal()} onVpickGap={setVpickGap}
              isCart={rawIsCart()} cart={cartCfg()} onCart={setCart}
              isSave={rawIsSave()} saveMode={saveCfg().mode} saveShow={saveCfg().show} onSaveBadge={setSaveBadge}
              isIconItem={rawIsIconItem()} itemIcon={itemIcon()} onItemIcon={setItemIcon}
              urlOpen={imgUrlOpen} onUrlOpen={setImgUrlOpen} device={device} onDevice={setDevice} onRename={rawRename}
              getVal={rawStyleVal} onStyle={rawStyle} onOp={rawOp} onClear={() => setRawSel(null)} />
          ) : !sel ? (
            <div style={{ color: FAINT, fontSize: 13, lineHeight: 1.6 }}>Select a section, block, or element on the canvas or in the tree to edit it.</div>
          ) : (sel.sectionId && !sel.blockId && !sel.elementId && secRaw(sel.sectionId)) ? (
            <RawSectionSettings key={sel.sectionId + ':' + device}
              name={(() => { const s = doc.sections.find((x) => x.id === sel.sectionId); const re = s ? rawSectionEl(s) : null; return re ? (/\bptitle\b/.test(re.html) && /\b(now|price|buy)\b/.test(re.html) ? 'Product Information' : rawSectionName(re.html, s?.name || '')) : (s?.name || 'Section') })()}
              getVal={(p) => device === 'mobile' ? (sectionMobileVal(sel.sectionId, p) || sectionStyleVal(sel.sectionId, p)) : sectionStyleVal(sel.sectionId, p)}
              onStyle={(p, v) => device === 'mobile' ? sectionMobileStyle(sel.sectionId, p, v) : sectionStyle(sel.sectionId, p, v)}
              full={sectionFullWidth(sel.sectionId)} onFull={(v) => setSectionFullWidth(sel.sectionId, v)}
              gridVal={(p) => sectionInnerVal(sel.sectionId, p)} onGrid={(p, v) => sectionInnerStyle(sel.sectionId, p, v)}
              cols={sectionColumns(sel.sectionId)} onCols={(n) => setSectionColumns(sel.sectionId, n)}
              bgImage={sectionBgImageUrl(sel.sectionId)} onBgImage={(u) => sectionSetBgImage(sel.sectionId, u)} uploadImage={uploadImage}
              device={device} onDevice={setDevice} onRename={(nm) => sectionRename(sel.sectionId, nm)}
              onHide={() => apply((d) => setHidden(d, sel))} onDup={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, sel); queueMicrotask(() => setSel(newRef)); return nd })} onDel={() => apply((d) => removeNode(d, sel), null)} />
          ) : (
            <PropertyPanel doc={doc} sel={sel} device={device} onStyle={onStyle} onHidden={onHidden} onContent={onContent} />
          )}
        </aside>
      </div>

      {addMenu && (
        <AddMenu
          title={addMenu.kind === 'section' ? 'Add a section' : 'Add a block'}
          options={addMenu.kind === 'section'
            ? SECTION_TYPES.map((t) => ({ id: t, label: SECTION_LABEL(t) }))
            : (SECTION_BLOCK_PALETTE[doc.sections.find((s) => s.id === addMenu.sectionId)?.type || 'productInfo'] || BLOCK_TYPES).map((t) => ({ id: t, label: BLOCK_LABEL(t as Block['type']) }))}
          onPick={(id) => {
            if (addMenu.kind === 'section') apply((d) => { const { doc: nd, newRef } = insertSection(d, newSection(id as Section['type'])); queueMicrotask(() => { setSel(newRef); setExpanded((x) => new Set(x).add(newRef.sectionId)) }); return nd })
            else { const sid = addMenu.sectionId; apply((d) => { const { doc: nd, newRef } = insertBlock(d, sid, newBlock(id as Block['type'])); queueMicrotask(() => setSel(newRef)); return nd }) }
            setAddMenu(null)
          }}
          onClose={() => setAddMenu(null)}
        />
      )}

      {pubResult && (
        <div onClick={() => setPubResult(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 440, maxWidth: '92vw', background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 20px 60px rgba(20,18,15,.25)' }}>
            {pubResult.error ? (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 8 }}>Couldn’t publish</div>
                <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.6 }}>{pubResult.error}</div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 8 }}>Published to Shopify 🎉</div>
                <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.6, marginBottom: 14 }}>Your page is live as native, theme-editable sections. Open it in Shopify to fine-tune or set it live.</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {pubResult.url && <a href={pubResult.url} target="_blank" rel="noopener noreferrer" style={{ border: 0, background: ORANGE, color: '#fff', textDecoration: 'none', borderRadius: 999, padding: '9px 18px', fontWeight: 700, fontSize: 13 }}>Open in Shopify →</a>}
                  {pubResult.previewUrl && <a href={pubResult.previewUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn }}>Preview</a>}
                </div>
              </>
            )}
            <div style={{ textAlign: 'right', marginTop: 16 }}><button onClick={() => setPubResult(null)} style={btn}>Close</button></div>
          </div>
        </div>
      )}

      {tb && sel && !rawSel && (
        <div style={{ position: 'fixed', top: tb.top, left: tb.left, transform: tb.below ? 'none' : 'translateY(-100%)', display: 'flex', alignItems: 'center', gap: 1, ...TB_BAR, zIndex: 30 }} onClick={(e) => e.stopPropagation()}>
          <TbBtn title="Hide / show" onClick={() => apply((d) => setHidden(d, sel))}>{TB_ICON.eye}</TbBtn>
          <TbBtn title="Duplicate" onClick={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, sel); queueMicrotask(() => setSel(newRef)); return nd })}>{TB_ICON.dup}</TbBtn>
          <TbDiv />
          <TbBtn title="Move up" onClick={() => apply((d) => moveNode(d, sel, -1))}>{TB_ICON.up}</TbBtn>
          <TbBtn title="Move down" onClick={() => apply((d) => moveNode(d, sel, 1))}>{TB_ICON.down}</TbBtn>
          {!sel.elementId && <><TbDiv /><TbText title="Add block" onClick={() => setAddMenu({ kind: 'block', sectionId: sel.sectionId })}>Add block</TbText></>}
          <TbDiv />
          <TbBtn title="Delete" onClick={() => apply((d) => removeNode(d, sel), null)} danger>{TB_ICON.trash}</TbBtn>
        </div>
      )}

      {/* granular toolbar for a piece clicked INSIDE a raw (bespoke-template) section */}
      {/* selection highlight box over the exact block that's selected (PagePilot-style) */}
      {rawBox && rawSel && (
        <div style={{ position: 'fixed', top: rawBox.top - 2, left: rawBox.left - 2, width: rawBox.width + 4, height: rawBox.height + 4, border: `2px solid ${ORANGE}`, borderRadius: 6, zIndex: 29, pointerEvents: 'none', boxShadow: `0 0 0 3px ${WASH}` }} />
      )}
      {hoverBox && (!rawBox || hoverBox.top !== rawBox.top || hoverBox.left !== rawBox.left) && (
        <div style={{ position: 'fixed', top: hoverBox.top - 1, left: hoverBox.left - 1, width: hoverBox.width + 2, height: hoverBox.height + 2, border: `1.5px dashed ${ORANGE}`, borderRadius: 5, zIndex: 28, pointerEvents: 'none' }} />
      )}
      {rawTb && rawSel && (
        <div style={{ position: 'fixed', top: rawTb.top, left: rawTb.left, transform: rawTb.below ? 'none' : 'translateY(-100%)', display: 'flex', alignItems: 'center', gap: 1, ...TB_BAR, zIndex: 31 }} onClick={(e) => e.stopPropagation()}>
          {!rawSel.isImg && rawText().trim() !== '' && (<>
            <button title="Edit with AI" onClick={rawEditAI} disabled={rawAIbusy} style={{ border: 0, background: rawAIbusy ? '#f3ebfb' : 'linear-gradient(90deg,#f5e9ff,#ffe9f0)', color: '#a23ba0', cursor: rawAIbusy ? 'default' : 'pointer', height: 28, display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 7, padding: '0 10px', fontSize: 12.5, fontWeight: 800, pointerEvents: 'auto', whiteSpace: 'nowrap' }}>✨ {rawAIbusy ? 'Editing…' : 'Edit with AI'}</button>
            <TbDiv />
          </>)}
          {rawSel.isImg && <><TbBtn title="Replace image" onClick={() => setImgUrlOpen(true)}>{TB_ICON.img}</TbBtn><TbDiv /></>}
          <TbBtn title="Hide / show" onClick={() => rawOp('hide')}>{TB_ICON.eye}</TbBtn>
          <TbDiv />
          <TbBtn title="Move up" onClick={() => rawOp('up')}>{TB_ICON.up}</TbBtn>
          <TbBtn title="Move down" onClick={() => rawOp('down')}>{TB_ICON.down}</TbBtn>
          <TbDiv />
          <TbText title="Add a piece after this" onClick={() => setRawAddOpen((o) => !o)}>Add block</TbText>
          <TbDiv />
          <TbBtn title="Delete" onClick={() => rawOp('delete')} danger>{TB_ICON.trash}</TbBtn>
          {rawAddOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, boxShadow: '0 8px 24px -8px rgba(20,18,15,.35)', padding: 6, display: 'flex', flexDirection: 'column', minWidth: 130, zIndex: 32, pointerEvents: 'auto' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: FAINT, textTransform: 'uppercase', letterSpacing: '.06em', padding: '2px 8px 4px' }}>Add a piece</div>
              {RAW_INSERTS.map((it) => (
                <button key={it.id} onClick={() => { rawInsert(stampName(it.html, it.label)); setRawAddOpen(false) }} style={{ textAlign: 'left', border: 0, background: 'transparent', color: INK, fontSize: 13, fontWeight: 600, padding: '7px 8px', borderRadius: 7, cursor: 'pointer' }}>{it.label}</button>
              ))}
              <button onClick={() => { setRawAddOpen(false); setRawLibOpen(true) }} style={{ textAlign: 'left', border: 0, borderTop: `1px solid ${LINE}`, marginTop: 4, paddingTop: 8, background: 'transparent', color: ORANGE, fontSize: 13, fontWeight: 700, padding: '8px', cursor: 'pointer' }}>Browse library →</button>
            </div>
          )}
        </div>
      )}

      {showProduct && <EditProductModal doc={doc} onChange={onProduct} onClose={() => setShowProduct(false)} />}
      {showMenu && <SettingsModal doc={doc} onChange={onSettings} onClose={() => setShowMenu(false)} />}
      {rawLibOpen && <RawLibraryModal onPick={(html, label) => { rawInsertAt(stampName(html, label)); setRawLibOpen(false) }} onClose={() => { setRawLibOpen(false); setRawInsertTarget(null) }} />}
      {sectionLibOpen && <SectionLibraryModal onPick={(html, name) => { apply((d) => { const { doc: nd, newRef } = insertSection(d, newRawSection(html, name)); queueMicrotask(() => { setSel(newRef); setExpanded((x) => new Set(x).add(newRef.sectionId)) }); return nd }); setSectionLibOpen(false) }} onClose={() => setSectionLibOpen(false)} />}
    </div>
  )
}

/* ── Block library: a gallery of ready-made pieces (rendered previews) to drop into a template section. ── */
function RawLibraryModal({ onPick, onClose }: { onPick: (html: string, label: string) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 'min(860px,94vw)', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 20px 60px -20px rgba(20,18,15,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: `1px solid ${LINE}`, position: 'sticky', top: 0, background: '#fff' }}>
          <span style={{ fontFamily: SERIF, fontSize: 20 }}>Block library</span>
          <span style={{ fontSize: 12.5, color: SUB }}>Click one to add it into this section</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...iconTopBtn, fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14, padding: 20 }}>
          {RAW_LIBRARY.map((it) => (
            <button key={it.id} onClick={() => onPick(it.html, it.label)} title={`Add ${it.label}`} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'left' }}>
              <div style={{ height: 120, overflow: 'hidden', background: '#faf9f7', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
                <div style={{ width: '100%', pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: it.html }} />
              </div>
              <div style={{ padding: '9px 12px', fontSize: 13, fontWeight: 700, color: INK, borderTop: `1px solid ${LINE}` }}>{it.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Which category each library section belongs to (PagePilot groups its Add-Section library this way).
const SECTION_CAT: Record<string, string> = {
  reviews: 'Social Proof & Trust', 'reviews-photos': 'Social Proof & Trust', 'as-seen-on': 'Social Proof & Trust', 'trust-icons': 'Social Proof & Trust', 'trusted-by': 'Social Proof & Trust',
  'rotating-benefits': 'Benefits & Features', statistics: 'Benefits & Features', 'feature-cards': 'Benefits & Features', comparison: 'Benefits & Features', numbered: 'Benefits & Features',
  'image-text': 'Image & Content', 'how-it-works': 'Image & Content', 'text-rotating': 'Image & Content',
  cta: 'Conversion / CTA', recommended: 'Conversion / CTA', 'sticky-atc': 'Conversion / CTA',
  faq: 'FAQ', guarantee: 'Guarantee',
}
const SECTION_CAT_ORDER = ['Social Proof & Trust', 'Benefits & Features', 'Image & Content', 'Conversion / CTA', 'FAQ', 'Guarantee']
// A minimal blank section for "Create from Scratch".
const BLANK_SECTION = `<section style="padding:44px 20px;background:transparent"><div style="max-width:1040px;margin:0 auto;text-align:center"><h2 style="font-size:28px;font-weight:800;color:#1b1a17;margin:0 0 10px">Your section heading</h2><p style="font-size:15px;color:#6a6e93;max-width:560px;margin:0 auto;line-height:1.6">Add your text, then drop in blocks — every piece stays editable.</p></div></section>`

// PagePilot-style "Add Section" library: a searchable, category-filtered gallery of ready-made sections with
// live previews. Picking one inserts it as a named, per-piece-editable raw section that publishes natively.
function SectionLibraryModal({ onPick, onClose }: { onPick: (html: string, name: string) => void; onClose: () => void }) {
  const [cat, setCat] = useState('All')
  const [q, setQ] = useState('')
  const catOf = (id: string) => SECTION_CAT[id] || 'Layout'
  const counts: Record<string, number> = { All: SECTION_LIBRARY.length }
  for (const c of SECTION_CAT_ORDER) counts[c] = SECTION_LIBRARY.filter((it) => catOf(it.id) === c).length
  const query = q.trim().toLowerCase()
  const shown = SECTION_LIBRARY.filter((it) => (cat === 'All' || catOf(it.id) === cat) && (!query || it.label.toLowerCase().includes(query)))
  const navItem = (label: string, count?: number) => (
    <button key={label} onClick={() => setCat(label)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', border: 0, background: cat === label ? INSET : 'transparent', color: cat === label ? INK : SUB, borderRadius: 9, padding: '8px 11px', fontSize: 13, fontWeight: cat === label ? 700 : 500, cursor: 'pointer' }}>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {count != null && <span style={{ fontSize: 11.5, color: FAINT, flex: 'none' }}>{count}</span>}
    </button>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 'min(1080px,96vw)', height: 'min(760px,90vh)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px -20px rgba(20,18,15,.5)' }}>
        {/* header + search */}
        <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${LINE}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 700 }}>Add Section</span>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ ...iconTopBtn, fontSize: 18 }}>✕</button>
          </div>
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px' }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={FAINT} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" style={{ flex: 1, border: 0, outline: 'none', fontSize: 13.5, color: INK, background: 'transparent' }} />
          </div>
        </div>
        {/* body: left categories + right grid */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ width: 210, flex: 'none', borderRight: `1px solid ${LINE}`, padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {navItem('Saved', 0)}
            {navItem('All', counts.All)}
            {SECTION_CAT_ORDER.map((c) => navItem(c, counts[c]))}
            <div style={{ flex: 1 }} />
            <button onClick={() => { onPick(BLANK_SECTION, 'Section'); onClose() }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, border: `1px dashed ${LINE}`, background: INSET, borderRadius: 12, padding: '16px 10px', cursor: 'pointer', color: INK, marginTop: 8 }}>
              <span style={{ fontSize: 22, color: ORANGE, lineHeight: 1 }}>＋</span>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Create from Scratch</span>
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 18 }}>
            {cat !== 'All' && <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT, marginBottom: 12 }}>{cat}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
              {shown.map((it) => (
                <button key={it.id} onClick={() => { onPick(it.html, it.label); onClose() }} title={`Add ${it.label}`} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'left' }}>
                  <div style={{ padding: '10px 12px 6px', fontSize: 13, fontWeight: 700, color: INK }}>{it.label}</div>
                  <div style={{ height: 150, overflow: 'hidden', background: '#faf9f7', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: `1px solid ${LINE}` }}>
                    <div style={{ width: 900, transform: 'scale(.34)', transformOrigin: 'center', pointerEvents: 'none', flex: 'none' }} dangerouslySetInnerHTML={{ __html: it.html }} />
                  </div>
                </button>
              ))}
              {shown.length === 0 && <div style={{ gridColumn: '1 / -1', color: FAINT, fontSize: 13, padding: '30px 0', textAlign: 'center' }}>No sections match “{q}”.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Settings for a single piece clicked inside a template (raw) section. Edits inline CSS on that exact
 * node so the template design is preserved and every piece is individually styleable (PagePilot-style). ── */
// ── Premium single-weight line-icon library (Lucide-style) — searchable, matches PagePilot's icon collection.
// Values are the INNER svg markup; svgIcon() wraps them so the same set feeds both the picker and the page.
const LINE_ICONS: Record<string, string> = {
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.5 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L21.5 7H6"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  basket: '<path d="M5 11 8 4M19 11l-3-7M2 11h20l-1.4 8a2 2 0 0 1-2 1.7H5.4a2 2 0 0 1-2-1.7z"/><path d="M9 15v2M15 15v2"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  verified: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>',
  truck: '<path d="M14 18V6a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h1"/><path d="M14 9h4l3 3v5a1 1 0 0 1-1 1h-1"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8a10 10 0 0 1-15 8.6"/><path d="M2 21c0-3 1.8-5.6 4.6-7"/>',
  droplet: '<path d="M12 2.7 6.3 9.4a7.5 7.5 0 1 0 11.4 0z"/>',
  sparkles: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  tag: '<path d="M12.6 2.6a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.2 8.2a2 2 0 0 0 2.8 0l6.8-6.8a2 2 0 0 0 0-2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  flame: '<path d="M12 2c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1 .3-1.8 1-3-2 1-4 3-4 6a7 7 0 0 0 14 0c0-5-4-7-7-11z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.2 13.9 7 22l5-3 5 3-1.2-8.1"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  package: '<path d="m21 8-9 4-9-4 9-4z"/><path d="M3 8v8l9 4 9-4V8"/><path d="M12 12v8"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  thumbsup: '<path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z"/><path d="M7 11l4-8a2 2 0 0 1 3 1.8V9h5a2 2 0 0 1 2 2.4l-1.4 6A2 2 0 0 1 17.6 19H7"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  crown: '<path d="M2 18h20l-1.6-9-4.4 4-4-6-4 6-4.4-4z"/>',
  flower: '<circle cx="12" cy="12" r="3"/><path d="M12 9c0-3 1-5 0-7-1 2 0 4 0 7M12 15c0 3-1 5 0 7 1-2 0-4 0-7M9 12c-3 0-5 1-7 0 2 1 4 0 7 0M15 12c3 0 5-1 7 0-2 1-4 0-7 0"/>',
  coffee: '<path d="M17 8h1a3 3 0 0 1 0 6h-1"/><path d="M3 8h14v6a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/>',
  bell: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/>',
  rocket: '<path d="M5 13c-1.5 1.3-2 5-2 5s3.7-.5 5-2M12 15l-3-3a11 11 0 0 1 7-8 11 11 0 0 1 2 2 11 11 0 0 1-8 7z"/><circle cx="14" cy="10" r="1.2"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3"/><path d="M21 11h-5a2 2 0 0 0 0 4h5z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  feather: '<path d="M20 4a6 6 0 0 0-8.5 0L4 11.5V20h8.5z"/><path d="M16 8 2 22M17.5 12.5H9"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 3 8 9l4 12 4-12z"/>',
  sprout: '<path d="M7 20h10M12 20V10"/><path d="M12 10C12 6 9 4 4 4c0 4 3 6 8 6zM12 10c0-3 2-5 6-5 0 3-2 5-6 5z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
}
const svgIcon = (inner: string, size = 18) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
function IconPicker({ value, onPick, allowNone = true }: { value: string; onPick: (name: string) => void; allowNone?: boolean }) {
  const [q, setQ] = useState('')
  const names = Object.keys(LINE_ICONS).filter((n) => !q || n.includes(q.toLowerCase()))
  const cell = (sel: boolean): React.CSSProperties => ({ height: 34, border: `1px solid ${sel ? ORANGE : LINE}`, background: sel ? WASH : '#fff', color: INK, borderRadius: 8, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 })
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons…" style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 9, padding: '7px 10px', fontSize: 12.5, color: INK, boxSizing: 'border-box', marginBottom: 8 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6, maxHeight: 176, overflowY: 'auto' }}>
        {allowNone && <button title="None" onClick={() => onPick('')} style={{ ...cell(value === ''), fontSize: 10, color: SUB }}>None</button>}
        {names.map((n) => <button key={n} title={n} onClick={() => onPick(n)} style={cell(value === n)} dangerouslySetInnerHTML={{ __html: svgIcon(LINE_ICONS[n], 18) }} />)}
      </div>
    </div>
  )
}
function RawElementSettings({ name, text, onText, isImg, isText, html, onHtml, textContext, isLink, href, onHref, gallery, onGalleryAdd, onGalleryRemove, onGalleryReplace, onSetImg, uploadImage, isGallery, sticky, onSticky, onCreateAI, aiBusy, isPays, paysActive, onTogglePay, paysAlign, paysGap, onPaysAlign, onPaysGap, isRing, ringPct, ringSize, ringDur, onRingPct, onRingSize, onRingDur, isLogo, logoImg, onLogoImage, isAcc, accRows, onAccAdd, onAccRemove, isVpick, vpickList, vpickOpts, onVpickStyle, onVpickAdd, onVpickRemove, vpickStyleVal, onVpickTextStyle, vpickGap, onVpickGap, isCart, cart, onCart, isSave, saveMode, saveShow, onSaveBadge, isIconItem, itemIcon, onItemIcon, urlOpen, onUrlOpen, device, onDevice, onRename, getVal, onStyle, onOp, onClear }: { name: string; text: string; onText: (t: string) => void; isImg: boolean; isText: boolean; html: string; onHtml: (h: string) => void; textContext: string; isLink: boolean; href: string; onHref: (u: string) => void; isRing: boolean; ringPct: string; ringSize: string; ringDur: string; onRingPct: (v: string) => void; onRingSize: (v: string) => void; onRingDur: (v: string) => void; isLogo: boolean; logoImg: string; onLogoImage: (u: string) => void; isAcc: boolean; accRows: string[]; onAccAdd: () => void; onAccRemove: (i: number) => void; isVpick: boolean; vpickList: boolean; vpickOpts: string[]; onVpickStyle: (list: boolean) => void; onVpickAdd: () => void; onVpickRemove: (i: number) => void; vpickStyleVal: (prop: string) => string; onVpickTextStyle: (prop: string, v: string) => void; vpickGap: string; onVpickGap: (v: string) => void; isCart: boolean; cart: { icon: string; label: string; show: boolean; pos: 'left' | 'right'; size: number }; onCart: (patch: Partial<{ icon: string; label: string; show: boolean; pos: 'left' | 'right'; size: number }>) => void; isSave: boolean; saveMode: 'percent' | 'value'; saveShow: boolean; onSaveBadge: (patch: Partial<{ mode: 'percent' | 'value'; show: boolean }>) => void; isIconItem: boolean; itemIcon: string; onItemIcon: (icon: string) => void; device: Device; onDevice: (d: Device) => void; onRename: (name: string) => void; gallery: { src: string; path: number[] }[] | null; onGalleryAdd: (url: string) => void; onGalleryRemove: (path: number[]) => void; onGalleryReplace: (path: number[], url: string) => void; onSetImg: (url: string) => void; uploadImage: (f: File) => Promise<string | null>; isGallery: boolean; sticky: boolean; onSticky: (v: boolean) => void; onCreateAI: () => void; aiBusy: boolean; isPays: boolean; paysActive: string[]; onTogglePay: (id: string) => void; paysAlign: string; paysGap: string; onPaysAlign: (v: string) => void; onPaysGap: (v: string) => void; urlOpen: boolean; onUrlOpen: (v: boolean) => void; getVal: (p: string) => string; onStyle: (p: string, v: string) => void; onOp: (op: RawOp) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(text)   // content field — commit on blur (key remounts per piece)
  const [busy, setBusy] = useState(false)    // an image upload is in flight
  const [urlDraft, setUrlDraft] = useState('')   // inline "image URL" field value
  // Media / special blocks (gallery, image, ring, pays, logo, variant, accordion) get their OWN controls —
  // the generic Text typography + Box rows are irrelevant there (PagePilot doesn't show them). Hide them.
  const isMedia = isImg || gallery != null || isGallery || isPays || isRing || isLogo || isVpick || isAcc || isCart || isSave
  const showTextStyle = !isMedia && (isText || text !== '' || isLink)   // typography only where there's real text
  // The multi-image "Images N/15" manager belongs ONLY on the real Product Gallery. A block that merely CONTAINS
  // an image (a review avatar, a single lifestyle photo) gets a plain single-image replace instead — so the
  // Featured Review's image is edited on the Featured Review, never duplicated onto Product Details. (Bug: the
  // gallery manager was showing on every image-bearing block.)
  const singleImg = !isGallery && (isImg || (gallery != null && gallery.length > 0))
  const replaceImg = (url: string) => { if (isImg) onSetImg(url); else if (gallery && gallery.length) onGalleryReplace(gallery[0].path, url) }
  const pickFile = (onUrl: (url: string) => void) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp,image/gif'
    inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; setBusy(true); const url = await uploadImage(f); setBusy(false); if (url) onUrl(url) }
    inp.click()
  }
  // NumRow / ColorRow / SegRow / SelRow are MODULE-LEVEL (below) so they keep a stable component identity and
  // don't remount on every parent re-render — that remount was why colour/padding "only worked once" and the
  // padding input wouldn't accept typing (it lost focus after the first keystroke).
  return (
    <div>
      <PanelHeader kind="Block" name={name || 'Edit this piece'} device={device} onDevice={onDevice} onRename={onRename} />
      {isGallery && gallery && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800 }}>Images</div>
            <div style={{ fontSize: 11.5, color: FAINT }}>{gallery.length}/15</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 10 }}>
            {gallery.map((g) => (
              <div key={g.path.join('.')} style={{ position: 'relative', paddingTop: '100%', borderRadius: 10, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#faf9f7' }}>
                <img src={g.src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                <button title="Replace" onClick={() => pickFile((url) => onGalleryReplace(g.path, url))} style={{ position: 'absolute', left: 4, bottom: 4, border: 0, background: 'rgba(20,18,15,.72)', color: '#fff', borderRadius: 7, fontSize: 12, width: 24, height: 24, cursor: 'pointer' }}>🖼</button>
                <button title="Remove" onClick={() => onGalleryRemove(g.path)} style={{ position: 'absolute', right: 4, top: 4, border: 0, background: 'rgba(214,67,22,.92)', color: '#fff', borderRadius: 999, fontSize: 13, width: 22, height: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
          <DropZone label="Drag & Drop or click to select images" busy={busy} onPick={() => pickFile((url) => onGalleryAdd(url))} />
          <button disabled={busy} onClick={() => pickFile((url) => onGalleryAdd(url))} style={{ width: '100%', marginTop: 8, border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>⬆ Select files</button>
          <button disabled={aiBusy} onClick={onCreateAI} style={{ width: '100%', marginTop: 8, border: 0, background: 'linear-gradient(90deg,#f5e9ff,#ffe9f0)', color: '#b23aa0', borderRadius: 10, padding: '11px 12px', fontSize: 13, fontWeight: 800, cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.6 : 1 }}>{aiBusy ? 'Creating…' : '✨ Create with AI'}</button>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Add images to the gallery. The first image will be used as the main image.</div>
        </div>
      )}
      {isGallery && (
        <div style={{ marginBottom: 14, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, marginTop: 2, color: INK }}>General</div>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, fontWeight: 600, color: INK, cursor: 'pointer' }}>
            Sticky
            <input type="checkbox" checked={sticky} onChange={(e) => onSticky(e.target.checked)} style={{ accentColor: ORANGE, width: 34, height: 18 }} />
          </label>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>If enabled, the gallery stays fixed to the top of the screen as the customer scrolls.</div>
        </div>
      )}
      {isPays && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, marginTop: 2, color: INK }}>Payment Providers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {PAY_PROVIDERS.map((p) => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 2px', fontSize: 12.5, color: INK, cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}><span style={{ display: 'inline-flex', width: 38 }} dangerouslySetInnerHTML={{ __html: p.svg }} />{p.label}</span>
                <input type="checkbox" checked={paysActive.includes(p.id)} onChange={() => onTogglePay(p.id)} style={{ accentColor: ORANGE, width: 34, height: 18 }} />
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4, marginBottom: 12 }}>Toggle which payment icons show in this row.</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8, color: INK }}>Icons</div>
          <SegRow label="Alignment" prop="__paysalign" options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['between', 'Space']]} getVal={() => paysAlign} onStyle={(_p, v) => onPaysAlign(v)} />
          <NumRow label="Gap" prop="__paysgap" min={0} max={30} unit="px" getVal={() => paysGap} onStyle={(_p, v) => onPaysGap(v)} />
        </div>
      )}
      {isRing && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, marginTop: 2, color: INK }}>Animation</div>
          <NumRow label="Percentage" prop="__pct" min={0} max={100} unit="%" getVal={() => ringPct} onStyle={(_p, v) => onRingPct(v)} />
          <NumRow label="Size" prop="__size" min={60} max={200} getVal={() => ringSize} onStyle={(_p, v) => onRingSize(v)} />
          <NumRow label="Duration" prop="__dur" min={0} max={6} unit="s" getVal={() => ringDur} onStyle={(_p, v) => onRingDur(v)} />
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>The ring fills from 0 to the percentage over the duration.</div>
        </div>
      )}
      {isLogo && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, marginTop: 2, color: INK }}>Logo</div>
          {logoImg && <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#faf9f7', padding: 12, marginBottom: 8, display: 'flex', justifyContent: 'center' }}><img src={logoImg} alt="" style={{ height: 34, maxWidth: '100%', objectFit: 'contain' }} /><button onClick={() => onLogoImage('')} title="Remove" style={{ position: 'absolute', top: 5, right: 5, border: 0, background: 'rgba(20,18,15,.72)', color: '#fff', borderRadius: 999, width: 22, height: 22, cursor: 'pointer', lineHeight: 1 }}>×</button></div>}
          <DropZone label={logoImg ? 'Replace logo image' : 'Drag & Drop or click to upload a logo'} busy={busy} onPick={() => pickFile((url) => onLogoImage(url))} />
          <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Upload a logo image, or edit the text below to use a name instead.</div>
        </div>
      )}
      {isAcc && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, marginTop: 2, color: INK }}>Accordion rows</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
            {accRows.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 9, padding: '7px 10px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r}</span>
                <button onClick={() => onAccRemove(i)} title="Remove row" style={{ border: 0, background: 'transparent', color: FAINT, cursor: 'pointer', fontSize: 15, lineHeight: 1, flex: 'none' }}>×</button>
              </div>
            ))}
          </div>
          <button onClick={onAccAdd} style={{ width: '100%', border: `1px dashed ${LINE}`, background: INSET, color: INK, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>＋ Add row</button>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Double-click a row’s title or text on the canvas to edit it.</div>
        </div>
      )}
      {isVpick && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, marginTop: 2, color: INK }}>Variant Picker</div>
          <SegRow label="Style" prop="__vstyle" options={[['buttons', 'Buttons'], ['dropdown', 'Dropdown']]} getVal={() => (vpickList ? 'dropdown' : 'buttons')} onStyle={(_p, v) => onVpickStyle(v === 'dropdown')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '8px 0' }}>
            {vpickOpts.map((o, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 9, padding: '7px 10px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o}</span>
                <button onClick={() => onVpickRemove(i)} title="Remove option" style={{ border: 0, background: 'transparent', color: FAINT, cursor: 'pointer', fontSize: 15, lineHeight: 1, flex: 'none' }}>×</button>
              </div>
            ))}
          </div>
          <button onClick={onVpickAdd} style={{ width: '100%', border: `1px dashed ${LINE}`, background: INSET, color: INK, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>＋ Add option</button>
          <div style={{ fontSize: 11, color: FAINT, margin: '6px 0 12px' }}>Double-click an option on the canvas to rename it.</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8, color: INK }}>Options</div>
          <NumRow label="Gap" prop="__vgap" min={0} max={40} unit="px" getVal={() => (vpickGap || '').replace('px', '')} onStyle={(_p, v) => onVpickGap(v ? `${v}px` : '')} />
          <ColorRow label="Branding text color" prop="color" getVal={vpickStyleVal} onStyle={onVpickTextStyle} />
          <NumRow label="Size" prop="font-size" min={10} max={24} unit="px" getVal={vpickStyleVal} onStyle={onVpickTextStyle} />
          <SelRow label="Weight" prop="font-weight" options={[['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extrabold']]} getVal={vpickStyleVal} onStyle={onVpickTextStyle} />
          <NumRow label="Letter spacing" prop="letter-spacing" min={-1} max={6} unit="px" getVal={vpickStyleVal} onStyle={onVpickTextStyle} />
          <SegRow label="Case" prop="text-transform" options={[['none', 'Normal'], ['uppercase', 'Upper'], ['lowercase', 'Lower']]} getVal={vpickStyleVal} onStyle={onVpickTextStyle} />
        </div>
      )}
      {singleImg && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>Image</div>
          <DropZone label="Drag & Drop or click to select image" busy={busy} onPick={() => pickFile((url) => replaceImg(url))} />
          <button onClick={() => onUrlOpen(!urlOpen)} style={{ width: '100%', marginTop: 8, border: `1px solid ${urlOpen ? ORANGE : LINE}`, background: '#fff', color: urlOpen ? ORANGE : SUB, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>🔗 Use image URL</button>
          {urlOpen && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input autoFocus value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} placeholder="https://…/image.jpg"
                onKeyDown={(e) => { if (e.key === 'Enter' && urlDraft.trim()) { replaceImg(urlDraft.trim()); setUrlDraft(''); onUrlOpen(false) } }}
                style={{ flex: 1, minWidth: 0, border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: INK, boxSizing: 'border-box' }} />
              <button onClick={() => { if (urlDraft.trim()) { replaceImg(urlDraft.trim()); setUrlDraft(''); onUrlOpen(false) } }} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 8, padding: '0 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Set</button>
            </div>
          )}
        </div>
      )}
      {isCart && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, marginTop: 2, color: INK }}>Add to Cart</div>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: INK }}>Button label</div>
          <input defaultValue={cart.label} key={cart.label} placeholder="Add to Cart" onBlur={(e) => { const v = e.target.value; if (v !== cart.label) onCart({ label: v }) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 11px', fontSize: 12.5, color: INK, boxSizing: 'border-box', marginBottom: 10 }} />
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, fontWeight: 600, color: INK, cursor: 'pointer', marginBottom: 8 }}>
            Show icon
            <input type="checkbox" checked={cart.show} onChange={(e) => onCart({ show: e.target.checked })} style={{ accentColor: ORANGE, width: 34, height: 18 }} />
          </label>
          {cart.show && (<>
            <div style={{ fontSize: 12, fontWeight: 700, margin: '2px 0 6px', color: INK }}>Icon</div>
            <IconPicker value={cart.icon} onPick={(v) => onCart({ icon: v })} allowNone={false} />
            <div style={{ height: 8 }} />
            <SegRow label="Icon position" prop="__icopos" options={[['left', 'Left'], ['right', 'Right']]} getVal={() => cart.pos} onStyle={(_p, v) => onCart({ pos: v as 'left' | 'right' })} />
            <NumRow label="Icon size" prop="__icosize" min={10} max={40} unit="px" getVal={() => (cart.size ? String(cart.size) : '')} onStyle={(_p, v) => onCart({ size: parseInt(v) || 0 })} />
          </>)}
          <div style={{ fontSize: 12.5, fontWeight: 700, margin: '14px 0 8px', color: INK, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>Colors</div>
          <ColorRow label="Background color" prop="background" getVal={getVal} onStyle={onStyle} />
          <ColorRow label="Text color" prop="color" getVal={getVal} onStyle={onStyle} />
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>The product is added dynamically — there’s no link to set.</div>
        </div>
      )}
      {isSave && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10, marginTop: 2, color: INK }}>Save Badge</div>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, fontWeight: 600, color: INK, cursor: 'pointer', marginBottom: 8 }}>
            Show badge
            <input type="checkbox" checked={saveShow} onChange={(e) => onSaveBadge({ show: e.target.checked })} style={{ accentColor: ORANGE, width: 34, height: 18 }} />
          </label>
          <SegRow label="Type" prop="__savetype" options={[['percent', 'Percentage'], ['value', 'Value']]} getVal={() => saveMode} onStyle={(_p, v) => onSaveBadge({ mode: v as 'percent' | 'value' })} />
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>Computed automatically from Price & Compare price — updates when you change them.</div>
        </div>
      )}
      {isIconItem && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8, marginTop: 2, color: INK }}>Icon</div>
          <IconPicker value={itemIcon} onPick={onItemIcon} />
          <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Pick an icon for this row, or None to remove it.</div>
        </div>
      )}
      {isLink && !isCart && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>Link</div>
          <input defaultValue={href} placeholder="https://…  or  /products/handle" onBlur={(e) => { const v = e.target.value.trim(); if (v !== href) onHref(v) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 11px', fontSize: 12.5, color: INK, boxSizing: 'border-box' }} />
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>Where this button/link goes when clicked.</div>
        </div>
      )}
      {isCart || isSave ? null : isText ? (
        <RichText key={html.length + ':' + name} html={html} onCommit={onHtml} context={textContext} />
      ) : text !== '' && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>Content</div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== text) onText(draft) }} rows={draft.length > 60 ? 4 : 2}
            style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 11px', fontSize: 13, lineHeight: 1.5, color: INK, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>Edit the words here, or double-click the text on the canvas.</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={() => onOp('dup')} style={miniActionA}>⧉ Duplicate</button>
        <button onClick={() => onOp('hide')} style={miniActionA}>👁 Hide/show</button>
        <button onClick={() => onOp('delete')} style={{ ...miniActionA, color: ORANGE }}>🗑 Delete</button>
      </div>
      {showTextStyle && (
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, marginTop: 2, color: INK }}>Text</div>
        <ColorRow label="Text color" prop="color" getVal={getVal} onStyle={onStyle} />
        <NumRow label="Text size" prop="font-size" min={10} max={72} getVal={getVal} onStyle={onStyle} />
        <SegRow label="Alignment" prop="text-align" options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} getVal={getVal} onStyle={onStyle} />
        <SelRow label="Weight" prop="font-weight" options={[['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extrabold'], ['900', 'Black']]} getVal={getVal} onStyle={onStyle} />
        <SelRow label="Font" prop="font-family" options={[["Inter,system-ui,sans-serif", 'Sans (Inter)'], ["Georgia,'Times New Roman',serif", 'Serif'], ["'Courier New',monospace", 'Mono']]} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Line height" prop="line-height" min={12} max={64} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Letter spacing" prop="letter-spacing" min={-2} max={12} getVal={getVal} onStyle={onStyle} />
      </div>
      )}
      {!isMedia && (
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, marginTop: 2, color: INK }}>Box</div>
        <ColorRow label="Background" prop="background-color" getVal={getVal} onStyle={onStyle} />
        <NumRow label="Padding" prop="padding" max={80} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Margin top" prop="margin-top" max={80} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Margin bottom" prop="margin-bottom" max={80} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Rounded corners" prop="border-radius" max={60} getVal={getVal} onStyle={onStyle} />
        <ColorRow label="Border color" prop="border-color" getVal={getVal} onStyle={onStyle} />
        <BorderWidthRow getVal={getVal} onStyle={onStyle} />
      </div>
      )}
      <button onClick={onClear} style={{ marginTop: 14, border: `1px solid ${LINE}`, background: '#fff', color: SUB, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Done</button>
    </div>
  )
}
const miniActionA: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '7px 12px', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }
// PagePilot's framed-picture icon for the drag-&-drop dropzones (replaces the 🖼 emoji).
const PIC_ICON = <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke={FAINT} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M21 15.5l-4.5-4.5L5 20" /></svg>
// A PagePilot-style dashed drop-zone box (icon + prompt + size hint). `onPick` fires the file chooser.
function DropZone({ label, busy, onPick }: { label: string; busy: boolean; onPick: () => void }) {
  return (
    <button disabled={busy} onClick={onPick} style={{ width: '100%', border: `1.5px dashed ${LINE}`, background: INSET, color: INK, borderRadius: 12, padding: '20px 12px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {PIC_ICON}
      <span style={{ fontSize: 13, fontWeight: 700 }}>{busy ? 'Uploading…' : label}</span>
      <span style={{ fontSize: 11, color: FAINT, fontWeight: 500 }}>JPG, PNG, GIF, WEBP up to 120MB</span>
    </button>
  )
}

// Shared panel header (PagePilot parity): the KIND label ("Section"/"Block"), the name, a ✏️ affordance, and a
// desktop/mobile toggle — the same header PagePilot shows above every block's settings.
function PanelHeader({ kind, name, device, onDevice, onRename }: { kind: string; name: string; device?: Device; onDevice?: (d: Device) => void; onRename?: (name: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const save = () => { setEditing(false); if (onRename && draft.trim() && draft.trim() !== name) onRename(draft.trim()) }
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE }}>{kind}</div>
          {editing
            ? <input autoFocus defaultValue={name} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} style={{ width: '100%', fontFamily: SERIF, fontSize: 16, fontWeight: 700, border: `1px solid ${ORANGE}`, borderRadius: 8, padding: '3px 8px', color: INK, boxSizing: 'border-box', outline: 'none' }} />
            : <div style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || kind}</div>}
        </div>
        {onRename && <button title="Rename" onClick={() => { setDraft(name); setEditing((e) => !e) }} style={{ border: 0, background: editing ? WASH : 'transparent', color: editing ? ORANGE : FAINT, flex: 'none', marginTop: 2, cursor: 'pointer', padding: 3, borderRadius: 6, lineHeight: 0 }}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></button>}
      </div>
      {device && onDevice && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
            <button title="Desktop settings" onClick={() => onDevice('base')} style={{ border: 0, background: device === 'base' ? INK : '#fff', padding: '5px 10px', cursor: 'pointer', display: 'flex' }}><MonitorIcon on={device === 'base'} /></button>
            <button title="Mobile settings" onClick={() => onDevice('mobile')} style={{ border: 0, borderLeft: `1px solid ${LINE}`, background: device === 'mobile' ? INK : '#fff', padding: '5px 10px', cursor: 'pointer', display: 'flex' }}><PhoneIcon on={device === 'mobile'} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

// Section-level settings panel (bug D): PagePilot-style — the whole section's Layout (width, columns, gap,
// rounded), Background, and Spacing. Styles the raw section's outer wrapper + its content grid.
function RawSectionSettings({ name, getVal, onStyle, full, onFull, gridVal, onGrid, cols, onCols, bgImage, onBgImage, uploadImage, device, onDevice, onRename, onHide, onDup, onDel }: { name: string; getVal: (p: string) => string; onStyle: (p: string, v: string) => void; full: boolean; onFull: (v: boolean) => void; gridVal: (p: string) => string; onGrid: (p: string, v: string) => void; cols: string; onCols: (n: string) => void; bgImage: string; onBgImage: (u: string) => void; uploadImage: (f: File) => Promise<string | null>; device: Device; onDevice: (d: Device) => void; onRename: (name: string) => void; onHide: () => void; onDup: () => void; onDel: () => void }) {
  // "Dynamic" rounded-corners = inherit the template default (no override); "Custom" = the slider below.
  const [roundedCustom, setRoundedCustom] = useState(() => !!parseFloat(getVal('border-radius')))
  const [bgBusy, setBgBusy] = useState(false)
  const pickBg = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp,image/gif'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; setBgBusy(true); const u = await uploadImage(f); setBgBusy(false); if (u) onBgImage(u) }; inp.click() }
  const mob = device === 'mobile'
  const L = (s: string) => (mob ? `Mobile ${s}` : s)   // per-device props read/write mobile values in mobile mode
  return (
    <div>
      <PanelHeader kind="Section" name={name} device={device} onDevice={onDevice} onRename={onRename} />
      {mob && <div style={{ display: 'flex', gap: 7, alignItems: 'center', background: WASH, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 10px', marginBottom: 12, fontSize: 11.5, color: SUB, lineHeight: 1.4 }}><span style={{ flex: 'none' }}>📱</span>Editing mobile — background, padding &amp; alignment here apply on phones only.</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={onDup} style={miniActionA}>⧉ Duplicate</button>
        <button onClick={onHide} style={miniActionA}>👁 Hide/show</button>
        <button onClick={onDel} style={{ ...miniActionA, color: ORANGE }}>🗑 Delete</button>
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, marginTop: 2, color: INK }}>Layout</div>
        <SegRow label="Width" prop="__full" options={[['0', 'Contained'], ['1', 'Full']]} getVal={() => (full ? '1' : '0')} onStyle={(_p, v) => onFull(v === '1')} />
        <SegRow label={L('Content alignment')} prop="text-align" options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} getVal={getVal} onStyle={onStyle} />
        {!mob && <NumRow label="Columns" prop="__cols" min={1} max={6} unit="col" getVal={() => cols || ''} onStyle={(_p, v) => onCols(v)} />}
        {!mob && <NumRow label="Gap" prop="gap" max={80} getVal={gridVal} onStyle={onGrid} />}
        <SegRow label="Rounded corners source" prop="__rcs" options={[['custom', 'Custom'], ['dynamic', 'Dynamic']]} getVal={() => (roundedCustom ? 'custom' : 'dynamic')} onStyle={(_p, v) => { const c = v === 'custom'; setRoundedCustom(c); if (!c) onStyle('border-radius', '') }} />
        {roundedCustom && <NumRow label={L('Rounded corners')} prop="border-radius" max={60} getVal={getVal} onStyle={onStyle} />}
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, marginTop: 2, color: INK }}>Background</div>
        <ColorRow label={L('Background color')} prop="background-color" getVal={getVal} onStyle={onStyle} />
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 13, color: '#4a4843', fontWeight: 500, marginBottom: 7 }}>Background image</div>
          {bgImage
            ? (<div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${LINE}` }}><img src={bgImage} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block' }} /><button onClick={() => onBgImage('')} title="Remove" style={{ position: 'absolute', top: 6, right: 6, border: 0, background: 'rgba(20,18,15,.72)', color: '#fff', borderRadius: 999, width: 24, height: 24, cursor: 'pointer', lineHeight: 1, fontSize: 14 }}>×</button></div>)
            : (<DropZone label="Drag & Drop or click to select image" busy={bgBusy} onPick={pickBg} />)}
          {bgImage && (<div style={{ marginTop: 8 }}>
            <SegRow label="Position" prop="background-position" options={[['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']]} getVal={getVal} onStyle={onStyle} />
            <SegRow label="Size" prop="background-size" options={[['cover', 'Cover'], ['contain', 'Contain']]} getVal={getVal} onStyle={onStyle} />
          </div>)}
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 12, marginTop: 2, color: INK }}>Spacing</div>
        <NumRow label={L('Padding top')} prop="padding-top" max={160} getVal={getVal} onStyle={onStyle} />
        <NumRow label={L('Padding bottom')} prop="padding-bottom" max={160} getVal={getVal} onStyle={onStyle} />
        <NumRow label={L('Padding sides')} prop="padding-inline" max={120} getVal={getVal} onStyle={onStyle} />
      </div>
    </div>
  )
}

// PagePilot-style rich text editor: a formatting toolbar (size, B/I/U, lists, link, undo/redo, color) over a
// contentEditable of the selected text piece, plus "✨ Edit with AI". Commits the piece's innerHTML on blur.
function RichText({ html, onCommit, context }: { html: string; onCommit: (html: string) => void; context: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkVal, setLinkVal] = useState('')
  const setInitial = useCallback((el: HTMLDivElement | null) => { ref.current = el; if (el && el.innerHTML !== html) el.innerHTML = html }, [html])
  const saveSel = () => { const s = window.getSelection(); if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange() }
  const restoreSel = () => { const r = savedRange.current; const s = window.getSelection(); if (r && s) { s.removeAllRanges(); s.addRange(r) } }
  const commit = () => { if (ref.current) onCommit(ref.current.innerHTML) }
  // Toolbar buttons preventDefault on mousedown, so the editor keeps focus + the live selection — run the
  // command directly (calling focus() here would collapse the selection first, which is why it "did nothing").
  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); saveSel(); commit() }
  // List toggles need a live selection INSIDE the editor or execCommand can wipe/detach the whole block. If the
  // cursor isn't in the editor, select all its content first; and never let a toggle empty the block.
  const execList = (cmd: string) => {
    const el = ref.current; if (!el) return
    const before = el.innerHTML
    const s = window.getSelection()
    const inside = !!(s && s.rangeCount && el.contains(s.anchorNode))
    if (!inside) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); s?.removeAllRanges(); s?.addRange(r) }
    document.execCommand(cmd)
    if (!(el.textContent || '').trim()) el.innerHTML = before   // guard: a list toggle must never delete the content
    saveSel(); commit()
  }
  // Focus-stealing controls (size <select>, color <input>, link field) — refocus + restore the saved range first.
  const execRestore = (cmd: string, val?: string) => { ref.current?.focus(); restoreSel(); document.execCommand(cmd, false, val); saveSel(); commit() }
  const applyLink = () => { const u = linkVal.trim(); setLinkOpen(false); if (!u) return; execRestore('createLink', u); setLinkVal('') }
  const editAI = async () => {
    const text = ref.current?.textContent || ''
    if (!text.trim()) return
    setAiBusy(true)
    try {
      const r = await fetch('/api/builder/rewrite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, context }) })
      const j = await r.json()
      if (j.text && ref.current) { ref.current.textContent = j.text; commit() }
      else window.alert(j.error || 'Could not rewrite.')
    } catch { window.alert('Could not rewrite — please try again.') }
    finally { setAiBusy(false) }
  }
  const tbBtn: React.CSSProperties = { border: 0, background: 'transparent', color: INK, width: 26, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }
  const noBlur = (fn: () => void) => (e: React.MouseEvent) => { e.preventDefault(); fn() }
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>Text</div>
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', padding: '4px 5px', borderBottom: `1px solid ${LINE}`, background: INSET }}>
          <select onMouseDown={saveSel} onChange={(e) => execRestore('fontSize', e.target.value)} defaultValue="" title="Text size" style={{ border: `1px solid ${LINE}`, borderRadius: 6, background: '#fff', fontSize: 12, padding: '2px 4px', marginRight: 3, cursor: 'pointer', color: INK }}>
            <option value="" disabled>Aa</option>
            <option value="2">Small</option><option value="3">Normal</option><option value="5">Large</option><option value="6">XL</option>
          </select>
          <button title="Bold" style={{ ...tbBtn, fontWeight: 800 }} onMouseDown={noBlur(() => exec('bold'))}>B</button>
          <button title="Italic" style={{ ...tbBtn, fontStyle: 'italic' }} onMouseDown={noBlur(() => exec('italic'))}>I</button>
          <button title="Underline" style={{ ...tbBtn, textDecoration: 'underline' }} onMouseDown={noBlur(() => exec('underline'))}>U</button>
          <button title="Bulleted list" style={tbBtn} onMouseDown={noBlur(() => execList('insertUnorderedList'))}>•</button>
          <button title="Numbered list" style={tbBtn} onMouseDown={noBlur(() => execList('insertOrderedList'))}>1.</button>
          <button title="Link" style={tbBtn} onMouseDown={noBlur(() => { saveSel(); setLinkOpen((o) => !o) })}>🔗</button>
          <label title="Text color" style={{ ...tbBtn, position: 'relative' }} onMouseDown={saveSel}><span style={{ pointerEvents: 'none' }}>A</span><span style={{ position: 'absolute', bottom: 3, left: 6, right: 6, height: 3, background: ORANGE, borderRadius: 2 }} /><input type="color" onChange={(e) => execRestore('foreColor', e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} /></label>
          <div style={{ flex: 1 }} />
          <button title="Undo" style={tbBtn} onMouseDown={noBlur(() => exec('undo'))}>↺</button>
          <button title="Redo" style={tbBtn} onMouseDown={noBlur(() => exec('redo'))}>↻</button>
        </div>
        {linkOpen && (
          <div style={{ display: 'flex', gap: 6, padding: '7px 7px 0' }}>
            <input autoFocus value={linkVal} onChange={(e) => setLinkVal(e.target.value)} placeholder="https://…" onKeyDown={(e) => { if (e.key === 'Enter') applyLink() }}
              style={{ flex: 1, minWidth: 0, border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 9px', fontSize: 12.5, boxSizing: 'border-box' }} />
            <button onMouseDown={(e) => e.preventDefault()} onClick={applyLink} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 8, padding: '0 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Add</button>
          </div>
        )}
        <div ref={setInitial} contentEditable suppressContentEditableWarning onBlur={commit} onMouseUp={saveSel} onKeyUp={saveSel}
          style={{ minHeight: 60, padding: '9px 11px', fontSize: 13, lineHeight: 1.5, color: INK, outline: 'none' }} />
      </div>
      <div style={{ marginTop: 8 }}>
        <button disabled={aiBusy} onMouseDown={(e) => e.preventDefault()} onClick={editAI} style={{ width: '100%', border: 0, background: 'linear-gradient(90deg,#f5e9ff,#ffe9f0)', color: '#b23aa0', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontWeight: 800, cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.6 : 1 }}>{aiBusy ? 'Rewriting…' : '✨ Edit with AI'}</button>
      </div>
      <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Format the text here, or double-click it on the canvas.</div>
    </div>
  )
}

/** Border width slider — also sets border-style:solid so the border actually shows (and clears it at 0). */
function BorderWidthRow({ getVal, onStyle }: { getVal: (p: string) => string; onStyle: (p: string, v: string) => void }) {
  const n = parseFloat(getVal('border-width')); const v = isFinite(n) ? n : 0
  const set = (raw: string) => { const w = raw ? parseInt(raw, 10) : 0; if (w > 0) { onStyle('border-style', 'solid'); onStyle('border-width', `${w}px`) } else { onStyle('border-width', ''); onStyle('border-style', '') } }
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: SUB, fontWeight: 600, marginBottom: 4 }}>Border width</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="range" min={0} max={12} value={v} onChange={(e) => set(e.target.value)} style={{ flex: 1, accentColor: ORANGE }} />
        <input type="number" value={v || ''} onChange={(e) => set(e.target.value)} style={{ width: 56, border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 8px', fontSize: 12.5, boxSizing: 'border-box' }} />
      </div>
    </div>
  )
}

/* ── Edit Product — the product the page's bound elements read from ── */
function EditProductModal({ doc, onChange, onClose }: { doc: PageDoc; onChange: (p: Record<string, unknown>) => void; onClose: () => void }) {
  const p = (doc.productRef?.importedProduct || {}) as Record<string, unknown>
  const field = (label: string, key: string, placeholder = '', numeric = false) => (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 12, color: SUB, fontWeight: 600 }}>{label}</span>
      <input defaultValue={p[key] != null ? String(p[key]) : ''} placeholder={placeholder}
        onBlur={(e) => onChange({ [key]: numeric ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value })}
        style={{ width: '100%', marginTop: 5, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, fontFamily: 'inherit', boxSizing: 'border-box' }} />
    </label>
  )
  return (
    <Modal title="Edit product" onClose={onClose} hint="These feed the product-bound elements (title, price, rating, image) and the canvas preview.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {field('Title', 'title', 'Product name')}
        {field('Price', 'price', '$49.00')}
        {field('Compare-at price', 'compareAtPrice', '$69.00')}
        {field('Rating (0–5)', 'rating', '4.9', true)}
        {field('Review count', 'ratingCount', '1240', true)}
        {field('Image URL', 'image', 'https://…')}
      </div>
      <div style={{ marginTop: 10 }}>{field('Description', 'description', 'Short product description')}</div>
    </Modal>
  )
}

/* ── Page settings — SEO title + description (stored in doc.settings.seo) ── */
function SettingsModal({ doc, onChange, onClose }: { doc: PageDoc; onChange: (p: Record<string, unknown>) => void; onClose: () => void }) {
  const seo = ((doc.settings as { seo?: Record<string, unknown> })?.seo || {}) as Record<string, unknown>
  return (
    <Modal title="Page settings" onClose={onClose} hint="SEO title and description for the published page.">
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: SUB, fontWeight: 600 }}>SEO title</span>
        <input defaultValue={seo.title != null ? String(seo.title) : ''} onBlur={(e) => onChange({ title: e.target.value })}
          style={{ width: '100%', marginTop: 5, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, fontFamily: 'inherit', boxSizing: 'border-box' }} />
      </label>
      <label style={{ display: 'block' }}>
        <span style={{ fontSize: 12, color: SUB, fontWeight: 600 }}>SEO description</span>
        <textarea defaultValue={seo.description != null ? String(seo.description) : ''} onBlur={(e) => onChange({ description: e.target.value })}
          style={{ width: '100%', marginTop: 5, border: `1px solid ${LINE}`, borderRadius: 9, padding: '8px 10px', fontSize: 13, color: INK, fontFamily: 'inherit', minHeight: 70, resize: 'vertical', boxSizing: 'border-box' }} />
      </label>
    </Modal>
  )
}

function Modal({ title, hint, children, onClose }: { title: string; hint?: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '92vw', background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 20px 60px rgba(20,18,15,.25)' }}>
        <div style={{ fontFamily: SERIF, fontSize: 22 }}>{title}</div>
        {hint && <div style={{ fontSize: 12.5, color: SUB, marginTop: 4, marginBottom: 14, lineHeight: 1.5 }}>{hint}</div>}
        {children}
        <div style={{ textAlign: 'right', marginTop: 16 }}><button onClick={onClose} style={btn}>Done</button></div>
      </div>
    </div>
  )
}

// PagePilot-style canvas toolbar: a clean white pill with muted outline icons + dividers (not a bold bar).
const tbSvg = (d: React.ReactNode) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
const TB_ICON: Record<string, React.ReactNode> = {
  eye: tbSvg(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>),
  dup: tbSvg(<><rect x="9" y="9" width="11" height="11" rx="2.5" /><path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" /></>),
  up: tbSvg(<path d="M6 15l6-6 6 6" />),
  down: tbSvg(<path d="M6 9l6 6 6-6" />),
  plus: tbSvg(<path d="M12 5v14M5 12h14" />),
  trash: tbSvg(<><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>),
  img: tbSvg(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M21 15l-5-5L5 20" /></>),
}
function TbBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  const [h, setH] = useState(false)
  return <button title={title} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ border: 0, background: h ? (danger ? '#fdece9' : '#f1f0f7') : 'transparent', color: danger ? '#e0402f' : '#565b78', cursor: 'pointer', fontSize: 15, lineHeight: 0, width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, pointerEvents: 'auto', transition: 'background .1s' }}>{children}</button>
}
const TbDiv = () => <span style={{ width: 1, height: 18, background: '#e7e5f0', margin: '0 2px', flex: 'none' }} />
function TbText({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  const [h, setH] = useState(false)
  return <button title={title} onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ border: 0, background: h ? '#f1f0f7' : 'transparent', color: '#565b78', cursor: 'pointer', height: 28, display: 'inline-flex', alignItems: 'center', gap: 5, borderRadius: 7, padding: '0 9px 0 7px', fontSize: 13, fontWeight: 600, pointerEvents: 'auto', whiteSpace: 'nowrap', transition: 'background .1s' }}>{TB_ICON.plus}{children}</button>
}
const TB_BAR: React.CSSProperties = { background: '#fff', border: '1px solid #e7e5f0', borderRadius: 10, padding: 4, boxShadow: '0 6px 22px -6px rgba(20,18,15,.22)', pointerEvents: 'auto' }

/* ── small pieces ── */
const btn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const iconTopBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 8, width: 30, height: 30, fontSize: 14, lineHeight: 1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const menuItem: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'transparent', color: INK, fontSize: 13, fontWeight: 600, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: SUB, fontFamily: 'Inter, system-ui, sans-serif', fontSize: 14 }}>{children}</div>
}
function Row({ label, faint }: { label: string; faint?: boolean }) {
  return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.09em', color: faint ? FAINT : SUB, padding: '4px 6px 8px' }}>{label}</div>
}
function SaveBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = { saving: ['Saving…', SUB], saved: ['Saved', '#12a150'], error: ['Save failed', ORANGE], idle: ['', SUB], loading: ['', SUB] }
  const [txt, col] = map[status] || ['', SUB]
  return <span style={{ fontSize: 12, color: col, minWidth: 64, textAlign: 'right' }}>{txt}</span>
}
const MonitorIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on ? '#fff' : SUB} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
)
const PhoneIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on ? '#fff' : SUB} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
)
function DeviceToggle({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 999, overflow: 'hidden' }}>
      <button title="Desktop" onClick={() => onChange('base')} style={{ border: 0, background: value === 'base' ? INK : '#fff', padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><MonitorIcon on={value === 'base'} /></button>
      <button title="Mobile" onClick={() => onChange('mobile')} style={{ border: 0, borderLeft: `1px solid ${LINE}`, background: value === 'mobile' ? INK : '#fff', padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><PhoneIcon on={value === 'mobile'} /></button>
    </div>
  )
}
function ZoomControl({ zoom, setZoom, onFit }: { zoom: number; setZoom: (z: number) => void; onFit: () => void }) {
  const step = (d: number) => setZoom(Math.min(1, Math.max(0.4, Math.round((zoom + d) * 20) / 20)))
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 999, overflow: 'hidden' }}>
      <button title="Zoom out" onClick={() => step(-0.1)} style={{ border: 0, background: '#fff', color: INK, padding: '6px 10px', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>−</button>
      <button title="Fit to width" onClick={onFit} style={{ border: 0, borderLeft: `1px solid ${LINE}`, borderRight: `1px solid ${LINE}`, background: '#fff', color: SUB, padding: '6px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700, minWidth: 46 }}>{Math.round(zoom * 100)}%</button>
      <button title="Zoom in" onClick={() => step(0.1)} style={{ border: 0, background: '#fff', color: INK, padding: '6px 10px', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>+</button>
    </div>
  )
}
function AddBtn({ label, onClick, depth, primary }: { label: string; onClick: () => void; depth: number; primary?: boolean }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', marginLeft: depth * 14, marginTop: 4, border: `1px dashed ${primary ? ORANGE : LINE}`, background: primary ? WASH : 'transparent', color: primary ? ORANGE : SUB, borderRadius: 9, padding: '7px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
      ＋ {label}
    </button>
  )
}

// A PagePilot-style leading type icon for a tree row, inferred from its label (line icons, 15px).
function treeIconFor(label: string, hasChildren?: boolean): React.ReactNode {
  const l = (label || '').toLowerCase()
  const ic = (d: React.ReactNode) => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>{d}</svg>
  // PagePilot section-type icons (checked first so e.g. "Reviews Carousel" gets a carousel, not a star).
  if (/carousel|rotating|recommended/.test(l)) return ic(<><rect x="7" y="6" width="10" height="12" rx="1.5" /><path d="M4 8v8M20 8v8" /></>)   // carousel: center card + side pages
  if (/statistics|percentage|feature ?card/.test(l)) return ic(<><path d="M4 5v14M20 5v14" /><path d="M8 9h8M8 13h5" /></>)   // brackets [ ]
  if (/as seen|quote/.test(l)) return ic(<><path d="M7 4h10v4a5 5 0 0 1-10 0V4z" /><path d="M9 21h6M12 13v8" /></>)   // trophy
  if (/difference|comparison|versus/.test(l)) return ic(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16M3 10h18" /></>)   // table
  if (/gallery|thumbnail|image|photo|product image|avatar/.test(l)) return ic(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.5" /><path d="M21 16l-5-5L5 20" /></>)
  if (/best ?seller|badge|award|eyebrow/.test(l)) return ic(<><path d="M7 4h10v4a5 5 0 0 1-10 0V4z" /><path d="M9 21h6M12 13v8" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>)
  if (/product title|^title|headline|heading|tagline|subhead/.test(l)) return ic(<><path d="M5 5h14M12 5v14M9 19h6" /></>)
  if (/sale price|compare price|save|price/.test(l)) return ic(<><path d="M20 12l-8 8-9-9V4h7z" /><circle cx="7.5" cy="7.5" r="1.5" /></>)
  if (/reviews number|rating|stars|review/.test(l)) return ic(<><path d="M12 3l2.9 5.9 6.1.9-4.4 4.3 1 6.1L12 17.8 6.4 20.6l1-6.1L3 10.2l6.1-.9z" /></>)
  if (/add to cart|button|cta/.test(l)) return ic(<><rect x="3" y="8" width="18" height="8" rx="4" /><path d="M8 12h8" /></>)
  if (/payment/.test(l)) return ic(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>)
  if (/guarantee/.test(l)) return ic(<><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>)
  if (/details|description/.test(l)) return ic(<><path d="M6 3h9l4 4v14H6z" /><path d="M9 10h7M9 14h7M9 18h4" /></>)
  if (/stock|notice|warn/.test(l)) return ic(<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></>)
  if (/check|benefit/.test(l)) return ic(<><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.4 2.4 4.6-5" /></>)
  if (/pill|strip/.test(l)) return ic(<><rect x="3" y="9" width="18" height="6" rx="3" /></>)
  if (/stat|percentage/.test(l)) return ic(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>)
  if (/feature|card/.test(l)) return ic(<><path d="M12 3l2 5 5 .5-4 3.5 1.5 5L12 19l-4.5 3 1.5-5-4-3.5 5-.5z" /></>)
  if (/divider/.test(l)) return ic(<><path d="M4 12h16" /></>)
  if (/list|ingredient|numbered/.test(l)) return ic(<><path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>)
  if (/press|logo|as seen/.test(l)) return ic(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h10M7 12h6" /></>)
  if (hasChildren || /group|row|section|creative|buy box|product details|gallery/.test(l)) return ic(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>)
  return ic(<><rect x="5" y="5" width="14" height="14" rx="2" /></>)
}

function TreeRow(props: {
  depth: number; label: string; count?: number; hidden?: boolean; selected: boolean; open?: boolean; hasChildren?: boolean
  onToggle?: () => void; onSelect: () => void; onUp: () => void; onDown: () => void; onDup: () => void; onHide: () => void; onDel: () => void
  draggable?: boolean; dragging?: boolean; dropHint?: boolean
  onDragStart?: () => void; onDragEnd?: () => void; onDragOver?: (e: React.DragEvent) => void; onDrop?: () => void
}) {
  const { depth, label, count, hidden, selected, open, hasChildren, onToggle, onSelect, draggable } = props
  const [hover, setHover] = useState(false)
  const [menu, setMenu] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const act = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); setMenu(false); fn() }
  // Keep the ⋯ menu open when the cursor moves off the row onto an option; close it on an outside click or scroll.
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => { if (!rowRef.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', () => setMenu(false), { capture: true, once: true })
    return () => document.removeEventListener('mousedown', close)
  }, [menu])
  return (
    <div ref={rowRef} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      draggable={draggable} onDragStart={props.onDragStart} onDragEnd={props.onDragEnd}
      onDragOver={draggable ? props.onDragOver : undefined} onDrop={draggable ? props.onDrop : undefined}
      style={{ position: 'relative', zIndex: menu ? 20 : undefined, display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6, paddingLeft: 2 + depth * 14, paddingRight: 4, minHeight: 34, borderRadius: 8, background: selected ? WASH : hover ? INSET : 'transparent', cursor: 'pointer', opacity: props.dragging ? 0.4 : hidden ? 0.5 : 1, boxShadow: props.dropHint ? `inset 0 2px 0 ${ORANGE}` : 'none' }}>
      {/* drag grip — appears on hover (the whole row is draggable); signals reordering like PagePilot */}
      <span title="Drag to reorder" style={{ width: 12, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: FAINT, cursor: draggable ? 'grab' : 'default', opacity: hover && draggable ? 1 : 0, transition: 'opacity .1s' }}>
        <svg viewBox="0 0 10 16" width="8" height="13" fill="currentColor"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>
      </span>
      <span onClick={(e) => { e.stopPropagation(); (hasChildren ? onToggle : onSelect)?.() }} style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: hasChildren ? SUB : 'transparent', fontSize: 15, fontWeight: 700, cursor: hasChildren ? 'pointer' : 'default', flex: 'none', transition: 'transform .12s', transform: hasChildren && open ? 'rotate(90deg)' : 'none' }}>{hasChildren ? '›' : ''}</span>
      <span style={{ color: selected ? ORANGE : SUB, display: 'inline-flex', flex: 'none' }}>{treeIconFor(label, hasChildren)}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: selected ? ORANGE : INK, fontWeight: selected ? 800 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}{count != null && count > 0 ? <span style={{ color: FAINT, fontWeight: 500 }}> · {count}</span> : null}
      </span>
      {(hover || menu) && (
        <span onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 1, paddingLeft: 14, background: `linear-gradient(90deg, transparent, ${selected ? WASH : INSET} 16px)`, borderRadius: 8 }}>
          <button title={hidden ? 'Show' : 'Hide'} onClick={act(props.onHide)} style={{ border: 0, background: 'transparent', color: SUB, cursor: 'pointer', width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, padding: 0 }}>
            {hidden
              ? <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 20C5 20 1 12 1 12a19 19 0 0 1 5.1-5.9M9.9 4.2A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a19 19 0 0 1-2.2 3.2M1 1l22 22M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
              : <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
          </button>
          <button title="Options" onClick={(e) => { e.stopPropagation(); setMenu((m) => !m) }} style={{ border: 0, background: 'transparent', color: SUB, cursor: 'pointer', fontSize: 18, lineHeight: 1, width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>⋯</button>
          {menu && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 2, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, boxShadow: '0 10px 28px -10px rgba(20,18,15,.4)', padding: 5, display: 'flex', flexDirection: 'column', minWidth: 150, zIndex: 40 }}>
              <MenuItem onClick={act(props.onHide)}>{hidden ? '◌  Show' : '👁  Hide'}</MenuItem>
              <MenuItem onClick={act(props.onDup)}>⧉  Duplicate</MenuItem>
              <MenuItem onClick={act(props.onUp)}>↑  Move up</MenuItem>
              <MenuItem onClick={act(props.onDown)}>↓  Move down</MenuItem>
              <MenuItem onClick={act(props.onDel)} danger>🗑  Delete</MenuItem>
            </div>
          )}
        </span>
      )}
    </div>
  )
}
// ── Right-panel style rows (MODULE-LEVEL so they keep focus / don't remount on every parent re-render) ──
// PagePilot layout: label on the LEFT, control on the RIGHT (compact two-column rows).
type RowBase = { label: string; prop: string; getVal: (p: string) => string; onStyle: (p: string, v: string) => void }
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minHeight: 30, padding: '5px 0' }
const LBL: React.CSSProperties = { fontSize: 13, color: '#4a4843', fontWeight: 500, flex: 'none', width: 92 }
const numBox: React.CSSProperties = { width: 44, border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 6px', fontSize: 12.5, boxSizing: 'border-box', textAlign: 'center', color: INK }
const selBox: React.CSSProperties = { flex: 1, minWidth: 0, border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 9px', fontSize: 12.5, cursor: 'pointer', background: '#fff', boxSizing: 'border-box', color: INK }
// Number + slider: edits locally while dragging/typing, commits on release / blur (so a re-render never
// interrupts the interaction). Slider knob is dark to match PagePilot; `unit` shows px / % / col.
function NumRow({ label, prop, min = 0, max = 120, unit = 'px', getVal, onStyle }: RowBase & { min?: number; max?: number; unit?: string }) {
  const initial = () => { const n = parseFloat(getVal(prop)); return isFinite(n) ? String(n) : '' }
  const [val, setVal] = useState(initial)
  const commit = (v: string) => onStyle(prop, v !== '' ? `${v}${unit === 'px' ? 'px' : unit === '%' ? '%' : ''}` : '')
  return (
    <div style={ROW}>
      <span style={LBL}>{label}</span>
      <input type="range" min={min} max={max} value={val === '' ? min : val} onChange={(e) => setVal(e.target.value)} onMouseUp={() => commit(val)} onTouchEnd={() => commit(val)} style={{ flex: 1, minWidth: 0, accentColor: INK }} />
      <input type="number" value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => commit(val)} onKeyDown={(e) => { if (e.key === 'Enter') commit(val) }} style={numBox} />
      <span style={{ fontSize: 11, color: FAINT, flex: 'none', width: 18 }}>{unit}</span>
    </div>
  )
}
// Colour: live-previews locally while the native picker is open (onInput), commits on release (onChange).
function ColorRow({ label, prop, getVal, onStyle }: RowBase) {
  const [val, setVal] = useState(() => getVal(prop))
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val) ? val : '#000000'
  return (
    <div style={ROW}>
      <span style={LBL}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, border: `1px solid ${LINE}`, borderRadius: 8, padding: '4px 8px' }}>
        <input type="color" value={hex} onInput={(e) => setVal((e.target as HTMLInputElement).value)} onChange={(e) => { setVal(e.target.value); onStyle(prop, e.target.value) }} style={{ width: 22, height: 22, flex: 'none', border: `1px solid ${LINE}`, borderRadius: 6, background: 'none', cursor: 'pointer', padding: 0 }} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: val ? INK : FAINT, overflow: 'hidden', textOverflow: 'ellipsis' }}>{val || 'inherit'}</span>
        {val && <button onClick={() => { setVal(''); onStyle(prop, '') }} style={{ border: 0, background: 'transparent', color: FAINT, fontSize: 14, fontWeight: 700, cursor: 'pointer', flex: 'none', lineHeight: 1 }} title="Clear">×</button>}
      </div>
    </div>
  )
}
// Segmented toggle (Page | Full style): label left, pill toggle right — active pill is dark, track is light.
function SegRow({ label, prop, options, getVal, onStyle }: RowBase & { options: [string, string][] }) {
  const cur = getVal(prop)
  return (
    <div style={ROW}>
      <span style={LBL}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', background: '#f1f0ee', borderRadius: 9, padding: 3, gap: 3 }}>
        {options.map(([v, lbl]) => (
          <button key={v} onClick={() => onStyle(prop, cur === v ? '' : v)} style={{ flex: 1, border: 0, background: cur === v ? INK : 'transparent', color: cur === v ? '#fff' : SUB, padding: '5px 4px', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 6, boxShadow: cur === v ? '0 1px 2px rgba(0,0,0,.15)' : 'none' }}>{lbl}</button>
        ))}
      </div>
    </div>
  )
}
function SelRow({ label, prop, options, getVal, onStyle }: RowBase & { options: [string, string][] }) {
  return (
    <div style={ROW}>
      <span style={LBL}>{label}</span>
      <select value={getVal(prop)} onChange={(e) => onStyle(prop, e.target.value)} style={selBox}>
        <option value="">Default</option>
        {options.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
      </select>
    </div>
  )
}
// A plain labeled <select> driven by value/onChange (for Gallery settings, unlike SelRow which uses CSS props).
function PlainSel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div style={ROW}>
      <span style={LBL}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selBox}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: (e: React.MouseEvent) => void; danger?: boolean }) {
  const [h, setH] = useState(false)
  return <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ textAlign: 'left', border: 0, background: h ? INSET : 'transparent', color: danger ? '#d64316' : INK, fontSize: 13, fontWeight: 600, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap' }}>{children}</button>
}
function IconBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return <button className="bld-iconbtn" title={title} onClick={onClick} style={{ border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, color: danger ? '#d64316' : SUB }}>{children}</button>
}

function AddMenu({ title, options, onPick, onClose }: { title: string; options: { id: string; label: string }[]; onPick: (id: string) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 420, maxWidth: '92vw', background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 20px 60px rgba(20,18,15,.25)' }}>
        <div style={{ fontFamily: SERIF, fontSize: 22, marginBottom: 14 }}>{title}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {options.map((o) => (
            <button key={o.id} onClick={() => onPick(o.id)} style={{ textAlign: 'left', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 12, padding: '12px 14px', fontSize: 13.5, fontWeight: 600, color: INK, cursor: 'pointer' }}>
              {o.label}
            </button>
          ))}
        </div>
        <div style={{ textAlign: 'right', marginTop: 14 }}><button onClick={onClose} style={btn}>Cancel</button></div>
      </div>
    </div>
  )
}

/* helpers */
function toggle(set: Set<string>, id: string): Set<string> { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n }
function elLabel(el: Element): string {
  if (el.content.bind) return el.content.bind.replace('product.', '') + ' (product)'
  const t = el.content.text
  return t ? `${el.type}: ${t.slice(0, 18)}${t.length > 18 ? '…' : ''}` : el.type
}
