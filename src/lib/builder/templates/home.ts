/**
 * home_v1 — a store HOME page modelled on the Atlas demo store home: brand hero (rating + big promise +
 * shop CTA), "as seen on", a feature block, a benefit-blurbs row, a highlighted expert review, a
 * "transform your life" trio, a reviews grid, a "what makes us different" comparison, FAQ, a services
 * row, and a before/after + newsletter close. Product-scoped (built around the hero product + brand
 * voice). Layout is FIXED; the AI only fills `schema` slots. All CSS scoped under `.pgbld`.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
// esc + strip stray **markdown** the copy model sometimes leaves in short labels.
const escp = (s: any) => esc(String(s ?? '').replace(/\*\*/g, '').replace(/^\s*[-•*]\s*/, '').trim())
// Heading with a **highlighted** phrase → accent span (two-tone headings).
const hl = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<span class="hl">$1</span>')
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
.pgbld{--ink:#17151a;--body:#514e57;--muted:#8b8792;--line:#ece9ef;--paper:#f8f6fb;--accent:#d6248f;--accent2:#7b2ff7;--grad:linear-gradient(100deg,#d6248f,#7b2ff7);--dark:#1a1720;--good:#22a06b;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--head:'Hanken Grotesk','Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;width:100%;color:var(--body);font-family:var(--sans);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
.pgbld *{box-sizing:border-box}
.pgbld h1,.pgbld h2,.pgbld h3,.pgbld .sec{font-family:var(--head)}
.pgbld img{max-width:100%;display:block}
.pgbld b,.pgbld strong{color:var(--ink);font-weight:700}
.pgbld .wrap{max-width:1160px;margin:0 auto;padding:0 22px}
.main-page-title,.shopify-page-title,.template-page .page-title{display:none!important}
.pgbld .rpill{display:inline-flex;align-items:center;gap:8px;background:var(--grad);color:#fff;border-radius:100px;padding:6px 14px;font-size:13px;font-weight:700}
.pgbld a.cta{display:inline-block;background:var(--grad);color:#fff;text-decoration:none;border-radius:100px;padding:15px 34px;font-weight:800;font-size:16.5px;box-shadow:0 14px 32px -16px rgba(214,36,143,.7)}
.pgbld a.cta.dark{background:var(--dark)}
/* hero */
.pgbld .hero{max-width:1160px;margin:0 auto;padding:48px 22px 34px;display:grid;grid-template-columns:1.05fr 1fr;gap:46px;align-items:center}
.pgbld .hero h1{font-size:clamp(34px,5.4vw,58px);font-weight:800;line-height:1.03;letter-spacing:-.025em;color:var(--ink);margin:14px 0 14px}
.pgbld .hero .lead{font-size:19px;color:var(--body);margin:0 0 24px;max-width:520px}
.pgbld .himg,.pgbld .himg.ph{border-radius:22px;aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff)}
.pgbld .seen{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--paper)}
.pgbld .seen .row{max-width:1160px;margin:0 auto;padding:16px 22px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:14px 34px;font-weight:800;color:var(--muted);opacity:.7}
.pgbld .seen .lbl{font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);opacity:1}
/* section shells */
.pgbld h2.sec{font-size:clamp(24px,3vw,34px);font-weight:800;letter-spacing:-.02em;color:var(--ink);text-align:center;margin:0 0 8px}
.pgbld .seclead{text-align:center;color:var(--muted);font-size:16px;max-width:640px;margin:0 auto 26px}
.pgbld .feat{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center;padding:50px 0}
.pgbld .fimg,.pgbld .fimg.ph{border-radius:20px;aspect-ratio:4/3;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff)}
.pgbld .feat h2{font-size:clamp(22px,2.6vw,32px);font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:0 0 12px;text-align:left}
.pgbld .fbul{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:10px}
.pgbld .fbul li{position:relative;padding-left:30px;font-size:15px}
.pgbld .fbul li::before{content:"\\2713";position:absolute;left:0;top:1px;width:20px;height:20px;border-radius:50%;background:#eafaf2;color:var(--good);font-size:11px;font-weight:800;display:grid;place-items:center}
/* benefit blurbs */
.pgbld .blurbs{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:14px 0 6px}
.pgbld .blurb{text-align:center;padding:20px 16px}
.pgbld .blurb .ic{width:46px;height:46px;border-radius:13px;background:linear-gradient(100deg,#fbeaf5,#efe6ff);display:grid;place-items:center;margin:0 auto 12px;font-size:20px}
.pgbld .blurb .bt{font-weight:800;color:var(--ink);font-size:15px;margin-bottom:4px}
.pgbld .blurb p{margin:0;font-size:13.5px}
/* expert review highlight */
.pgbld .expert{background:var(--paper);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:52px 0}
.pgbld .expert .in{max-width:820px;margin:0 auto;text-align:center;padding:0 22px}
.pgbld .expert .who{font-weight:800;color:var(--ink);font-size:18px;margin-bottom:12px}
.pgbld .expert .st{color:#f4b400;font-size:16px;margin-bottom:12px}
.pgbld .expert p{font-size:19px;line-height:1.6;color:var(--ink)}
/* trio */
.pgbld .trio{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:20px 0}
.pgbld .tcard{text-align:center;padding:26px 18px;border:1px solid var(--line);border-radius:16px;background:#fff}
.pgbld .tcard .lab{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--accent)}
.pgbld .tcard h3{font-size:19px;font-weight:800;color:var(--ink);margin:8px 0 6px}
.pgbld .tcard p{margin:0;font-size:14px}
.pgbld .sec .hl,.pgbld h1 .hl,.pgbld .feat h2 .hl{color:var(--accent2)}
/* gradient transform band */
.pgbld .transband{background:var(--grad);color:#fff;padding:56px 0;margin:26px 0}
.pgbld .transband .in{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .transband h2{font-family:var(--head);font-size:clamp(26px,3.4vw,40px);font-weight:800;letter-spacing:-.02em;color:#fff;margin:0 0 20px;text-align:left}
.pgbld .transband h2 .hl{color:#fff;font-style:italic;opacity:.9}
.pgbld .tlist{display:flex;flex-direction:column;gap:4px}
.pgbld .titem{padding:16px 0;border-top:1px solid rgba(255,255,255,.2)}
.pgbld .titem:first-child{border-top:0}
.pgbld .titem .tlab{display:inline-block;background:#fff;color:var(--ink);font-size:12px;font-weight:800;padding:3px 12px;border-radius:100px;margin-bottom:8px}
.pgbld .titem h3{font-size:19px;font-weight:800;color:#fff;margin:0 0 4px}
.pgbld .titem p{margin:0;font-size:14.5px;color:rgba(255,255,255,.9)}
.pgbld .timg,.pgbld .timg.ph{border-radius:20px;aspect-ratio:1/1;object-fit:cover;width:100%}
/* gradient comparison band */
.pgbld .cmpband{background:var(--grad);color:#fff;padding:56px 0;margin:26px 0}
.pgbld .cmpband .in{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .cmpband h2{font-family:var(--head);font-size:clamp(26px,3.4vw,40px);font-weight:800;letter-spacing:-.02em;color:#fff;margin:0 0 14px;text-align:left}
.pgbld .cmpband h2 .hl{color:#fff;font-style:italic;opacity:.85}
.pgbld .cmpband p{color:rgba(255,255,255,.9);font-size:16px;margin:0 0 22px}
.pgbld .cmpband a.bag{display:inline-block;background:var(--dark);color:#fff;text-decoration:none;border-radius:12px;padding:15px 40px;font-weight:800;font-size:16px}
.pgbld .ctab{position:relative}
.pgbld .ctab .ch2{display:grid;grid-template-columns:1fr 96px 96px;margin-bottom:4px}
.pgbld .ctab .ch2>div{text-align:center;font-weight:800;font-size:15px;padding:6px 0}
.pgbld .ctab .cr2{display:grid;grid-template-columns:1fr 96px 96px;align-items:center;padding:12px 0;border-top:1px solid rgba(255,255,255,.18)}
.pgbld .ctab .cr2 .lab{display:flex;align-items:center;gap:12px;font-weight:600}
.pgbld .ctab .cr2 .lab::before{content:"\\2713";width:22px;height:22px;border-radius:50%;background:#fff;color:var(--accent);font-weight:800;font-size:12px;display:grid;place-items:center;flex:none}
.pgbld .ctab .cr2 .yes,.pgbld .ctab .cr2 .no{text-align:center;font-size:16px;font-weight:800}
.pgbld .ctab .usbox{position:absolute;top:0;bottom:0;right:96px;width:96px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);border-radius:16px;pointer-events:none}
/* photo review carousel */
.pgbld .gcar{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 4px 20px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.pgbld .gcar::-webkit-scrollbar{display:none}
.pgbld .rcard{scroll-snap-align:start;flex:0 0 300px;max-width:82%;position:relative;border-radius:18px;overflow:hidden;aspect-ratio:3/4;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff)}
.pgbld .rcard .rimg,.pgbld .rcard .rimg.ph{width:100%;height:100%;object-fit:cover}
.pgbld .rcard .rov{position:absolute;left:0;right:0;bottom:0;padding:22px 18px 18px;background:linear-gradient(to top,rgba(24,23,32,.94),rgba(24,23,32,.55) 55%,transparent);color:#fff}
.pgbld .rcard .st{color:#ffd24a;font-size:14px;margin-bottom:6px}
.pgbld .rcard .rtt{font-weight:800;font-size:16px;margin-bottom:6px}
.pgbld .rcard p{margin:0 0 8px;font-size:13.5px;color:rgba(255,255,255,.94);line-height:1.5}
.pgbld .rcard .rwho{font-size:12.5px;font-weight:700;color:rgba(255,255,255,.82)}
@media(max-width:760px){
  .pgbld .transband .in,.pgbld .cmpband .in{grid-template-columns:1fr;gap:26px}
  .pgbld .transband,.pgbld .cmpband{padding:40px 0}
  .pgbld .transband h2,.pgbld .cmpband h2{font-size:26px}
  .pgbld .ctab .ch2,.pgbld .ctab .cr2{grid-template-columns:1fr 64px 64px}
  .pgbld .ctab .usbox{right:64px;width:64px}
  .pgbld .rcard{flex:0 0 78%}
}
/* reviews grid */
.pgbld .revs{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px 0}
.pgbld .rev{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px}
.pgbld .rev .st{color:#f4b400;font-size:13px;margin-bottom:8px}
.pgbld .rev .rt{font-weight:800;color:var(--ink);font-size:15px;margin-bottom:6px}
.pgbld .rev p{margin:0 0 10px;font-size:13.5px}
.pgbld .rev .who{font-size:12.5px;color:var(--muted);font-weight:700}
/* comparison */
.pgbld .cmp{max-width:760px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden}
.pgbld .cmp .ch{display:grid;grid-template-columns:1fr 110px 110px;background:var(--paper);font-weight:800;color:var(--ink);font-size:14px}
.pgbld .cmp .ch>div{padding:14px 16px;text-align:center}
.pgbld .cmp .ch>div:first-child{text-align:left}
.pgbld .cmp .cr{display:grid;grid-template-columns:1fr 110px 110px;border-top:1px solid var(--line);align-items:center}
.pgbld .cmp .cr>div{padding:14px 16px;text-align:center;font-size:14.5px}
.pgbld .cmp .cr>div:first-child{text-align:left;font-weight:600;color:var(--ink)}
.pgbld .cmp .yes{color:var(--good);font-weight:800}
.pgbld .cmp .no{color:#c9c5cf;font-weight:800}
.pgbld .cmp .us{background:linear-gradient(180deg,rgba(214,36,143,.06),rgba(123,47,247,.06))}
/* faq */
.pgbld .faq{max-width:760px;margin:0 auto;padding:8px 0}
.pgbld .faq .q{font-weight:800;color:var(--ink);font-size:16.5px;margin:18px 0 4px}
.pgbld .faq .a{margin:0}
/* services row */
.pgbld .svc{display:flex;flex-wrap:wrap;justify-content:center;gap:14px 44px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:20px 22px;background:var(--paper)}
.pgbld .svc .si{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:700;color:var(--ink)}
/* before/after + newsletter */
.pgbld .results{padding:52px 0}
.pgbld .ba{display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:760px;margin:20px auto 0}
.pgbld .ba figure{margin:0}
.pgbld .ba img,.pgbld .ba .ph{border-radius:18px;aspect-ratio:1/1;object-fit:cover;width:100%}
.pgbld .ba figcaption{text-align:center;font-weight:800;color:var(--ink);margin-top:8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em}
.pgbld .news{background:var(--dark);color:#fff;text-align:center;padding:54px 22px;margin-top:14px}
.pgbld .news h2{color:#fff;font-size:clamp(24px,3vw,32px);font-weight:800;margin:0 0 10px;letter-spacing:-.02em}
.pgbld .news p{color:#c9c5d2;font-size:16px;max-width:520px;margin:0 auto 22px}
@media(max-width:880px){.pgbld .hero{grid-template-columns:1fr;gap:24px;padding:34px 22px 24px}.pgbld .feat{grid-template-columns:1fr;gap:22px;padding:34px 0}.pgbld .blurbs{grid-template-columns:1fr 1fr}.pgbld .trio{grid-template-columns:1fr}.pgbld .revs{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.pgbld .blurbs{grid-template-columns:1fr}.pgbld .revs{grid-template-columns:1fr}.pgbld .cmp .ch,.pgbld .cmp .cr{grid-template-columns:1fr 70px 70px}.pgbld .ba{grid-template-columns:1fr 1fr}}
`

function render(c: FilledContent, o: RenderOpts): string {
  const stars = '★★★★★'
  const fbul = arr(c.feature_bullets).map((b) => `<li><strong>${escp(b.label)}</strong>${b.body ? ' — ' + escp(b.body) : ''}</li>`).join('')
  const blurbs = arr(c.benefit_blurbs).map((b) => `<div class="blurb"><div class="ic">${esc((b as any).emoji || '✦')}</div><div class="bt">${escp(b.label)}</div><p>${esc(b.body)}</p></div>`).join('')
  const trio = arr(c.transform_items).map((t, i) => `<div class="titem"><span class="tlab">${escp((t as any).label || ((['First', 'Second', 'Third'][i] || 'Next') + ' benefit'))}</span><h3>${escp(t.title || t.label)}</h3><p>${esc(t.body)}</p></div>`).join('')
  const revPhotos = [c.image_hero, c.image_feature, c.image_before, c.image_after]
  const revs = arr(c.testimonials).map((t, i) => `<div class="rcard">${img(revPhotos[i] || o.productImage, o.productName, 'rimg')}<div class="rov"><div class="st">${stars}</div><div class="rtt">${escp((t as any).title || t.city || 'Verified review')}</div><p>${esc(t.quote)}</p><div class="rwho">${esc(t.name)}</div></div></div>`).join('')
  const cmpRows = arr(c.compare_rows).map((r) => `<div class="cr2"><div class="lab">${escp(r.label)}</div><div class="yes">✓</div><div class="no" style="opacity:.55">✕</div></div>`).join('')
  const faqs = arr(c.faqs).map((f) => `<div class="fitem"><div class="q">${esc(f.q)}</div><p class="a">${esc(f.a)}</p></div>`).join('')
  const svc = arr(c.services).map((s) => `<div class="si">✓ ${escp(s.label)}</div>`).join('')

  return `
  <div class="pgbld">
  <section class="hero">
    <div>
      <div class="rpill"><span>${stars}</span> ${esc(o.rating?.countLabel || 'Excellent 4.8 | 12,000+ Customers')}</div>
      <h1>${hl(c.headline)}</h1>
      <p class="lead">${esc(c.subhead)}</p>
      <a class="cta" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Shop now')}</a>
    </div>
    ${img(c.image_hero || o.productImage, o.productName, 'himg', 'Hero')}
  </section>

  <div class="seen"><div class="row"><span class="lbl">${esc(c.as_seen_on || 'As seen on')}</span><span>FORBES</span><span>VOGUE</span><span>ELLE</span><span>ALLURE</span></div></div>

  <div class="wrap">
    <section class="feat">
      ${img(c.image_feature, o.productName, 'fimg', 'Lifestyle')}
      <div>
        <h2>${hl(c.feature_head)}</h2>
        ${rt(c.feature_body)}
        <ul class="fbul">${fbul}</ul>
      </div>
    </section>

    <div class="blurbs">${blurbs}</div>
  </div>

  <div class="expert"><div class="in">
    <div class="st">${stars}</div>
    <div class="who">${esc(c.expert_author || 'A verified expert')}</div>
    <p>${esc(c.expert_quote)}</p>
  </div></div>

  <div class="transband"><div class="wrap in">
    <div>
      <h2>${hl(c.transform_head || 'How this will **transform** your day')}</h2>
      <div class="tlist">${trio}</div>
    </div>
    ${img(c.image_feature || o.productImage, o.productName, 'timg')}
  </div></div>

  <div class="wrap">
    <h2 class="sec" style="margin-top:52px">${hl(c.reviews_head || 'Join 10,000+ **happy customers**')}</h2>
  </div>
  <div class="wrap"><div class="gcar">${revs}</div></div>

  <div class="cmpband"><div class="wrap in">
    <div>
      <h2>${hl(c.compare_head || 'What makes us **different**')}</h2>
      <p>${esc(c.compare_body)}</p>
      <a class="bag" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Shop now')}</a>
    </div>
    <div class="ctab">
      <div class="usbox"></div>
      <div class="ch2"><div></div><div>${esc(o.productName).split(' ')[0] || 'Us'}</div><div>Others</div></div>
      ${cmpRows}
    </div>
  </div></div>

  <div class="wrap">
    <h2 class="sec" style="margin-top:52px">Frequently asked questions</h2>
    <p class="seclead">${esc(c.faq_sub || 'Quick answers to the most common questions.')}</p>
    <div class="faq">${faqs}</div>
  </div>

  <div class="svc">${svc}</div>

  <div class="wrap results">
    <h2 class="sec">${esc(c.results_head || 'Real results')}</h2>
    <div class="ba">
      <figure>${img(c.image_before || o.productImage, 'Before', '')}<figcaption>Before</figcaption></figure>
      <figure>${img(c.image_after || o.productImage, 'After', '')}<figcaption>After</figcaption></figure>
    </div>
  </div>

  <div class="news">
    <h2>${esc(c.newsletter_head || 'Ready when you are')}</h2>
    <p>${esc(c.newsletter_sub)}</p>
    <a class="cta" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Shop now')}</a>
  </div>
  </div>`
}

export const homeV1: PageTemplate = {
  id: 'home_v1',
  type: 'home',
  name: 'Home page',
  description: 'A store homepage: brand hero, "as seen on", a feature block, benefit blurbs, an expert review, a transform trio, a reviews grid, a comparison, FAQ, a services row, and a before/after + newsletter close.',
  thumbnail: '/builder/thumb-home.png',
  css: CSS,
  render,
  schema: [
    { key: 'headline', type: 'text', role: 'headline', label: 'Hero headline', hint: 'The big brand promise, ~4-7 words. Wrap the single most important 1-2 word phrase in **double asterisks** to accent it.' },
    { key: 'subhead', type: 'text', role: 'body', label: 'Hero subhead', hint: '1-2 sentences on what it does + who it\'s for.' },
    { key: 'cta_label', type: 'text', label: 'Button label', hint: 'e.g. "Shop now".' },
    { key: 'image_hero', type: 'image', role: 'hero', label: 'Hero image' },
    { key: 'as_seen_on', type: 'text', label: '"As seen on" label' },
    { key: 'feature_head', type: 'text', label: 'Feature heading', hint: 'Wrap the key 1-2 word phrase in **double asterisks** to accent it.' },
    { key: 'feature_body', type: 'richtext', role: 'body', label: 'Feature body' },
    { key: 'feature_bullets', type: 'list', label: 'Feature bullets', count: 3, hint: 'Each: bold benefit + short line.' },
    { key: 'image_feature', type: 'image', role: 'editorial', label: 'Feature image' },
    { key: 'benefit_blurbs', type: 'list', label: 'Benefit blurbs', count: 4, hint: 'Each: bold short title (label) + one short line (body).' },
    { key: 'expert_author', type: 'text', label: 'Expert review — name', hint: 'A believable expert/customer name + title, e.g. "Dr. Lena Hart, Nutritionist".' },
    { key: 'expert_quote', type: 'text', label: 'Expert review — quote', hint: '2-3 sentences endorsing the product.' },
    { key: 'transform_head', type: 'text', label: 'Transform heading', hint: 'Wrap the key 1-2 word phrase in **double asterisks** to accent it.' },
    { key: 'transform_items', type: 'reasons', label: 'Transform trio', count: 3, hint: 'label = 1-2 word tag; title = benefit; body = one sentence.' },
    { key: 'reviews_head', type: 'text', label: 'Reviews heading', hint: 'Wrap the key 1-2 word phrase in **double asterisks** to accent it.' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews', count: 4, hint: 'name, city, quote. Use "city" as a SHORT review title.' },
    { key: 'compare_head', type: 'text', label: 'Comparison heading', hint: 'Wrap the key 1-2 word phrase in **double asterisks** to accent it.' },
    { key: 'compare_body', type: 'text', label: 'Comparison intro' },
    { key: 'compare_rows', type: 'list', label: 'Comparison rows', count: 5, hint: 'Each label only: a feature the product has and rivals don\'t.' },
    { key: 'faq_sub', type: 'text', label: 'FAQ subheading' },
    { key: 'faqs', type: 'faq', label: 'FAQ', count: 4, hint: 'Cover results time, safety, daily use, taste/usage.' },
    { key: 'services', type: 'list', label: 'Services row', count: 4, hint: 'Each label only: e.g. "Worldwide shipping", "24/7 support".' },
    { key: 'results_head', type: 'text', label: 'Before/after heading' },
    { key: 'image_before', type: 'image', role: 'product', label: 'Before image' },
    { key: 'image_after', type: 'image', role: 'lifestyle', label: 'After image' },
    { key: 'newsletter_head', type: 'text', label: 'Newsletter heading' },
    { key: 'newsletter_sub', type: 'text', label: 'Newsletter subtext' },
  ],
}
