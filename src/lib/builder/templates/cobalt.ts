/**
 * cobalt_v1 — a high-potency liquid-supplement PDP in a deep indigo/blue aesthetic, modelled
 * section-for-section on the Bluven Methylene Blue reference: hero creative (headline + two-part
 * benefit pills + bottle) beside a buy-box (bestseller badge, rating, benefit checks, sale price,
 * guarantee row, info accordion, review snippet, low-stock warning), a scrolling pill strip, a
 * "trusted by" split with lifestyle photos, a "how it works" split with a blue ingredient card, a
 * vs-the-rest comparison card beside a numbered benefits list, a reviews block with a press-quote
 * strip, a stat band, a 3-up feature-card row, a gold-standard comparison table, and a final CTA band.
 * Layout is FIXED; the AI only fills `schema` slots. All CSS scoped under `.pgbld`. Fully responsive.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const escp = (s: any) => esc(String(s ?? '').replace(/\*\*/g, '').replace(/^\s*[-•*]\s*/, '').trim())
const hl = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<span class="hl">$1</span>')
const bd = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
const arr = (v: SlotValue | undefined) => (Array.isArray(v) ? v : [])
const PH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/></svg>'
const TICK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#3f4bd6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-11"/></svg>'
const CHK = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" fill="#3f4bd6" stroke="#3f4bd6"/><path d="M8.4 12.4l2.4 2.4 4.7-5"/></svg>'
const CHKline = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#3f4bd6" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-11"/></svg>'
const XMARK = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#b9bcd6" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>'
const XMARKr = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#e2557a" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>'
const HEART = '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/></svg>'
const S = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`
const ICONS = [
  S('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>'),                                                            // bolt
  S('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'), // sun
  S('<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),                       // shield
  S('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>'),        // smile
  S('<path d="M12 2a5 5 0 0 1 5 5c0 3-5 9-5 9s-5-6-5-9a5 5 0 0 1 5-5z"/><circle cx="12" cy="7" r="1.5"/>'),     // drop
  S('<path d="M4 19V5M4 12h9M13 5l3 3-3 3M20 19V5"/>'),                                                         // graph-ish
]
const img = (url: any, alt: string, cls: string, label?: string): string =>
  (url && typeof url === 'string') ? `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`
    : `<div class="${cls} ph"><span class="phi">${PH_ICON}</span><span class="phl">${esc(label || 'Image')}</span></div>`

const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Fraunces:ital,opsz,wght@1,9..144,400;1,9..144,500;1,9..144,600&display=swap');
.pgbld{--blue:#3f4bd6;--blue2:#5563f0;--ink:#191b3a;--sub:#6a6e93;--soft:#eef0fe;--soft2:#e6e9fd;--card:#ffffff;--line:#e1e4f6;--dark:#2b31a6;--deep:#242a8f;--good:#3f4bd6;--warn:#e88a2a;
  font-family:'Inter',system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);line-height:1.5;background:#fff;-webkit-font-smoothing:antialiased}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld .ph{background:#eaecfb;border:1.5px dashed #cdd2f2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#a3a9d8;font-size:12px;min-height:120px;border-radius:14px;text-align:center;padding:14px}
.pgbld .ph .phi svg{width:30px;height:30px}
.pgbld .ph .phl{font-weight:700}
.pgbld .wrap{max-width:1140px;margin:0 auto;padding:0 22px}
.pgbld h1,.pgbld h2,.pgbld h3,.pgbld h4{margin:0;letter-spacing:-.02em;line-height:1.16}
.pgbld .hl{font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:500;letter-spacing:0}
.pgbld .btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;background:linear-gradient(180deg,#4a56ea,#3a45d0);color:#fff;border:0;border-radius:999px;padding:15px 30px;font-size:15px;font-weight:800;cursor:pointer;text-decoration:none;width:100%;box-shadow:0 12px 24px -12px rgba(63,75,214,.7)}
.pgbld .pays{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;align-items:center}
.pgbld .pays span{font-size:10px;font-weight:800;color:#8f93bb;border:1px solid var(--line);border-radius:5px;padding:3px 7px;background:#fff}
.pgbld .stars{color:#4a56ea;letter-spacing:1px;font-size:13px}
.pgbld .secttl{font-size:30px;text-align:center;margin-bottom:8px;font-weight:800}
.pgbld .sectsub{text-align:center;color:var(--sub);font-size:14px;max-width:620px;margin:0 auto 32px}

/* 1 · HERO */
.pgbld .hero{padding:26px 0 40px}
.pgbld .hero .grid{display:grid;grid-template-columns:1.05fr 1fr;gap:36px;align-items:start}
.pgbld .hcre{background:linear-gradient(180deg,var(--soft),#fff);border:1px solid var(--line);border-radius:20px;padding:22px}
.pgbld .hcre .hd{font-size:20px;font-weight:900;line-height:1.18;margin-bottom:4px}
.pgbld .hcre .hd .hl{color:var(--blue)}
.pgbld .hcre .sd{font-size:12.5px;color:var(--sub);font-weight:600;margin-bottom:14px}
.pgbld .hcre .mid{display:grid;grid-template-columns:1fr .9fr;gap:12px;align-items:center}
.pgbld .ppills{display:flex;flex-direction:column;gap:8px}
.pgbld .ppill{display:grid;grid-template-columns:auto 1fr;border-radius:999px;overflow:hidden;font-size:10.5px;font-weight:800;box-shadow:0 3px 8px -5px rgba(63,75,214,.5)}
.pgbld .ppill .a{background:var(--blue);color:#fff;padding:6px 11px;white-space:nowrap}
.pgbld .ppill .b{background:#fff;color:var(--ink);padding:6px 11px;border:1px solid var(--line);border-left:0}
.pgbld .hbottle,.pgbld .hbottle.ph{aspect-ratio:3/4;border-radius:12px;min-height:0}
.pgbld .thumbs{display:flex;gap:8px;margin-top:12px}
.pgbld .thumbs img,.pgbld .thumbs .ph{width:56px;height:56px;object-fit:cover;border-radius:9px;border:1px solid var(--line);min-height:0}
.pgbld .bestseller{display:inline-flex;align-items:center;gap:8px;background:var(--soft2);border:1px solid var(--line);border-radius:8px;padding:6px 11px;font-size:11px;font-weight:800;color:var(--blue);margin-bottom:12px}
.pgbld .ptitle{font-size:25px;font-weight:800}
.pgbld .rlabel{font-size:12.5px;color:var(--sub);margin:7px 0 12px}
.pgbld .hchecks{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-bottom:16px}
.pgbld .hchecks .c{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600}
.pgbld .hchecks .c .t{width:20px;height:20px;border-radius:50%;background:var(--soft2);display:flex;align-items:center;justify-content:center;flex:none}
.pgbld .price{display:flex;align-items:baseline;gap:10px;margin:4px 0 14px}
.pgbld .price .was{font-size:15px;color:#a6aac9;text-decoration:line-through}
.pgbld .price .now{font-size:24px;font-weight:900;color:var(--blue)}
.pgbld .price .save{font-size:11px;font-weight:800;color:#fff;background:var(--blue);border-radius:5px;padding:3px 8px}
.pgbld .grow{display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:#6a6e93;font-weight:600}
.pgbld .grow span{display:inline-flex;align-items:center;gap:6px}
.pgbld .acc{margin-top:14px;border-top:1px solid var(--line)}
.pgbld .acc details{border-bottom:1px solid var(--line)}
.pgbld .acc summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:12px 2px;font-weight:700;font-size:13.5px}
.pgbld .acc summary::-webkit-details-marker{display:none}
.pgbld .acc summary::after{content:'⌄';margin-left:auto;color:var(--sub);font-size:17px}
.pgbld .acc .body{padding:0 2px 12px;font-size:13px;color:var(--sub)}
.pgbld .hclaim{font-size:12px;color:var(--sub);text-align:center;margin-top:12px}
.pgbld .hrev{display:flex;gap:12px;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:13px 14px;margin-top:12px}
.pgbld .hrev .av,.pgbld .hrev .av.ph{width:40px;height:40px;border-radius:50%;flex:none;min-height:0}
.pgbld .hrev .q{font-size:12px;color:#6a6e93;line-height:1.5}
.pgbld .hrev .who{font-size:11px;font-weight:800;margin-top:5px}
.pgbld .warn{display:flex;gap:9px;background:#fdf1e2;border:1px solid #f5d9b4;border-radius:10px;padding:11px 13px;margin-top:12px;font-size:11.5px;color:#8a5a1e}
.pgbld .warn b{color:#b06a1c}

/* 2 · PILL STRIP */
.pgbld .strip{background:var(--blue);padding:12px 0}
.pgbld .strip .row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.pgbld .strip .p{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.24);color:#fff;border-radius:999px;padding:6px 14px;font-size:12px;font-weight:700}
.pgbld .strip .p::before{content:'✓';font-weight:900}

/* 3 · TRUSTED */
.pgbld .trust{background:var(--soft);padding:48px 0}
.pgbld .trust .grid{display:grid;grid-template-columns:1.1fr 1fr;gap:40px;align-items:center}
.pgbld .trust h2{font-size:28px;font-weight:800;margin-bottom:12px}
.pgbld .trust p{font-size:14px;color:var(--sub);margin-bottom:20px}
.pgbld .trust .rate{font-size:12.5px;color:var(--sub);margin-top:14px}
.pgbld .trust .ims{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.pgbld .trust .ims .im,.pgbld .trust .ims .im.ph{aspect-ratio:4/5;border-radius:16px;min-height:0}

/* 4 · HOW IT WORKS */
.pgbld .how{padding:52px 0}
.pgbld .how .grid{display:grid;grid-template-columns:1fr 1.05fr;gap:40px;align-items:center}
.pgbld .how h2{font-size:26px;font-weight:800;margin-bottom:16px}
.pgbld .how p{font-size:13.5px;color:var(--sub);margin-bottom:16px;line-height:1.6}
.pgbld .sci{background:var(--dark);border-radius:22px;padding:26px;color:#eceefb;text-align:center}
.pgbld .sci h3{font-size:18px;font-weight:800;margin-bottom:4px}
.pgbld .sci .ss{font-size:11.5px;color:#b7bcea;margin-bottom:16px}
.pgbld .sci .body{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;text-align:left}
.pgbld .sci .ic{display:flex;gap:9px;margin-bottom:16px}
.pgbld .sci .ic .d{width:32px;height:32px;border-radius:9px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;flex:none;color:#fff}.pgbld .sci .ic .d svg{width:16px;height:16px}
.pgbld .sci .ic .t b{font-size:11.5px;color:#fff;display:block}
.pgbld .sci .ic .t span{font-size:10.5px;color:#b7bcea}
.pgbld .sci .im,.pgbld .sci .im.ph{aspect-ratio:3/4;border-radius:12px;min-height:0}
.pgbld .sci .brand{margin-top:14px;font-size:11px;color:#b7bcea}.pgbld .sci .brand b{color:#fff;font-size:14px;display:block}

/* 5 · VERSUS + BENEFITS */
.pgbld .vs{padding:8px 0 52px}
.pgbld .vs .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.pgbld .vs h2{font-size:24px;font-weight:800;margin-bottom:6px}
.pgbld .vs .vsub{font-size:13px;color:var(--sub);margin-bottom:18px}
.pgbld .vcard{background:var(--soft);border:1px solid var(--line);border-radius:18px;padding:18px;display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center}
.pgbld .vcol h5{font-size:12px;font-weight:800;text-align:center;margin-bottom:10px}
.pgbld .vcol .r{display:flex;align-items:flex-start;gap:7px;font-size:11px;font-weight:600;margin-bottom:9px;color:var(--ink)}
.pgbld .vcol.o .r{color:var(--sub)}
.pgbld .vcol .r svg{flex:none;margin-top:1px}
.pgbld .vmid,.pgbld .vmid.ph{width:86px;aspect-ratio:3/5;border-radius:10px;min-height:0}
.pgbld .ben h2 .hl{color:var(--blue)}
.pgbld .brow{display:flex;gap:13px;margin-bottom:15px;align-items:flex-start}
.pgbld .brow .n{width:30px;height:30px;border-radius:50%;background:var(--soft2);color:var(--blue);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex:none}
.pgbld .brow .t b{font-size:13.5px}
.pgbld .brow .t p{font-size:12.5px;color:var(--sub);margin:2px 0 0;line-height:1.45}

/* 6 · REVIEWS */
.pgbld .revs{padding:48px 0;background:var(--soft)}
.pgbld .rgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.pgbld .rc{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px}
.pgbld .rc .rn{font-weight:800;font-size:12.5px;margin-bottom:2px}
.pgbld .rc .rs{color:#4a56ea;font-size:11px;letter-spacing:1px;margin-bottom:7px}
.pgbld .rc p{font-size:12px;color:var(--sub);margin:0;line-height:1.5}
.pgbld .press{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:26px;padding-top:22px;border-top:1px solid var(--line)}
.pgbld .press .pq b{font-family:'Fraunces',Georgia,serif;font-size:16px;display:block;margin-bottom:5px}
.pgbld .press .pq p{font-size:11.5px;color:var(--sub);margin:0;font-style:italic}

/* 7 · STATS */
.pgbld .stats{padding:52px 0}
.pgbld .sgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.pgbld .sc{background:var(--blue);border-radius:16px;padding:22px 18px;text-align:center;color:#fff}
.pgbld .sc .bd{width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,.5);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;margin:0 auto 12px}
.pgbld .sc p{font-size:12px;color:#dfe2fb;margin:0;line-height:1.4}

/* 8 · FEATURE CARDS */
.pgbld .feat{padding:12px 0 54px}
.pgbld .fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.pgbld .fc .im,.pgbld .fc .im.ph{aspect-ratio:4/3;border-radius:16px;margin-bottom:12px;min-height:0}
.pgbld .fc h4{font-size:16px;font-weight:800;color:var(--blue);margin-bottom:4px}
.pgbld .fc p{font-size:12.5px;color:var(--sub);margin:0;line-height:1.45}

/* 9 · GOLD STANDARD (comparison table) */
.pgbld .gold{padding:52px 0;background:var(--soft)}
.pgbld .gold .grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .gold h2{font-size:26px;font-weight:800;margin-bottom:14px}
.pgbld .gold p{font-size:14px;color:var(--sub);margin-bottom:20px}
.pgbld .ctable{position:relative;padding:0 4px}
.pgbld .ctable::before{content:'';position:absolute;top:-16px;bottom:6px;right:104px;width:96px;background:linear-gradient(180deg,#dfe3ff,#eef0fe);border-radius:16px;z-index:0;box-shadow:0 12px 28px -14px rgba(63,75,214,.5)}
.pgbld .ctop,.pgbld .cr{position:relative;z-index:1;display:grid;grid-template-columns:1fr 100px 100px;align-items:center}
.pgbld .ctop{padding:12px 4px;font-size:11px;font-weight:800;color:var(--sub);text-transform:uppercase;letter-spacing:.03em;text-align:center}
.pgbld .ctop span:first-child{text-align:left}.pgbld .ctop .ours{color:var(--blue)}
.pgbld .cr{padding:14px 4px;border-top:1px solid var(--line);font-size:14px}
.pgbld .cr>div:first-child{text-align:left;color:var(--ink);font-weight:600}
.pgbld .cr .m{text-align:center;display:flex;justify-content:center;align-items:center}

/* 10 · FINAL CTA */
.pgbld .final{background:linear-gradient(120deg,var(--dark),var(--blue));padding:46px 0;color:#fff}
.pgbld .final .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.pgbld .final .prod{position:relative}
.pgbld .final .prod .name{font-size:11px;font-weight:800;letter-spacing:.1em;color:#c7cbf5;text-transform:uppercase;margin-bottom:6px}
.pgbld .final .prod .big{font-size:26px;font-weight:900;line-height:1.05;margin-bottom:14px}
.pgbld .final .prod .im,.pgbld .final .prod .im.ph{aspect-ratio:5/4;border-radius:16px;min-height:0}
.pgbld .final .forms{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.pgbld .final .forms span{font-size:10.5px;font-weight:700;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.24);border-radius:999px;padding:5px 11px}
.pgbld .final .cta{text-align:center}
.pgbld .final .cta .hz{width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.pgbld .final .cta h2{font-size:28px;font-weight:800;margin-bottom:10px}
.pgbld .final .cta p{font-size:13px;color:#d5d8f7;margin:0 auto 20px;max-width:380px;line-height:1.55}
.pgbld .final .cta .btn{background:#fff;color:var(--blue);max-width:320px;margin:0 auto}
.pgbld .final .cta .pays{justify-content:center}
.pgbld .final .cta .pays span{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.24);color:#d5d8f7}

@media(max-width:900px){
  .pgbld .hero .grid,.pgbld .trust .grid,.pgbld .how .grid,.pgbld .vs .grid,.pgbld .gold .grid,.pgbld .final .grid{grid-template-columns:1fr}
  .pgbld .rgrid,.pgbld .sgrid{grid-template-columns:1fr 1fr}
  .pgbld .fgrid{grid-template-columns:1fr}
  .pgbld .press{grid-template-columns:1fr}
}
@media(max-width:520px){
  .pgbld .hcre .mid{grid-template-columns:1fr}
  .pgbld .rgrid,.pgbld .sgrid{grid-template-columns:1fr}
  .pgbld .hchecks{grid-template-columns:1fr}
  .pgbld .wrap{padding:0 16px}
}
`.trim()

function render(c: FilledContent, o: RenderOpts): string {
  const P = o.productImage
  const price = o.priceLabel || ''

  const pills = (arr(c.hero_pills).length ? arr(c.hero_pills) : [
    { a: 'Supercharges', b: 'Brainpower' }, { a: 'Increases', b: 'Oxygen Utilization' }, { a: 'Supports', b: 'Mitochondria' }, { a: 'Balances', b: 'Mood & Stress' }, { a: 'High-Potency', b: 'Ultra-Pure' },
  ]).slice(0, 5).map((p: any) => `<div class="ppill"><span class="a">${escp(p.a || p.label)}</span><span class="b">${escp(p.b || p.body)}</span></div>`).join('')

  const checks = (arr(c.hero_benefits).length ? arr(c.hero_benefits) : ['Steady mental clarity', 'No afternoon crash', 'Uplifted daily mood', 'Simple glass dropper'].map((l) => ({ label: l })))
    .slice(0, 4).map((f) => `<div class="c"><span class="t">${TICK}</span>${escp(f.label)}</div>`).join('')
  const thumbs = [c.image_main, c.image_g2, c.image_g3, c.image_g4, c.image_g5].map((u) => img(u || P, o.productName, '', 'Img')).join('')
  const accItems = (arr(c.info_sections).length ? arr(c.info_sections) : [{ label: 'Description', body: 'What it is and what’s inside.' }, { label: 'How to use', body: 'A few drops daily, on or under the tongue.' }, { label: 'Shipping & Returns', body: 'Fast, tracked delivery and a money-back guarantee.' }])
    .map((s, i) => `<details${i === 0 ? ' open' : ''}><summary>${escp(s.label)}</summary><div class="body">${esc(s.body)}</div></details>`).join('')

  const strip = (arr(c.strip_pills).length ? arr(c.strip_pills) : ['Sustained Cellular Energy', 'Simple Daily Drops', 'Triple Lab Tested', 'Instant Mental Clarity', 'No Jittery Crash'].map((l) => ({ label: l })))
    .map((p) => `<span class="p">${escp(p.label)}</span>`).join('')

  const sci = (arr(c.sci_points).length ? arr(c.sci_points) : [
    { title: 'Pharmaceutical-Grade Methylene Blue', body: 'The one true form, sourced at the highest standard.' },
    { title: 'Distilled Water', body: 'Ultra-clean and contaminant-free.' },
    { title: 'Vitamin C', body: 'Elevated absorption for lasting potency.' },
  ]).slice(0, 3).map((s: any, i: number) => `<div class="ic"><div class="d">${ICONS[i % ICONS.length]}</div><div class="t"><b>${escp(s.title || s.label)}</b><span>${escp(s.body)}</span></div></div>`).join('')

  const vGood = (arr(c.vs_ours).length ? arr(c.vs_ours) : ['USP-Grade Purity', 'Accurate Microdosing', 'Rapid Brain & Energy Boost', 'Clean Taste, No Bitterness', 'Leakproof, Stable Formula'].map((l) => ({ label: l })))
    .map((r) => `<div class="r">${CHKline}${escp(r.label)}</div>`).join('')
  const vBad = (arr(c.vs_others).length ? arr(c.vs_others) : ['Unverified Purity', 'Inconsistent Dosing', 'Slower Absorption', 'Harsh Chemical Taste', 'Leaky, Unstable Packaging'].map((l) => ({ label: l })))
    .map((r) => `<div class="r">${XMARKr}${escp(r.label)}</div>`).join('')

  const bens = (arr(c.benefits).length ? arr(c.benefits) : [
    { title: 'Sustained Cellular Energy', body: 'Fuel your mitochondria for steady stamina that lasts all day without the caffeine crash.' },
    { title: 'Instant Mental Clarity', body: 'Clear away brain fog in minutes to feel sharper and more present during demanding tasks.' },
    { title: 'Reliable Neuroprotection', body: 'Defend your brain against oxidative stress to maintain long-term cognitive health and resilience.' },
    { title: 'Elevated Daily Motivation', body: 'Transform stress into flow and enjoy an uplifted mood that keeps you moving forward.' },
    { title: 'Triple Tested Purity', body: 'Trust in pharmaceutical-grade quality with every batch tested in protective cobalt glass.' },
  ]).slice(0, 5).map((b: any, i: number) => `<div class="brow"><div class="n">${i + 1}</div><div class="t"><b>${escp(b.title || b.label)}</b><p>${esc(b.body)}</p></div></div>`).join('')

  const revs = (arr(c.testimonials).length ? arr(c.testimonials) : [
    { name: 'Justin P.', quote: 'I was skeptical, but this smooths out my whole day. Less stress, more getting things done. Way different than coffee.' },
    { name: 'Sam T.', quote: 'I feel lighter, more positive, and just generally driven without feeling wired. Simple addition to my water.' },
    { name: 'Bri M.', quote: 'Helps me stay sharp during long meetings. I like that it supports my cells instead of just spiking me.' },
    { name: 'Benny K.', quote: 'Love skipping the third cup of coffee now. This gives me that grounded alertness I’ve been searching for.' },
  ]).slice(0, 4).map((t) => `<div class="rc"><div class="rn">${escp(t.name)}</div><div class="rs">★★★★★</div><p>${esc(t.quote)}</p></div>`).join('')

  const press = (arr(c.press_quotes).length ? arr(c.press_quotes) : [
    { title: 'New Scientist', body: 'The ultimate upgrade for clean mental clarity and focus.' },
    { title: 'Bloomberg', body: 'It perks up effortless way to just your morning routine.' },
    { title: 'Cosmopolitan', body: 'A calm, steady lift the whole team swears by now.' },
  ]).slice(0, 3).map((p: any) => `<div class="pq"><b>${escp(p.title || p.label)}</b><p>${esc(p.body)}</p></div>`).join('')

  const stats = (arr(c.stats).length ? arr(c.stats) : [
    { label: '97%', body: 'Felt reliable clarity in every drop.' }, { label: '96%', body: 'Gained brain fuel for a sharper edge.' }, { label: '98%', body: 'Maintained steady focus without any crashes.' }, { label: '89%', body: 'Found a lighter, more motivated mood.' },
  ]).slice(0, 4).map((s) => `<div class="sc"><div class="bd">${escp(s.label)}</div><p>${bd(s.body)}</p></div>`).join('')

  const feats = (arr(c.feature_cards).length ? arr(c.feature_cards) : [
    { title: 'Sustained Vitality', body: 'Experience clean cellular energy that keeps you alert and steady from morning until evening.' },
    { title: 'Sharp Cognition', body: 'Clear away mental fog to find a natural flow state that helps you stay productive.' },
    { title: 'Trusted Purity', body: 'Every drop is triple-lab tested, ensuring long-term safety for daily use without doubt.' },
  ]).slice(0, 3).map((f: any) => `<div class="fc">${img(f.image, o.productName, 'im', 'Feature')}<h4>${escp(f.title)}</h4><p>${esc(f.body)}</p></div>`).join('')

  const goldRows = (arr(c.gold_rows).length ? arr(c.gold_rows) : ['USP Purity', 'Zero Jitters', 'Consistent Focus', 'No Crash', 'Lab Tested', 'Cellular Fuel'].map((l) => ({ label: l })))
    .map((r) => `<div class="cr"><div>${escp(r.label)}</div><div class="m">${CHK}</div><div class="m">${XMARK}</div></div>`).join('')

  const forms = (arr(c.final_forms).length ? arr(c.final_forms) : ['5-MTHF Form', 'Organic Certified', 'Sublingual Form'].map((l) => ({ label: l })))
    .map((f) => `<span>${escp(f.label)}</span>`).join('')

  return `<div class="pgbld">

  <!-- 1 · HERO -->
  <section class="hero"><div class="wrap"><div class="grid">
    <div>
      <div class="hcre">
        <div class="hd">${hl(c.hero_headline || 'Your Brain is Starving for **Oxygen**. Fuel it & Unlock Peak Performance.')}</div>
        <div class="sd">${escp(c.hero_subline || 'A Few Drops. Instant Impact.')}</div>
        <div class="mid">
          <div class="ppills">${pills}</div>
          <div>${img(c.image_hero || P, o.productName, 'hbottle', 'Product')}</div>
        </div>
      </div>
      <div class="thumbs">${thumbs}</div>
    </div>
    <div>
      <div class="bestseller">★ ${escp(c.bestseller_label || 'BESTSELLER OF 2026')}</div>
      <h1 class="ptitle">${esc(c.headline || o.productName)}</h1>
      <div class="rlabel"><span class="stars">★★★★★</span> ${escp(c.rating_label || `Rated ${o.rating?.stars || '4.9'} by 17,873 buyers`)}</div>
      <div class="hchecks">${checks}</div>
      <div class="price">${c.compare_at ? `<span class="was">${escp(c.compare_at)}</span>` : ''}${price ? `<span class="now">${esc(price)}</span>` : ''}${c.save_pill ? `<span class="save">${escp(c.save_pill)}</span>` : ''}</div>
      <a class="btn" href="${esc(o.ctaHref || '#')}">🛒 ${escp(c.cta_label || 'Add to Cart')}</a>
      <div class="pays"><span>VISA</span><span>Mastercard</span><span>AMEX</span><span>PayPal</span><span>Shop</span></div>
      <div class="grow"><span>🛡 ${escp(c.guarantee_line || '30-Day Money Back Guarantee')}</span><span>↩ ${escp(c.returns_line || '30 Day Returns')}</span></div>
      <div class="acc">${accItems}</div>
      <div class="hclaim">${escp(c.hero_claim || 'Join thousands of customers who trust our money-back guarantee.')}</div>
      <div class="hrev"><div class="av">${img(c.image_reviewer, 'Reviewer', 'avim', '')}</div><div><div class="q">${esc(c.hero_review || 'Actually feels like clean fuel. No racing heart or crash later, just a steady sense of being ‘on’ while I work through my day.')}</div><div class="who">${escp(c.hero_review_name || 'Verified Buyer')}</div></div></div>
      <div class="warn">⚠ <span><b>Low Stock Notice.</b> ${esc(c.warn_line || 'This product sold out fast this year. We encourage you to take advantage of the limited sale while it lasts. It’s only available here and not sold in stores.')}</span></div>
    </div>
  </div></div></section>

  <!-- 2 · PILL STRIP -->
  <section class="strip"><div class="wrap"><div class="row">${strip}</div></div></section>

  <!-- 3 · TRUSTED -->
  <section class="trust"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.trust_head || 'Trusted by doctors. Chosen by **high performers**.')}</h2>
      <p>${bd(c.trust_sub || 'Triple-lab testing ensures the purity you need for steady cellular energy.')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.trust_cta || 'Get Yours Now')}</a>
      <div class="rate"><span class="stars">★★★★★</span> ${escp(c.trust_rating || `Rated ${o.rating?.stars || '4.9'} by 15,000+ happy customers`)}</div>
    </div>
    <div class="ims"><div class="im">${img(c.image_trust1 || P, o.productName, 'gimg', 'Lifestyle')}</div><div class="im">${img(c.image_trust2 || P, o.productName, 'gimg', 'Lifestyle')}</div></div>
  </div></div></section>

  <!-- 4 · HOW IT WORKS -->
  <section class="how"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.how_head || 'How Does This Liquid Energy Work?')}</h2>
      <p>${bd(c.how_body1 || 'It acts directly on your mitochondria, the tiny engines that power every cell. It helps them convert fuel into energy more efficiently than caffeine can.')}</p>
      <p>${bd(c.how_body2 || 'Instead of a temporary spike, you feel steady focus and sustained stamina. Daily use helps protect brain cells and lifts your mood naturally.')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.how_cta || 'Buy It Now')}</a>
    </div>
    <div class="sci">
      <h3>${escp(c.sci_head || 'Pure By Design — Backed By Science')}</h3>
      <div class="ss">${escp(c.sci_sub || 'Only 3 carefully chosen ingredients. Free from GMOs, animal products, and unnecessary additives.')}</div>
      <div class="body">
        <div>${sci}</div>
        <div>${img(c.image_sci || P, o.productName, 'im', 'Product')}</div>
        <div class="brand"><b>${escp(c.sci_brand || o.productName)}</b>${escp(c.sci_brand_sub || 'Quality You Can Trust.')}</div>
      </div>
    </div>
  </div></div></section>

  <!-- 5 · VERSUS + BENEFITS -->
  <section class="vs"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.vs_head || 'How We Compare vs. The Rest')}</h2>
      <div class="vsub">${esc(c.vs_sub || 'USP-Grade Purity. Accurate Microdosing. Fast Brain & Energy Support — Without The Bitterness.')}</div>
      <div class="vcard">
        <div class="vcol"><h5>${escp(c.vs_ours_label || o.productName)}</h5>${vGood}</div>
        <div>${img(c.image_vs || P, o.productName, 'vmid', '')}</div>
        <div class="vcol o"><h5>${escp(c.vs_others_label || 'Other Brands')}</h5>${vBad}</div>
      </div>
    </div>
    <div class="ben">
      <h2>${hl(c.ben_head || '5 Everyday Benefits of using **Us**')}</h2>
      <div class="vsub">${esc(c.ben_sub || 'Power your body with clean mitochondrial support.')}</div>
      ${bens}
    </div>
  </div></div></section>

  <!-- 6 · REVIEWS -->
  <section class="revs"><div class="wrap">
    <h2 class="secttl">${hl(c.reviews_head || 'What People Are Saying Now')}</h2>
    <div class="sectsub"><span class="stars">★★★★★</span> ${escp(c.reviews_sub || `Rated ${o.rating?.stars || '4.9'} based on 7,000+ reviews`)}</div>
    <div class="rgrid">${revs}</div>
    <div class="press">${press}</div>
  </div></section>

  <!-- 7 · STATS -->
  <section class="stats"><div class="wrap">
    <h2 class="secttl">${hl(c.stats_head || 'What Most High Performers Noticed')}</h2>
    <div class="sectsub">${esc(c.stats_sub || 'A collection of real experiences from people who chose mitochondrial support over their morning cup of coffee.')}</div>
    <div class="sgrid">${stats}</div>
  </div></section>

  <!-- 8 · FEATURE CARDS -->
  <section class="feat"><div class="wrap">
    <h2 class="secttl">${hl(c.feat_head || 'Pure mitochondria support for daily mental clarity')}</h2>
    <div class="sectsub">${esc(c.feat_sub || 'Fuel your cells directly to activate natural focus and steady stamina without the usual caffeine crash.')}</div>
    <div class="fgrid">${feats}</div>
  </div></section>

  <!-- 9 · GOLD STANDARD -->
  <section class="gold"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.gold_head || 'The Gold Standard for Energy')}</h2>
      <p>${bd(c.gold_body || 'Step away from the temporary buzz of caffeine. Our drops feed your cells directly, offering sustained mitochondrial energy without the shaky jitters or afternoon crash — pure mental clarity that lasts all day.')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.gold_cta || 'Get Yours Now')}</a>
    </div>
    <div class="ctable"><div class="ctop"><span>Feature</span><span class="ours">Our product</span><span>Others</span></div>${goldRows}</div>
  </div></div></section>

  <!-- 10 · FINAL CTA -->
  <section class="final"><div class="wrap"><div class="grid">
    <div class="prod">
      <div class="name">${escp(c.final_kicker || 'Professional Strength')}</div>
      <div class="big">${hl(c.final_prod_name || o.productName)}</div>
      <div class="im">${img(c.image_final || P, o.productName, 'gimg', 'Product')}</div>
      <div class="forms">${forms}</div>
    </div>
    <div class="cta">
      <div class="hz">${HEART}</div>
      <h2>${hl(c.final_head || 'Start your clean flow')}</h2>
      <p>${esc(c.final_body || 'Feel the calm of steady energy without the afternoon crash. Getting started is a risk-free with our thirty-day satisfaction guarantee.')}</p>
      <a class="btn" href="${esc(o.ctaHref || '#')}">${escp(c.final_cta || 'Buy It Now')}</a>
      <div class="pays"><span>VISA</span><span>Mastercard</span><span>AMEX</span><span>PayPal</span><span>Shop</span></div>
    </div>
  </div></div></section>

  </div>`
}

export const cobaltV1: PageTemplate = {
  id: 'cobalt_v1',
  type: 'product',
  name: 'Peak Energy (Blue)',
  description: 'Deep-indigo liquid-supplement PDP — hero creative with two-part benefit pills + buy-box (bestseller badge, benefit checks, guarantee, info accordion, review + low-stock warning), pill strip, trusted-by split, how-it-works blue ingredient card, vs-the-rest comparison + numbered benefits, reviews + press quotes, stat band, feature cards, gold-standard table, and a final CTA band.',
  css,
  render,
  schema: [
    { key: 'hero_headline', type: 'text', label: 'Hero creative headline', hint: 'Wrap 1 word in ** ** to accent it (e.g. "…Starving for **Oxygen**").' },
    { key: 'hero_subline', type: 'text', label: 'Hero creative subline', hint: 'e.g. "A Few Drops. Instant Impact.".' },
    { key: 'hero_pills', type: 'reasons', label: 'Hero benefit pills (5)', count: 5, hint: 'Each: a = left word (verb like "Supercharges"); b = right word ("Brainpower").' },
    { key: 'image_hero', type: 'image', role: 'product', label: 'Hero bottle image' },
    { key: 'bestseller_label', type: 'text', label: 'Bestseller badge text' },
    { key: 'headline', type: 'text', role: 'headline', label: 'Product title' },
    { key: 'rating_label', type: 'text', label: 'Rating line' },
    { key: 'hero_benefits', type: 'list', label: 'Buy-box benefit checks', count: 4, hint: 'Each label only.' },
    { key: 'compare_at', type: 'text', label: 'Compare-at price' },
    { key: 'save_pill', type: 'text', label: 'Save pill', hint: 'e.g. "SAVE 20%".' },
    { key: 'cta_label', type: 'text', label: 'Add-to-cart label' },
    { key: 'guarantee_line', type: 'text', label: 'Guarantee line' },
    { key: 'returns_line', type: 'text', label: 'Returns line' },
    { key: 'info_sections', type: 'list', label: 'Info accordion', count: 3, hint: 'Each: label = section title (Description / How to use / Shipping & Returns); body = the detail.' },
    { key: 'hero_claim', type: 'text', label: 'Guarantee claim line' },
    { key: 'hero_review', type: 'richtext', role: 'body', label: 'Hero review quote' },
    { key: 'hero_review_name', type: 'text', label: 'Hero reviewer name' },
    { key: 'image_reviewer', type: 'image', role: 'lifestyle', label: 'Hero reviewer avatar' },
    { key: 'warn_line', type: 'richtext', role: 'body', label: 'Low-stock warning text' },
    { key: 'image_main', type: 'image', role: 'product', label: 'Thumbnail 1 (main)' },
    { key: 'image_g2', type: 'image', role: 'product', label: 'Thumbnail 2' },
    { key: 'image_g3', type: 'image', role: 'product', label: 'Thumbnail 3' },
    { key: 'image_g4', type: 'image', role: 'lifestyle', label: 'Thumbnail 4' },
    { key: 'image_g5', type: 'image', role: 'lifestyle', label: 'Thumbnail 5' },
    { key: 'strip_pills', type: 'list', label: 'Pill strip badges', count: 5, hint: 'Each label only: a short claim.' },
    { key: 'trust_head', type: 'text', label: 'Trusted heading', hint: 'Accent a phrase with ** ** (e.g. "Chosen by **high performers**").' },
    { key: 'trust_sub', type: 'richtext', role: 'body', label: 'Trusted subhead' },
    { key: 'trust_cta', type: 'text', label: 'Trusted button' },
    { key: 'trust_rating', type: 'text', label: 'Trusted rating line' },
    { key: 'image_trust1', type: 'image', role: 'lifestyle', label: 'Trusted photo 1' },
    { key: 'image_trust2', type: 'image', role: 'lifestyle', label: 'Trusted photo 2' },
    { key: 'how_head', type: 'text', label: 'How-it-works heading' },
    { key: 'how_body1', type: 'richtext', role: 'body', label: 'How-it-works paragraph 1' },
    { key: 'how_body2', type: 'richtext', role: 'body', label: 'How-it-works paragraph 2' },
    { key: 'how_cta', type: 'text', label: 'How-it-works button' },
    { key: 'sci_head', type: 'text', label: 'Science card heading' },
    { key: 'sci_sub', type: 'text', label: 'Science card subhead' },
    { key: 'sci_points', type: 'reasons', label: 'Science ingredients (3)', count: 3, hint: 'title = ingredient; body = one line.' },
    { key: 'sci_brand', type: 'text', label: 'Science card brand name' },
    { key: 'sci_brand_sub', type: 'text', label: 'Science card brand tagline' },
    { key: 'image_sci', type: 'image', role: 'product', label: 'Science card product image' },
    { key: 'vs_head', type: 'text', label: 'Versus heading' },
    { key: 'vs_sub', type: 'text', label: 'Versus subhead' },
    { key: 'vs_ours_label', type: 'text', label: 'Versus — our column label' },
    { key: 'vs_others_label', type: 'text', label: 'Versus — their column label' },
    { key: 'vs_ours', type: 'list', label: 'Versus — our strengths', count: 5, hint: 'Each label only.' },
    { key: 'vs_others', type: 'list', label: 'Versus — their weaknesses', count: 5, hint: 'Each label only.' },
    { key: 'image_vs', type: 'image', role: 'product', label: 'Versus card product image' },
    { key: 'ben_head', type: 'text', label: 'Benefits heading', hint: 'Accent brand with ** ** (e.g. "…using **Bluven**").' },
    { key: 'ben_sub', type: 'text', label: 'Benefits subhead' },
    { key: 'benefits', type: 'reasons', label: 'Numbered benefits (5)', count: 5, hint: 'title + body.' },
    { key: 'reviews_head', type: 'text', label: 'Reviews heading' },
    { key: 'reviews_sub', type: 'text', label: 'Reviews rating line' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews (4)', count: 4, hint: 'name + quote.' },
    { key: 'press_quotes', type: 'reasons', label: 'Press quotes (3)', count: 3, hint: 'title = publication; body = the quote.' },
    { key: 'stats_head', type: 'text', label: 'Stats heading' },
    { key: 'stats_sub', type: 'text', label: 'Stats subhead' },
    { key: 'stats', type: 'reasons', label: 'Stats (4)', count: 4, hint: 'label = a percentage like "97%"; body = what improved.' },
    { key: 'feat_head', type: 'text', label: 'Feature-cards heading' },
    { key: 'feat_sub', type: 'text', label: 'Feature-cards subhead' },
    { key: 'feature_cards', type: 'reasons', label: 'Feature cards (3)', count: 3, hint: 'title + body; each has its own image slot.' },
    { key: 'gold_head', type: 'text', label: 'Gold-standard heading' },
    { key: 'gold_body', type: 'richtext', role: 'body', label: 'Gold-standard paragraph' },
    { key: 'gold_cta', type: 'text', label: 'Gold-standard button' },
    { key: 'gold_rows', type: 'list', label: 'Gold-standard comparison rows', count: 6, hint: 'Each label only: a feature you have and rivals don\'t.' },
    { key: 'final_kicker', type: 'text', label: 'Final CTA kicker', hint: 'e.g. "Professional Strength".' },
    { key: 'final_prod_name', type: 'text', label: 'Final CTA product name' },
    { key: 'final_forms', type: 'list', label: 'Final CTA form badges', count: 3, hint: 'Each label only (e.g. "Organic Certified").' },
    { key: 'image_final', type: 'image', role: 'product', label: 'Final CTA product image' },
    { key: 'final_head', type: 'text', label: 'Final CTA heading' },
    { key: 'final_body', type: 'richtext', role: 'body', label: 'Final CTA paragraph' },
    { key: 'final_cta', type: 'text', label: 'Final CTA button' },
  ],
}
