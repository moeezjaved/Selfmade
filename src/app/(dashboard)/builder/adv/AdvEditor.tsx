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
const SERIF = '"Hedvig Letters Serif", Georgia, serif'

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

type RawOp = 'up' | 'down' | 'hide' | 'delete' | 'img' | 'style' | 'insert' | 'sethtml' | 'settext' | 'dup' | 'appendchild'
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
  ti: 'Check', pays: 'Payment Icons', grow: 'Guarantees', acc: 'Details', pdetails: 'Details', pdesc: 'Description',
  hrev: 'Featured Review', warn: 'Stock Notice', hclaim: 'Guarantee', qty: 'Quantity', newline: 'Tagline',
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
  const tag = el.tagName.toLowerCase()
  const cls = friendlyClassOf(el)
  // A known class wins for BOTH leaves and containers → clean PagePilot-style names everywhere we know them.
  if (RAW_FRIENDLY[cls]) return RAW_FRIENDLY[cls]
  if (tag === 'img') return 'Image'
  if (tag === 'hr') return 'Divider'
  if (tag === 'table') return 'Table'
  if (tag === 'ul' || tag === 'ol') return 'List'
  const txt = (el.textContent || '').replace(/\s+/g, ' ').trim()
  const snip = (n: number) => txt.slice(0, n) + (txt.length > n ? '…' : '')
  const kids = el.children.length
  if (kids === 0) {
    if (!txt) return el.querySelector('img') ? 'Image' : (rawFriendly(cls) || tag)
    if (/^h[1-6]$/.test(tag)) return `Heading: ${snip(20)}`
    if (tag === 'a' || tag === 'button') return `Button: ${snip(16)}`
    if (tag === 'li') return `• ${snip(18)}`
    return snip(24)
  }
  if (el.querySelector('img') && !txt) return 'Image'
  if (/^h[1-6]$/.test(tag)) return `Heading: ${snip(20)}`
  if (tag === 'a' || tag === 'button') return `Button: ${snip(16)}`
  // Unclassed container (a hero column) → infer a PagePilot-style group name from what it holds. The outer
  // row keeps its own friendly class ('grid'→'Row'), so only real columns reach here.
  if (el.querySelector('.ptitle, h1') && el.querySelector('.price, .now, .buy, .btn, [class*="cart"], [class*="atc"]')) return 'Product Details'
  if (rawIsImg(el) || el.querySelector('.thumbs, .gtrack, .gallery, .hbottle')) return 'Product Gallery'
  if (txt && txt.length <= 24) return snip(24)
  return rawFriendly(cls) || 'Group'
}
function rawIsImg(el: HTMLElement): boolean {
  return el.tagName === 'IMG' || (!!el.querySelector('img') && !(el.textContent || '').trim())
}
/** Parse a raw slice's HTML into a nested outline. Collapses single-child layout wrappers so the tree shows
 *  meaningful pieces, not scaffolding; caps nodes + depth so it stays fast and legible. */
function buildRawOutline(html: string): RawOutlineNode[] {
  if (typeof document === 'undefined' || !html) return []
  const box = document.createElement('div'); box.innerHTML = html
  let budget = 800
  const walk = (el: HTMLElement, path: number[], depth: number): RawOutlineNode | null => {
    if (budget-- <= 0) return null
    let cur: HTMLElement = el, curPath = path
    // descend through wrappers that hold a single element child and add no own text (pure layout)
    while (cur.children.length === 1 && depth < 12) {
      const only = cur.children[0] as HTMLElement
      const own = (cur.textContent || '').replace(only.textContent || '', '').trim()
      if (own) break
      cur = only; curPath = [...curPath, 0]
    }
    const kids = Array.from(cur.children) as HTMLElement[]
    let children: RawOutlineNode[] = []
    if (kids.length > 1 && depth < 6) children = kids.map((k, i) => walk(k, [...curPath, i], depth + 1)).filter(Boolean) as RawOutlineNode[]
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
  const [histDepth, setHistDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)
  const [tb, setTb] = useState<null | { top: number; left: number; below: boolean }>(null)
  const [zoom, setZoom] = useState(1)
  // Sub-selection INSIDE a raw (bespoke-template) section: the raw element + the clicked node's child-path.
  const [rawSel, setRawSel] = useState<null | { ref: NodeRef; path: number[]; isImg: boolean }>(null)
  const [rawTb, setRawTb] = useState<null | { top: number; left: number; below: boolean }>(null)
  const [rawBox, setRawBox] = useState<null | { top: number; left: number; width: number; height: number }>(null)  // selection highlight rect
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
    const { html, css } = renderDoc(doc, { mode: 'edit', device, product })
    return `<style>${css}
[data-node-id]{outline:1px dashed transparent;outline-offset:-1px;transition:outline-color .1s}
[data-node-id]:hover{outline-color:rgba(224,47,6,.35);cursor:pointer}
[data-sel="1"]{outline:2px solid ${ORANGE} !important;outline-offset:-2px}
</style>${html}`
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
    // Gallery: clicking a thumbnail swaps the MAIN image (preview interaction, like PagePilot and the
    // published storefront). Replacing/editing gallery images is still available from the tree.
    const thumb = clicked.closest('.thumbs img, img.gthumb, .gthumb img') as HTMLImageElement | null
    if (thumb && thumb.tagName === 'IMG') {
      const scope = (clicked.closest('[data-node-type^="section:"]') as HTMLElement | null) || canvasRef.current
      const main = scope?.querySelector('.hbottle, .gimg, .gtrack img, .gallery img:not(.thumbs img)') as HTMLImageElement | null
      const src = thumb.getAttribute('src')
      if (main && src && main !== thumb) { main.setAttribute('src', src); e.stopPropagation(); return }
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
    if (op === 'img') { const url = window.prompt('New image URL'); if (!url || !url.trim()) return; a = url.trim() }
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
    const n = rawNodeEl(); if (!n) return false
    return !!Array.from(n.querySelectorAll<HTMLElement>('*')).concat(n).find((e) => e.style && e.style.position === 'sticky')
  }, [rawNodeEl])
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
    return n.classList?.contains('pays') || !!n.querySelector('.pays, .payicon') || !!n.closest('.pays')
  }, [rawNodeEl])
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
  // Skip leading generic layout wrappers (the .grid "Row" / "Group") so the real blocks — Product Gallery,
  // Product Details, etc. — sit at the top of the section, matching PagePilot's two-block hero.
  const flattenOutline = (nodes: RawOutlineNode[]): RawOutlineNode[] => {
    let out = nodes
    let guard = 0
    while (out.length === 1 && out[0].children.length > 1 && /^(Row|Group|Section)$/.test(out[0].label) && guard++ < 4) out = out[0].children
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
        <div key={key}>
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
            <AddBtn label="Add block" depth={depth + 1} onClick={() => { selectRawPath(ref, n.path, n.isImg); setRawInsertTarget({ path: n.path, mode: 'append' }); setRawLibOpen(true) }} />
          )}
        </div>
      )
    })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 55, display: 'flex', flexDirection: 'column', height: '100vh', background: '#f4f2ee', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>
      {/* top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${LINE}`, background: '#fff' }}>
        <Link href="/builder" style={{ color: SUB, textDecoration: 'none', fontSize: 13, fontWeight: 600 }}>← Builder</Link>
        <span style={{ fontFamily: SERIF, fontSize: 18 }}>Page editor</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE, background: WASH, borderRadius: 999, padding: '3px 9px' }}>Advanced · beta</span>
        <button onClick={() => setShowProduct(true)} style={{ ...btn, padding: '6px 12px' }}>Edit product</button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'inline-flex', gap: 2 }}>
          <button title="Undo (⌘Z)" onClick={undo} disabled={!histDepth} style={{ ...iconTopBtn, opacity: histDepth ? 1 : 0.35, cursor: histDepth ? 'pointer' : 'default' }}>↶</button>
          <button title="Redo (⇧⌘Z)" onClick={redo} disabled={!redoDepth} style={{ ...iconTopBtn, opacity: redoDepth ? 1 : 0.35, cursor: redoDepth ? 'pointer' : 'default' }}>↷</button>
        </div>
        <DeviceToggle value={device} onChange={(d) => setDevice(d)} />
        <ZoomControl zoom={zoom} setZoom={setZoom} onFit={fitZoom} />
        <SaveBadge status={status} />
        <button onClick={saveNow} disabled={!dirty || status === 'saving'} title="Save (⌘S)" style={{ border: `1px solid ${dirty ? ORANGE : LINE}`, background: dirty ? WASH : '#fff', color: dirty ? ORANGE : SUB, borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: dirty && status !== 'saving' ? 'pointer' : 'default' }}>
          {status === 'saving' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        <button onClick={publish} disabled={publishing !== 'idle'} style={{ border: 0, background: ORANGE, color: '#fff', borderRadius: 999, padding: '7px 18px', fontSize: 13, fontWeight: 700, cursor: publishing === 'idle' ? 'pointer' : 'default', opacity: publishing === 'idle' ? 1 : 0.7 }}>
          {publishing === 'saving' ? 'Saving…' : publishing === 'publishing' ? 'Publishing…' : 'Publish →'}
        </button>
        <button title="Page settings" onClick={() => setShowMenu(true)} style={{ ...iconTopBtn, fontSize: 18 }}>⋯</button>
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
            const secLabel = isBuyBoxSec ? 'Product Information' : (s.name || SECTION_LABEL(s.type))
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
            <div ref={canvasRef} onClick={onCanvasClick} onDoubleClick={onCanvasDouble} onDragStart={onCanvasDragStart} onDragOver={onCanvasDragOver} onDrop={onCanvasDrop} dangerouslySetInnerHTML={{ __html: canvasHtml }} />
          </div>
        </main>

        {/* ── right: property panel ── raw sub-selection gets the in-place element settings ── */}
        <aside style={{ width: 300, borderLeft: `1px solid ${LINE}`, background: '#fff', overflowY: 'auto', padding: 16 }}>
          {rawSel ? (
            <RawElementSettings key={rawSel.path.join('.')} name={rawName()} text={rawText()} onText={rawSetText} isImg={rawSel.isImg}
              gallery={rawGallery()} onGalleryAdd={rawGalleryAdd} onGalleryRemove={rawGalleryRemove} onGalleryReplace={rawGalleryReplace} onSetImg={rawSetImg} uploadImage={uploadImage}
              isGallery={rawIsGallery()} sticky={rawGallerySticky()} onSticky={setGallerySticky} onCreateAI={galleryCreateAI} aiBusy={galleryAIbusy}
              isPays={rawIsPays()} paysActive={rawPaysActive()} onTogglePay={togglePayProvider}
              getVal={rawStyleVal} onStyle={rawStyle} onOp={rawOp} onClear={() => setRawSel(null)} />
          ) : !sel ? (
            <div style={{ color: FAINT, fontSize: 13, lineHeight: 1.6 }}>Select a section, block, or element on the canvas or in the tree to edit it.</div>
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
        <div style={{ position: 'fixed', top: tb.top, left: tb.left, transform: tb.below ? 'none' : 'translateY(-100%)', display: 'flex', gap: 1, background: INK, borderRadius: 8, padding: '3px 4px', boxShadow: '0 4px 14px rgba(20,18,15,.3)', zIndex: 30, pointerEvents: 'none' }} onClick={(e) => e.stopPropagation()}>
          <TbBtn title="Hide" onClick={() => apply((d) => setHidden(d, sel))}>👁</TbBtn>
          <TbBtn title="Duplicate" onClick={() => apply((d) => { const { doc: nd, newRef } = duplicateNode(d, sel); queueMicrotask(() => setSel(newRef)); return nd })}>⧉</TbBtn>
          <TbBtn title="Move up" onClick={() => apply((d) => moveNode(d, sel, -1))}>↑</TbBtn>
          <TbBtn title="Move down" onClick={() => apply((d) => moveNode(d, sel, 1))}>↓</TbBtn>
          {!sel.elementId && <TbBtn title="Add block" onClick={() => setAddMenu({ kind: 'block', sectionId: sel.sectionId })}>＋</TbBtn>}
          <TbBtn title="Delete" onClick={() => apply((d) => removeNode(d, sel), null)} danger>🗑</TbBtn>
        </div>
      )}

      {/* granular toolbar for a piece clicked INSIDE a raw (bespoke-template) section */}
      {/* selection highlight box over the exact block that's selected (PagePilot-style) */}
      {rawBox && rawSel && (
        <div style={{ position: 'fixed', top: rawBox.top - 2, left: rawBox.left - 2, width: rawBox.width + 4, height: rawBox.height + 4, border: `2px solid ${ORANGE}`, borderRadius: 6, zIndex: 29, pointerEvents: 'none', boxShadow: `0 0 0 3px ${WASH}` }} />
      )}
      {rawTb && rawSel && (
        <div style={{ position: 'fixed', top: rawTb.top, left: rawTb.left, transform: rawTb.below ? 'none' : 'translateY(-100%)', display: 'flex', alignItems: 'center', gap: 1, background: ORANGE, borderRadius: 8, padding: '3px 4px', boxShadow: '0 4px 14px rgba(20,18,15,.3)', zIndex: 31, pointerEvents: 'none' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '.04em', padding: '0 6px', textTransform: 'uppercase', pointerEvents: 'auto' }}>Item</span>
          {rawSel.isImg && <TbBtn title="Replace image" onClick={() => rawOp('img')}>🖼</TbBtn>}
          <TbBtn title="Move up" onClick={() => rawOp('up')}>↑</TbBtn>
          <TbBtn title="Move down" onClick={() => rawOp('down')}>↓</TbBtn>
          <TbBtn title="Add a piece after this" onClick={() => setRawAddOpen((o) => !o)}>＋</TbBtn>
          <TbBtn title="Hide / show" onClick={() => rawOp('hide')}>👁</TbBtn>
          <TbBtn title="Delete" onClick={() => rawOp('delete')} danger>🗑</TbBtn>
          {rawAddOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, boxShadow: '0 8px 24px -8px rgba(20,18,15,.35)', padding: 6, display: 'flex', flexDirection: 'column', minWidth: 130, zIndex: 32, pointerEvents: 'auto' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: FAINT, textTransform: 'uppercase', letterSpacing: '.06em', padding: '2px 8px 4px' }}>Add a piece</div>
              {RAW_INSERTS.map((it) => (
                <button key={it.id} onClick={() => { rawInsert(it.html); setRawAddOpen(false) }} style={{ textAlign: 'left', border: 0, background: 'transparent', color: INK, fontSize: 13, fontWeight: 600, padding: '7px 8px', borderRadius: 7, cursor: 'pointer' }}>{it.label}</button>
              ))}
              <button onClick={() => { setRawAddOpen(false); setRawLibOpen(true) }} style={{ textAlign: 'left', border: 0, borderTop: `1px solid ${LINE}`, marginTop: 4, paddingTop: 8, background: 'transparent', color: ORANGE, fontSize: 13, fontWeight: 700, padding: '8px', cursor: 'pointer' }}>Browse library →</button>
            </div>
          )}
        </div>
      )}

      {showProduct && <EditProductModal doc={doc} onChange={onProduct} onClose={() => setShowProduct(false)} />}
      {showMenu && <SettingsModal doc={doc} onChange={onSettings} onClose={() => setShowMenu(false)} />}
      {rawLibOpen && <RawLibraryModal onPick={(html) => { rawInsertAt(html); setRawLibOpen(false) }} onClose={() => { setRawLibOpen(false); setRawInsertTarget(null) }} />}
      {sectionLibOpen && <SectionLibraryModal onPick={(html, name) => { apply((d) => { const { doc: nd, newRef } = insertSection(d, newRawSection(html, name)); queueMicrotask(() => { setSel(newRef); setExpanded((x) => new Set(x).add(newRef.sectionId)) }); return nd }); setSectionLibOpen(false) }} onClose={() => setSectionLibOpen(false)} />}
    </div>
  )
}

/* ── Block library: a gallery of ready-made pieces (rendered previews) to drop into a template section. ── */
function RawLibraryModal({ onPick, onClose }: { onPick: (html: string) => void; onClose: () => void }) {
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
            <button key={it.id} onClick={() => onPick(it.html)} title={`Add ${it.label}`} style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'left' }}>
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

// PagePilot-style "Add Section" library — a gallery of ready-made sections with live previews. Picking one
// inserts it as a named, per-piece-editable raw section that keeps its design and publishes as native blocks.
function SectionLibraryModal({ onPick, onClose }: { onPick: (html: string, name: string) => void; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: 'min(980px,95vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px -20px rgba(20,18,15,.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: `1px solid ${LINE}`, position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <span style={{ fontFamily: SERIF, fontSize: 20 }}>Add a section</span>
          <span style={{ fontSize: 12.5, color: SUB }}>Click one to add it to your page — every piece stays editable</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...iconTopBtn, fontSize: 18 }}>✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 16, padding: 20 }}>
          {SECTION_LIBRARY.map((it) => (
            <button key={it.id} onClick={() => onPick(it.html, it.label)} title={`Add ${it.label}`} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'left' }}>
              <div style={{ height: 168, overflow: 'hidden', background: '#faf9f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 900, transform: 'scale(.42)', transformOrigin: 'center', pointerEvents: 'none', flex: 'none' }} dangerouslySetInnerHTML={{ __html: it.html }} />
              </div>
              <div style={{ padding: '11px 14px', fontSize: 13.5, fontWeight: 700, color: INK, borderTop: `1px solid ${LINE}` }}>{it.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Settings for a single piece clicked inside a template (raw) section. Edits inline CSS on that exact
 * node so the template design is preserved and every piece is individually styleable (PagePilot-style). ── */
function RawElementSettings({ name, text, onText, isImg, gallery, onGalleryAdd, onGalleryRemove, onGalleryReplace, onSetImg, uploadImage, isGallery, sticky, onSticky, onCreateAI, aiBusy, isPays, paysActive, onTogglePay, getVal, onStyle, onOp, onClear }: { name: string; text: string; onText: (t: string) => void; isImg: boolean; gallery: { src: string; path: number[] }[] | null; onGalleryAdd: (url: string) => void; onGalleryRemove: (path: number[]) => void; onGalleryReplace: (path: number[], url: string) => void; onSetImg: (url: string) => void; uploadImage: (f: File) => Promise<string | null>; isGallery: boolean; sticky: boolean; onSticky: (v: boolean) => void; onCreateAI: () => void; aiBusy: boolean; isPays: boolean; paysActive: string[]; onTogglePay: (id: string) => void; getVal: (p: string) => string; onStyle: (p: string, v: string) => void; onOp: (op: RawOp) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(text)   // content field — commit on blur (key remounts per piece)
  const [busy, setBusy] = useState(false)    // an image upload is in flight
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
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: ORANGE }}>Block</div>
        <div style={{ fontFamily: SERIF, fontSize: 20, lineHeight: 1.15 }}>{name || 'Edit this piece'}</div>
      </div>
      {gallery && (
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
          <button disabled={busy} onClick={() => pickFile((url) => onGalleryAdd(url))} style={{ width: '100%', border: `1px dashed ${LINE}`, background: INSET, color: INK, borderRadius: 12, padding: '18px 12px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1, textAlign: 'center' }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>🖼</div>
            {busy ? 'Uploading…' : 'Drag & Drop or click to select images'}
            <div style={{ fontSize: 11, color: FAINT, fontWeight: 500, marginTop: 2 }}>JPG, PNG, GIF, WEBP up to 120MB</div>
          </button>
          <button disabled={busy} onClick={() => pickFile((url) => onGalleryAdd(url))} style={{ width: '100%', marginTop: 8, border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>⬆ Select files</button>
          <button disabled={aiBusy} onClick={onCreateAI} style={{ width: '100%', marginTop: 8, border: 0, background: 'linear-gradient(90deg,#f5e9ff,#ffe9f0)', color: '#b23aa0', borderRadius: 10, padding: '11px 12px', fontSize: 13, fontWeight: 800, cursor: aiBusy ? 'default' : 'pointer', opacity: aiBusy ? 0.6 : 1 }}>{aiBusy ? 'Creating…' : '✨ Create with AI'}</button>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>Add images to the gallery. The first image will be used as the main image.</div>
        </div>
      )}
      {isGallery && (
        <div style={{ marginBottom: 14, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>General</div>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, fontWeight: 600, color: INK, cursor: 'pointer' }}>
            Sticky
            <input type="checkbox" checked={sticky} onChange={(e) => onSticky(e.target.checked)} style={{ accentColor: ORANGE, width: 34, height: 18 }} />
          </label>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>If enabled, the gallery stays fixed to the top of the screen as the customer scrolls.</div>
        </div>
      )}
      {isPays && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>Payment Providers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {PAY_PROVIDERS.map((p) => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '5px 2px', fontSize: 12.5, color: INK, cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}><span style={{ display: 'inline-flex', width: 38 }} dangerouslySetInnerHTML={{ __html: p.svg }} />{p.label}</span>
                <input type="checkbox" checked={paysActive.includes(p.id)} onChange={() => onTogglePay(p.id)} style={{ accentColor: ORANGE, width: 34, height: 18 }} />
              </label>
            ))}
          </div>
          <div style={{ fontSize: 11, color: FAINT, marginTop: 4 }}>Toggle which payment icons show in this row.</div>
        </div>
      )}
      {isImg && !gallery && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>Image</div>
          <button disabled={busy} onClick={() => pickFile((url) => onSetImg(url))} style={{ width: '100%', border: `1px dashed ${LINE}`, background: INSET, color: INK, borderRadius: 10, padding: '14px 12px', fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Uploading…' : '⬆ Upload image'}</button>
          <button onClick={() => onOp('img')} style={{ width: '100%', marginTop: 6, border: `1px solid ${LINE}`, background: '#fff', color: SUB, borderRadius: 10, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>🔗 Use image URL</button>
        </div>
      )}
      {text !== '' && (
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
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>Text</div>
        <ColorRow label="Text color" prop="color" getVal={getVal} onStyle={onStyle} />
        <NumRow label="Text size" prop="font-size" min={10} max={72} getVal={getVal} onStyle={onStyle} />
        <SegRow label="Alignment" prop="text-align" options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} getVal={getVal} onStyle={onStyle} />
        <SelRow label="Weight" prop="font-weight" options={[['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extrabold'], ['900', 'Black']]} getVal={getVal} onStyle={onStyle} />
        <SelRow label="Font" prop="font-family" options={[["Inter,system-ui,sans-serif", 'Sans (Inter)'], ["Georgia,'Times New Roman',serif", 'Serif'], ["'Courier New',monospace", 'Mono']]} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Line height" prop="line-height" min={12} max={64} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Letter spacing" prop="letter-spacing" min={-2} max={12} getVal={getVal} onStyle={onStyle} />
      </div>
      <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: 12, marginTop: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 10 }}>Box</div>
        <ColorRow label="Background" prop="background-color" getVal={getVal} onStyle={onStyle} />
        <NumRow label="Padding" prop="padding" max={80} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Margin top" prop="margin-top" max={80} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Margin bottom" prop="margin-bottom" max={80} getVal={getVal} onStyle={onStyle} />
        <NumRow label="Rounded corners" prop="border-radius" max={60} getVal={getVal} onStyle={onStyle} />
        <ColorRow label="Border color" prop="border-color" getVal={getVal} onStyle={onStyle} />
        <BorderWidthRow getVal={getVal} onStyle={onStyle} />
      </div>
      <button onClick={onClear} style={{ marginTop: 14, border: `1px solid ${LINE}`, background: '#fff', color: SUB, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Done</button>
    </div>
  )
}
const miniActionA: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '7px 12px', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }

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

function TbBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return <button title={title} onClick={onClick} style={{ border: 0, background: 'transparent', color: danger ? '#ff9b8a' : '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1, width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, pointerEvents: 'auto' }}>{children}</button>
}

/* ── small pieces ── */
const btn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const iconTopBtn: React.CSSProperties = { border: `1px solid ${LINE}`, background: '#fff', color: INK, borderRadius: 8, width: 30, height: 30, fontSize: 14, lineHeight: 1, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }

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
      style={{ position: 'relative', zIndex: menu ? 20 : undefined, display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 6, paddingLeft: 6 + depth * 14, paddingRight: 4, minHeight: 34, borderRadius: 8, background: selected ? WASH : hover ? INSET : 'transparent', cursor: 'pointer', opacity: props.dragging ? 0.4 : hidden ? 0.5 : 1, borderTop: props.dropHint ? `2px solid ${ORANGE}` : '2px solid transparent' }}>
      <span onClick={(e) => { e.stopPropagation(); (hasChildren ? onToggle : onSelect)?.() }} style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: hasChildren ? SUB : 'transparent', fontSize: 15, fontWeight: 700, cursor: hasChildren ? 'pointer' : 'default', flex: 'none', transition: 'transform .12s', transform: hasChildren && open ? 'rotate(90deg)' : 'none' }}>{hasChildren ? '›' : ''}</span>
      <span style={{ color: selected ? ORANGE : SUB, display: 'inline-flex', flex: 'none' }}>{treeIconFor(label, hasChildren)}</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: selected ? ORANGE : INK, fontWeight: selected ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}{count != null && count > 0 ? <span style={{ color: FAINT, fontWeight: 500 }}> · {count}</span> : null}
      </span>
      {(hover || menu) && (
        <span onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', paddingLeft: 12, background: `linear-gradient(90deg, transparent, ${selected ? WASH : INSET} 14px)`, borderRadius: 8 }}>
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
type RowBase = { label: string; prop: string; getVal: (p: string) => string; onStyle: (p: string, v: string) => void }
// Number + slider: edits locally while dragging/typing, commits to the canvas on release / blur (so a full
// re-render never interrupts the interaction — fixes "padding only works once / can't type").
function NumRow({ label, prop, min = 0, max = 120, getVal, onStyle }: RowBase & { min?: number; max?: number }) {
  const initial = () => { const n = parseFloat(getVal(prop)); return isFinite(n) ? String(n) : '' }
  const [val, setVal] = useState(initial)
  const commit = (v: string) => onStyle(prop, v !== '' ? `${v}px` : '')
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: SUB, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="range" min={min} max={max} value={val === '' ? min : val} onChange={(e) => setVal(e.target.value)} onMouseUp={() => commit(val)} onTouchEnd={() => commit(val)} style={{ flex: 1, accentColor: ORANGE }} />
        <input type="number" value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => commit(val)} onKeyDown={(e) => { if (e.key === 'Enter') commit(val) }} style={{ width: 56, border: `1px solid ${LINE}`, borderRadius: 8, padding: '6px 8px', fontSize: 12.5, boxSizing: 'border-box' }} />
      </div>
    </div>
  )
}
// Colour: live-previews locally while the native picker is open (onInput), commits on release (onChange) so
// the picker doesn't close mid-pick from a re-render.
function ColorRow({ label, prop, getVal, onStyle }: RowBase) {
  const [val, setVal] = useState(() => getVal(prop))
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val) ? val : '#000000'
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: SUB, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="color" value={hex} onInput={(e) => setVal((e.target as HTMLInputElement).value)} onChange={(e) => { setVal(e.target.value); onStyle(prop, e.target.value) }} style={{ width: 30, height: 30, border: `1px solid ${LINE}`, borderRadius: 8, background: 'none', cursor: 'pointer' }} />
        <span style={{ flex: 1, fontSize: 12.5, color: val ? INK : FAINT }}>{val || 'inherit'}</span>
        {val && <button onClick={() => { setVal(''); onStyle(prop, '') }} style={{ border: 0, background: 'transparent', color: ORANGE, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>clear</button>}
      </div>
    </div>
  )
}
function SegRow({ label, prop, options, getVal, onStyle }: RowBase & { options: [string, string][] }) {
  const cur = getVal(prop)
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: SUB, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden', width: '100%' }}>
        {options.map(([v, lbl]) => (
          <button key={v} onClick={() => onStyle(prop, cur === v ? '' : v)} style={{ flex: 1, border: 0, borderLeft: `1px solid ${LINE}`, background: cur === v ? INK : '#fff', color: cur === v ? '#fff' : SUB, padding: '7px 4px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{lbl}</button>
        ))}
      </div>
    </div>
  )
}
function SelRow({ label, prop, options, getVal, onStyle }: RowBase & { options: [string, string][] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: SUB, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <select value={getVal(prop)} onChange={(e) => onStyle(prop, e.target.value)} style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, cursor: 'pointer', background: '#fff', boxSizing: 'border-box' }}>
        <option value="">Default</option>
        {options.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}
      </select>
    </div>
  )
}
// A plain labeled <select> driven by value/onChange (for Gallery settings, unlike SelRow which uses CSS props).
function PlainSel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: SUB, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, cursor: 'pointer', background: '#fff', boxSizing: 'border-box' }}>
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
