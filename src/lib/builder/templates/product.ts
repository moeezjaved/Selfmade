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

// Heading with a **highlighted** phrase → accent-colored span (Atlas two-tone headings).
const hl = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<span class="hl">$1</span>')

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
.pgbld{--ink:#17151a;--body:#514e57;--muted:#8b8792;--line:#ece9ef;--paper:#f8f6fb;--accent:#d6248f;--accent2:#7b2ff7;--grad:linear-gradient(100deg,#d6248f,#7b2ff7);--dark:#1a1720;--good:#22a06b;--sans:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--head:'Hanken Grotesk','Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;width:100%;color:var(--body);font-family:var(--sans);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;padding-bottom:78px}
.pgbld *{box-sizing:border-box}
.pgbld h1,.pgbld h2,.pgbld h3,.pgbld .sec,.pgbld h1.ptitle{font-family:var(--head)}
.pgbld img{max-width:100%;display:block}
.pgbld b,.pgbld strong{color:var(--ink);font-weight:700}
.pgbld .wrap{max-width:1160px;margin:0 auto;padding:0 22px}
.main-page-title,.shopify-page-title,.template-page .page-title{display:none!important}
/* hero */
.pgbld .hero{display:grid;grid-template-columns:1fr 1fr;gap:46px;padding:34px 0 40px;align-items:start}
.pgbld .gallery{position:sticky;top:18px;display:flex;flex-direction:column;gap:12px}
.pgbld .gtrack{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;border-radius:20px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.pgbld .gtrack::-webkit-scrollbar{display:none}
.pgbld .gslide{flex:0 0 100%;scroll-snap-align:start;aspect-ratio:1/1;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff)}
.pgbld .gslide .gimg,.pgbld .gslide .gimg.ph{width:100%;height:100%;object-fit:cover;border-radius:20px;display:grid;place-items:center;color:#b06;font-weight:700}
.pgbld .gslide video,.pgbld .gslide model-viewer,.pgbld .gslide iframe{width:100%;height:100%;object-fit:cover;border-radius:20px;border:0;display:block;background:#000}
.pgbld .gthumb{position:relative}
.pgbld .gbadge{position:absolute;top:5px;left:5px;z-index:1;background:rgba(20,18,15,.72);color:#fff;font-size:9px;font-weight:800;line-height:1;padding:3px 5px;border-radius:5px}
.gzoom{position:fixed;inset:0;z-index:100001;background:rgba(20,18,15,.92);display:grid;place-items:center;padding:24px;cursor:zoom-out;animation:sfzin .18s ease}
.gzoom img{max-width:min(1000px,94vw);max-height:92vh;object-fit:contain;border-radius:12px}
@keyframes sfzin{from{opacity:0}to{opacity:1}}
.pgbld .gdots{display:flex;gap:7px;justify-content:center;margin-top:2px}
.pgbld .gdot{width:8px;height:8px;border-radius:50%;background:var(--line);transition:width .2s,background .2s}
.pgbld .gdot.on{background:var(--accent);width:22px;border-radius:5px}
.pgbld .gwrap{position:relative}
.pgbld .garr{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.92);border:1px solid var(--line);display:grid;place-items:center;font-size:22px;color:var(--ink);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.14);z-index:2;line-height:1;padding:0}
.pgbld .gprev{left:12px}
.pgbld .gnext{right:12px}
.pgbld .thumbs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pgbld .gthumb{border:1.5px solid var(--line);border-radius:12px;overflow:hidden;padding:0;background:none;cursor:pointer;aspect-ratio:1/1}
.pgbld .gthumb.on{border-color:var(--accent)}
.pgbld .gthumb img,.pgbld .gthumb .ph{width:100%;height:100%;object-fit:cover}
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
.pgbld .buy{display:block;width:100%;background:var(--dark);color:#fff;text-decoration:none;text-align:center;border:0;cursor:pointer;font-family:inherit;border-radius:12px;padding:17px;font-weight:800;font-size:17px}
.pgbld .buy.grad{background:var(--grad);box-shadow:0 14px 30px -14px rgba(214,36,143,.6)}
.pgbld .buy.big{max-width:520px;margin:8px auto 0}
.pgbld .sf-iconimg{width:1.35em;height:1.35em;object-fit:contain;vertical-align:middle;display:inline-block}
/* Shopify's dynamic-checkout button ({{ form | payment_button }} — "Buy it now" / Shop Pay). Without this
   it renders at the theme's tiny default; force it full-width and match the Add-to-cart button. */
.pgbld .sf-dyncheckout{margin-top:10px;width:100%}
.pgbld .sf-dyncheckout .shopify-payment-button{width:100%}
.pgbld .sf-dyncheckout .shopify-payment-button__button,.pgbld .sf-dyncheckout .shopify-payment-button__button--unbranded,.pgbld .sf-dyncheckout [role=button]{width:100%!important;min-height:54px!important;height:auto!important;border-radius:12px!important;font-family:inherit!important;font-weight:800!important;font-size:16.5px!important}
.pgbld .sf-dyncheckout .shopify-payment-button__more-options{margin-top:6px;font-size:13px}
/* native-style variant picker (pills + colour swatches) */
.pgbld .sf-optrow{margin:0 0 13px}
.pgbld .sf-optname{font-size:13px;font-weight:700;color:var(--ink);margin:0 0 7px}
.pgbld .sf-optname b{font-weight:800}
.pgbld .sf-optvals{display:flex;flex-wrap:wrap;gap:8px}
.pgbld .sf-pill{border:1.5px solid var(--line);background:#fff;color:var(--ink);border-radius:10px;padding:9px 15px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:8px;transition:border-color .12s,box-shadow .12s}
.pgbld .sf-pill:hover{border-color:var(--ink)}
.pgbld .sf-pill.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.pgbld .sf-pill.sf-soldout{opacity:.4;text-decoration:line-through}
.pgbld .sf-pill.sf-soldout.on{opacity:.65}
.pgbld .sf-pill.sf-color{padding:7px 14px 7px 8px}
.pgbld .sf-dot{width:18px;height:18px;border-radius:50%;border:1px solid rgba(0,0,0,.14);flex:none;background:#e7e4ee}
.pgbld .social{text-align:center;font-size:13px;color:var(--muted);margin-top:12px}
.pgbld .pdetails{border-top:1px solid var(--line);margin-top:16px}
.pgbld .pdetails summary{cursor:pointer;list-style:none;padding:14px 0;font-weight:800;color:var(--ink);font-size:14.5px;display:flex;justify-content:space-between;align-items:center}
.pgbld .pdetails summary::-webkit-details-marker{display:none}
.pgbld .pdetails summary::after{content:"+";color:var(--muted);font-weight:700;font-size:18px}
.pgbld .pdetails[open] summary::after{content:"\\2212"}
.pgbld .pdesc{padding:0 0 16px;color:var(--body);font-size:14px;line-height:1.65}
.pgbld .pdesc:empty{display:none}
/* recommendations */
.pgbld .sf-recs{padding:8px 0}
.pgbld .sf-recs-h{font-size:clamp(22px,3vw,32px);font-weight:800;letter-spacing:-.02em;color:var(--ink);text-align:center;margin:0 0 22px}
.pgbld .sf-recs-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.pgbld .sf-rec{display:flex;flex-direction:column;text-decoration:none;color:inherit}
.pgbld .sf-rec-img{aspect-ratio:1/1;border-radius:14px;overflow:hidden;background:var(--paper);display:block;margin-bottom:10px}
.pgbld .sf-rec-img img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s}
.pgbld .sf-rec:hover .sf-rec-img img{transform:scale(1.04)}
.pgbld .sf-rec-t{font-size:14px;font-weight:700;color:var(--ink);line-height:1.3}
.pgbld .sf-rec-p{font-size:14px;color:var(--body);margin-top:3px}
.pgbld .sf-rec-p del{color:var(--muted);margin-right:4px}
@media(max-width:880px){.pgbld .sf-recs-grid{grid-template-columns:1fr 1fr}}
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
.pgbld .frev{margin-top:20px;background:var(--grad);color:#fff;border-radius:18px;padding:22px 24px;display:grid;grid-template-columns:200px 1fr;gap:24px;align-items:center}
.pgbld .frev .who{display:flex;align-items:center;gap:14px}
.pgbld .frev .av{width:56px;height:56px;border-radius:50%;overflow:hidden;border:2px solid rgba(255,255,255,.5);flex:none}
.pgbld .frev .av img,.pgbld .frev .av .ph{width:100%;height:100%;object-fit:cover}
.pgbld .frev .nm{font-weight:800;font-size:16px;display:flex;align-items:center;gap:6px}
.pgbld .frev .chk{width:16px;height:16px;border-radius:50%;background:#fff;color:var(--accent);font-size:10px;font-weight:800;display:inline-grid;place-items:center}
.pgbld .frev .loc{font-size:13px;color:rgba(255,255,255,.85)}
.pgbld .frev .st{color:#ffd24a;font-size:14px;margin-top:2px}
.pgbld .frev .q{font-size:15px;line-height:1.55;color:rgba(255,255,255,.95)}
/* trust + UGC live INSIDE the buy-box column (Atlas placement) — compact them */
.pgbld .buybox .trust{justify-content:space-between;gap:10px;padding:14px 0;margin-top:16px;background:none}
.pgbld .buybox .ugc{padding:22px 0 4px}
.pgbld .buybox .ugc .top h2{font-size:20px}
.pgbld .buybox .frev{grid-template-columns:1fr;gap:12px;padding:18px 20px}
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
.pgbld .feat{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;padding:66px 0}
.pgbld .feat.rev .fimg{order:2}
/* as seen on band */
.pgbld .seenband{padding:46px 0 34px;text-align:center}
.pgbld .seenband h2{font-size:clamp(26px,3.4vw,40px);font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:0}
.pgbld .logos{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:20px 48px;margin-top:26px}
.pgbld .logos span{font-weight:800;font-size:24px;letter-spacing:.06em;color:#c7c3cf;text-transform:uppercase}
.pgbld .logos img.plogo{height:34px;width:auto;max-width:150px;object-fit:contain;filter:grayscale(1);opacity:.72}
/* pink gradient CTA band */
.pgbld .pinkband{background:var(--grad);color:#fff;padding:60px 0 64px;margin:26px 0;text-align:center}
.pgbld .pinkband h2{font-size:clamp(28px,3.6vw,42px);font-weight:800;letter-spacing:-.02em;color:#fff;margin:0 0 12px}
.pgbld .pinkband p{font-size:17px;color:rgba(255,255,255,.92);max-width:660px;margin:0 auto 26px}
.pgbld .pinkband .bag{display:inline-block;background:var(--dark);color:#fff;text-decoration:none;border:0;cursor:pointer;font-family:inherit;border-radius:12px;padding:16px 40px;font-weight:800;font-size:17px}
.pgbld .pcards{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:36px}
.pgbld .pcard{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);border-radius:16px;padding:24px 18px;font-size:15px;font-weight:600;text-align:center;color:#fff}
/* comparison on a gradient band (Atlas 'what makes us different') */
.pgbld .cmpband{background:var(--grad);color:#fff;padding:56px 0;margin:26px 0}
.pgbld .cmpband .in{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .cmpband h2{font-size:clamp(26px,3.4vw,40px);font-weight:800;letter-spacing:-.02em;color:#fff;margin:0 0 14px;text-align:left}
.pgbld .cmpband h2 .hl{color:#fff;font-style:italic;opacity:.85}
.pgbld .cmpband p{color:rgba(255,255,255,.9);font-size:16px;margin:0 0 22px}
.pgbld .cmpband .bag{display:inline-block;background:var(--dark);color:#fff;text-decoration:none;border:0;cursor:pointer;font-family:inherit;border-radius:12px;padding:15px 40px;font-weight:800;font-size:16px}
.pgbld .ctab{position:relative}
.pgbld .ctab .ch2{display:grid;grid-template-columns:1fr 96px 96px;margin-bottom:4px}
.pgbld .ctab .ch2>div{text-align:center;font-weight:800;font-size:15px;padding:6px 0}
.pgbld .ctab .cr2{display:grid;grid-template-columns:1fr 96px 96px;align-items:center;padding:12px 0;border-top:1px solid rgba(255,255,255,.18)}
.pgbld .ctab .cr2 .lab{display:flex;align-items:center;gap:12px;font-weight:600}
.pgbld .ctab .cr2 .lab::before{content:"\\2713";width:22px;height:22px;border-radius:50%;background:#fff;color:var(--accent);font-weight:800;font-size:12px;display:grid;place-items:center;flex:none}
.pgbld .ctab .cr2 .yes,.pgbld .ctab .cr2 .no{text-align:center;font-size:16px;font-weight:800}
.pgbld .ctab .usbox{position:absolute;top:0;bottom:0;right:96px;width:96px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);border-radius:16px;pointer-events:none}
.pgbld .fimg,.pgbld .fimg.ph{border-radius:24px;aspect-ratio:1/1;object-fit:cover;width:100%;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff)}
.pgbld .feat h2{font-size:clamp(28px,3.8vw,46px);font-weight:800;letter-spacing:-.02em;color:var(--ink);margin:0 0 16px;text-align:left;line-height:1.05}
.pgbld .feat h2 .hl{color:var(--accent2)}
.pgbld .fbul{list-style:none;padding:0;margin:18px 0 0;display:flex;flex-direction:column;gap:14px}
.pgbld .fbul li{position:relative;padding-left:32px;font-size:15.5px}
.pgbld .fbul li::before{content:"\\2713";position:absolute;left:0;top:0;width:21px;height:21px;border-radius:50%;background:linear-gradient(100deg,#fbeaf5,#efe6ff);color:var(--accent);font-size:11px;font-weight:800;display:grid;place-items:center;border:1px dashed #e2b7d5}
.pgbld .seen{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-top:20px;opacity:.55;font-weight:800;color:var(--muted)}
/* stats */
.pgbld .stats{background:var(--paper);border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:48px 0}
.pgbld .statgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;max-width:900px;margin:22px auto 0}
.pgbld .stats .sin{display:grid;grid-template-columns:.9fr 1.05fr .9fr;gap:34px;align-items:center;padding-top:8px}
.pgbld .stats .scard{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;background:var(--grad);color:#fff;border-radius:16px;padding:16px}
.pgbld .stats .scard .simg,.pgbld .stats .scard .simg.ph{width:56px;height:56px;border-radius:10px;object-fit:cover}
.pgbld .stats .scard .sct{font-weight:800;font-size:16px}
.pgbld .stats .scard .scs{font-size:13px;color:rgba(255,255,255,.85)}
.pgbld .stats .smid .simg2,.pgbld .stats .smid .simg2.ph{border-radius:20px;aspect-ratio:4/5;object-fit:cover;width:100%}
.pgbld .stats .srow{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;padding:18px 0;border-top:1px solid var(--line)}
.pgbld .stats .srow:first-child{border-top:0}
.pgbld .stats .srow .n{font-size:38px;font-weight:800;background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;line-height:1}
.pgbld .stats .srow .t{font-weight:800;color:var(--ink);font-size:17px}
.pgbld .stats .srow .s{font-size:13px;color:var(--muted)}
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
/* photo testimonial carousel */
.pgbld .gcar{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;padding:6px 4px 20px;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.pgbld .gcar::-webkit-scrollbar{display:none}
.pgbld .rcard{scroll-snap-align:start;flex:0 0 320px;max-width:82%;position:relative;border-radius:18px;overflow:hidden;aspect-ratio:3/4;background:radial-gradient(120% 120% at 55% 30%,#fde4f2,#e9d4ff)}
.pgbld .rcard .rimg,.pgbld .rcard .rimg.ph{width:100%;height:100%;object-fit:cover}
.pgbld .rcard .rov{position:absolute;left:0;right:0;bottom:0;padding:22px 18px 18px;background:linear-gradient(to top,rgba(24,23,32,.94),rgba(24,23,32,.55) 55%,transparent);color:#fff}
.pgbld .rcard .st{color:#ffd24a;font-size:14px;margin-bottom:6px}
.pgbld .rcard .rtt{font-weight:800;font-size:16px;margin-bottom:6px}
.pgbld .rcard p{margin:0 0 8px;font-size:13.5px;color:rgba(255,255,255,.94);line-height:1.5}
.pgbld .rcard .rwho{font-size:12.5px;font-weight:700;color:rgba(255,255,255,.82)}
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
/* transform gradient band */
.pgbld .transband{background:var(--grad);color:#fff;padding:56px 0;margin:26px 0}
.pgbld .transband .in{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .transband h2{font-size:clamp(26px,3.4vw,40px);font-weight:800;letter-spacing:-.02em;color:#fff;margin:0 0 20px;text-align:left}
.pgbld .transband h2 .hl{color:#fff;font-style:italic;opacity:.9}
.pgbld .tlist{display:flex;flex-direction:column;gap:4px}
.pgbld .titem{padding:16px 0;border-top:1px solid rgba(255,255,255,.2)}
.pgbld .titem:first-child{border-top:0}
.pgbld .titem .tlab{display:inline-block;background:#fff;color:var(--ink);font-size:12px;font-weight:800;padding:3px 12px;border-radius:100px;margin-bottom:8px}
.pgbld .titem h3{font-size:19px;font-weight:800;color:#fff;margin:0 0 4px}
.pgbld .titem p{margin:0;font-size:14.5px;color:rgba(255,255,255,.9)}
.pgbld .timg,.pgbld .timg.ph{border-radius:20px;aspect-ratio:1/1;object-fit:cover;width:100%}
/* faq accordion (numbered) */
.pgbld .faqacc{max-width:820px;margin:0 auto;padding:8px 0;display:flex;flex-direction:column;gap:12px}
.pgbld .fq{background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.pgbld .fq summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:14px;padding:18px 20px;font-weight:700;color:var(--ink);font-size:16px}
.pgbld .fq summary::-webkit-details-marker{display:none}
.pgbld .fq summary::after{content:"+";margin-left:auto;font-size:22px;font-weight:700;color:var(--muted)}
.pgbld .fq[open] summary::after{content:"\\2013"}
.pgbld .fq .fn{width:28px;height:28px;border-radius:50%;background:#fff;border:1px solid var(--line);display:grid;place-items:center;font-weight:800;font-size:13px;color:var(--ink);flex:none}
.pgbld .fq .fqa{padding:0 20px 18px 62px;color:var(--body);font-size:14.5px}
/* float bar */
.pgbld .floatcta{position:fixed;left:0;right:0;bottom:0;z-index:60;background:#fff;border-top:1px solid var(--line);box-shadow:0 -8px 24px -10px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px max(18px,calc((100% - 1160px)/2 + 22px));transition:transform .28s ease}
.pgbld .floatcta.hide{transform:translateY(115%)}
.pgbld .fc-info{display:flex;align-items:center;gap:12px;min-width:0}
.pgbld .fc-thumb{width:44px;height:44px;border-radius:9px;flex:none;object-fit:cover}
.pgbld .fc-name{font-weight:700;color:var(--ink);font-size:15px;min-width:0;line-height:1.25}
.pgbld .fc-btn{background:var(--grad);color:#fff;text-decoration:none;border:0;cursor:pointer;font-family:inherit;font-weight:800;font-size:16px;padding:13px 26px;border-radius:10px;white-space:nowrap;flex:none}
@media(max-width:880px){.pgbld .hero{grid-template-columns:1fr;gap:24px}.pgbld .gallery{position:static}.pgbld .feat{grid-template-columns:1fr;gap:22px;padding:32px 0}.pgbld .feat.rev .fimg{order:0}.pgbld .statgrid{grid-template-columns:1fr}.pgbld .bgrid{grid-template-columns:1fr 1fr}.pgbld .revs{grid-template-columns:1fr 1fr}.pgbld .trio{grid-template-columns:1fr}.pgbld .ugc .wall{grid-template-columns:repeat(3,1fr)}.pgbld .pcards{grid-template-columns:1fr 1fr}.pgbld .cmpband .in{grid-template-columns:1fr;gap:24px}.pgbld .transband .in{grid-template-columns:1fr;gap:24px}.pgbld .stats .sin{grid-template-columns:1fr;gap:26px}}
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
  const revPhotos = [c.image_rev1, c.image_rev2, c.image_rev3, c.image_rev4]
  const revs = arr(c.testimonials).map((t, i) => `<div class="rcard">${img(revPhotos[i] || o.productImage, o.productName, 'rimg')}<div class="rov"><div class="st">${stars}</div><div class="rtt">${escp((t as any).title || t.city || 'Verified review')}</div><p>${esc(t.quote)}</p><div class="rwho">${esc(t.name)}</div></div></div>`).join('')
  const trio = arr(c.transform_items).map((t, i) => `<div class="tcard"><div class="lab">${esc((t as any).lab || ['First','Second','Third'][i] || 'Benefit')} benefit</div><h3>${esc(t.title || t.label)}</h3><p>${esc(t.body)}</p></div>`).join('')
  const faqs = arr(c.faqs).map((f, i) => `<details class="fq"><summary><span class="fn">${i + 1}</span><span class="fqq">${esc(f.q)}</span></summary><div class="fqa">${esc(f.a)}</div></details>`).join('')

  return `
  <div class="pgbld">
  <div class="wrap">
    <div class="hero">
      <div class="gallery">
        <div class="gwrap">
          <div class="gtrack" id="gtrack">
            ${[c.image_main, c.image_g2, c.image_g3, c.image_g4].map((u) => `<div class="gslide">${img(u || o.productImage, o.productName, 'gimg', 'Product')}</div>`).join('')}
          </div>
          <button class="garr gprev" id="gprev" aria-label="Previous">‹</button>
          <button class="garr gnext" id="gnext" aria-label="Next">›</button>
        </div>
        <div class="gdots" id="gdots">${[0, 1, 2, 3].map((i) => `<span class="gdot${i === 0 ? ' on' : ''}"></span>`).join('')}</div>
        <div class="thumbs" id="gthumbs">${[c.image_main, c.image_g2, c.image_g3, c.image_g4].map((u, i) => `<button class="gthumb${i === 0 ? ' on' : ''}" data-i="${i}">${img(u || o.productImage, o.productName, '')}</button>`).join('')}</div>
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
        <div class="trust">${trust}</div>
        <details class="pdetails"><summary>${esc((c as any).details_label || 'Product details')}</summary><div class="pdesc">${esc((c as any).product_details || (c as any).description || `Full details for ${o.productName}.`)}</div></details>
        <div class="ugc">
          <div class="top"><h2>${esc(c.ugc_head || 'What our customers think')}</h2><div class="socials">${esc(c.ugc_socials || '📷 🎵 ▶️ 📌')}</div></div>
          <div class="wall">
            ${[c.image_ugc1, c.image_ugc2, c.image_ugc3, c.image_ugc4, c.image_ugc5].map((u) => `<div class="vc">${mediaCard(u, o.productImage, o.productName)}</div>`).join('')}
          </div>
          ${(() => { const t0 = arr(c.testimonials)[0] || {}; return t0.quote ? `<div class="frev">
            <div class="who">
              <div class="av">${img((c.image_rev1 as any) || o.productImage, esc(t0.name), '')}</div>
              <div><div class="nm">${esc(t0.name)} <span class="chk">✓</span></div><div class="loc">${esc(t0.city)}</div><div class="st">${stars}</div></div>
            </div>
            <div class="q">${esc(t0.quote)}</div>
          </div>` : '' })()}
        </div>
        <div class="acc">
          <details open><summary>How to use</summary><div class="body">${esc(c.howto_body)}</div></details>
          <details><summary>Shipping &amp; delivery</summary><div class="body">${esc(c.shipping_body)}</div></details>
          <details><summary>Returns &amp; refunds</summary><div class="body">${esc(c.returns_body)}</div></details>
        </div>
      </div>
    </div>
  </div>

  <div class="marq"><div class="marq-track">${marqOne}${marqOne}</div></div>

  <div class="wrap"><section class="feat">
    ${img(c.image_feature_1, o.productName, 'fimg', 'Lifestyle')}
    <div><h2>${hl(c.feature_1_head)}</h2>${rt(c.feature_1_body)}<ul class="fbul">${f1bul}</ul></div>
  </section></div>

  <div class="seenband"><div class="wrap">
    <h2>${esc(c.as_seen_on || 'As seen on')}</h2>
    <div class="logos">${(arr(c.seen_logos).length ? arr(c.seen_logos) : ['Forbes', 'Vogue', 'Elle', 'Allure', 'Bazaar'].map((n) => ({ label: n }))).map((l: any) => l.image ? `<img class="plogo" src="${l.image}" alt="${escp(l.label || '')}">` : `<span class="plogo">${escp(l.label)}</span>`).join('')}</div>
  </div></div>

  <div class="wrap"><section class="feat rev">
    ${img(c.image_feature_2, o.productName, 'fimg', 'In use')}
    <div><h2>${hl(c.feature_2_head)}</h2>${rt(c.feature_2_body)}<ul class="fbul">${f2bul}</ul></div>
  </section></div>

  <div class="pinkband"><div class="wrap">
    <h2>${hl(c.pink_head || 'Confidence that starts within')}</h2>
    <p>${esc(c.pink_sub)}</p>
    <a class="bag" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Add to cart')}</a>
    <div class="pcards">${arr(c.pink_items).map((i) => `<div class="pcard">${escp(i.label)}</div>`).join('')}</div>
  </div></div>

  <div class="stats"><div class="wrap"><div class="sin">
    <div class="scol">
      <h2 class="sec" style="text-align:left;margin-bottom:12px">${hl(c.stats_head || 'The reason customers choose us **again and again**')}</h2>
      <p style="color:var(--muted);font-size:16px;margin:0 0 18px">${esc(c.stats_sub)}</p>
      <div class="scard">${img(o.productImage, o.productName, 'simg')}<div><div class="sct">${escp(c.stats_card_label || o.productName)}</div><div class="scs">${esc(c.stats_card_sub || '')}</div></div></div>
    </div>
    <div class="smid">${img(c.image_stats || o.productImage, o.productName, 'simg2', 'Lifestyle')}</div>
    <div class="scol srows">
      ${arr(c.stats).map((s) => `<div class="srow"><div class="n">${escp(s.label)}</div><div><div class="t">${escp(s.title)}</div><div class="s">${esc(s.body)}</div></div></div>`).join('')}
    </div>
  </div></div></div>

  <div class="wrap">
    <h2 class="sec" style="margin-top:48px">${esc(c.benefits_head || 'Benefits you\'ll love')}</h2>
    <div class="bgrid">${bene}</div>
  </div>

  <div class="cmpband"><div class="wrap"><div class="in">
    <div>
      <h2>${hl(c.compare_head || 'What makes us **different**')}</h2>
      <p>${esc(c.compare_body)}</p>
      <a class="bag" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Shop now')}</a>
    </div>
    <div class="ctab">
      <div class="usbox"></div>
      <div class="ch2"><div>&nbsp;</div><div>${esc(o.productName).split(' ')[0] || 'Us'}</div><div>Others</div></div>
      ${arr(c.compare_rows).map((r) => `<div class="cr2"><div class="lab">${escp(r.label)}</div><div class="yes">✓</div><div class="no" style="opacity:.55">✕</div></div>`).join('')}
    </div>
  </div></div></div>

  <div class="wrap">
    <h2 class="sec" style="margin-top:20px">${hl(c.reviews_head || 'Join 10,000+ **happy customers**')}</h2>
    <div class="gwrap">
      <div class="gcar" id="rcar">${revs}</div>
      <button class="garr gprev" id="rprev" aria-label="Previous">‹</button>
      <button class="garr gnext" id="rnext" aria-label="Next">›</button>
    </div>
  </div>

  <div class="transband"><div class="wrap"><div class="in">
    <div>
      <h2>${hl(c.transform_head || 'How this will transform **your day**')}</h2>
      <div class="tlist">
        ${arr(c.transform_items).map((t, i) => `<div class="titem"><span class="tlab">${escp((t as any).label || ((['First', 'Second', 'Third'][i] || 'Next') + ' benefit'))}</span><h3>${escp(t.title || t.label)}</h3><p>${esc(t.body)}</p></div>`).join('')}
      </div>
    </div>
    ${img(c.image_transform || o.productImage, o.productName, 'timg', 'Lifestyle')}
  </div></div></div>

  <div class="wrap">
    <h2 class="sec" style="margin-top:44px">${hl(c.faq_head || 'Frequently asked **questions**')}</h2>
    <p class="seclead">${esc(c.faq_sub || 'Quick answers to the most common questions.')}</p>
    <div class="faqacc">${faqs}</div>

    <a class="buy grad big" style="margin-top:34px" href="${esc(o.ctaHref)}">${esc(c.final_cta || `Get ${o.productName}`)}</a>
  </div>

  <div class="floatcta" id="floatcta">
    <div class="fc-info">${img(o.productImage, o.productName, 'fc-thumb')}<span class="fc-name">${esc(o.productName)}${o.priceLabel ? ' · <b>' + esc(o.priceLabel) + '</b>' : ''}</span></div>
    <a class="fc-btn" href="${esc(o.ctaHref)}">${esc(c.cta_label || 'Add to cart')}</a>
  </div>
  </div>
  <script>(function(){var fc=document.getElementById('floatcta');function t(){if(fc)fc.classList.toggle('hide',window.scrollY<560)}window.addEventListener('scroll',t,{passive:true});t();
  var tr=document.getElementById('gtrack');if(tr){var dots=[].slice.call(document.querySelectorAll('#gdots .gdot')),ths=[].slice.call(document.querySelectorAll('#gthumbs .gthumb'));function u(){var i=Math.round(tr.scrollLeft/tr.clientWidth);dots.forEach(function(d,j){d.classList.toggle('on',j===i)});ths.forEach(function(x,j){x.classList.toggle('on',j===i)})}tr.addEventListener('scroll',function(){window.requestAnimationFrame(u)},{passive:true});ths.forEach(function(x){x.addEventListener('click',function(){tr.scrollTo({left:(+x.getAttribute('data-i'))*tr.clientWidth,behavior:'smooth'})})});var pv=document.getElementById('gprev'),nx=document.getElementById('gnext');function go(d){var n=tr.children.length,i=((Math.round(tr.scrollLeft/tr.clientWidth)+d)%n+n)%n;tr.scrollTo({left:i*tr.clientWidth,behavior:'smooth'})}if(pv)pv.addEventListener('click',function(){go(-1)});if(nx)nx.addEventListener('click',function(){go(1)})}
  var rc=document.getElementById('rcar');if(rc){var rp=document.getElementById('rprev'),rn=document.getElementById('rnext');function rgo(d){var w=(rc.firstElementChild?rc.firstElementChild.offsetWidth:320)+16;rc.scrollBy({left:d*w,behavior:'smooth'})}if(rp)rp.addEventListener('click',function(){rgo(-1)});if(rn)rn.addEventListener('click',function(){rgo(1)})}
  })();</script>`
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
    { key: 'ugc_socials', type: 'text', label: 'Video wall social icons', hint: 'A short row of emoji/icons, e.g. "📷 🎵 ▶️ 📌".' },
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
    { key: 'as_seen_on', type: 'text', label: '"As seen on" heading' },
    { key: 'seen_logos', type: 'list', label: '"As seen on" logos', count: 5, hint: 'Each label only: a press/publication name shown as a wordmark.' },
    { key: 'image_feature_1', type: 'image', role: 'editorial', label: 'Feature 1 image' },
    { key: 'feature_2_head', type: 'text', label: 'Feature 2 heading' },
    { key: 'feature_2_body', type: 'richtext', role: 'body', label: 'Feature 2 body' },
    { key: 'feature_2_bullets', type: 'list', label: 'Feature 2 bullets', count: 4, hint: 'Each: bold benefit + short line.' },
    { key: 'image_feature_2', type: 'image', role: 'lifestyle', label: 'Feature 2 image' },
    { key: 'stats_head', type: 'text', label: 'Stats heading' },
    { key: 'stats_sub', type: 'text', label: 'Stats subheading' },
    { key: 'stats', type: 'reasons', label: 'Stats', count: 3, hint: 'label = a percentage like "92%"; title = what improved; body = timeframe/context.' },
    { key: 'stats_card_label', type: 'text', label: 'Stats product-card title', hint: 'Short product/benefit name for the little card, e.g. "Bloat relief".' },
    { key: 'stats_card_sub', type: 'text', label: 'Stats product-card subtext' },
    { key: 'image_stats', type: 'image', role: 'lifestyle', label: 'Stats section image (center)' },
    { key: 'benefits_head', type: 'text', label: 'Benefits heading' },
    { key: 'benefit_items', type: 'list', label: 'Benefits grid', count: 4, hint: 'Each label only: e.g. "Worldwide shipping", "24/7 support".' },
    { key: 'compare_head', type: 'text', label: 'Comparison heading' },
    { key: 'compare_body', type: 'text', label: 'Comparison intro' },
    { key: 'compare_rows', type: 'list', label: 'Comparison rows', count: 5, hint: 'Each label only: a feature the product has and rivals don\'t (e.g. "Probiotic", "Non-GMO", "Vegan").' },
    { key: 'reviews_head', type: 'text', label: 'Reviews heading' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews', count: 4, hint: 'name, city, quote. Use the "city" field as a SHORT review title.' },
    { key: 'image_rev1', type: 'image', role: 'lifestyle', label: 'Review photo 1' },
    { key: 'image_rev2', type: 'image', role: 'lifestyle', label: 'Review photo 2' },
    { key: 'image_rev3', type: 'image', role: 'lifestyle', label: 'Review photo 3' },
    { key: 'image_rev4', type: 'image', role: 'lifestyle', label: 'Review photo 4' },
    { key: 'transform_head', type: 'text', label: 'Transform heading' },
    { key: 'pink_head', type: 'text', label: 'Highlight band heading', hint: 'A punchy benefit headline; wrap the strongest word(s) in **…** to highlight them.' },
    { key: 'pink_sub', type: 'text', label: 'Highlight band subtext' },
    { key: 'pink_items', type: 'list', label: 'Highlight band cards', count: 4, hint: 'Each label only: a short benefit sentence.' },
    { key: 'transform_items', type: 'reasons', label: 'Transform trio', count: 3, hint: 'label = 1-2 word tag; title = benefit; body = one sentence.' },
    { key: 'image_transform', type: 'image', role: 'lifestyle', label: 'Transform section image' },
    { key: 'faq_head', type: 'text', label: 'FAQ heading', hint: 'e.g. "Frequently asked **questions**".' },
    { key: 'faq_sub', type: 'text', label: 'FAQ subheading' },
    { key: 'faqs', type: 'faq', label: 'FAQ', count: 5, hint: 'Cover results time, safety, usage, shipping, returns.' },
    { key: 'final_cta', type: 'text', label: 'Final button label' },
  ],
}
