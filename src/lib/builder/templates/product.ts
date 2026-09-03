/**
 * product_v1 — a full PDP modelled section-for-section on the Atlas demo store product page: hero
 * (gallery + buy-box with rating, sale price, benefit pills, subscribe/one-time options, add-to-cart),
 * trust row, marquee, two feature blocks, a stats band, a "Benefits you'll love" grid, a "what makes us
 * different" comparison, a reviews grid, a "transform your life" trio, FAQ and a floating buy bar.
 * Layout is FIXED; the AI only fills `schema` slots. All CSS scoped under `.pgbld` so it never touches
 * the merchant's theme header/footer.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
// esc + strip stray **markdown** / leading bullet chars the copy model sometimes leaves in short labels.
const escp = (s: any) => esc(String(s ?? '').replace(/\*\*/g, '').replace(/^\s*[-•*]\s*/, '').trim())
function rt(s: any): string {
  const safe = esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return safe.split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}
const arr = (v: SlotValue | undefined) => (Array.isArray(v) ? v : [])
function img(url: any, alt: string, cls: string, label?: string): string {
  if (url && typeof url === 'string') return `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}">`
  return `<div class="${cls} ph">${esc(label || 'Image')}</div>`
}

// A UGC card: a real uploaded <video>, else a poster image with a play badge.
function mediaCard(u: any, poster: any, name: string): string {
  const isVid = typeof u === 'string' && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)
  if (isVid) return `<video src="${esc(u)}" muted loop playsinline controls preload="metadata"></video>`
  return `${img(u || poster, name, '')}<div class="play"><span>▶</span></div>`
}

// Compact, self-contained payment badges (no external images — Shopify CSP safe).
const PAYICONS = `
<svg viewBox="0 0 48 30"><text x="24" y="20" text-anchor="middle" font-family="Arial" font-weight="bold" font-style="italic" font-size="13" fill="#1a1f71">VISA</text></svg>
<svg viewBox="0 0 48 30"><circle cx="21" cy="15" r="8" fill="#eb001b"/><circle cx="28" cy="15" r="8" fill="#f79e1b" fill-opacity=".85"/></svg>
<svg viewBox="0 0 48 30"><rect width="48" height="30" fill="#1f72cd"/><text x="24" y="19" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="9" fill="#fff">AMEX</text></svg>
<svg viewBox="0 0 48 30"><text x="24" y="19" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="9.5" fill="#003087">PayPal</text></svg>
<svg viewBox="0 0 48 30"><rect width="48" height="30" rx="4" fill="#5a31f4"/><text x="24" y="19" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="9" fill="#fff">Pay</text></svg>`

const CSS = `
/* Every rule scoped under .pgbld so nothing leaks into the merchant's theme (header/footer). */
.pgbld{--ink:#17151a;--body:#514e57;--muted:#8b8792;--line:#ece9ef;--paper:#f8f6fb;--accent:#d6248f;--accent2:#7b2ff7;--grad:linear-gradient(100deg,#d6248f,#7b2ff7);--dark:#1a1720;--good:#22a06b;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:100%;color:var(--body);font-family:var(--sans);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;padding-bottom:78px}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld b,.pgbld strong{color:var(--ink);font-weight:700}
.pgbld .wrap{max-width:1160px;margin:0 auto;padding:0 22px}
.main-page-title,.shopify-page-title,.template-page .page-title{display:none!important}
/* hero */
.pgbld .hero{display:grid;grid-template-columns:1fr 1fr;gap:46px;padding:34px 0 40px;align-items:start}
.pgbld .gallery{position:sticky;top:18px;display:flex;flex-direction:column;gap:12px}
.pgbld .gmain,.pgbld .gmain.ph{border-radius:20px;aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff);display:grid;place-items:center;color:#b06;font-weight:700}
.pgbld .thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pgbld .thumbs img,.pgbld .thumbs .ph{border-radius:12px;aspect-ratio:1/1;object-fit:cover;width:100%;border:1px solid var(--line)}
.pgbld .rpill{display:inline-flex;align-items:center;gap:8px;background:var(--grad);color:#fff;border-radius:100px;padding:5px 12px;font-size:13px;font-weight:700}
.pgbld .rpill .st{letter-spacing:1px}
.pgbld h1.ptitle{font-size:clamp(28px,3.6vw,40px);font-weight:800;line-height:1.08;letter-spacing:-.02em;color:var(--ink);margin:14px 0 6px}
.pgbld .newline{font-size:13.5px;font-weight:700;color:var(--accent);letter-spacing:.02em;margin:0 0 14px}
.pgbld .priceRow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 16px}
.pgbld .priceRow .now{font-size:30px;font-weight:800;color:var(--ink)}
.pgbld .priceRow .was{font-size:18px;color:var(--muted);text-decoration:line-through}
.pgbld .priceRow .save{background:var(--grad);color:#fff;font-weight:800;font-size:12.5px;padding:5px 12px;border-radius:8px}
.pgbld .pills{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 20px}
.pgbld .pill{display:flex;align-items:center;gap:8px;border:1.5px dashed #e2b7d5;border-radius:100px;padding:9px 14px;font-size:14px;font-weight:600;color:var(--ink)}
.pgbld .pill::before{content:"\\2713";width:18px;height:18px;border-radius:50%;background:linear-gradient(100deg,#fbeaf5,#efe6ff);color:var(--accent);font-size:11px;font-weight:800;display:grid;place-items:center;flex:none}
.pgbld .buyopt{border:1.5px solid var(--line);border-radius:16px;overflow:hidden;margin:0 0 12px}
.pgbld .buyopt .opt{padding:16px 18px;border-bottom:1px solid var(--line)}
.pgbld .buyopt .opt:last-child{border-bottom:0}
.pgbld .buyopt .opt.on{background:linear-gradient(100deg,#fbeaf5,#efe6ff);border-left:3px solid var(--accent)}
.pgbld .buyopt .ohead{display:flex;align-items:center;justify-content:space-between;font-weight:800;color:var(--ink);font-size:15.5px}
.pgbld .buyopt .otag{background:var(--grad);color:#fff;font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:6px}
.pgbld .buyopt .osub{font-size:13px;color:var(--muted);margin-top:3px}
.pgbld .buyopt .obul{list-style:none;padding:0;margin:12px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:6px}
.pgbld .buyopt .obul li{font-size:12.5px;color:var(--body);position:relative;padding-left:18px}
.pgbld .buyopt .obul li::before{content:"\\2713";position:absolute;left:0;color:var(--good);font-weight:800}
.pgbld a.buy{display:block;background:var(--dark);color:#fff;text-decoration:none;text-align:center;border-radius:12px;padding:17px;font-weight:800;font-size:17px}
.pgbld a.buy.grad{background:var(--grad);box-shadow:0 14px 30px -14px rgba(214,36,143,.6)}
.pgbld a.buy.big{max-width:520px;margin:8px auto 0}
.pgbld .social{text-align:center;font-size:13px;color:var(--muted);margin-top:12px}
/* payment icons */
.pgbld .pay{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin:12px 0 2px}
.pgbld .pay svg{height:24px;width:auto;border-radius:4px;border:1px solid var(--line);background:#fff}
/* product-info accordions (native details/summary) */
.pgbld .acc{margin:14px 0 0;border-top:1px solid var(--line)}
.pgbld .acc details{border-bottom:1px solid var(--line)}
.pgbld .acc summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:15px 2px;font-weight:800;color:var(--ink);font-size:15px}
.pgbld .acc summary::-webkit-details-marker{display:none}
.pgbld .acc summary::after{content:"+";font-size:20px;font-weight:700;color:var(--muted)}
.pgbld .acc details[open] summary::after{content:"\\2013"}
.pgbld .acc .body{padding:0 2px 16px;font-size:14px;color:var(--body)}
/* UGC video wall */
.pgbld .ugc{padding:44px 0 8px}
.pgbld .ugc .top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.pgbld .ugc .top h2{font-size:clamp(22px,2.6vw,30px);font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:0;text-align:left}
.pgbld .ugc .socials{display:flex;gap:12px;font-size:20px}
.pgbld .ugc .wall{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}
.pgbld .ugc .vc{position:relative;border-radius:16px;overflow:hidden;aspect-ratio:9/16;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff)}
.pgbld .ugc .vc img,.pgbld .ugc .vc video{width:100%;height:100%;object-fit:cover;display:block}
.pgbld .ugc .vc .play{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.pgbld .ugc .vc .play span{width:48px;height:48px;border-radius:50%;background:rgba(0,0,0,.5);color:#fff;display:grid;place-items:center;font-size:18px;backdrop-filter:blur(2px)}
/* trust row */
.pgbld .trust{display:flex;flex-wrap:wrap;justify-content:center;gap:12px 44px;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:18px 22px;background:var(--paper)}
.pgbld .trust .ti{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:700;color:var(--ink)}
/* marquee */
.pgbld .marq{overflow:hidden;background:var(--dark);color:#fff;padding:12px 0;white-space:nowrap}
.pgbld .marq-track{display:inline-block;animation:pgbldmarq 22s linear infinite;font-size:13.5px;font-weight:700;letter-spacing:.02em}
.pgbld .marq-track span{margin:0 26px}
@keyframes pgbldmarq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
/* section shells */
.pgbld h2.sec{font-size:clamp(24px,3vw,34px);font-weight:800;letter-spacing:-.02em;color:var(--ink);text-align:center;margin:0 0 8px}
.pgbld .seclead{text-align:center;color:var(--muted);font-size:16px;max-width:640px;margin:0 auto 26px}
.pgbld .feat{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center;padding:48px 0}
.pgbld .feat:nth-of-type(even) .fimg{order:2}
.pgbld .fimg,.pgbld .fimg.ph{border-radius:20px;aspect-ratio:4/3;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff)}
.pgbld .feat h2{font-size:clamp(22px,2.6vw,30px);font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:0 0 12px;text-align:left}
.pgbld .fbul{list-style:none;padding:0;margin:16px 0 0;display:flex;flex-direction:column;gap:10px}
.pgbld .fbul li{position:relative;padding-left:30px;font-size:15px}
.pgbld .fbul li::before{content:"\\2713";position:absolute;left:0;top:1px;width:20px;height:20px;border-radius:50%;background:#eafaf2;color:var(--good);font-size:11px;font-weight:800;display:grid;place-items:center}
.pgbld .seen{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-top:20px;opacity:.55;font-weight:800;color:var(--muted)}
/* stats */
.pgbld .stats{background:var(--paper);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:48px 0}
.pgbld .statgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;max-width:900px;margin:22px auto 0}
.pgbld .stat{text-align:center}
.pgbld .stat .n{font-size:44px;font-weight:800;background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;line-height:1}
.pgbld .stat .t{font-weight:800;color:var(--ink);margin:8px 0 3px;font-size:16px}
.pgbld .stat .s{font-size:13.5px;color:var(--muted)}
/* benefits grid */
.pgbld .bgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:20px 0 4px}
.pgbld .bcard{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px 18px;text-align:center}
.pgbld .bcard .ic{width:44px;height:44px;border-radius:12px;background:linear-gradient(100deg,#fbeaf5,#efe6ff);display:grid;place-items:center;margin:0 auto 12px;font-size:20px}
.pgbld .bcard .bt{font-weight:800;color:var(--ink);font-size:15px}
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
/* gradient testimonial carousel */
.pgbld .gcar{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 4px 20px;-webkit-overflow-scrolling:touch}
.pgbld .gcard{scroll-snap-align:start;flex:0 0 360px;max-width:86%;background:var(--grad);color:#fff;border-radius:18px;padding:22px;display:flex;gap:14px;align-items:flex-start}
.pgbld .gcard .av{width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.22);flex:none;display:grid;place-items:center;font-weight:800;font-size:17px}
.pgbld .gcard .st{color:#ffe08a;font-size:13px}
.pgbld .gcard .rt{font-weight:800;margin:2px 0 6px;font-size:16px}
.pgbld .gcard p{margin:0;font-size:14px;color:rgba(255,255,255,.92);line-height:1.55}
.pgbld .gcard .who{font-weight:800;margin-top:10px;font-size:13px;color:rgba(255,255,255,.85)}
/* reviews grid */
.pgbld .revs{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:24px 0}
.pgbld .rev{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px}
.pgbld .rev .st{color:#f4b400;font-size:13px;margin-bottom:8px}
.pgbld .rev .rt{font-weight:800;color:var(--ink);font-size:15px;margin-bottom:6px}
.pgbld .rev p{margin:0 0 10px;font-size:13.5px}
.pgbld .rev .who{font-size:12.5px;color:var(--muted);font-weight:700}
/* transform trio */
.pgbld .trio{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;padding:20px 0}
.pgbld .tcard{text-align:center;padding:24px 18px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}
.pgbld .tcard .lab{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--accent)}
.pgbld .tcard h3{font-size:18px;font-weight:800;color:var(--ink);margin:8px 0 6px}
.pgbld .tcard p{margin:0;font-size:14px}
/* faq */
.pgbld .faq{max-width:760px;margin:0 auto;padding:8px 0}
.pgbld .faq .q{font-weight:800;color:var(--ink);font-size:16.5px;margin:18px 0 4px}
.pgbld .faq .a{margin:0}
/* float bar */
.pgbld .floatcta{position:fixed;left:0;right:0;bottom:0;z-index:60;background:#fff;border-top:1px solid var(--line);box-shadow:0 -8px 24px -10px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px max(18px,calc((100% - 1160px)/2 + 22px));transition:transform .28s ease}
.pgbld .floatcta.hide{transform:translateY(115%)}
.pgbld .fc-info{display:flex;align-items:center;gap:12px;min-width:0}
.pgbld .fc-thumb{width:44px;height:44px;border-radius:9px;flex:none;object-fit:cover}
.pgbld .fc-name{font-weight:700;color:var(--ink);font-size:15px;min-width:0;line-height:1.25}
.pgbld .fc-btn{background:var(--grad);color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:13px 26px;border-radius:10px;white-space:nowrap;flex:none}
@media(max-width:880px){.pgbld .hero{grid-template-columns:1fr;gap:24px}.pgbld .gallery{position:static}.pgbld .feat{grid-template-columns:1fr;gap:22px;padding:32px 0}.pgbld .feat:nth-of-type(even) .fimg{order:0}.pgbld .statgrid{grid-template-columns:1fr}.pgbld .bgrid{grid-template-columns:1fr 1fr}.pgbld .revs{grid-template-columns:1fr 1fr}.pgbld .trio{grid-template-columns:1fr}.pgbld .ugc .wall{grid-template-columns:repeat(3,1fr)}}
@media(max-width:560px){.pgbld .pills{grid-template-columns:1fr}.pgbld .bgrid{grid-template-columns:1fr}.pgbld .revs{grid-template-columns:1fr}.pgbld .cmp .ch,.pgbld .cmp .cr{grid-template-columns:1fr 70px 70px}.pgbld .fc-name{font-size:13.5px}.pgbld .fc-btn{padding:12px 18px;font-size:15px}}
`

function render(c: FilledContent, o: RenderOpts): string {
  const stars = '★★★★★'
  const pills = arr(c.benefit_pills).slice(0, 4).map((p) => `<div class="pill">${escp(p.label)}</div>`).join('')
  const subBul = arr(c.subscribe_perks).map((p) => `<li>${escp(p.label)}</li>`).join('')
  const trust = arr(c.trust_row).map((t) => `<div class="ti">✓ ${escp(t.label)}</div>`).join('')
  const marqOne = `<span>${arr(c.marquee_items).map((m) => escp(m.label)).join('</span><span>')}</span>`
  const f1bul = arr(c.feature_1_bullets).map((b) => `<li><strong>${escp(b.label)}</strong>${b.body ? ' — ' + escp(b.body) : ''}</li>`).join('')
  const f2bul = arr(c.feature_2_bullets).map((b) => `<li><strong>${escp(b.label)}</strong>${b.body ? ' — ' + escp(b.body) : ''}</li>`).join('')
  const stats = arr(c.stats).map((s) => `<div class="stat"><div class="n">${esc(s.label)}</div><div class="t">${esc(s.title)}</div><div class="s">${esc(s.body)}</div></div>`).join('')
  const bene = arr(c.benefit_items).map((b) => `<div class="bcard"><div class="ic">${esc((b as any).emoji || '✦')}</div><div class="bt">${escp(b.label)}</div></div>`).join('')
  const cmpRows = arr(c.compare_rows).map((r) => `<div class="cr"><div>${escp(r.label)}</div><div class="us"><span class="yes">✓</span></div><div><span class="no">✕</span></div></div>`).join('')
  const revs = arr(c.testimonials).map((t) => `<div class="gcard"><div class="av">${esc(String(t.name || 'A').trim().charAt(0).toUpperCase() || 'A')}</div><div><div class="st">${stars}</div><div class="rt">${esc((t as any).title || t.city || 'Verified review')}</div><p>${esc(t.quote)}</p><div class="who">${esc(t.name)}</div></div></div>`).join('')
  const trio = arr(c.transform_items).map((t, i) => `<div class="tcard"><div class="lab">${esc((t as any).lab || ['First','Second','Third'][i] || 'Benefit')} benefit</div><h3>${esc(t.title || t.label)}</h3><p>${esc(t.body)}</p></div>`).join('')
  const faqs = arr(c.faqs).map((f) => `<div><div class="q">${esc(f.q)}</div><p class="a">${esc(f.a)}</p></div>`).join('')

  return `
  <div class="pgbld">
  <div class="wrap">
    <div class="hero">
      <div class="gallery">
        ${img(c.image_main || o.productImage, o.productName, 'gmain', 'Product')}
        <div class="thumbs">${img(c.image_main || o.productImage, o.productName, '')}${img(c.image_g2 || o.productImage, o.productName, '')}${img(c.image_g3 || o.productImage, o.productName, '')}${img(c.image_g4 || o.productImage, o.productName, '')}</div>
      </div>
      <div class="buybox">
        <div class="rpill"><span class="st">${stars}</span> ${esc(o.rating?.countLabel || '4.8 | 12,000+ Customers')}</div>
        <h1 class="ptitle">${esc(c.headline || o.productName)}</h1>
        <div class="newline">${esc(c.new_line || 'NEW')}</div>
        <div class="priceRow"><span class="now">${esc(o.priceLabel || '$49.99')}</span>${c.compare_at ? `<span class="was">${esc(c.compare_at)}</span>` : ''}${c.save_pill ? `<span class="save">${esc(c.save_pill)}</span>` : ''}</div>
        <div class="pills">${pills}</div>
        <div class="buyopt">
          <div class="opt on">
            <div class="ohead">${esc(c.subscribe_label || 'Subscribe & Save 20%')} <span class="otag">BEST VALUE</span></div>
            <div class="osub">${esc(c.subscribe_sub || 'Delivered every 30 days · cancel anytime')}</div>
            <ul class="obul">${subBul}</ul>
          </div>
          <div class="opt">
            <div class="ohead">${esc(c.onetime_label || 'One-time purchase')}</div>
            <div class="osub">${esc(c.onetime_sub || 'Get it one time')}</div>
          </div>
        </div>
        <a class="buy grad" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Add to cart')}</a>
        <div class="pay">${PAYICONS}</div>
        <div class="social">${esc(c.social_line || 'Loved by thousands of happy customers')}</div>
        <div class="acc">
          <details open><summary>How to use</summary><div class="body">${esc(c.howto_body)}</div></details>
          <details><summary>Shipping &amp; delivery</summary><div class="body">${esc(c.shipping_body)}</div></details>
          <details><summary>Returns &amp; refunds</summary><div class="body">${esc(c.returns_body)}</div></details>
        </div>
      </div>
    </div>
  </div>

  <div class="trust">${trust}</div>
  <div class="marq"><div class="marq-track">${marqOne}${marqOne}</div></div>

  <div class="wrap"><div class="ugc">
    <div class="top"><h2>${esc(c.ugc_head || 'What our customers think')}</h2><div class="socials">📷 🎵 ▶️ 📌</div></div>
    <div class="wall">
      ${[c.image_ugc1, c.image_ugc2, c.image_ugc3, c.image_ugc4, c.image_ugc5].map((u) => `<div class="vc">${mediaCard(u, o.productImage, o.productName)}</div>`).join('')}
    </div>
  </div></div>

  <div class="wrap">
    <section class="feat">
      ${img(c.image_feature_1, o.productName, 'fimg', 'Lifestyle')}
      <div>
        <h2>${esc(c.feature_1_head)}</h2>
        ${rt(c.feature_1_body)}
        <ul class="fbul">${f1bul}</ul>
        <div class="seen">${esc(c.as_seen_on || 'As seen on')} <span>FORBES</span><span>VOGUE</span><span>ELLE</span></div>
      </div>
    </section>
    <section class="feat">
      ${img(c.image_feature_2, o.productName, 'fimg', 'In use')}
      <div>
        <h2>${esc(c.feature_2_head)}</h2>
        ${rt(c.feature_2_body)}
        <ul class="fbul">${f2bul}</ul>
        <a class="buy grad" style="max-width:220px;margin-top:20px" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Add to cart')}</a>
      </div>
    </section>
  </div>

  <div class="stats"><div class="wrap">
    <h2 class="sec">${esc(c.stats_head || 'The reason customers choose us again and again')}</h2>
    <p class="seclead">${esc(c.stats_sub)}</p>
    <div class="statgrid">${stats}</div>
  </div></div>

  <div class="wrap">
    <h2 class="sec" style="margin-top:48px">${esc(c.benefits_head || 'Benefits you\'ll love')}</h2>
    <div class="bgrid">${bene}</div>

    <h2 class="sec" style="margin-top:52px">${esc(c.compare_head || 'What makes us different')}</h2>
    <p class="seclead">${esc(c.compare_body)}</p>
    <div class="cmp">
      <div class="ch"><div>&nbsp;</div><div>${esc(o.productName).split(' ')[0] || 'Us'}</div><div>Others</div></div>
      ${cmpRows}
    </div>

    <h2 class="sec" style="margin-top:52px">${esc(c.reviews_head || 'Join 10,000+ happy customers')}</h2>
    <div class="gcar">${revs}</div>

    <h2 class="sec" style="margin-top:44px">${esc(c.transform_head || 'How this will transform your day')}</h2>
    <div class="trio">${trio}</div>

    <h2 class="sec" style="margin-top:52px">Frequently asked questions</h2>
    <p class="seclead">${esc(c.faq_sub || 'Quick answers to the most common questions.')}</p>
    <div class="faq">${faqs}</div>

    <a class="buy grad big" style="margin-top:34px" href="${esc(o.ctaHref)}">${esc(c.final_cta || `Get ${o.productName}`)}</a>
  </div>

  <div class="floatcta" id="floatcta">
    <div class="fc-info">${img(o.productImage, o.productName, 'fc-thumb')}<span class="fc-name">${esc(o.productName)}${o.priceLabel ? ' · <b>' + esc(o.priceLabel) + '</b>' : ''}</span></div>
    <a class="fc-btn" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Add to cart')}</a>
  </div>
  </div>
  <script>(function(){var fc=document.getElementById('floatcta');function t(){if(fc)fc.classList.toggle('hide',window.scrollY<560)}window.addEventListener('scroll',t,{passive:true});t();})();</script>`
}

export const productV1: PageTemplate = {
  id: 'product_v1',
  type: 'product',
  name: 'Product page',
  description: 'A full PDP: gallery + buy-box (rating, sale price, benefit pills, subscribe/one-time), trust row, feature blocks, stats, benefits grid, comparison, reviews, and FAQ.',
  thumbnail: '/builder/thumb-product.png',
  css: CSS,
  render,
  schema: [
    { key: 'headline', type: 'text', role: 'headline', label: 'Product headline', hint: 'A benefit-led product title, ~4-8 words.' },
    { key: 'new_line', type: 'text', label: 'NEW line', hint: 'A short "NEW: <promise>" style line above the price.' },
    { key: 'save_pill', type: 'text', label: 'Save pill', hint: 'e.g. "50% off · Save $50". Optional.' },
    { key: 'compare_at', type: 'text', label: 'Compare-at price', hint: 'The struck-through original price, e.g. "$99.99". Optional.' },
    { key: 'benefit_pills', type: 'list', label: 'Benefit pills', count: 4, hint: 'Each: a 2-3 word benefit (label only).' },
    { key: 'cta_label', type: 'text', label: 'Button label', hint: 'e.g. "Add to cart".' },
    { key: 'subscribe_label', type: 'text', label: 'Subscribe option title', hint: 'e.g. "Subscribe & Save 20%".' },
    { key: 'subscribe_sub', type: 'text', label: 'Subscribe subtitle' },
    { key: 'subscribe_perks', type: 'list', label: 'Subscribe perks', count: 4, hint: 'Each: short perk (label only), e.g. "Free shipping".' },
    { key: 'onetime_label', type: 'text', label: 'One-time option title' },
    { key: 'onetime_sub', type: 'text', label: 'One-time subtitle' },
    { key: 'social_line', type: 'text', label: 'Social proof line', hint: 'e.g. "Sarah and 400+ people purchased today".' },
    { key: 'howto_body', type: 'text', label: 'How to use', hint: '1-2 sentences on how to use the product.' },
    { key: 'shipping_body', type: 'text', label: 'Shipping & delivery', hint: '1-2 sentences on shipping times/tracking.' },
    { key: 'returns_body', type: 'text', label: 'Returns & refunds', hint: '1-2 sentences on the returns policy.' },
    { key: 'ugc_head', type: 'text', label: 'Video wall heading', hint: 'e.g. "What our customers think".' },
    { key: 'image_ugc1', type: 'video', label: 'Customer video 1' },
    { key: 'image_ugc2', type: 'video', label: 'Customer video 2' },
    { key: 'image_ugc3', type: 'video', label: 'Customer video 3' },
    { key: 'image_ugc4', type: 'video', label: 'Customer video 4' },
    { key: 'image_ugc5', type: 'video', label: 'Customer video 5' },
    { key: 'image_main', type: 'image', role: 'product', label: 'Main product image' },
    { key: 'image_g2', type: 'image', role: 'product', label: 'Gallery image 2' },
    { key: 'image_g3', type: 'image', role: 'product', label: 'Gallery image 3' },
    { key: 'image_g4', type: 'image', role: 'lifestyle', label: 'Gallery image 4' },
    { key: 'trust_row', type: 'list', label: 'Trust row', count: 3, hint: 'Each label only: e.g. "Safe payment", "Free shipping", "Fast delivery".' },
    { key: 'marquee_items', type: 'list', label: 'Marquee phrases', count: 4, hint: 'Each label only: short scrolling promo lines (with an emoji).' },
    { key: 'feature_1_head', type: 'text', label: 'Feature 1 heading' },
    { key: 'feature_1_body', type: 'richtext', role: 'body', label: 'Feature 1 body' },
    { key: 'feature_1_bullets', type: 'list', label: 'Feature 1 bullets', count: 3, hint: 'Each: bold benefit + short line.' },
    { key: 'as_seen_on', type: 'text', label: '"As seen on" label' },
    { key: 'image_feature_1', type: 'image', role: 'editorial', label: 'Feature 1 image' },
    { key: 'feature_2_head', type: 'text', label: 'Feature 2 heading' },
    { key: 'feature_2_body', type: 'richtext', role: 'body', label: 'Feature 2 body' },
    { key: 'feature_2_bullets', type: 'list', label: 'Feature 2 bullets', count: 4, hint: 'Each: bold benefit + short line.' },
    { key: 'image_feature_2', type: 'image', role: 'lifestyle', label: 'Feature 2 image' },
    { key: 'stats_head', type: 'text', label: 'Stats heading' },
    { key: 'stats_sub', type: 'text', label: 'Stats subheading' },
    { key: 'stats', type: 'reasons', label: 'Stats', count: 3, hint: 'label = a percentage like "92%"; title = what improved; body = timeframe/context.' },
    { key: 'benefits_head', type: 'text', label: 'Benefits heading' },
    { key: 'benefit_items', type: 'list', label: 'Benefits grid', count: 4, hint: 'Each label only: e.g. "Worldwide shipping", "24/7 support".' },
    { key: 'compare_head', type: 'text', label: 'Comparison heading' },
    { key: 'compare_body', type: 'text', label: 'Comparison intro' },
    { key: 'compare_rows', type: 'list', label: 'Comparison rows', count: 5, hint: 'Each label only: a feature the product has and rivals don\'t (e.g. "Probiotic", "Non-GMO", "Vegan").' },
    { key: 'reviews_head', type: 'text', label: 'Reviews heading' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews', count: 4, hint: 'name, city, quote. Use the "city" field as a SHORT review title.' },
    { key: 'transform_head', type: 'text', label: 'Transform heading' },
    { key: 'transform_items', type: 'reasons', label: 'Transform trio', count: 3, hint: 'label = 1-2 word tag; title = benefit; body = one sentence.' },
    { key: 'faq_sub', type: 'text', label: 'FAQ subheading' },
    { key: 'faqs', type: 'faq', label: 'FAQ', count: 5, hint: 'Cover results time, safety, usage, shipping, returns.' },
    { key: 'final_cta', type: 'text', label: 'Final button label' },
  ],
}
