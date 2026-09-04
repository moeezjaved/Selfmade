/**
 * Block Library — the curated, always-on-brand sections the "Add a section" agent (and the manual
 * picker) insert into a page. Each block is SELF-CONTAINED: it renders a full <section> with inline
 * styles that read the page's palette CSS variables (--accent/--ink/--line/--paper/--grad, with hex
 * fallbacks), so it looks native on ANY template and keeps working inside hand-edited HTML — it never
 * depends on a specific template's class names.
 *
 * The agent returns { type, content }; renderBlock(type, content) produces the HTML. A free-form
 * fallback block ('custom') carries sanitized HTML for anything the library can't express.
 */

export type BlockField = { key: string; type: 'text' | 'image' | 'list'; label: string; hint?: string; itemFields?: string[]; count?: number }
export interface BlockDef {
  type: string
  label: string
  /** shown to the agent so it can pick the right block for a request */
  description: string
  schema: BlockField[]
  render: (c: any, opts?: { productImage?: string | null }) => string
}

const esc = (s: any) => String(s ?? '').replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m] as string))
// accent a **word** → colored span (same convention as the templates)
const hl = (s: any) => esc(s).replace(/\*\*(.+?)\*\*/g, '<span style="color:var(--accent,#d6248f)">$1</span>')
const arr = (v: any): any[] => (Array.isArray(v) ? v : [])
const wrap = (inner: string, pad = '64px') =>
  `<section class="pgblk" style="padding:${pad} max(20px,calc((100% - 1160px)/2));background:var(--bg,#fff)"><div style="max-width:1160px;margin:0 auto">${inner}</div></section>`
const H = (s: string, sub?: string) =>
  `<div style="text-align:center;margin-bottom:36px"><h2 style="font-family:'Hanken Grotesk',sans-serif;font-size:clamp(26px,3.2vw,38px);font-weight:800;letter-spacing:-.02em;color:var(--ink,#181720);margin:0 0 10px">${hl(s)}</h2>${sub ? `<p style="font-size:16px;color:var(--muted,#6b6775);max-width:620px;margin:0 auto">${esc(sub)}</p>` : ''}</div>`
const card = 'background:var(--paper,#faf8fc);border:1px solid var(--line,#eee7f0);border-radius:16px'
// A visible, CLICKABLE placeholder for image slots the agent couldn't fill — so the section is never a
// blank/broken <img> (the user clicks it to upload/generate in the editor).
const IMG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='500'%3E%3Crect width='1200' height='500' fill='%23f0eaf7'/%3E%3Ctext x='600' y='258' font-family='sans-serif' font-size='30' fill='%23a99fc0' text-anchor='middle'%3E%F0%9F%96%BC Click to add an image%3C/text%3E%3C/svg%3E"

export const BLOCKS: BlockDef[] = [
  {
    type: 'rich_text',
    label: 'Text section',
    description: 'A simple prose section: an optional small eyebrow label, a heading, and a paragraph. Use for a brand story, an explainer, a mission statement, or any block of plain copy.',
    schema: [
      { key: 'eyebrow', type: 'text', label: 'Eyebrow' },
      { key: 'heading', type: 'text', label: 'Heading' },
      { key: 'body', type: 'text', label: 'Paragraph' },
    ],
    render: (c) => wrap(
      `<div style="max-width:760px;margin:0 auto;text-align:center">${c.eyebrow ? `<div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent,#d6248f);margin-bottom:12px">${esc(c.eyebrow)}</div>` : ''}<h2 style="font-family:'Hanken Grotesk',sans-serif;font-size:clamp(24px,3vw,34px);font-weight:800;color:var(--ink,#181720);letter-spacing:-.02em;margin:0 0 16px">${hl(c.heading)}</h2><p style="font-size:17px;line-height:1.7;color:var(--body,#4a4653);margin:0">${esc(c.body)}</p></div>`),
  },
  {
    type: 'feature_grid',
    label: 'Feature grid',
    description: 'A grid of 3-4 benefit cards, each with an emoji icon, a short title and a one-line description. Use to lay out product benefits or "why us" reasons.',
    schema: [
      { key: 'heading', type: 'text', label: 'Heading' },
      { key: 'items', type: 'list', label: 'Features', itemFields: ['icon', 'title', 'body'], count: 4 },
    ],
    render: (c) => wrap(
      `${c.heading ? H(c.heading) : ''}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">${arr(c.items).slice(0, 4).map((it) => `<div style="${card};padding:24px 20px;text-align:center"><div style="width:46px;height:46px;border-radius:12px;background:linear-gradient(100deg,#fbeaf5,#efe6ff);display:grid;place-items:center;margin:0 auto 14px;font-size:22px">${esc(it.icon || '✦')}</div><div style="font-weight:800;color:var(--ink,#181720);font-size:16px;margin-bottom:6px">${esc(it.title)}</div><div style="font-size:14px;color:var(--body,#4a4653);line-height:1.55">${esc(it.body)}</div></div>`).join('')}</div>`),
  },
  {
    type: 'comparison',
    label: 'Comparison table',
    description: 'A "us vs them" table: a list of rows where the brand gets a ✓ and the alternative gets a ✕. Use to contrast the product with competitors or the old way.',
    schema: [
      { key: 'heading', type: 'text', label: 'Heading' },
      { key: 'us', type: 'text', label: 'Our column label' },
      { key: 'them', type: 'text', label: 'Their column label' },
      { key: 'rows', type: 'list', label: 'Rows', itemFields: ['label'], count: 5 },
    ],
    render: (c) => wrap(
      `${c.heading ? H(c.heading) : ''}<div style="max-width:760px;margin:0 auto;${card};overflow:hidden"><div style="display:grid;grid-template-columns:1fr 120px 120px;background:var(--paper,#faf8fc);font-weight:800;color:var(--ink,#181720);font-size:14px"><div style="padding:14px 16px"></div><div style="padding:14px 16px;text-align:center;color:var(--accent,#d6248f)">${esc(c.us || 'Us')}</div><div style="padding:14px 16px;text-align:center">${esc(c.them || 'Them')}</div></div>${arr(c.rows).map((r) => `<div style="display:grid;grid-template-columns:1fr 120px 120px;border-top:1px solid var(--line,#eee7f0);align-items:center"><div style="padding:14px 16px;font-weight:600;color:var(--ink,#181720);font-size:14.5px">${esc(r.label)}</div><div style="padding:14px 16px;text-align:center;color:var(--good,#12b76a);font-weight:800">✓</div><div style="padding:14px 16px;text-align:center;color:#cfc9d6;font-weight:800">✕</div></div>`).join('')}</div>`),
  },
  {
    type: 'testimonial_wall',
    label: 'Reviews wall',
    description: 'A grid of 3-4 customer reviews, each a 5-star quote with a name. Use for social proof.',
    schema: [
      { key: 'heading', type: 'text', label: 'Heading' },
      { key: 'items', type: 'list', label: 'Reviews', itemFields: ['quote', 'name', 'city'], count: 3 },
    ],
    render: (c) => wrap(
      `${c.heading ? H(c.heading) : ''}<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">${arr(c.items).slice(0, 4).map((t) => `<div style="${card};padding:22px"><div style="color:#f4b400;font-size:14px;margin-bottom:10px">★★★★★</div><p style="margin:0 0 12px;font-size:14.5px;line-height:1.6;color:var(--body,#4a4653)">"${esc(t.quote)}"</p><div style="font-size:13px;font-weight:700;color:var(--muted,#6b6775)">${esc(t.name)}${t.city ? ' · ' + esc(t.city) : ''}</div></div>`).join('')}</div>`),
  },
  {
    type: 'stats',
    label: 'Stat band',
    description: 'A row of 3-4 big numbers with labels (e.g. "10,000+ customers", "98% would recommend"). Use to show scale or results at a glance.',
    schema: [
      { key: 'items', type: 'list', label: 'Stats', itemFields: ['n', 'label'], count: 3 },
    ],
    render: (c) => wrap(
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:24px;text-align:center">${arr(c.items).slice(0, 4).map((s) => `<div><div style="font-family:'Hanken Grotesk',sans-serif;font-size:clamp(32px,5vw,48px);font-weight:800;color:var(--accent,#d6248f);letter-spacing:-.02em">${esc(s.n)}</div><div style="font-size:14px;color:var(--muted,#6b6775);font-weight:600;margin-top:4px">${esc(s.label)}</div></div>`).join('')}</div>`, '48px'),
  },
  {
    type: 'faq',
    label: 'FAQ',
    description: 'An accordion of question/answer pairs. Use to handle objections and common questions.',
    schema: [
      { key: 'heading', type: 'text', label: 'Heading' },
      { key: 'items', type: 'list', label: 'Q&A', itemFields: ['q', 'a'], count: 5 },
    ],
    render: (c) => wrap(
      `${H(c.heading || 'Frequently asked questions')}<div style="max-width:820px;margin:0 auto;display:flex;flex-direction:column;gap:12px">${arr(c.items).map((f) => `<details style="${card};overflow:hidden"><summary style="list-style:none;cursor:pointer;padding:18px 20px;font-weight:700;color:var(--ink,#181720);font-size:16px">${esc(f.q)}</summary><div style="padding:0 20px 18px;color:var(--body,#4a4653);font-size:14.5px;line-height:1.6">${esc(f.a)}</div></details>`).join('')}</div>`),
  },
  {
    type: 'big_image',
    label: 'Big image',
    description: 'A single full-width image with an optional caption. Use for a hero lifestyle shot, a banner, or a screenshot the user wants to feature.',
    schema: [
      { key: 'image', type: 'image', label: 'Image' },
      { key: 'caption', type: 'text', label: 'Caption' },
    ],
    render: (c, o) => wrap(
      `<img src="${esc(c.image || o?.productImage || '') || IMG_PLACEHOLDER}" alt="${esc(c.caption || 'Add an image')}" style="width:100%;min-height:220px;border-radius:20px;display:block;object-fit:cover;background:linear-gradient(135deg,#f3eef8,#efe6ff)">${c.caption ? `<p style="text-align:center;font-size:14px;color:var(--muted,#6b6775);margin:14px 0 0">${esc(c.caption)}</p>` : ''}`, '40px'),
  },
  {
    type: 'guarantee',
    label: 'Guarantee band',
    description: 'A reassurance band with a badge, a bold heading and a line of copy (e.g. money-back guarantee, free shipping, warranty). Use to reduce purchase risk.',
    schema: [
      { key: 'badge', type: 'text', label: 'Badge' },
      { key: 'heading', type: 'text', label: 'Heading' },
      { key: 'body', type: 'text', label: 'Body' },
    ],
    render: (c) => `<section class="pgblk" style="padding:52px max(20px,calc((100% - 1160px)/2));background:var(--grad,linear-gradient(100deg,#d6248f,#7b2ff7));color:#fff;margin:0"><div style="max-width:760px;margin:0 auto;text-align:center"><div style="font-size:34px;margin-bottom:12px">${esc(c.badge || '🛡️')}</div><h2 style="font-family:'Hanken Grotesk',sans-serif;font-size:clamp(24px,3vw,34px);font-weight:800;color:#fff;margin:0 0 12px;letter-spacing:-.02em">${esc(c.heading)}</h2><p style="font-size:16px;line-height:1.6;color:rgba(255,255,255,.92);margin:0">${esc(c.body)}</p></div></section>`,
  },
  {
    type: 'cta_band',
    label: 'Call-to-action band',
    description: 'A closing banner with a headline, an optional subline, and a button. Use to drive the final conversion.',
    schema: [
      { key: 'heading', type: 'text', label: 'Heading' },
      { key: 'sub', type: 'text', label: 'Subline' },
      { key: 'button', type: 'text', label: 'Button label' },
    ],
    render: (c) => wrap(
      `<div style="text-align:center;${card};padding:48px 24px"><h2 style="font-family:'Hanken Grotesk',sans-serif;font-size:clamp(26px,3.4vw,40px);font-weight:800;color:var(--ink,#181720);letter-spacing:-.02em;margin:0 0 12px">${hl(c.heading)}</h2>${c.sub ? `<p style="font-size:16px;color:var(--muted,#6b6775);margin:0 0 24px">${esc(c.sub)}</p>` : ''}<a href="#" style="display:inline-block;background:var(--grad,linear-gradient(100deg,#d6248f,#7b2ff7));color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:15px 36px;border-radius:12px">${esc(c.button || 'Shop now')}</a></div>`),
  },
  {
    // Free-form fallback — the agent emits sanitized HTML for anything the curated blocks can't express.
    type: 'custom',
    label: 'Custom section',
    description: 'A free-form section for a layout none of the other blocks covers. The agent supplies the inner HTML (headings, paragraphs, images, simple grids) styled with the palette variables.',
    schema: [{ key: 'html', type: 'text', label: 'HTML' }],
    render: (c) => `<section class="pgblk" style="padding:56px max(20px,calc((100% - 1160px)/2));background:var(--bg,#fff)"><div style="max-width:1160px;margin:0 auto">${c.html || ''}</div></section>`,
  },
]

export function getBlock(type: string): BlockDef | undefined {
  return BLOCKS.find((b) => b.type === type)
}

/** Render one block to a section HTML string (wrapped so the editor treats it as a section). */
export function renderBlock(type: string, content: any, opts?: { productImage?: string | null }): string | null {
  const b = getBlock(type)
  if (!b) return null
  try { return b.render(content || {}, opts) } catch { return null }
}

/** Compact catalog handed to the agent so it can choose the right block for a request. */
export function blockCatalog(): { type: string; label: string; description: string; fields: string[] }[] {
  return BLOCKS.map((b) => ({
    type: b.type,
    label: b.label,
    description: b.description,
    fields: b.schema.map((s) => (s.itemFields ? `${s.key}[]:{${s.itemFields.join(',')}}` : `${s.key}:${s.type}`)),
  }))
}
