/**
 * listicle_v1 — the Top-N ranked advertorial variant ("Why More People Are Switching To X").
 * Same DNA as advertorial_v1: dark countdown bar, byline, sticky offer card, floating CTA — but the
 * body is a numbered ranked list where EVERY item ends in its own mini-CTA. Layout is FIXED here; the
 * AI only fills `schema` slots. Shares the advertorial design tokens so the two feel like one family.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

// ── tiny render helpers (self-contained; no deps; copied from advertorial.ts) ──
const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
/** rich text: escape, turn **bold** into <strong>, blank lines into paragraphs. */
function rt(s: any): string {
  const safe = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return safe.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}
const arr = (v: SlotValue | undefined) => (Array.isArray(v) ? v : [])
/** image slot → <img> if a url is present, else an on-brand gradient placeholder. */
function img(url: any, alt: string, cls: string, label?: string): string {
  if (url && typeof url === 'string') return `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}">`
  return `<div class="${cls} ph">${esc(label || 'Image')}</div>`
}

const CSS = `
:root{--ink:#1c1c1c;--body:#333;--muted:#6b6b6b;--green:#356a3d;--red:#d0342b;--pink:#fbe9ef;--pink2:#fdeef2;--greenbox:#edf6e9;--dark:#1b1b28;--cream:#f3e4bf;--yellow:#f2d64e;--line:#e7e7e7;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--body);font-family:var(--sans);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased;padding-bottom:84px}
img{max-width:100%;display:block}
b,strong{color:var(--ink);font-weight:700}
.wrap{max-width:1180px;margin:0 auto;padding:0 22px}
.count{background:var(--dark);color:#fff;text-align:center;font-size:14px;letter-spacing:.06em;padding:13px 10px;font-weight:600}
.count .lbl{opacity:.85;margin-right:8px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:44px;padding:40px 0 70px}
.main>*{margin:0 0 20px}
h1.head{font-size:40px;line-height:1.12;font-weight:800;color:var(--ink);letter-spacing:-.02em;margin:6px 0 14px}
h2.sec{font-size:26px;font-weight:800;color:var(--ink);letter-spacing:-.01em;margin:34px 0 10px}
h2.sec.brand{color:var(--green)}
.byline{display:flex;align-items:center;gap:11px;margin:0 0 18px}
.byline .av{width:40px;height:40px;border-radius:50%;background:#dcdcdc;display:grid;place-items:center;color:#999;flex:none}
.byline .n{font-size:15px;line-height:1.25}
.byline .n b{display:block;color:var(--ink)}
.byline .n span{color:var(--muted);font-size:13px}
.lead{font-size:19px;color:var(--body)}
.ph{border-radius:6px;aspect-ratio:1/1;display:grid;place-items:center;color:#a2823a;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:radial-gradient(120% 120% at 60% 30%, #fdf3d4 0%, #f4dd94 45%, #eaca6a 100%)}
.hero{position:relative;border-radius:10px;overflow:hidden;min-height:340px}
.hero img,.hero.ph{width:100%;min-height:340px;object-fit:cover}
.rrow{display:flex;align-items:center;gap:12px;margin:14px 0 6px;flex-wrap:wrap}
.rrow .stars{color:#f4b400;font-size:20px;letter-spacing:2px}
.rrow .rlab{font-size:15px;color:var(--muted);font-weight:600}
.badges{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0 4px}
.badges span{background:var(--greenbox);color:var(--green);border-radius:100px;font-size:13px;font-weight:700;padding:7px 15px}
/* ranked list — the defining listicle trait */
.item{border-top:1px solid var(--line);padding:26px 0 6px}
.item:first-of-type{border-top:0}
.item .ihd{display:flex;align-items:center;gap:16px;margin:0 0 12px}
.item .num{flex:none;min-width:56px;height:56px;padding:0 12px;border-radius:12px;background:var(--dark);color:#fff;font-weight:800;font-size:26px;letter-spacing:-.02em;display:grid;place-items:center}
.item .num.top{background:var(--red)}
.item .ititle{font-size:23px;font-weight:800;color:var(--ink);letter-spacing:-.01em;line-height:1.18}
.item .iimg,.item .iimg.ph{border-radius:8px;aspect-ratio:16/10;object-fit:cover;width:100%;margin:0 0 14px}
.item .ibody{margin:0 0 16px}
.cta-inline{display:inline-block;background:var(--red);color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:12px 24px;border-radius:9px}
.cta-big{display:block;background:var(--red);color:#fff;text-decoration:none;text-align:center;border-radius:10px;padding:20px;font-weight:800;font-size:20px;margin:22px 0}
.cta-big small{display:block;font-weight:600;font-size:14px;opacity:.92;margin-top:5px}
.faq q{display:block;font-weight:800;color:var(--ink);font-size:17px;margin:18px 0 4px}
.faq p{margin:0 0 6px}
.aside{position:relative}
.offer{position:sticky;top:20px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 10px 30px -18px rgba(0,0,0,.25)}
.offer .pimg{aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%, #fdf3d4, #f0d281);display:grid;place-items:center;color:#a2823a;font-weight:700;letter-spacing:.08em;font-size:12px}
.offer .band{background:var(--pink);text-align:center;padding:16px}
.offer .band .st{color:#111;font-size:15px;letter-spacing:2px}
.offer .band .rt{font-size:12.5px;color:#555;margin:5px 0}
.offer .band .pn{font-weight:800;color:var(--ink);font-size:15px}
.offer .buy{display:block;background:var(--red);color:#fff;text-align:center;text-decoration:none;font-weight:800;font-size:18px;padding:18px}
.offer .trust{text-align:center;font-size:13px;color:#444;padding:12px 10px 16px;line-height:1.9}
.floatcta{position:fixed;left:0;right:0;bottom:0;z-index:60;background:#fff;border-top:1px solid var(--line);box-shadow:0 -8px 24px -10px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px max(18px,calc((100% - 1180px)/2 + 22px));transform:none;transition:transform .28s ease}
.floatcta.hide{transform:translateY(115%)}
.fc-info{display:flex;align-items:center;gap:12px;min-width:0}
.fc-thumb{width:46px;height:46px;border-radius:8px;flex:none;object-fit:cover;background:radial-gradient(120% 120% at 55% 30%, #fdf3d4, #f0d281)}
.fc-name{font-weight:700;color:var(--ink);font-size:15px;line-height:1.25;min-width:0}
.fc-name b{color:var(--red)}
.fc-btn{background:var(--red);color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:9px;white-space:nowrap;flex:none}
@media(max-width:900px){.grid{grid-template-columns:1fr;gap:0}h1.head{font-size:30px}.aside{order:-1}.offer{position:static;margin:18px 0}.item .ititle{font-size:20px}.item .num{min-width:48px;height:48px;font-size:22px}}
@media(max-width:600px){.fc-btn{padding:13px 18px;font-size:15px}.fc-name{font-size:13.5px}}
`

function offerCard(o: RenderOpts): string {
  const stars = '★ '.repeat(Math.round(o.rating?.stars || 5)).trim()
  return `<div class="offer">
    ${img(o.productImage, o.productName, 'pimg', 'Product image')}
    <div class="band"><div class="st">${stars}</div><div class="rt">${esc(o.rating?.countLabel || '')}</div><div class="pn">${esc(o.productName)}</div></div>
    <a class="buy" href="${esc(o.ctaHref)}">👉 Check Availability</a>
    <div class="trust">🔒 100% Secure Checkout<br>💰 90-Day Money-Back Guarantee</div>
  </div>`
}

function render(c: FilledContent, o: RenderOpts): string {
  const hours = Number(c.countdown_hours || 14)
  const stars = '★★★★★'
  const items = arr(c.items).map((i, idx) => {
    const n = String(idx + 1).padStart(2, '0')
    const top = idx === 0 ? ' top' : ''
    const body = rt(i.body).replace(/^<p>|<\/p>$/g, '')
    return `<div class="item">
      <div class="ihd"><div class="num${top}">${idx === 0 ? '#1' : n}</div><div class="ititle">${esc(i.label)}</div></div>
      ${img((i as any).image, i.label || o.productName, 'iimg')}
      <p class="ibody">${body}</p>
      <a class="cta-inline" href="${esc(o.ctaHref)}">👉 Check Availability</a>
    </div>`
  }).join('')
  const faqs = arr(c.faqs).map((f) => `<q>${esc(f.q)}</q><p>${esc(f.a)}</p>`).join('')

  return `
  <div class="count"><span class="lbl">LIMITED TIME :</span> <b>${hours} HRS</b> : <b>13 MINS</b> : <b>18 SECS</b></div>
  <div class="wrap"><div class="grid">
    <div class="main">
      <h1 class="head">${esc(c.headline)}</h1>
      <div class="byline"><div class="av">◍</div><div class="n"><b>By ${esc(c.author_name)}</b><span>${esc(c.author_tag || 'Verified Customer')}</span></div></div>
      <div class="hero">${img(c.image_hero, o.productName, '')}</div>
      <div class="rrow"><span class="stars">${stars}</span><span class="rlab">${esc(o.rating?.countLabel || 'Rated by 10,000+ Customers')}</span></div>
      <div class="badges"><span>🔒 Secure Checkout</span><span>💰 90-Day Guarantee</span><span>🚚 Fast Shipping</span></div>
      ${rt(c.intro)}
      ${items}
      <div class="faq"><h2 class="sec">Common Questions</h2>${faqs}</div>
      <h2 class="sec brand">${esc(c.closing_head)}</h2>
      ${rt(c.closing_body)}
      <a class="cta-big" href="${esc(o.ctaHref)}">👉 CHECK OUT ${esc(o.productName).toUpperCase()} →<small>⭐ ${o.rating?.stars || 4.8}/5 stars from 10,000+ verified users</small></a>
    </div>
    <div class="aside">${offerCard(o)}</div>
  </div></div>
  <div class="floatcta" id="floatcta"><div class="fc-info">${img(o.productImage, o.productName, 'fc-thumb')}<span class="fc-name">${esc(o.productName)}${o.priceLabel ? ' · <b>' + esc(o.priceLabel) + '</b>' : ''}</span></div><a class="fc-btn" href="${esc(o.ctaHref)}">👉 Check Availability</a></div>
  <script>var fc=document.getElementById('floatcta');function t(){fc.classList.toggle('hide',window.scrollY<480)}window.addEventListener('scroll',t,{passive:true});t();</script>`
}

export const listicleV1: PageTemplate = {
  id: 'listicle_v1',
  type: 'listicle',
  name: 'Listicle',
  description: 'Top-N ranked format with a CTA after every section — scannable, lower-commitment, drives clicks down the page.',
  thumbnail: '/builder/thumb-listicle.png',
  css: CSS,
  render,
  schema: [
    { key: 'headline', type: 'text', role: 'headline', label: 'Headline', hint: 'Curiosity/social-proof hook, e.g. "Why More People Are Switching To [Product]". ~8-12 words.' },
    { key: 'author_name', type: 'text', label: 'Author name', hint: 'A believable first name + last initial for the "verified customer" narrator.' },
    { key: 'author_tag', type: 'text', label: 'Author tag', hint: 'e.g. "Verified Customer".' },
    { key: 'image_hero', type: 'image', role: 'hero', label: 'Hero image', hint: 'Eye-catching product hero shot.' },
    { key: 'intro', type: 'richtext', role: 'body', label: 'Intro', hint: '1-2 short paragraphs setting up the ranked list; tease why people are switching. Bold one phrase.' },
    { key: 'items', type: 'list', label: 'Ranked items', count: 5, hint: 'Each: bold benefit-driven title (label) + 1-2 sentences (body) on why people switched. Ranked most compelling first. Each also gets an image, filled by the pipeline.' },
    { key: 'faqs', type: 'faq', label: 'FAQ', count: 3, hint: 'q + a covering results, guarantee, and shipping/usage.' },
    { key: 'closing_head', type: 'text', label: 'Closing heading', hint: 'e.g. "The Bottom Line".' },
    { key: 'closing_body', type: 'richtext', role: 'body', label: 'Closing body', hint: 'Final urge to buy; bold "Don\'t wait any longer!".' },
    { key: 'countdown_hours', type: 'number', label: 'Countdown hours' },
  ],
}
