/**
 * product_v1 — a modern, high-converting PRODUCT page (PDP-style), Atlas-style. Big gallery + buy-box
 * hero, value columns, alternating feature sections, social proof, comparison, FAQ, guarantee and a
 * floating buy bar. Layout is FIXED here; the AI only fills `schema` slots. All CSS is scoped under
 * `.pgbld` so it never touches the merchant's theme header/footer.
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
.pgbld{--ink:#161511;--body:#3a382f;--muted:#7a7668;--line:#e9e6dd;--paper:#faf8f3;--accent:#e0402a;--dark:#181712;--good:#2e7d46;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--serif:'Hedvig Letters Serif',Georgia,serif;width:100%;color:var(--body);font-family:var(--sans);font-size:16.5px;line-height:1.6;-webkit-font-smoothing:antialiased;padding-bottom:78px}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld b,.pgbld strong{color:var(--ink);font-weight:700}
.pgbld .wrap{max-width:1120px;margin:0 auto;padding:0 22px}
/* Hide the theme's auto page-title so it doesn't duplicate our headline. */
.main-page-title,.shopify-page-title,.template-page .page-title{display:none!important}
.pgbld .pbar{background:var(--dark);color:#fff;text-align:center;font-size:13.5px;font-weight:600;letter-spacing:.02em;padding:11px 14px}
.pgbld .hero{display:grid;grid-template-columns:1fr 1fr;gap:44px;padding:42px 0 48px;align-items:start}
.pgbld .gallery{display:flex;flex-direction:column;gap:12px;position:sticky;top:18px}
.pgbld .gmain,.pgbld .gmain.ph{border-radius:18px;aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fdf3d4,#f0d281);display:grid;place-items:center;color:#a2823a;font-weight:700}
.pgbld .thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.pgbld .thumbs img,.pgbld .thumbs .ph{border-radius:12px;aspect-ratio:1/1;object-fit:cover;width:100%}
.pgbld .rating{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--muted);font-weight:600}
.pgbld .rating .st{color:#f4b400;letter-spacing:2px;font-size:16px}
.pgbld h1.ptitle{font-family:var(--serif);font-weight:400;font-size:clamp(30px,4vw,44px);line-height:1.08;letter-spacing:-.02em;color:var(--ink);margin:12px 0 10px}
.pgbld .psub{font-size:18px;color:var(--body);margin:0 0 18px}
.pgbld .price{font-size:26px;font-weight:800;color:var(--ink);margin:0 0 18px;display:flex;align-items:baseline;gap:10px}
.pgbld .benefits{list-style:none;padding:0;margin:0 0 22px;display:flex;flex-direction:column;gap:10px}
.pgbld .benefits li{position:relative;padding-left:30px;font-size:15.5px;line-height:1.5}
.pgbld .benefits li::before{content:"\\2713";position:absolute;left:0;top:1px;width:20px;height:20px;border-radius:50%;background:#e9f7ee;color:var(--good);font-size:12px;font-weight:800;display:grid;place-items:center}
.pgbld a.buy{display:block;background:var(--accent);color:#fff;text-decoration:none;text-align:center;border-radius:12px;padding:18px;font-weight:800;font-size:19px;box-shadow:0 12px 30px -14px rgba(224,64,42,.6)}
.pgbld a.buy.big{max-width:520px;margin:8px auto 0}
.pgbld .trust{text-align:center;font-size:13px;color:var(--muted);margin-top:12px;line-height:1.9}
.pgbld h2.sec{font-family:var(--serif);font-weight:400;font-size:clamp(24px,3vw,34px);letter-spacing:-.02em;color:var(--ink);text-align:center;margin:0 0 8px}
.pgbld .seclead{text-align:center;color:var(--muted);font-size:16px;max-width:620px;margin:0 auto 26px}
.pgbld .valuecols{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:20px 0 12px}
.pgbld .vcard{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:22px}
.pgbld .vcard .vlab{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--accent)}
.pgbld .vcard h3{font-size:17px;font-weight:800;color:var(--ink);margin:8px 0 6px}
.pgbld .vcard p{margin:0;font-size:14.5px}
.pgbld .feat{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;padding:44px 0}
.pgbld .feat:nth-child(even) .fimg{order:2}
.pgbld .fimg,.pgbld .fimg.ph{border-radius:18px;aspect-ratio:4/3;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fdf3d4,#eaca6a)}
.pgbld .feat h2{font-family:var(--serif);font-weight:400;font-size:clamp(22px,2.6vw,30px);letter-spacing:-.02em;color:var(--ink);margin:0 0 10px}
.pgbld .band{background:var(--paper);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-top:20px}
.pgbld .testis{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:34px 0}
.pgbld .tcard{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px}
.pgbld .tcard .st{color:#f4b400;font-size:14px;margin-bottom:8px}
.pgbld .tcard p{margin:0 0 10px;font-size:14.5px}
.pgbld .tcard .who{font-weight:800;color:var(--ink);font-size:14px}
.pgbld .tcard .city{color:var(--muted);font-size:12.5px}
.pgbld .compare{max-width:720px;margin:0 auto;padding:8px 0 6px}
.pgbld .compare ul{list-style:none;padding:0;margin:0;background:#fff;border:1px solid var(--line);border-radius:16px;overflow:hidden}
.pgbld .compare li{display:flex;gap:12px;align-items:flex-start;padding:14px 18px;border-bottom:1px solid var(--line);font-size:15px}
.pgbld .compare li:last-child{border-bottom:0}
.pgbld .compare li::before{content:"\\2713";color:var(--good);font-weight:800;flex:none}
.pgbld .faq{max-width:720px;margin:0 auto;padding:8px 0}
.pgbld .faq .q{font-weight:800;color:var(--ink);font-size:16.5px;margin:18px 0 4px}
.pgbld .faq .a{margin:0;color:var(--body)}
.pgbld .guarantee{max-width:720px;margin:26px auto;background:var(--paper);border:1px solid var(--line);border-radius:18px;padding:30px 26px;text-align:center}
.pgbld .guarantee h2{margin:0 0 8px}
.pgbld .floatcta{position:fixed;left:0;right:0;bottom:0;z-index:60;background:#fff;border-top:1px solid var(--line);box-shadow:0 -8px 24px -10px rgba(0,0,0,.24);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px max(18px,calc((100% - 1120px)/2 + 22px));transition:transform .28s ease}
.pgbld .floatcta.hide{transform:translateY(115%)}
.pgbld .fc-info{display:flex;align-items:center;gap:12px;min-width:0}
.pgbld .fc-thumb{width:44px;height:44px;border-radius:9px;flex:none;object-fit:cover}
.pgbld .fc-name{font-weight:700;color:var(--ink);font-size:15px;min-width:0;line-height:1.25}
.pgbld .fc-btn{background:var(--accent);color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:13px 26px;border-radius:10px;white-space:nowrap;flex:none}
@media(max-width:860px){.pgbld .hero{grid-template-columns:1fr;gap:26px}.pgbld .gallery{position:static}.pgbld .valuecols{grid-template-columns:1fr}.pgbld .feat{grid-template-columns:1fr;gap:20px;padding:30px 0}.pgbld .feat:nth-child(even) .fimg{order:0}.pgbld .testis{grid-template-columns:1fr}}
@media(max-width:600px){.pgbld .fc-name{font-size:13.5px}.pgbld .fc-btn{padding:12px 18px;font-size:15px}}
`

function render(c: FilledContent, o: RenderOpts): string {
  const stars = '★★★★★'
  const bullets = arr(c.benefit_bullets).map((b) => `<li><strong>${esc(b.label)}</strong>${b.body ? ' — ' + esc(b.body) : ''}</li>`).join('')
  const vcols = arr(c.value_cols).map((v) => `<div class="vcard"><div class="vlab">${esc(v.label)}</div><h3>${esc(v.title)}</h3><p>${esc(v.body)}</p></div>`).join('')
  const testis = arr(c.testimonials).map((t) => `<div class="tcard"><div class="st">${stars}</div><p>${esc(t.quote)}</p><div class="who">${esc(t.name)}</div><div class="city">${esc(t.city)}</div></div>`).join('')
  const compare = arr(c.compare_items).map((i) => `<li><span><strong>${esc(i.label)}</strong>${i.body ? ' — ' + esc(i.body) : ''}</span></li>`).join('')
  const faqs = arr(c.faqs).map((f) => `<div><div class="q">${esc(f.q)}</div><p class="a">${esc(f.a)}</p></div>`).join('')

  return `
  <div class="pgbld">
  ${c.announce ? `<div class="pbar">${esc(c.announce)}</div>` : ''}
  <div class="wrap">
    <div class="hero">
      <div class="gallery">
        ${img(c.image_main || o.productImage, o.productName, 'gmain', 'Product')}
        <div class="thumbs">${img(c.image_g2 || o.productImage, o.productName, '')}${img(c.image_g3 || o.productImage, o.productName, '')}${img(c.image_g4 || o.productImage, o.productName, '')}</div>
      </div>
      <div class="buybox">
        <div class="rating"><span class="st">${stars}</span> <span>${esc(o.rating?.countLabel || 'Loved by thousands')}</span></div>
        <h1 class="ptitle">${esc(c.headline || o.productName)}</h1>
        <p class="psub">${esc(c.subhead)}</p>
        <div class="price">${esc(o.priceLabel || '')}</div>
        <ul class="benefits">${bullets}</ul>
        <a class="buy" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Add to cart')}</a>
        <div class="trust">🔒 Secure checkout · 💳 Easy returns<br>💰 ${esc(c.guarantee_head || '30-day money-back guarantee')}</div>
      </div>
    </div>

    <h2 class="sec">${esc(c.value_head || 'Why you\'ll love it')}</h2>
    <div class="valuecols">${vcols}</div>

    <section class="feat">
      ${img(c.image_feature_1, o.productName, 'fimg', 'Lifestyle')}
      <div><h2>${esc(c.feature_1_head)}</h2>${rt(c.feature_1_body)}</div>
    </section>
    <section class="feat">
      ${img(c.image_feature_2, o.productName, 'fimg', 'In use')}
      <div><h2>${esc(c.feature_2_head)}</h2>${rt(c.feature_2_body)}</div>
    </section>
  </div>

  <div class="band"><div class="wrap">
    <div class="testis">${testis}</div>
  </div></div>

  <div class="wrap">
    <h2 class="sec" style="margin-top:44px">${esc(c.compare_head || 'What makes it different')}</h2>
    <div class="compare"><ul>${compare}</ul></div>

    <h2 class="sec" style="margin-top:44px">Questions, answered</h2>
    <div class="faq">${faqs}</div>

    <div class="guarantee">
      <h2 class="sec">${esc(c.guarantee_head || 'Try it risk-free')}</h2>
      <p style="margin:0 0 16px">${esc(c.guarantee_body)}</p>
      <a class="buy big" href="${esc(o.ctaHref)}">${esc(c.final_cta || `Get ${o.productName}`)}</a>
    </div>
  </div>

  <div class="floatcta" id="floatcta">
    <div class="fc-info">${img(o.productImage, o.productName, 'fc-thumb')}<span class="fc-name">${esc(o.productName)}${o.priceLabel ? ' · <b>' + esc(o.priceLabel) + '</b>' : ''}</span></div>
    <a class="fc-btn" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Add to cart')}</a>
  </div>
  </div>
  <script>(function(){var fc=document.getElementById('floatcta');function t(){if(fc)fc.classList.toggle('hide',window.scrollY<520)}window.addEventListener('scroll',t,{passive:true});t();})();</script>`
}

export const productV1: PageTemplate = {
  id: 'product_v1',
  type: 'product',
  name: 'Product page',
  description: 'A modern PDP: gallery + buy-box hero, value columns, feature sections, reviews, comparison, FAQ and a floating buy bar.',
  thumbnail: '/builder/thumb-product.png',
  css: CSS,
  render,
  schema: [
    { key: 'announce', type: 'text', label: 'Announcement bar', hint: 'A short promo line, e.g. "Free shipping over $50 · 30-day returns". Optional.' },
    { key: 'headline', type: 'text', role: 'headline', label: 'Product headline', hint: 'A benefit-led product title, ~4-8 words (not just the SKU name).' },
    { key: 'subhead', type: 'text', role: 'body', label: 'Subhead', hint: 'One sentence on the core promise/outcome.' },
    { key: 'benefit_bullets', type: 'list', label: 'Buy-box bullets', count: 4, hint: 'Each: bold benefit + a few words. Scannable.' },
    { key: 'cta_label', type: 'text', label: 'Button label', hint: 'e.g. "Add to cart" / "Shop now".' },
    { key: 'image_main', type: 'image', role: 'product', label: 'Main product image' },
    { key: 'image_g2', type: 'image', role: 'product', label: 'Gallery image 2' },
    { key: 'image_g3', type: 'image', role: 'product', label: 'Gallery image 3' },
    { key: 'image_g4', type: 'image', role: 'product', label: 'Gallery image 4' },
    { key: 'value_head', type: 'text', label: 'Value section heading', hint: 'e.g. "Why you\'ll love it".' },
    { key: 'value_cols', type: 'reasons', label: 'Value columns', count: 3, hint: 'label = 1-2 word category; title = short benefit; body = 1-2 sentences.' },
    { key: 'feature_1_head', type: 'text', label: 'Feature 1 heading' },
    { key: 'feature_1_body', type: 'richtext', role: 'body', label: 'Feature 1 body', hint: '2-3 sentences; bold one phrase.' },
    { key: 'image_feature_1', type: 'image', role: 'editorial', label: 'Feature 1 image' },
    { key: 'feature_2_head', type: 'text', label: 'Feature 2 heading' },
    { key: 'feature_2_body', type: 'richtext', role: 'body', label: 'Feature 2 body' },
    { key: 'image_feature_2', type: 'image', role: 'lifestyle', label: 'Feature 2 image' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews', count: 3, hint: 'name, city, short quote about THIS product.' },
    { key: 'compare_head', type: 'text', label: 'Comparison heading', hint: 'e.g. "What makes it different".' },
    { key: 'compare_items', type: 'list', label: 'Differentiators', count: 4, hint: 'Each: bold point + short reason.' },
    { key: 'faqs', type: 'faq', label: 'FAQ', count: 5, hint: 'Cover sizing/usage, materials, shipping, returns, care.' },
    { key: 'guarantee_head', type: 'text', label: 'Guarantee heading', hint: 'e.g. "Try it risk-free for 30 days".' },
    { key: 'guarantee_body', type: 'text', label: 'Guarantee note' },
    { key: 'final_cta', type: 'text', label: 'Final button label' },
  ],
}
