/**
 * advertorial_v1 — the long-form editorial template, ported from the founder-approved mock
 * (public/advertorial-preview.html). Layout is FIXED here; the AI only fills `schema` slots.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

// ── tiny render helpers (self-contained; no deps) ──
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
/* Every rule is scoped under .pgbld so NOTHING leaks into the merchant's theme (header/footer).
   The one deliberate exception is the theme page-title hide below. No viewport breakout — the page
   stays inside the theme's page container so it can never push the footer/header around. */
.pgbld{--ink:#1c1c1c;--body:#333;--muted:#6b6b6b;--green:#356a3d;--red:#d0342b;--pink:#fbe9ef;--pink2:#fdeef2;--greenbox:#edf6e9;--dark:#1b1b28;--cream:#f3e4bf;--yellow:#f2d64e;--line:#e7e7e7;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:100%;color:var(--body);font-family:var(--sans);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased;padding-bottom:84px}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld b,.pgbld strong{color:var(--ink);font-weight:700}
.pgbld .wrap{max-width:1180px;margin:0 auto;padding:0 22px}
/* Hide the theme's auto page-title (Dawn/most themes) so it doesn't duplicate our headline. */
.main-page-title,.shopify-page-title,.template-page .page-title{display:none!important}
.pgbld .count{background:var(--dark);color:#fff;text-align:center;font-size:14px;letter-spacing:.06em;padding:13px 10px;font-weight:600}
.pgbld .count .lbl{opacity:.85;margin-right:8px}
.pgbld .count b{color:#fff}
.pgbld .grid{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:44px;padding:40px 0 70px}
.pgbld .main>*{margin:0 0 20px}
.pgbld h1.head{font-size:40px;line-height:1.12;font-weight:800;color:var(--ink);letter-spacing:-.02em;margin:6px 0 14px}
.pgbld h2.sec{font-size:26px;font-weight:800;color:var(--ink);letter-spacing:-.01em;margin:34px 0 10px}
.pgbld h2.sec.brand{color:var(--green)}
.pgbld .byline{display:flex;align-items:center;gap:11px;margin:0 0 18px}
.pgbld .byline .av{width:40px;height:40px;border-radius:50%;background:#dcdcdc;display:grid;place-items:center;color:#999;flex:none}
.pgbld .byline .n{font-size:15px;line-height:1.25}
.pgbld .byline .n b{display:block;color:var(--ink)}
.pgbld .byline .n span{color:var(--muted);font-size:13px}
.pgbld .lead{font-size:19px;color:var(--body)}
.pgbld .imgrow{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.pgbld .ph{border-radius:6px;aspect-ratio:1/1;display:grid;place-items:center;color:#a2823a;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:radial-gradient(120% 120% at 60% 30%, #fdf3d4 0%, #f4dd94 45%, #eaca6a 100%)}
.pgbld .imgrow img,.pgbld .imgrow .ph{border-radius:6px;aspect-ratio:1/1;object-fit:cover;width:100%}
.pgbld .ba{position:relative;border-radius:6px;overflow:hidden;min-height:360px}
.pgbld .ba img{width:100%;min-height:360px;object-fit:cover}
.pgbld .ba .pill{position:absolute;top:20px;padding:8px 20px;border-radius:100px;font-weight:800;font-size:15px;letter-spacing:.05em}
.pgbld .ba .pill.bp{left:18px;background:var(--cream);color:#6b5a34}
.pgbld .ba .pill.ap{right:18px;background:var(--yellow);color:#4a3d05}
.pgbld .xlist{list-style:none;padding:0;margin:14px 0}
.pgbld .xlist li{position:relative;padding:8px 0 8px 34px;line-height:1.5}
.pgbld .xlist li::before{content:"\\274C";position:absolute;left:0;top:7px;font-size:16px}
.pgbld .cbox{list-style:none;background:var(--greenbox);border-radius:12px;padding:8px 20px;margin:16px 0}
.pgbld .cbox li{position:relative;padding:12px 0 12px 34px;line-height:1.5;border-bottom:1px solid #dcebd4}
.pgbld .cbox li:last-child{border-bottom:0}
.pgbld .cbox li::before{content:"\\2705";position:absolute;left:0;top:12px;font-size:15px}
.pgbld .costs p{margin:10px 0}
.pgbld .callout{background:var(--pink2);border-radius:12px;padding:20px 24px;margin:18px 0}
.pgbld .callout .tot{color:var(--red);font-weight:800;font-size:22px;margin:0 0 4px}
.pgbld .tl{display:flex;flex-direction:column;gap:22px;margin:16px 0}
.pgbld .tl .row{display:grid;grid-template-columns:120px 1fr;gap:18px;align-items:start}
.pgbld .tl .thumb{border-radius:8px;aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 60% 30%, #fdf3d4, #eaca6a)}
.pgbld .tl .lab{display:inline-block;background:#33333f;color:#fff;font-size:14px;font-weight:700;padding:5px 12px;border-radius:7px;margin-bottom:7px}
.pgbld .tests{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:16px 0}
.pgbld .tcard{border:1px solid var(--line);border-radius:14px;padding:18px}
.pgbld .tcard .who{font-weight:800;color:var(--ink)}
.pgbld .tcard .city{color:var(--muted);font-size:13px;margin-bottom:8px}
.pgbld .tcard .stars{color:#f4b400;font-size:14px;margin-bottom:8px}
.pgbld .tcard p{margin:0;font-size:15px}
.pgbld .faq q{display:block;font-weight:800;color:var(--ink);font-size:17px;margin:18px 0 4px}
.pgbld .faq p{margin:0 0 6px}
.pgbld .cta-big{display:block;background:var(--red);color:#fff;text-decoration:none;text-align:center;border-radius:10px;padding:20px;font-weight:800;font-size:20px;margin:22px 0}
.pgbld .cta-big small{display:block;font-weight:600;font-size:14px;opacity:.92;margin-top:5px}
.pgbld .guar{background:var(--pink2);border-radius:14px;padding:26px;text-align:center;margin:26px 0}
.pgbld .guar h3{margin:0 0 8px;font-size:22px;color:var(--ink);font-weight:800}
.pgbld .aside{position:relative}
.pgbld .offer{position:sticky;top:20px;border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 10px 30px -18px rgba(0,0,0,.25)}
.pgbld .offer .pimg{aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%, #fdf3d4, #f0d281);display:grid;place-items:center;color:#a2823a;font-weight:700;letter-spacing:.08em;font-size:12px}
.pgbld .offer .band{background:var(--pink);text-align:center;padding:16px}
.pgbld .offer .band .st{color:#111;font-size:15px;letter-spacing:2px}
.pgbld .offer .band .rt{font-size:12.5px;color:#555;margin:5px 0}
.pgbld .offer .band .pn{font-weight:800;color:var(--ink);font-size:15px}
.pgbld .offer .buy{display:block;background:var(--red);color:#fff;text-align:center;text-decoration:none;font-weight:800;font-size:18px;padding:18px}
.pgbld .offer .trust{text-align:center;font-size:13px;color:#444;padding:12px 10px 16px;line-height:1.9}
.pgbld .inline-offer{max-width:420px;margin:26px auto}
.pgbld .inline-offer .offer{position:static;box-shadow:none}
.pgbld .date{color:var(--muted);font-size:14px;margin-top:6px}
.pgbld .floatcta{position:fixed;left:0;right:0;bottom:0;z-index:60;background:#fff;border-top:1px solid var(--line);box-shadow:0 -8px 24px -10px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px max(18px,calc((100% - 1180px)/2 + 22px));transform:none;transition:transform .28s ease}
.pgbld .floatcta.hide{transform:translateY(115%)}
.pgbld .fc-info{display:flex;align-items:center;gap:12px;min-width:0}
.pgbld .fc-thumb{width:46px;height:46px;border-radius:8px;flex:none;object-fit:cover;background:radial-gradient(120% 120% at 55% 30%, #fdf3d4, #f0d281)}
.pgbld .fc-name{font-weight:700;color:var(--ink);font-size:15px;line-height:1.25;min-width:0}
.pgbld .fc-name b{color:var(--red)}
.pgbld .fc-btn{background:var(--red);color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:9px;white-space:nowrap;flex:none}
@media(max-width:900px){.pgbld .grid{grid-template-columns:1fr;gap:0}.pgbld h1.head{font-size:28px;line-height:1.15}.pgbld .offer{position:static;margin:18px 0}.pgbld .tests{grid-template-columns:1fr}.pgbld .tl .row{grid-template-columns:84px 1fr}}
@media(max-width:600px){.pgbld .fc-btn{padding:13px 18px;font-size:15px}.pgbld .fc-name{font-size:13.5px}}
`

function offerCard(c: FilledContent, o: RenderOpts): string {
  const stars = '★ '.repeat(Math.round(o.rating?.stars || 5)).trim()
  return `<div class="offer">
    ${img(o.productImage, o.productName, 'pimg', 'Product image')}
    <div class="band"><div class="st">${stars}</div><div class="rt">${esc(o.rating?.countLabel || '')}</div><div class="pn">${esc(o.productName)}</div></div>
    <a class="buy" href="${esc(o.ctaHref)}">👉 Check Availability</a>
    <div class="trust">🔒 100% Secure Checkout<br>💰 90-Day Money-Back Guarantee</div>
  </div>`
}

function render(c: FilledContent, o: RenderOpts): string {
  const list = (v: SlotValue | undefined, cls: string) => `<ul class="${cls}">${arr(v).map((i) => `<li><strong>${esc(i.label)}</strong>${i.body ? ' – ' + esc(i.body) : ''}</li>`).join('')}</ul>`
  const costs = arr(c.costs_items).map((i) => `<p><b>${esc(i.label)}:</b> ${esc(i.body)}</p>`).join('')
  const timeline = arr(c.timeline_items).map((i) => `<div class="row">${img((i as any).thumb, i.label || '', 'thumb')}<div><span class="lab">${esc(i.label)}</span><p style="margin:0">${rt(i.body).replace(/^<p>|<\/p>$/g, '')}</p></div></div>`).join('')
  const tests = arr(c.testimonials).map((t) => `<div class="tcard"><div class="stars">★★★★★</div><div class="who">${esc(t.name)}</div><div class="city">${esc(t.city)}</div><p>${esc(t.quote)}</p></div>`).join('')
  const faqs = arr(c.faqs).map((f) => `<q>${esc(f.q)}</q><p>${esc(f.a)}</p>`).join('')
  const hours = Number(c.countdown_hours || 14)

  return `
  <div class="pgbld">
  <div class="count"><span class="lbl">LIMITED TIME :</span> <b class="cd-h">${hours} HRS</b> : <b class="cd-m">00 MINS</b> : <b class="cd-s">00 SECS</b></div>
  <div class="wrap"><div class="grid">
    <div class="main">
      <h1 class="head">${esc(c.headline)}</h1>
      <div class="byline"><div class="av">◍</div><div class="n"><b>By ${esc(c.author_name)}</b><span>${esc(c.author_tag || 'Verified Customer')}</span></div></div>
      <p class="lead">${esc(c.lead)}</p>
      <div class="imgrow">${img(c.image_product_a, o.productName, '')}${img(c.image_product_b, o.productName, '')}</div>
      ${rt(c.story_intro)}
      <h2 class="sec">${esc(c.confidence_head)}</h2>
      ${rt(c.confidence_body)}
      <div class="ba">${img(c.image_before_after, 'Before and after', '')}<span class="pill bp">BEFORE</span><span class="pill ap">AFTER</span></div>
      <h2 class="sec">${esc(c.pain_head)}</h2>
      ${list(c.pain_items, 'xlist')}
      <h2 class="sec">${esc(c.costs_head)}</h2>
      <div class="costs">${costs}</div>
      <h2 class="sec">${esc(c.decision_head)}</h2>
      ${rt(c.decision_body)}
      ${list(c.failed_items, 'xlist')}
      <div class="callout"><p class="tot">Total wasted: ${esc(c.total_wasted)}</p>${esc(c.total_wasted_note)}</div>
      <h2 class="sec">${esc(c.running_head)}</h2>
      ${rt(c.running_body)}
      <h2 class="sec brand">${esc(c.discovery_head)}</h2>
      ${rt(c.discovery_body)}
      ${list(c.benefit_items, 'cbox')}
      <h2 class="sec">${esc(c.ingredients_head)}</h2>
      <p><b>What's in it:</b></p>
      ${list(c.ingredient_items, 'cbox')}
      <div class="inline-offer">${offerCard(c, o)}</div>
      <h2 class="sec">${esc(c.timeline_head)}</h2>
      <div class="tl">${timeline}</div>
      <h2 class="sec">${esc(c.moments_head)}</h2>
      ${rt(c.moments_body)}
      <div class="tests">${tests}</div>
      <h2 class="sec">${esc(c.why_head)}</h2>
      ${rt(c.why_body)}
      ${list(c.why_items, 'cbox')}
      <h2 class="sec">${esc(c.after_head)}</h2>
      ${rt(c.after_body)}
      <p><b>${esc(c.wish_line)}</b></p>
      <p class="date">${esc(c.date)}</p>
      <div class="count" style="border-radius:10px"><span class="lbl">LIMITED TIME :</span> <b class="cd-h">${hours} HRS</b> : <b class="cd-m">00 MINS</b> : <b class="cd-s">00 SECS</b></div>
      <div class="guar"><h3>${esc(c.guarantee_head)}</h3><p style="margin:0 0 14px">${esc(c.guarantee_note)}</p><a class="cta-big" style="margin:0" href="${esc(o.ctaHref)}">👉 Apply Discount &amp; Check Availability</a></div>
      <h2 class="sec">Common Questions</h2>
      <div class="faq">${faqs}</div>
      <h2 class="sec brand">${esc(c.closing_head)}</h2>
      ${rt(c.closing_body)}
      <a class="cta-big" href="${esc(o.ctaHref)}">👉 CHECK OUT ${esc(o.productName).toUpperCase()} →<small>⭐ ${o.rating?.stars || 4.8}/5 stars from 10,000+ verified users</small></a>
    </div>
    <div class="aside">${offerCard(c, o)}</div>
  </div></div>
  <div class="floatcta" id="floatcta"><div class="fc-info">${img(o.productImage, o.productName, 'fc-thumb')}<span class="fc-name">${esc(o.productName)}${o.priceLabel ? ' · <b>' + esc(o.priceLabel) + '</b>' : ''}</span></div><a class="fc-btn" href="${esc(o.ctaHref)}">👉 Check Availability</a></div>
  </div>
  <script>(function(){var fc=document.getElementById('floatcta');function t(){if(fc)fc.classList.toggle('hide',window.scrollY<480)}window.addEventListener('scroll',t,{passive:true});t();
  var end=Date.now()+(${hours}*3600+33*60+7)*1000;function p(n){return(n<10?'0':'')+n}function cd(){var d=Math.max(0,end-Date.now()),h=Math.floor(d/3600000),m=Math.floor(d%3600000/60000),s=Math.floor(d%60000/1000);document.querySelectorAll('.count').forEach(function(el){var H=el.querySelector('.cd-h'),M=el.querySelector('.cd-m'),S=el.querySelector('.cd-s');if(H)H.textContent=p(h)+' HRS';if(M)M.textContent=p(m)+' MINS';if(S)S.textContent=p(s)+' SECS'})}cd();setInterval(cd,1000);})();</script>`
}

export const advertorialV1: PageTemplate = {
  id: 'advertorial_v1',
  type: 'advertorial',
  name: 'Advertorial',
  description: 'Long-form editorial that tells a story before the CTA — trust via proof, before/after, testimonials.',
  thumbnail: '/builder/thumb-advertorial.png',
  css: CSS,
  render,
  schema: [
    { key: 'headline', type: 'text', role: 'headline', label: 'Headline', hint: 'Bold curiosity/transformation hook, ~8-12 words.' },
    { key: 'author_name', type: 'text', label: 'Author name', hint: 'A believable first name + last initial for the "verified customer" narrator.' },
    { key: 'author_tag', type: 'text', label: 'Author tag', hint: 'e.g. "Verified Customer".' },
    { key: 'lead', type: 'text', role: 'body', label: 'Lead hook', hint: 'One punchy sentence summarizing the product benefit.' },
    { key: 'image_product_a', type: 'image', role: 'product', label: 'Product image A' },
    { key: 'image_product_b', type: 'image', role: 'editorial', label: 'Editorial product shot' },
    { key: 'story_intro', type: 'richtext', role: 'body', label: 'Story opening', hint: '3-4 short paragraphs; the moment they realized the problem. Bold one emotional phrase.' },
    { key: 'confidence_head', type: 'text', label: 'Confidence subhead', hint: 'e.g. "When [problem] Took Over My Confidence".' },
    { key: 'confidence_body', type: 'richtext', role: 'body', label: 'Confidence story' },
    { key: 'image_before_after', type: 'image', role: 'before_after', label: 'Before/after image' },
    { key: 'pain_head', type: 'text', label: 'Pain-list heading', hint: 'e.g. "What I Was Facing Every Day:".' },
    { key: 'pain_items', type: 'list', label: 'Pain points', count: 4, hint: 'Each: bold symptom + short description.' },
    { key: 'costs_head', type: 'text', label: 'Costs heading', hint: 'e.g. "What [problem] Really Costs You".' },
    { key: 'costs_items', type: 'costs', label: 'Costs', count: 3, hint: 'Label = At work / At home / In relationships; body = the cost.' },
    { key: 'decision_head', type: 'text', label: 'Decision heading', hint: 'e.g. "The Day I Decided Enough Was Enough".' },
    { key: 'decision_body', type: 'richtext', role: 'body', label: 'Decision story' },
    { key: 'failed_items', type: 'list', label: 'Failed solutions', count: 4, hint: 'Each: bold "Product (price)" + why it failed.' },
    { key: 'total_wasted', type: 'text', label: 'Total wasted', hint: 'Sum of the failed solutions, e.g. "PKR 10,000+".' },
    { key: 'total_wasted_note', type: 'text', label: 'Total wasted note' },
    { key: 'running_head', type: 'text', label: 'Running-out heading', hint: 'e.g. "Running Out of Options".' },
    { key: 'running_body', type: 'richtext', role: 'body', label: 'Running-out story' },
    { key: 'discovery_head', type: 'text', label: 'Discovery heading', hint: 'e.g. "Then I Found [Product]".' },
    { key: 'discovery_body', type: 'richtext', role: 'body', label: 'Discovery story' },
    { key: 'benefit_items', type: 'list', label: 'Benefits', count: 4, hint: 'Each: bold benefit + description.' },
    { key: 'ingredients_head', type: 'text', label: 'Ingredients heading', hint: 'e.g. "How [Product] Changed Everything".' },
    { key: 'ingredient_items', type: 'list', label: 'Ingredients / how it works', count: 4, hint: 'Each: bold ingredient/mechanism + benefit.' },
    { key: 'timeline_head', type: 'text', label: 'Timeline heading', hint: 'e.g. "My Results, Week by Week".' },
    { key: 'timeline_items', type: 'timeline', label: 'Timeline', count: 3, hint: 'Label = Week 1 / Week 2-3 / Month 2-4; body = what changed.' },
    { key: 'moments_head', type: 'text', label: 'Little-moments heading' },
    { key: 'moments_body', type: 'richtext', role: 'body', label: 'Little-moments story', hint: 'Small wins, bold the quoted lines.' },
    { key: 'testimonials', type: 'testimonials', label: 'Testimonials', count: 3, hint: 'name, city, short quote.' },
    { key: 'why_head', type: 'text', label: 'Why-it-works heading' },
    { key: 'why_body', type: 'richtext', role: 'body', label: 'Why-it-works body' },
    { key: 'why_items', type: 'list', label: 'Why-it-works points', count: 4 },
    { key: 'after_head', type: 'text', label: 'After heading', hint: 'e.g. "How Everything Changed After [Product]".' },
    { key: 'after_body', type: 'richtext', role: 'body', label: 'After body', hint: 'Use 💼🏠💖✨ lines: Work / Home / Social / Self-esteem.' },
    { key: 'wish_line', type: 'text', label: 'Wish line', hint: 'e.g. "I just wish I\'d found it sooner."' },
    { key: 'date', type: 'text', label: 'Date', hint: 'A recent date, e.g. "Wednesday, 15 October 2025".' },
    { key: 'guarantee_head', type: 'text', label: 'Guarantee headline', hint: 'e.g. "Try [Product] for 30 Days. Don\'t See Results? 100% Refund".' },
    { key: 'guarantee_note', type: 'text', label: 'Guarantee note' },
    { key: 'faqs', type: 'faq', label: 'FAQ', count: 4, hint: 'q + a covering results time, safety, guarantee, usage.' },
    { key: 'closing_head', type: 'text', label: 'Closing heading', hint: 'e.g. "That\'s My Story".' },
    { key: 'closing_body', type: 'richtext', role: 'body', label: 'Closing body', hint: 'Final urge to buy; bold "Don\'t wait any longer!".' },
    { key: 'countdown_hours', type: 'number', label: 'Countdown hours' },
  ],
}
