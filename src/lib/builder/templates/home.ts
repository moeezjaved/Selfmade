/**
 * home_v1 — a store HOME page (Atlas-style): big brand hero, trust bar, a featured-product spotlight,
 * benefit columns, a brand-story section, a product gallery, social proof and a closing CTA band.
 * Product-scoped (built around the chosen hero product + brand voice). Layout is FIXED; the AI only fills
 * `schema` slots. All CSS scoped under `.pgbld` so it never touches the merchant's theme header/footer.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
function rt(s: any): string {
  const safe = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return safe.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}
const arr = (v: SlotValue | undefined) => (Array.isArray(v) ? v : [])
function img(url: any, alt: string, cls: string, label?: string): string {
  if (url && typeof url === 'string') return `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}">`
  return `<div class="${cls} ph">${esc(label || 'Image')}</div>`
}

const CSS = `
/* Every rule scoped under .pgbld so nothing leaks into the merchant's theme (header/footer). */
.pgbld{--ink:#161511;--body:#3a382f;--muted:#7a7668;--line:#e9e6dd;--paper:#faf8f3;--accent:#e0402a;--dark:#181712;--good:#2e7d46;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--serif:'Hedvig Letters Serif',Georgia,serif;width:100%;color:var(--body);font-family:var(--sans);font-size:16.5px;line-height:1.6;-webkit-font-smoothing:antialiased}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld b,.pgbld strong{color:var(--ink);font-weight:700}
.pgbld .wrap{max-width:1120px;margin:0 auto;padding:0 22px}
/* Hide the theme's auto page-title so it doesn't duplicate our headline. */
.main-page-title,.shopify-page-title,.template-page .page-title{display:none!important}
.pgbld .pbar{background:var(--dark);color:#fff;text-align:center;font-size:13.5px;font-weight:600;letter-spacing:.02em;padding:11px 14px}
.pgbld .hhero{max-width:1120px;margin:0 auto;padding:52px 22px 40px;display:grid;grid-template-columns:1.05fr 1fr;gap:44px;align-items:center}
.pgbld .eyebrow{font-size:12.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
.pgbld .hhero h1{font-family:var(--serif);font-weight:400;font-size:clamp(34px,5.2vw,58px);line-height:1.04;letter-spacing:-.025em;color:var(--ink);margin:12px 0 14px}
.pgbld .hhero .lead{font-size:19px;color:var(--body);margin:0 0 24px;max-width:520px}
.pgbld a.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;border-radius:100px;padding:15px 32px;font-weight:800;font-size:16.5px;box-shadow:0 14px 32px -16px rgba(224,64,42,.7)}
.pgbld .himg,.pgbld .himg.ph{border-radius:22px;aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fdf3d4,#eaca6a)}
.pgbld .trustbar{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--paper)}
.pgbld .trustbar .row{max-width:1120px;margin:0 auto;padding:16px 22px;display:flex;flex-wrap:wrap;justify-content:center;gap:14px 40px}
.pgbld .trustbar .ti{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:600;color:var(--ink)}
.pgbld .trustbar .ti b{color:var(--accent)}
.pgbld h2.sec{font-family:var(--serif);font-weight:400;font-size:clamp(26px,3.4vw,38px);letter-spacing:-.02em;color:var(--ink);text-align:center;margin:0 0 8px}
.pgbld .seclead{text-align:center;color:var(--muted);font-size:16px;max-width:620px;margin:0 auto 26px}
.pgbld .spotlight{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;background:var(--paper);border:1px solid var(--line);border-radius:22px;padding:30px;margin:14px 0 10px}
.pgbld .simg,.pgbld .simg.ph{border-radius:16px;aspect-ratio:1/1;object-fit:cover;width:100%}
.pgbld .spotlight h3{font-family:var(--serif);font-weight:400;font-size:28px;color:var(--ink);margin:0 0 8px;letter-spacing:-.01em}
.pgbld .sbul{list-style:none;padding:0;margin:14px 0 20px;display:flex;flex-direction:column;gap:9px}
.pgbld .sbul li{position:relative;padding-left:28px;font-size:15px}
.pgbld .sbul li::before{content:"\\2713";position:absolute;left:0;top:0;color:var(--good);font-weight:800}
.pgbld .bcols{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:14px 0 6px}
.pgbld .bcard{text-align:center;padding:22px 18px}
.pgbld .bcard .blab{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--accent)}
.pgbld .bcard h3{font-size:18px;font-weight:800;color:var(--ink);margin:8px 0 6px}
.pgbld .bcard p{margin:0;font-size:14.5px}
.pgbld .story{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;padding:46px 0}
.pgbld .story .stimg,.pgbld .story .stimg.ph{border-radius:20px;aspect-ratio:4/3;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fdf3d4,#eaca6a)}
.pgbld .story h2{font-family:var(--serif);font-weight:400;font-size:clamp(24px,3vw,32px);letter-spacing:-.02em;color:var(--ink);margin:0 0 10px}
.pgbld .ggrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:8px 0 10px}
.pgbld .ggrid img,.pgbld .ggrid .ph{border-radius:14px;aspect-ratio:1/1;object-fit:cover;width:100%}
.pgbld .testis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:30px 0}
.pgbld .tcard{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px}
.pgbld .tcard .st{color:#f4b400;font-size:14px;margin-bottom:8px}
.pgbld .tcard p{margin:0 0 10px;font-size:14.5px}
.pgbld .tcard .who{font-weight:800;color:var(--ink);font-size:14px}
.pgbld .tcard .city{color:var(--muted);font-size:12.5px}
.pgbld .ctaband{background:var(--dark);color:#fff;text-align:center;padding:56px 22px;margin-top:14px}
.pgbld .ctaband h2{font-family:var(--serif);font-weight:400;font-size:clamp(26px,3.4vw,38px);color:#fff;margin:0 0 10px;letter-spacing:-.02em}
.pgbld .ctaband p{color:#c9c5b8;font-size:16px;max-width:540px;margin:0 auto 22px}
@media(max-width:860px){.pgbld .hhero{grid-template-columns:1fr;gap:24px;padding:36px 22px 28px}.pgbld .spotlight{grid-template-columns:1fr;gap:22px;padding:22px}.pgbld .bcols{grid-template-columns:1fr}.pgbld .story{grid-template-columns:1fr;gap:20px;padding:32px 0}.pgbld .ggrid{grid-template-columns:repeat(2,1fr)}.pgbld .testis{grid-template-columns:1fr}}
`

function render(c: FilledContent, o: RenderOpts): string {
  const stars = '★★★★★'
  const trust = arr(c.trust_items).map((t) => `<div class="ti">✓ <span><b>${esc(t.label)}</b>${t.body ? ' ' + esc(t.body) : ''}</span></div>`).join('')
  const sbul = arr(c.spotlight_bullets).map((b) => `<li>${esc(b.label)}${b.body ? ' — ' + esc(b.body) : ''}</li>`).join('')
  const bcols = arr(c.benefit_cols).map((v) => `<div class="bcard"><div class="blab">${esc(v.label)}</div><h3>${esc(v.title)}</h3><p>${esc(v.body)}</p></div>`).join('')
  const testis = arr(c.testimonials).map((t) => `<div class="tcard"><div class="st">${stars}</div><p>${esc(t.quote)}</p><div class="who">${esc(t.name)}</div><div class="city">${esc(t.city)}</div></div>`).join('')
  const gallery = [c.image_g1, c.image_g2, c.image_g3, c.image_g4].map((u) => img(u || o.productImage, o.productName, '')).join('')

  return `
  <div class="pgbld">
  ${c.announce ? `<div class="pbar">${esc(c.announce)}</div>` : ''}
  <section class="hhero">
    <div class="hhero-txt">
      <div class="eyebrow">${esc(c.eyebrow || o.productName)}</div>
      <h1>${esc(c.headline)}</h1>
      <p class="lead">${esc(c.subhead)}</p>
      <a class="cta" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Shop now')}</a>
    </div>
    ${img(c.image_hero || o.productImage, o.productName, 'himg', 'Hero')}
  </section>

  <div class="trustbar"><div class="row">${trust}</div></div>

  <div class="wrap">
    <h2 class="sec" style="margin-top:44px">${esc(c.featured_head || 'The one everyone\'s talking about')}</h2>
    <div class="spotlight">
      ${img(c.image_spotlight || o.productImage, o.productName, 'simg', 'Product')}
      <div>
        <h3>${esc(o.productName)}</h3>
        ${rt(c.spotlight_pitch)}
        <ul class="sbul">${sbul}</ul>
        <a class="cta" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Shop now')}</a>
      </div>
    </div>

    <h2 class="sec" style="margin-top:48px">${esc(c.benefits_head || 'Why shop with us')}</h2>
    <div class="bcols">${bcols}</div>

    <section class="story">
      ${img(c.image_story, o.productName, 'stimg', 'Our story')}
      <div><h2>${esc(c.story_head || 'Our story')}</h2>${rt(c.story_body)}</div>
    </section>

    <h2 class="sec">${esc(c.gallery_head || 'From the collection')}</h2>
    <div class="ggrid">${gallery}</div>

    <div class="testis">${testis}</div>
  </div>

  <div class="ctaband">
    <h2>${esc(c.cta_head || 'Ready when you are')}</h2>
    <p>${esc(c.cta_sub)}</p>
    <a class="cta" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Shop now')}</a>
  </div>
  </div>`
}

export const homeV1: PageTemplate = {
  id: 'home_v1',
  type: 'home',
  name: 'Home page',
  description: 'A store homepage: brand hero, trust bar, featured-product spotlight, benefit columns, brand story, a gallery, reviews and a closing CTA.',
  thumbnail: '/builder/thumb-home.png',
  css: CSS,
  render,
  schema: [
    { key: 'announce', type: 'text', label: 'Announcement bar', hint: 'Short promo, e.g. "Free shipping over $50". Optional.' },
    { key: 'eyebrow', type: 'text', label: 'Hero eyebrow', hint: 'The brand/category in 1-3 words.' },
    { key: 'headline', type: 'text', role: 'headline', label: 'Hero headline', hint: 'The big brand promise, ~5-9 words.' },
    { key: 'subhead', type: 'text', role: 'body', label: 'Hero subhead', hint: 'One sentence on what the store offers + who it\'s for.' },
    { key: 'cta_label', type: 'text', label: 'Button label', hint: 'e.g. "Shop now" / "Shop the collection".' },
    { key: 'image_hero', type: 'image', role: 'hero', label: 'Hero image' },
    { key: 'trust_items', type: 'list', label: 'Trust bar', count: 3, hint: 'Each: bold short benefit (e.g. "Free shipping", "30-day returns", "10k+ happy customers").' },
    { key: 'featured_head', type: 'text', label: 'Featured heading' },
    { key: 'image_spotlight', type: 'image', role: 'product', label: 'Featured product image' },
    { key: 'spotlight_pitch', type: 'richtext', role: 'body', label: 'Featured pitch', hint: '2-3 sentences on the hero product.' },
    { key: 'spotlight_bullets', type: 'list', label: 'Featured bullets', count: 3, hint: 'Each: a short benefit.' },
    { key: 'benefits_head', type: 'text', label: 'Benefits heading', hint: 'e.g. "Why shop with us".' },
    { key: 'benefit_cols', type: 'reasons', label: 'Benefit columns', count: 3, hint: 'label = 1-2 word category; title = short benefit; body = 1-2 sentences.' },
    { key: 'story_head', type: 'text', label: 'Brand story heading' },
    { key: 'story_body', type: 'richtext', role: 'body', label: 'Brand story', hint: '3-4 sentences on why the brand exists; bold one line.' },
    { key: 'image_story', type: 'image', role: 'editorial', label: 'Brand story image' },
    { key: 'gallery_head', type: 'text', label: 'Gallery heading', hint: 'e.g. "From the collection".' },
    { key: 'image_g1', type: 'image', role: 'product', label: 'Gallery image 1' },
    { key: 'image_g2', type: 'image', role: 'product', label: 'Gallery image 2' },
    { key: 'image_g3', type: 'image', role: 'lifestyle', label: 'Gallery image 3' },
    { key: 'image_g4', type: 'image', role: 'lifestyle', label: 'Gallery image 4' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews', count: 3, hint: 'name, city, short quote.' },
    { key: 'cta_head', type: 'text', label: 'Closing CTA heading' },
    { key: 'cta_sub', type: 'text', label: 'Closing CTA subtext' },
  ],
}
