/**
 * listicle_v1 — the "N Reasons Why…" high-converting listicle, ported from the founder-approved mock.
 * Same DNA as advertorial_v1: dark countdown bar, byline, offer card, floating CTA — but the body is a
 * pink/orange-branded "8 reasons" list where each reason is a 2-column image-left row, with an
 * interstitial offer card and a subscribe/how-to block. Layout is FIXED here; the AI only fills `schema`
 * slots. Shares the advertorial design tokens (+ pink/orange) so the two feel like one family.
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
:root{--ink:#1c1c1c;--body:#333;--muted:#6b6b6b;--green:#356a3d;--red:#d0342b;--pink:#d6248f;--orange:#ef5a2b;--pinksoft:#fbe9ef;--pink2:#fdeef2;--greenbox:#edf6e9;--dark:#1b1b28;--cream:#f3e4bf;--yellow:#f2d64e;--line:#e7e7e7;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--grad:linear-gradient(90deg,var(--pink),var(--orange))}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--body);font-family:var(--sans);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased;padding-bottom:84px}
img{max-width:100%;display:block}
b,strong{color:var(--ink);font-weight:700}
.wrap{max-width:920px;margin:0 auto;padding:0 22px}
.pgbld{width:100vw;margin-left:calc(50% - 50vw)}
.pgbld *{box-sizing:border-box}
.count{background:var(--dark);color:#fff;text-align:center;font-size:14px;letter-spacing:.06em;padding:13px 10px;font-weight:600}
.count .lbl{opacity:.85;margin-right:8px}
.count b{color:#fff}
/* Hide the theme's auto page-title (Dawn/most themes) so it doesn't duplicate our headline. */
.main-page-title,.shopify-page-title,.template-page .page-title{display:none!important}
/* promo bar — pink→orange gradient, sticky at top */
.promo{position:sticky;top:0;z-index:70;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:10px max(18px,calc((100% - 920px)/2 + 22px))}
.promo .brand{font-weight:800;letter-spacing:.06em;font-size:15px;text-transform:uppercase;white-space:nowrap}
.promo .save{font-weight:700;font-size:14px;text-align:center;flex:1 1 auto}
.promo .pill{background:#fff;color:var(--pink);font-weight:800;font-size:14px;letter-spacing:.04em;padding:6px 13px;border-radius:100px;white-space:nowrap;font-variant-numeric:tabular-nums}
.promo .pill b{color:var(--pink)}
/* trust badge + byline + headline */
.trust-pill{display:flex;align-items:center;justify-content:center;gap:10px;margin:26px auto 12px;background:#fff;border:1px solid var(--line);box-shadow:0 6px 20px -14px rgba(0,0,0,.35);border-radius:100px;padding:10px 20px;width:max-content;max-width:100%;font-size:14px;font-weight:700;color:var(--ink)}
.trust-pill .stars{color:#2e9e5b;letter-spacing:2px;font-size:15px}
.author{text-align:center;color:var(--muted);font-size:14px;margin:0 0 14px}
h1.head{font-size:clamp(32px,5vw,50px);line-height:1.1;font-weight:800;color:var(--ink);letter-spacing:-.02em;text-align:center;margin:6px 0 22px}
.summary-lab{font-weight:800;color:var(--ink);font-size:18px;margin:26px 0 6px}
.lead p{font-size:19px;color:var(--body);margin:0 0 14px}
/* reasons list — image-left 2-col rows */
.reasons{display:flex;flex-direction:column;gap:34px;margin:30px 0}
.reason{display:grid;grid-template-columns:300px 1fr;gap:26px;align-items:start}
.reason .rimgwrap{position:relative;border-radius:16px;overflow:hidden;background:var(--pink2)}
.reason .rimg,.reason .rimg.ph{border-radius:16px;aspect-ratio:1/1;object-fit:cover;width:100%}
.reason .rlab{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:var(--dark);color:#fff;font-size:13px;font-weight:700;letter-spacing:.03em;padding:7px 16px;border-radius:100px;white-space:nowrap;max-width:calc(100% - 24px);overflow:hidden;text-overflow:ellipsis}
.reason .rttl{font-size:23px;font-weight:800;color:var(--ink);letter-spacing:-.01em;line-height:1.2;margin:2px 0 10px}
.reason .rttl .rnum{color:var(--pink)}
.reason .rbody p{margin:0 0 12px}
/* interstitial + subscribe soft-pink cards */
.icard{background:linear-gradient(135deg,#fce4f0,#fdeae0);border-radius:22px;padding:28px;margin:34px 0;display:grid;grid-template-columns:280px 1fr;gap:28px;align-items:center}
.icard .iimg,.icard .iimg.ph{border-radius:16px;aspect-ratio:1/1;object-fit:cover;width:100%}
.icard .ihead{font-size:32px;font-weight:800;color:var(--ink);letter-spacing:-.02em;line-height:1.08;margin:0 0 6px}
.icard .isub{font-weight:800;color:var(--pink);letter-spacing:.06em;font-size:14px;margin:0 0 14px}
.cbox{list-style:none;background:rgba(255,255,255,.65);border-radius:14px;padding:8px 18px;margin:0 0 18px}
.cbox li{position:relative;padding:11px 0 11px 30px;line-height:1.45;border-bottom:1px solid rgba(0,0,0,.06);font-size:15px}
.cbox li:last-child{border-bottom:0}
.cbox li::before{content:"\\2705";position:absolute;left:0;top:11px;font-size:14px}
.subscribe{text-align:center;background:linear-gradient(135deg,#fce4f0,#fdeae0);border-radius:22px;padding:34px 26px;margin:34px 0}
.subscribe h2{font-size:28px;font-weight:800;color:var(--ink);letter-spacing:-.01em;margin:0 0 10px}
.subscribe p{margin:0 auto 18px;max-width:560px;color:var(--body)}
/* how-to block */
.howto{margin:34px 0}
.howto h2{font-size:26px;font-weight:800;color:var(--ink);letter-spacing:-.01em;margin:0 0 8px}
.howto ol{margin:14px 0;padding-left:22px}
.howto ol li{margin:0 0 10px;line-height:1.5}
.howto ol li::marker{font-weight:800;color:var(--pink)}
.hint{background:var(--greenbox);border-radius:12px;padding:14px 18px;margin:16px 0;font-size:15px;color:var(--ink)}
/* CTAs */
.cta-grad{display:block;background:var(--grad);color:#fff;text-decoration:none;text-align:center;border-radius:100px;padding:17px 26px;font-weight:800;font-size:18px;margin:8px 0;box-shadow:0 12px 28px -14px rgba(214,36,143,.7)}
.cta-big{display:block;background:var(--red);color:#fff;text-decoration:none;text-align:center;border-radius:12px;padding:20px;font-weight:800;font-size:20px;margin:26px 0}
.cta-big small{display:block;font-weight:600;font-size:14px;opacity:.92;margin-top:5px}
/* offer card (shared family look) */
.inline-offer{max-width:420px;margin:26px auto}
.offer{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 10px 30px -18px rgba(0,0,0,.25)}
.offer .pimg{aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%, #fdf3d4, #f0d281);display:grid;place-items:center;color:#a2823a;font-weight:700;letter-spacing:.08em;font-size:12px}
.offer .band{background:var(--pinksoft);text-align:center;padding:16px}
.offer .band .st{color:#111;font-size:15px;letter-spacing:2px}
.offer .band .rt{font-size:12.5px;color:#555;margin:5px 0}
.offer .band .pn{font-weight:800;color:var(--ink);font-size:15px}
.offer .buy{display:block;background:var(--grad);color:#fff;text-align:center;text-decoration:none;font-weight:800;font-size:18px;padding:18px}
.offer .trust{text-align:center;font-size:13px;color:#444;padding:12px 10px 16px;line-height:1.9}
.floatcta{position:fixed;left:0;right:0;bottom:0;z-index:60;background:#fff;border-top:1px solid var(--line);box-shadow:0 -8px 24px -10px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px max(18px,calc((100% - 920px)/2 + 22px));transform:none;transition:transform .28s ease}
.floatcta.hide{transform:translateY(115%)}
.fc-info{display:flex;align-items:center;gap:12px;min-width:0}
.fc-thumb{width:46px;height:46px;border-radius:8px;flex:none;object-fit:cover;background:radial-gradient(120% 120% at 55% 30%, #fdf3d4, #f0d281)}
.fc-name{font-weight:700;color:var(--ink);font-size:15px;line-height:1.25;min-width:0}
.fc-name b{color:var(--pink)}
.fc-btn{background:var(--grad);color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:100px;white-space:nowrap;flex:none}
@media(max-width:900px){h1.head{font-size:clamp(26px,7vw,34px)}.reason{grid-template-columns:1fr;gap:14px}.reason .rimg,.reason .rimg.ph{max-width:420px;margin:0 auto}.icard{grid-template-columns:1fr;gap:18px;padding:22px}.icard .iimg,.icard .iimg.ph{max-width:340px;margin:0 auto}.icard .ihead{font-size:26px}.promo{justify-content:center}.promo .save{flex-basis:100%;order:3}}
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
  const reasons = arr(c.reasons)
  const half = Math.ceil(reasons.length / 2)
  const reasonRow = (i: any, idx: number) => `<div class="reason">
      <div class="rimgwrap">${img((i as any).image, i.label || o.productName, 'rimg')}${i.label ? `<span class="rlab">${esc(i.label)}</span>` : ''}</div>
      <div>
        <div class="rttl"><span class="rnum">${idx + 1}.</span> ${rt(i.title).replace(/^<p>|<\/p>$/g, '')}</div>
        <div class="rbody">${rt(i.body)}</div>
      </div>
    </div>`
  const firstReasons = reasons.slice(0, half).map((i, idx) => reasonRow(i, idx)).join('')
  const restReasons = reasons.slice(half).map((i, idx) => reasonRow(i, idx + half)).join('')
  const offerBullets = arr(c.offer_bullets).map((b) => `<li><strong>${esc(b.label)}</strong>${b.body ? ' – ' + esc(b.body) : ''}</li>`).join('')
  const howtoSteps = arr(c.howto_steps).map((s) => `<li><strong>${esc(s.label)}</strong>${s.body ? ' – ' + esc(s.body) : ''}</li>`).join('')

  return `
  <div class="pgbld">
  <div class="promo"><span class="brand">${esc(o.productName).toUpperCase()}</span><span class="save">${esc(c.promo_save || 'Save Today')}</span><span class="pill count"><b class="cd-h">${hours}</b>:<b class="cd-m">00</b>:<b class="cd-s">00</b></span></div>
  <div class="wrap">
    <div class="trust-pill"><span class="stars">★★★★★</span> <span>${esc(c.trust_label || 'Trusted by 50,000+ Customers')}</span></div>
    <p class="author">By ${esc(c.author_name)} | ${esc(c.date_label)}</p>
    <h1 class="head">${rt(c.headline).replace(/^<p>|<\/p>$/g, '')}</h1>
    <div class="summary-lab">Product Summary:</div>
    <div class="lead">${rt(c.summary)}</div>

    <div class="reasons">${firstReasons}</div>

    <div class="count"><span class="lbl">LIMITED TIME :</span> <b class="cd-h">${hours} HRS</b> : <b class="cd-m">00 MINS</b> : <b class="cd-s">00 SECS</b></div>
    <div class="icard">
      ${img(o.productImage, o.productName, 'iimg', 'Product image')}
      <div>
        <div class="ihead">${esc(c.offer_head || 'Up to 30% OFF')}</div>
        <div class="isub">${esc(c.offer_sub || 'LIMITED TIME OFFER!')}</div>
        <ul class="cbox">${offerBullets}</ul>
        <a class="cta-grad" href="${esc(o.ctaHref)}">Get ${esc(c.discount_label || '30%')} Off + Free Shipping →</a>
      </div>
    </div>

    <div class="reasons">${restReasons}</div>

    <div class="subscribe">
      <h2>${esc(c.subscribe_head || 'SUBSCRIBE & GET ' + (c.discount_label || '30%') + ' OFF')}</h2>
      <p>${esc(c.subscribe_body)}</p>
      <a class="cta-grad" href="${esc(o.ctaHref)}">Subscribe Now for Exclusive Discounts →</a>
    </div>
    <div class="count"><span class="lbl">LIMITED TIME :</span> <b class="cd-h">${hours} HRS</b> : <b class="cd-m">00 MINS</b> : <b class="cd-s">00 SECS</b></div>

    <div class="howto">
      <h2>${esc(c.howto_head || '🌟 How To Get The Best Results')}</h2>
      ${rt(c.howto_intro)}
      <ol>${howtoSteps}</ol>
      ${c.howto_hint ? `<div class="hint">💡 Helpful Hint: ${esc(c.howto_hint)}</div>` : ''}
    </div>

    <div class="inline-offer">${offerCard(o)}</div>

    ${c.closing_line ? `<div class="lead">${rt(c.closing_line)}</div>` : ''}
    <a class="cta-big" href="${esc(o.ctaHref)}">👉 CHECK OUT ${esc(o.productName).toUpperCase()} →<small>⭐ ${o.rating?.stars || 4.8}/5 stars from verified users</small></a>
  </div>
  <div class="floatcta" id="floatcta"><div class="fc-info">${img(o.productImage, o.productName, 'fc-thumb')}<span class="fc-name">${esc(o.productName)}${o.priceLabel ? ' · <b>' + esc(o.priceLabel) + '</b>' : ''}</span></div><a class="fc-btn" href="${esc(o.ctaHref)}">👉 Check Availability</a></div>
  </div>
  <script>(function(){var fc=document.getElementById('floatcta');function t(){if(fc)fc.classList.toggle('hide',window.scrollY<480)}window.addEventListener('scroll',t,{passive:true});t();
  var end=Date.now()+(${hours}*3600+33*60+7)*1000;function p(n){return(n<10?'0':'')+n}function cd(){var d=Math.max(0,end-Date.now()),h=Math.floor(d/3600000),m=Math.floor(d%3600000/60000),s=Math.floor(d%60000/1000);document.querySelectorAll('.count').forEach(function(el){var pill=el.classList.contains('pill'),H=el.querySelector('.cd-h'),M=el.querySelector('.cd-m'),S=el.querySelector('.cd-s');if(H)H.textContent=p(h)+(pill?'':' HRS');if(M)M.textContent=p(m)+(pill?'':' MINS');if(S)S.textContent=p(s)+(pill?'':' SECS')})}cd();setInterval(cd,1000);})();</script>`
}

export const listicleV1: PageTemplate = {
  id: 'listicle_v1',
  type: 'listicle',
  name: 'Listicle',
  description: '"N Reasons Why…" high-converting listicle — pink/orange promo bar, image-left reason rows, interstitial offer + subscribe blocks, and a CTA-heavy close.',
  thumbnail: '/builder/thumb-listicle.png',
  css: CSS,
  render,
  schema: [
    { key: 'promo_save', type: 'text', label: 'Promo bar save label', hint: 'Short save line for the top promo bar, e.g. "Save 30% Today".' },
    { key: 'discount_label', type: 'text', label: 'Discount', hint: 'The headline discount, e.g. "30%". Reused in the offer + subscribe CTAs.' },
    { key: 'trust_label', type: 'text', label: 'Trust line', hint: 'Social-proof line for the ★★★★★ trust pill, e.g. "Trusted by 50,000+ Customers".' },
    { key: 'author', type: 'text', label: 'Author', hint: 'Byline author name, e.g. "Sarah Mitchell".' },
    { key: 'author_name', type: 'text', label: 'Author name', hint: 'A believable first name + last name for the byline (same as author).' },
    { key: 'date_label', type: 'text', label: 'Date', hint: 'A recent date + time, e.g. "October 5th, 2023 | 10:35 am EST".' },
    { key: 'headline', type: 'richtext', role: 'headline', label: 'Headline', hint: 'A "N Reasons Why…" hook. Bold the number and the payoff with **bold** spans, e.g. "**8 Reasons** Why [Product] Could Be The Secret To **Fuller Hair In Minutes!**".' },
    { key: 'summary', type: 'richtext', role: 'body', label: 'Product summary', hint: 'A 2-3 sentence intro paragraph after the "Product Summary:" label. Set up the promise; bold one phrase.' },
    { key: 'reasons', type: 'reasons', label: 'Reasons', count: 8, hint: 'Each: label = a short category pill (e.g. "Instant Boost"); title = a bold benefit heading rendered next to its number; body = 1-2 sentences on the benefit. Ranked most compelling first. Each also gets an image, filled by the pipeline.' },
    { key: 'offer_head', type: 'text', label: 'Offer headline', hint: 'Big offer headline, e.g. "Up to 30% OFF".' },
    { key: 'offer_sub', type: 'text', label: 'Offer subhead', hint: 'e.g. "LIMITED TIME OFFER!".' },
    { key: 'offer_bullets', type: 'list', label: 'Offer bullets', count: 3, hint: 'Each: bold benefit + short description. Include a guarantee line.' },
    { key: 'subscribe_head', type: 'text', label: 'Subscribe heading', hint: 'e.g. "SUBSCRIBE & GET 30% OFF".' },
    { key: 'subscribe_body', type: 'text', label: 'Subscribe body', hint: 'One inviting sentence to join the list for the discount.' },
    { key: 'howto_head', type: 'text', label: 'How-to heading', hint: 'e.g. "🌟 How To Get The Best Results".' },
    { key: 'howto_intro', type: 'richtext', role: 'body', label: 'How-to intro', hint: 'One short sentence introducing the steps.' },
    { key: 'howto_steps', type: 'list', label: 'How-to steps', count: 3, hint: 'Each: bold step action + short detail. Numbered automatically.' },
    { key: 'howto_hint', type: 'text', label: 'Helpful hint', hint: 'A short "Helpful Hint" tip shown after the steps.' },
    { key: 'closing_line', type: 'richtext', role: 'body', label: 'Closing line', hint: 'One final urging sentence before the last CTA; bold the payoff.' },
    { key: 'countdown_hours', type: 'number', label: 'Countdown hours' },
  ],
}
