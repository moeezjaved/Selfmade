/**
 * radiance_v1 — a "glass skin" skincare/serum PDP in a warm gold + cream aesthetic, modelled
 * section-for-section on the Glass Skin Radiance Kit reference: hero buy-box (gallery + thumbnails,
 * rating, benefit checks, sale price, guarantee + shipping, a review snippet, a "see it in action"
 * thumb strip), a 4-week results timeline beside a before/after card, a reviews strip, a dark
 * problem-card + solution split, a dark stat band, an ingredients row (4 circular photos), three
 * lifestyle cards, an "as seen on" press strip, a comparison table, an FAQ, and a risk-free guarantee.
 * Layout is FIXED; the AI only fills `schema` slots. All CSS scoped under `.pgbld`. Fully responsive.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const escp = (s: any) => esc(String(s ?? '').replace(/\*\*/g, '').replace(/^\s*[-•*]\s*/, '').trim())
const hl = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<span class="hl">$1</span>')
const bd = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
const arr = (v: SlotValue | undefined) => (Array.isArray(v) ? v : [])
const PH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/></svg>'
const TICK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#7a5b12" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4 4 10-11"/></svg>'
const CHK = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="#2a2318" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" fill="#f7c948" stroke="#f7c948"/><path d="M8.4 12.4l2.4 2.4 4.7-5"/></svg>'
const XMARK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#c8bfa8" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>'
const SHIELD = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#2a2318" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>'
const S = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`
const ICONS = [
  S('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'), // sun
  S('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),                                                            // moon
  S('<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>'),                                     // heart
  S('<path d="M12 2a5 5 0 0 1 5 5c0 3-5 9-5 9s-5-6-5-9a5 5 0 0 1 5-5z"/><circle cx="12" cy="7" r="1.5"/>'),                 // drop
  S('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>'),                                                                          // bolt
  S('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>'),                     // smile
]
const img = (url: any, alt: string, cls: string, label?: string): string =>
  (url && typeof url === 'string') ? `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`
    : `<div class="${cls} ph"><span class="phi">${PH_ICON}</span><span class="phl">${esc(label || 'Image')}</span></div>`

const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Fraunces:ital,opsz,wght@1,9..144,400;1,9..144,500;1,9..144,600&display=swap');
.pgbld{--gold:#f7c948;--gold2:#f3b93a;--amber:#e6a52c;--cream:#fdf6e6;--cream2:#faeecf;--card:#fffaf0;--ink:#2a2318;--sub:#8f8672;--line:#ecdfc1;--dark:#282521;--dark2:#1f1c18;--good:#e6a52c;
  font-family:'Inter',system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);line-height:1.5;background:#fff;-webkit-font-smoothing:antialiased}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld .ph{background:#f7edd4;border:1.5px dashed #e6d3a6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#c3ab74;font-size:12px;min-height:120px;border-radius:14px;text-align:center;padding:14px}
.pgbld .ph .phi svg{width:30px;height:30px}
.pgbld .ph .phl{font-weight:700}
.pgbld .wrap{max-width:1140px;margin:0 auto;padding:0 22px}
.pgbld h1,.pgbld h2,.pgbld h3,.pgbld h4{margin:0;letter-spacing:-.01em;line-height:1.16}
.pgbld .hl{font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:500;letter-spacing:0}
.pgbld .btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;background:linear-gradient(180deg,#f9d05c,#f2b73a);color:#2a2318;border:0;border-radius:999px;padding:16px 30px;font-size:15px;font-weight:800;cursor:pointer;text-decoration:none;width:100%;box-shadow:0 10px 22px -12px rgba(230,165,44,.75)}
.pgbld .pays{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;align-items:center}
.pgbld .pays span{font-size:10px;font-weight:800;color:#a8946a;border:1px solid var(--line);border-radius:5px;padding:3px 7px;background:#fff}
.pgbld .stars{color:#f0a91e;letter-spacing:1px;font-size:13px}
.pgbld .secttl{font-size:30px;text-align:center;margin-bottom:8px;font-weight:800}
.pgbld .sectsub{text-align:center;color:var(--sub);font-size:14px;max-width:600px;margin:0 auto 34px}
.pgbld .eyebrow{text-align:center;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin-bottom:10px}

/* 1 · HERO */
.pgbld .hero{background:linear-gradient(180deg,var(--cream),#fff);padding:30px 0 44px}
.pgbld .hero .grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:start}
.pgbld .gmain{border-radius:18px;overflow:hidden;background:var(--card);aspect-ratio:1/1;border:1px solid var(--line)}
.pgbld .gmain img{width:100%;height:100%;object-fit:cover}
.pgbld .thumbs{display:flex;gap:8px;margin-top:10px}
.pgbld .thumbs img,.pgbld .thumbs .ph{width:60px;height:60px;object-fit:cover;border-radius:10px;border:1px solid var(--line);min-height:0}
.pgbld .rbar{display:inline-flex;align-items:center;gap:8px;background:var(--gold);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;color:#5c4610;margin-bottom:12px}
.pgbld .rbar .stars{color:#5c4610}
.pgbld .htitle{font-size:30px;font-weight:900;text-transform:uppercase;letter-spacing:0}
.pgbld .hkicker{font-size:13px;color:var(--sub);margin:8px 0 4px}
.pgbld .hsub{font-size:14.5px;color:#5f584a;margin:8px 0 16px}
.pgbld .hchecks{display:grid;grid-template-columns:1fr 1fr;gap:9px 16px;margin-bottom:18px}
.pgbld .hchecks .c{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.pgbld .hchecks .c .t{width:22px;height:22px;border-radius:50%;background:var(--gold);display:flex;align-items:center;justify-content:center;flex:none}
.pgbld .price{display:flex;align-items:baseline;gap:10px;margin:6px 0 14px}
.pgbld .price .was{font-size:15px;color:#b3a685;text-decoration:line-through}
.pgbld .price .now{font-size:24px;font-weight:900;color:var(--ink)}
.pgbld .price .save{font-size:11px;font-weight:800;color:#5c4610;background:var(--gold);border-radius:5px;padding:3px 8px}
.pgbld .titlesel{border:1px solid var(--line);border-radius:12px;padding:11px 14px;font-size:14px;margin-bottom:12px;background:#fff}
.pgbld .titlesel small{display:block;color:var(--sub);font-size:11px;margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em}
.pgbld .trust{display:flex;gap:18px;flex-wrap:wrap;margin-top:14px;font-size:12.5px;color:#6a6252;font-weight:600}
.pgbld .trust span{display:inline-flex;align-items:center;gap:6px}
.pgbld .hrev{display:flex;gap:12px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-top:16px}
.pgbld .hrev .av,.pgbld .hrev .av.ph{width:42px;height:42px;border-radius:50%;flex:none;min-height:0}
.pgbld .hrev .q{font-size:12.5px;color:#6a6252;line-height:1.5}
.pgbld .hrev .who{font-size:11.5px;font-weight:800;color:var(--ink);margin-top:6px;display:flex;align-items:center;gap:6px}
.pgbld .hrev .vf{font-size:10px;color:var(--amber);font-weight:800}
.pgbld .seeit{margin-top:22px}
.pgbld .seeit .lb{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--sub);margin-bottom:10px}
.pgbld .seeit .row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.pgbld .seeit .row .im,.pgbld .seeit .row .im.ph{aspect-ratio:3/4;border-radius:12px;min-height:0}

/* 2 · MOVE FORWARD (timeline + before/after) */
.pgbld .fwd{padding:56px 0;background:var(--cream)}
.pgbld .fwd .grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:40px;align-items:start;margin-top:6px}
.pgbld .ba{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px}
.pgbld .ba .cap{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:20px;text-align:center;margin-bottom:14px}
.pgbld .ba .pair{display:grid;grid-template-columns:1fr 1fr;gap:2px;border-radius:14px;overflow:hidden;background:var(--line)}
.pgbld .ba .im,.pgbld .ba .im.ph{aspect-ratio:4/5;border-radius:0;position:relative;min-height:0;overflow:hidden}
.pgbld .ba .badge{position:absolute;bottom:10px;background:rgba(42,35,24,.82);color:#fdf6e6;font-size:10.5px;font-weight:800;padding:4px 11px;border-radius:999px;letter-spacing:.05em}
.pgbld .ba .badge.bl{left:10px}
.pgbld .ba .badge.br{right:10px}
.pgbld .tl details{border:1px solid var(--line);border-radius:12px;margin-bottom:10px;background:var(--card);overflow:hidden}
.pgbld .tl summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:14px 16px}
.pgbld .tl summary::-webkit-details-marker{display:none}
.pgbld .tl .wk{background:var(--gold);color:#5c4610;font-size:10.5px;font-weight:800;padding:4px 9px;border-radius:6px;flex:none;text-transform:uppercase;letter-spacing:.04em}
.pgbld .tl .st{font-weight:800;font-size:14.5px}
.pgbld .tl summary::after{content:'⌄';margin-left:auto;color:var(--sub);font-size:18px}
.pgbld .tl .body{padding:0 16px 15px 55px;font-size:13px;color:var(--sub);margin-top:-4px}

/* 3 · REVIEWS strip */
.pgbld .revs{padding:48px 0}
.pgbld .revs .top{text-align:center;margin-bottom:26px}
.pgbld .revs .rate{font-size:12.5px;color:var(--sub);margin-top:6px}
.pgbld .revs .rate b{color:var(--ink)}
.pgbld .rgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.pgbld .rc{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.pgbld .rc .rn{font-weight:800;font-size:13px;margin-bottom:2px}
.pgbld .rc .rs{color:#f0a91e;font-size:12px;letter-spacing:1px;margin-bottom:8px}
.pgbld .rc p{font-size:12.5px;color:var(--sub);margin:0;line-height:1.5}

/* 4 · INSECURE (dark card) + SOLUTION */
.pgbld .sol{padding:44px 0 52px}
.pgbld .sol .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.pgbld .darkcard{background:var(--dark);border-radius:20px;padding:26px;color:#f6efe0;position:relative;overflow:hidden}
.pgbld .darkcard .im,.pgbld .darkcard .im.ph{aspect-ratio:1/1;border-radius:14px;margin-bottom:18px;min-height:0}
.pgbld .darkcard .ins{font-size:20px;font-weight:800;line-height:1.3;margin-bottom:16px}
.pgbld .darkcard .pill{display:inline-block;background:var(--gold);color:#5c4610;border-radius:7px;padding:2px 9px;font-size:15px;font-weight:800;margin:0 2px}
.pgbld .darkcard ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px}
.pgbld .darkcard li{display:flex;gap:10px;font-size:13px;color:#d9d1c0;line-height:1.45}
.pgbld .darkcard li .d{color:var(--gold);flex:none;font-weight:900}
.pgbld .sol h2{font-size:27px;font-weight:800;margin-bottom:12px}
.pgbld .sol .ssub{font-size:14px;color:var(--sub);margin-bottom:22px}
.pgbld .srow{display:flex;gap:14px;margin-bottom:16px;align-items:flex-start}
.pgbld .srow .ic{width:40px;height:40px;border-radius:11px;background:var(--cream2);color:var(--amber);display:flex;align-items:center;justify-content:center;flex:none}.pgbld .srow .ic svg{width:20px;height:20px}
.pgbld .srow .t b{font-size:13.5px;color:var(--ink)}
.pgbld .srow .t p{font-size:12.5px;color:var(--sub);margin:2px 0 0;line-height:1.45}

/* 5 · STRUGGLE (dark band + stats) */
.pgbld .strug{background:var(--dark);color:#f6efe0;padding:52px 0}
.pgbld .strug .grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .strug h2{font-size:26px;font-weight:800;line-height:1.2;margin-bottom:14px}
.pgbld .strug h2 .hl{color:var(--gold);font-style:italic}
.pgbld .strug p{font-size:13.5px;color:#c8c0af;line-height:1.6}
.pgbld .sstat{display:flex;align-items:center;gap:16px;margin-bottom:18px}
.pgbld .sstat .bd{width:60px;height:60px;border-radius:50%;border:2px solid var(--gold);color:var(--gold);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex:none}
.pgbld .sstat .t{font-size:13px;color:#d9d1c0;line-height:1.4}
.pgbld .sstat .t b{color:#fff}
.pgbld .strug .note{font-size:11px;color:#8f8779;margin-top:6px}

/* 6 · INGREDIENTS */
.pgbld .ing{padding:56px 0;background:var(--cream)}
.pgbld .igrid{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}
.pgbld .ig{text-align:center}
.pgbld .ig .im,.pgbld .ig .im.ph{width:120px;height:120px;border-radius:50%;object-fit:cover;margin:0 auto 14px;border:5px solid var(--card)}
.pgbld .ig h4{font-size:16px;font-weight:800;color:var(--amber);margin-bottom:5px}
.pgbld .ig p{font-size:12.5px;color:var(--sub);margin:0;line-height:1.45}

/* 7 · LIFESTYLE cards */
.pgbld .life{padding:52px 0}
.pgbld .lgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.pgbld .lc .im,.pgbld .lc .im.ph{aspect-ratio:1/1;border-radius:16px;margin-bottom:12px;min-height:0}
.pgbld .lc h4{font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:17px;color:var(--amber);margin-bottom:4px;text-align:center}
.pgbld .lc p{font-size:12.5px;color:var(--sub);margin:0;text-align:center;line-height:1.45}

/* 8 · AS SEEN ON (dark strip) */
.pgbld .press{background:var(--dark2);color:#efe7d5;padding:22px 0}
.pgbld .press .lb{text-align:center;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#b8ad93;margin-bottom:12px}
.pgbld .press .row{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:14px 34px}
.pgbld .press .row span{font-family:'Fraunces',Georgia,serif;font-size:19px;font-weight:500;opacity:.82;letter-spacing:.02em}

/* 9 · COMPARISON */
.pgbld .cmp{padding:56px 0;background:var(--cream)}
.pgbld .cmp .grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .cmp h2{font-size:27px;font-weight:800;margin-bottom:14px}
.pgbld .cmp p{font-size:14px;color:var(--sub);margin-bottom:20px}
.pgbld .ctable{position:relative;padding:0 4px}
.pgbld .ctable::before{content:'';position:absolute;top:-16px;bottom:6px;right:104px;width:96px;background:linear-gradient(180deg,#fbe6a8,#f8d989);border-radius:16px;z-index:0;box-shadow:0 12px 28px -14px rgba(230,165,44,.6)}
.pgbld .ctop,.pgbld .cr{position:relative;z-index:1;display:grid;grid-template-columns:1fr 100px 100px;align-items:center}
.pgbld .ctop{padding:12px 4px;font-size:11px;font-weight:800;color:var(--sub);text-transform:uppercase;letter-spacing:.04em;text-align:center}
.pgbld .ctop span:first-child{text-align:left}.pgbld .ctop .ours{color:#5c4610}
.pgbld .cr{padding:15px 4px;border-top:1px solid var(--line);font-size:14px}
.pgbld .cr>div:first-child{text-align:left;color:var(--ink);font-weight:600}
.pgbld .cr .m{text-align:center;display:flex;justify-content:center;align-items:center}

/* 10 · FAQ */
.pgbld .faq{padding:48px 0;max-width:820px;margin:0 auto}
.pgbld .faq details{border:1px solid var(--line);border-radius:12px;margin-bottom:10px;background:var(--card)}
.pgbld .faq summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:16px 18px;font-weight:700;font-size:14.5px}
.pgbld .faq summary::-webkit-details-marker{display:none}
.pgbld .faq summary::after{content:'+';margin-left:auto;color:var(--amber);font-size:20px;font-weight:400}
.pgbld .faq .body{padding:0 18px 16px;font-size:13.5px;color:var(--sub)}

/* 11 · GUARANTEE */
.pgbld .guar{padding:44px 0 60px}
.pgbld .guar .grid{display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:20px;align-items:center}
.pgbld .guar .side{display:grid;grid-template-rows:1fr 1fr;gap:14px}
.pgbld .guar .side .im,.pgbld .guar .side .im.ph{aspect-ratio:4/5;border-radius:16px;min-height:0}
.pgbld .guar .mid{text-align:center;background:var(--cream);border:1px solid var(--line);border-radius:20px;padding:34px 30px}
.pgbld .guar .mid .sh{width:64px;height:64px;border-radius:50%;background:var(--gold);display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.pgbld .guar .mid h2{font-size:26px;font-weight:800;margin-bottom:10px}
.pgbld .guar .mid p{font-size:13.5px;color:var(--sub);margin:0 auto 20px;max-width:420px;line-height:1.55}
.pgbld .guar .mid .btn{max-width:320px;margin:0 auto}
.pgbld .guar .mid .tsel{max-width:320px;margin:12px auto 0;border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:13px;background:#fff;text-align:left;color:var(--sub)}

@media(max-width:900px){
  .pgbld .hero .grid,.pgbld .fwd .grid,.pgbld .sol .grid,.pgbld .strug .grid,.pgbld .cmp .grid{grid-template-columns:1fr}
  .pgbld .igrid{grid-template-columns:1fr 1fr}
  .pgbld .rgrid,.pgbld .lgrid{grid-template-columns:1fr}
  .pgbld .guar .grid{grid-template-columns:1fr}
  .pgbld .guar .side{grid-template-rows:none;grid-template-columns:1fr 1fr}
}
@media(max-width:520px){
  .pgbld .hchecks{grid-template-columns:1fr}
  .pgbld .igrid{grid-template-columns:1fr 1fr}
  .pgbld .seeit .row{grid-template-columns:1fr 1fr}
  .pgbld .wrap{padding:0 16px}
}
`.trim()

function render(c: FilledContent, o: RenderOpts): string {
  const P = o.productImage
  const price = o.priceLabel || ''

  const checks = (arr(c.hero_benefits).length ? arr(c.hero_benefits) : ['Smooth glass finish', 'Effortless morning glow', 'Fade acne, feel confident', 'Targets stubborn spots'].map((l) => ({ label: l })))
    .slice(0, 4).map((f) => `<div class="c"><span class="t">${TICK}</span>${escp(f.label)}</div>`).join('')
  const thumbs = [c.image_main, c.image_g2, c.image_g3, c.image_g4, c.image_g5].map((u) => img(u || P, o.productName, '', 'Img')).join('')
  const seeit = [c.image_see1, c.image_see2, c.image_see3, c.image_see4].map((u) => img(u || P, o.productName, 'im', 'Result')).join('')

  const weeks = (arr(c.timeline).length ? arr(c.timeline) : [
    { label: 'Week 1', title: 'The First Layer', body: 'You notice how easily the formula sinks in, leaving your skin feeling hydrated and ready for the day.' },
    { label: 'Week 2', title: 'The Soft Transition', body: 'You stop noticing those specific spots that used to bother you. Everything starts to feel more balanced and calm.' },
    { label: 'Week 3', title: 'Waking Up Bright', body: 'The morning mirror feels like a much friendlier place as your natural tone appears more even and clear.' },
    { label: 'Week 4', title: 'A Reliable Routine Found', body: 'Confidence becomes your default setting. You spend less time worrying about coverage and more time enjoying the result.' },
  ]).slice(0, 4).map((w, i) => `<details${i === 0 ? ' open' : ''}><summary><span class="wk">${escp(w.label || `Week ${i + 1}`)}</span><span class="st">${escp(w.title)}</span></summary><div class="body">${esc(w.body)}</div></details>`).join('')

  const revs = (arr(c.testimonials).length ? arr(c.testimonials) : [
    { name: 'Bee L.', quote: 'Noticed a gentle shift. It helps keep those surface discolorations from looking so angry.' },
    { name: 'Samira P.', quote: 'My confidence is up because I don’t feel the need to cover everything anymore. The clarity is incredible.' },
    { name: 'Mia O.', quote: 'This absolutely helped tackle those lingering reminders of old breakouts. Skin just looks more uniform now.' },
  ]).slice(0, 3).map((t) => `<div class="rc"><div class="rn">${escp(t.name)}</div><div class="rs">★★★★★</div><p>${esc(t.quote)}</p></div>`).join('')

  const insPoints = (arr(c.insecure_points).length ? arr(c.insecure_points) : ['Bring back natural glow', 'Helps with hyperpigmentation and melasma', 'Supports skin’s natural collagen production'].map((l) => ({ label: l })))
    .slice(0, 3).map((p) => `<li><span class="d">•</span><span>${escp(p.label)}</span></li>`).join('')

  const solRows = (arr(c.solution_rows).length ? arr(c.solution_rows) : [
    { title: 'It calms the lamp light', body: 'Redness fades instantly. Finally, it looks like a calm reflection.' },
    { title: 'It evens tone', body: 'Fading the trace of dark spots. Everything feels softer, more unified, more balanced.' },
    { title: 'It brightens the surface', body: 'It erases the surface in targeted radiance. It just plays bright, clear and completely still.' },
  ]).slice(0, 3).map((r, i) => `<div class="srow"><div class="ic">${ICONS[i % ICONS.length]}</div><div class="t"><b>${escp(r.title || r.label)}</b><p>${esc(r.body)}</p></div></div>`).join('')

  const stats = (arr(c.struggle_stats).length ? arr(c.struggle_stats) : [
    { label: '96%', body: 'Noticed a balanced tone without harsh layering.' },
    { label: '94%', body: 'Felt more confident using fewer concealing products.' },
    { label: '92%', body: 'Experienced a natural pump that lasted all evening.' },
  ]).slice(0, 3).map((s) => `<div class="sstat"><div class="bd">${escp(s.label)}</div><div class="t">${bd(s.body)}</div></div>`).join('')

  const ings = (arr(c.ingredients).length ? arr(c.ingredients) : [
    { name: 'Niacinamide', body: 'Helps your skin feel balanced and smooth.' },
    { name: 'Licorice Root', body: 'Promotes a calm and steady complexion.' },
    { name: 'Vitamin C', body: 'Brings a natural brightness to your morning.' },
    { name: 'Turmeric', body: 'Keeps your texture feeling soft and dewy.' },
  ]).slice(0, 4).map((g: any, i: number) => `<div class="ig">${img(g.image, o.productName, 'im', g.name || 'Ingredient')}<h4>${escp(g.name || g.title)}</h4><p>${esc(g.body)}</p></div>`).join('')

  const lifeCards = (arr(c.life_cards).length ? arr(c.life_cards) : [
    { title: 'Gentle Application', body: 'The formula glides on and sinks in comfortably.' },
    { title: 'Steady Focus', body: 'It works quietly to help spots fade away.' },
    { title: 'Luminous Finish', body: 'Step out feeling confident with your clear complexion.' },
  ]).slice(0, 3).map((l: any, i: number) => `<div class="lc">${img(l.image, o.productName, 'im', 'Lifestyle')}<h4>${escp(l.title)}</h4><p>${esc(l.body)}</p></div>`).join('')

  const press = (arr(c.press_logos).length ? arr(c.press_logos) : ['New Scientist', 'Bloomberg', 'Cosmopolitan', 'Women’s Health', 'Allure', 'New Scientist'].map((l) => ({ label: l })))
    .map((p) => `<span>${escp(p.label)}</span>`).join('')

  const cmpRows = (arr(c.compare_rows).length ? arr(c.compare_rows) : ['Balanced Tone', 'Gentle Fading', 'Glass Finish', 'Smooth Texture', 'Deep Radiance', 'Even Clarity'].map((l) => ({ label: l })))
    .map((r) => `<div class="cr"><div>${escp(r.label)}</div><div class="m">${CHK}</div><div class="m">${XMARK}</div></div>`).join('')

  const faqs = (arr(c.faqs).length ? arr(c.faqs) : [
    { q: 'What exactly does this do for uneven tone?', a: 'It fades the look of dark spots and uneven areas so your natural tone looks clearer and more balanced.' },
    { q: 'How do I start using this to see results?', a: 'Apply a thin layer morning and night on clean skin. Most people see a difference within a few weeks.' },
    { q: 'What is your shipping and return situation?', a: 'Fast, tracked delivery and a 30-day money-back guarantee if it isn’t right for you.' },
    { q: 'Does this irritate sensitive areas on the face?', a: 'It’s formulated to be gentle and calming, even around more sensitive areas.' },
    { q: 'What if this doesn’t clear up my dark spots?', a: 'You’re covered by our money-back guarantee — return it for a full refund, no questions asked.' },
  ]).map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${escp(f.q)}</summary><div class="body">${esc(f.a)}</div></details>`).join('')

  return `<div class="pgbld">

  <!-- 1 · HERO -->
  <section class="hero"><div class="wrap"><div class="grid">
    <div>
      <div class="gmain">${img(c.image_main || P, o.productName, 'gimg', 'Product photo')}</div>
      <div class="thumbs">${thumbs}</div>
    </div>
    <div>
      <div class="rbar"><span class="stars">★★★★★</span> ${escp(c.rating_label || `Rated ${o.rating?.stars || '4.9'} by 12,400 buyers`)}</div>
      <h1 class="htitle">${esc(c.headline || o.productName)}</h1>
      <div class="hkicker">${escp(c.kicker || 'Your essential bright skin routine.')}</div>
      <div class="hsub">${bd(c.subhead || 'Wake up to clearer skin by fading the look of lingering marks and uneven spots.')}</div>
      <div class="hchecks">${checks}</div>
      <div class="price">${c.compare_at ? `<span class="was">${escp(c.compare_at)}</span>` : ''}${price ? `<span class="now">${esc(price)}</span>` : ''}${c.save_pill ? `<span class="save">${escp(c.save_pill)}</span>` : ''}</div>
      <div class="titlesel"><small>Title</small>${escp(c.title_option || 'Default Title')}</div>
      <a class="btn" href="${esc(o.ctaHref || '#')}">🛒 ${escp(c.cta_label || 'Add to Cart')}</a>
      <div class="trust"><span>🛡 ${escp(c.guarantee_line || '30-Day Money-Back Guarantee')}</span><span>🚚 ${escp(c.shipping_line || 'Free Shipping Included')}</span></div>
      <div class="hrev">
        <div class="av">${img(c.image_reviewer, 'Reviewer', 'avim', '')}</div>
        <div><div class="q">${esc(c.hero_review || 'This routine quietly became the one step I never skip. My skin looks calmer and more even, and I feel confident going makeup-free again.')}</div><div class="who">${escp(c.hero_review_name || 'Verified Buyer')} <span class="vf">✔ Verified</span></div></div>
      </div>
      <div class="seeit"><div class="lb">See It In Action</div><div class="row">${seeit}</div></div>
    </div>
  </div></div></section>

  <!-- 2 · MOVE FORWARD -->
  <section class="fwd"><div class="wrap">
    <h2 class="secttl">${hl(c.forward_head || 'Move Forward With Us')}</h2>
    <div class="sectsub">${esc(c.forward_sub || 'Finding your glow feels simple and grounding. Start today to rediscover a sense of quiet confidence.')}</div>
    <div class="grid">
      <div class="ba"><div class="cap">${hl(c.ba_caption || 'Real People, Real Results')}</div><div class="pair">
        <div class="im">${img(c.image_before || P, o.productName, 'gimg', 'Before')}<span class="badge bl">${escp(c.ba_before_label || 'Before')}</span></div>
        <div class="im">${img(c.image_after || P, o.productName, 'gimg', 'After')}<span class="badge br">${escp(c.ba_after_label || 'After')}</span></div>
      </div></div>
      <div class="tl">${weeks}</div>
    </div>
  </div></section>

  <!-- 3 · REVIEWS -->
  <section class="revs"><div class="wrap">
    <div class="top"><h2 class="secttl">${hl(c.reviews_head || 'See Real Stories of Even Skin')}</h2><div class="rate"><span class="stars">★★★★★</span> ${escp(c.reviews_rating || `Rated ${o.rating?.stars || '4.9'}/5 based on 1,426+ Trusted Reviews`)}</div></div>
    <div class="rgrid">${revs}</div>
  </div></section>

  <!-- 4 · INSECURE + SOLUTION -->
  <section class="sol"><div class="wrap"><div class="grid">
    <div class="darkcard">
      <div class="im">${img(c.image_insecure || P, o.productName, 'gimg', 'Portrait')}</div>
      <div class="ins">${escp(c.insecure_lead || 'Insecure about')} <span class="pill">${escp(c.insecure_tag1 || 'HYPERPIGMENTATION')}</span> ${escp(c.insecure_and || 'and')} <span class="pill">${escp(c.insecure_tag2 || 'DARK SPOTS')}</span></div>
      <ul>${insPoints}</ul>
    </div>
    <div>
      <h2>${hl(c.solution_head || 'Quiet Brilliance Tone Smoothing Essential')}</h2>
      <div class="ssub">${bd(c.solution_sub || 'It glides on cool, evening out the shadows. Feels like soft against glass skin.')}</div>
      ${solRows}
      <a class="btn" style="width:auto;margin-top:8px" href="${esc(o.ctaHref || '#')}">${escp(c.solution_cta || 'Get Yours Now')}</a>
    </div>
  </div></div></section>

  <!-- 5 · STRUGGLE -->
  <section class="strug"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.struggle_head || 'The Tone Struggle — **Missing The Mark**')}</h2>
      <p>${bd(c.struggle_body || 'Many products focus on temporary brightness while often neglecting the underlying cycle of dark spots. This leaves skin feeling uneven and dull after the initial glow fades away.')}</p>
    </div>
    <div>
      ${stats}
      <div class="note">${escp(c.struggle_note || 'Based on self-reported results from 200 customers who used this kit consistently over a 2-month period.')}</div>
    </div>
  </div></div></section>

  <!-- 6 · INGREDIENTS -->
  <section class="ing"><div class="wrap">
    <div class="eyebrow">Inside Your Even Glow</div>
    <h2 class="secttl">${hl(c.ing_head || 'Thoughtful Ingredients For Your Daily Ritual')}</h2>
    <div class="sectsub">${esc(c.ing_sub || 'Every ingredient is chosen to gently support a clearer, more even and radiant complexion.')}</div>
    <div class="igrid">${ings}</div>
  </div></section>

  <!-- 7 · LIFESTYLE -->
  <section class="life"><div class="wrap">
    <h2 class="secttl">${hl(c.life_head || 'Effortless Balanced Glow')}</h2>
    <div class="sectsub">${esc(c.life_sub || 'Achieving an even, radiant look feels completely natural.')}</div>
    <div class="lgrid">${lifeCards}</div>
  </div></section>

  <!-- 8 · AS SEEN ON -->
  <section class="press"><div class="wrap"><div class="lb">As Seen On</div><div class="row">${press}</div></div></section>

  <!-- 9 · COMPARISON -->
  <section class="cmp"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.compare_head || 'What Makes Us Different')}</h2>
      <p>${bd(c.compare_body || 'We fade shadows and smooth uneven patches without irritation. Your skin achieves a clear, lit-from-within glow naturally.')}</p>
    </div>
    <div class="ctable"><div class="ctop"><span>Feature</span><span class="ours">Ours</span><span>Others</span></div>${cmpRows}</div>
  </div></div></section>

  <!-- 10 · FAQ -->
  <section><div class="wrap"><h2 class="secttl" style="margin-bottom:26px">${hl(c.faq_head || 'Frequently Asked Questions')}</h2><div class="faq">${faqs}</div></div></section>

  <!-- 11 · GUARANTEE -->
  <section class="guar"><div class="wrap"><div class="grid">
    <div class="side"><div class="im">${img(c.image_guar1 || P, o.productName, 'gimg', 'Result')}</div><div class="im">${img(c.image_guar2 || P, o.productName, 'gimg', 'Result')}</div></div>
    <div class="mid">
      <div class="sh">${SHIELD}</div>
      <h2>${hl(c.guarantee_head || 'Risk-Free Guarantee')}</h2>
      <p>${esc(c.guarantee_body || 'We’re so confident in the quality of our product that we offer a satisfaction guarantee. If you’re not completely satisfied, simply return the item within 30 days for a full refund.')}</p>
      <a class="btn" href="${esc(o.ctaHref || '#')}">${escp(c.guarantee_cta || 'Buy It Now')}</a>
      <div class="tsel"><small style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Title</small>${escp(c.title_option || 'Default Title')}</div>
    </div>
    <div class="side"><div class="im">${img(c.image_guar3 || P, o.productName, 'gimg', 'Result')}</div><div class="im">${img(c.image_guar4 || P, o.productName, 'gimg', 'Result')}</div></div>
  </div></div></section>

  </div>`
}

export const radianceV1: PageTemplate = {
  id: 'radiance_v1',
  type: 'product',
  name: 'Glass Skin Radiance (Gold)',
  description: 'Warm gold/cream skincare PDP — buy-box with benefit checks + guarantee, 4-week results timeline with before/after, reviews, dark problem card + solution, stat band, ingredients row, lifestyle cards, press strip, comparison, FAQ and a risk-free guarantee.',
  css,
  render,
  schema: [
    { key: 'headline', type: 'text', role: 'headline', label: 'Product title' },
    { key: 'rating_label', type: 'text', label: 'Rating bar text', hint: 'e.g. "Rated 4.9 by 12,400 buyers".' },
    { key: 'kicker', type: 'text', label: 'Kicker line', hint: 'e.g. "Your essential bright skin routine".' },
    { key: 'subhead', type: 'richtext', role: 'body', label: 'Hero subhead' },
    { key: 'hero_benefits', type: 'list', label: 'Hero benefit checks', count: 4, hint: 'Each label only: a short benefit (e.g. "Smooth glass finish").' },
    { key: 'compare_at', type: 'text', label: 'Compare-at price' },
    { key: 'save_pill', type: 'text', label: 'Save pill', hint: 'e.g. "20% off".' },
    { key: 'cta_label', type: 'text', label: 'Add-to-cart label' },
    { key: 'guarantee_line', type: 'text', label: 'Guarantee line (hero)' },
    { key: 'shipping_line', type: 'text', label: 'Shipping line (hero)' },
    { key: 'hero_review', type: 'richtext', role: 'body', label: 'Hero review quote' },
    { key: 'hero_review_name', type: 'text', label: 'Hero reviewer name' },
    { key: 'image_main', type: 'image', role: 'product', label: 'Main product image' },
    { key: 'image_g2', type: 'image', role: 'product', label: 'Gallery image 2' },
    { key: 'image_g3', type: 'image', role: 'product', label: 'Gallery image 3' },
    { key: 'image_g4', type: 'image', role: 'lifestyle', label: 'Gallery image 4' },
    { key: 'image_g5', type: 'image', role: 'lifestyle', label: 'Gallery image 5' },
    { key: 'image_reviewer', type: 'image', role: 'lifestyle', label: 'Hero reviewer avatar' },
    { key: 'image_see1', type: 'image', role: 'lifestyle', label: 'See-it-in-action photo 1' },
    { key: 'image_see2', type: 'image', role: 'lifestyle', label: 'See-it-in-action photo 2' },
    { key: 'image_see3', type: 'image', role: 'lifestyle', label: 'See-it-in-action photo 3' },
    { key: 'image_see4', type: 'image', role: 'lifestyle', label: 'See-it-in-action photo 4' },
    { key: 'forward_head', type: 'text', label: '"Move forward" heading' },
    { key: 'forward_sub', type: 'text', label: '"Move forward" subhead' },
    { key: 'ba_caption', type: 'text', label: 'Before/after card caption' },
    { key: 'ba_before_label', type: 'text', label: 'Before/after — left label', hint: 'e.g. "Before".' },
    { key: 'ba_after_label', type: 'text', label: 'Before/after — right label', hint: 'e.g. "After".' },
    { key: 'image_before', type: 'image', role: 'lifestyle', label: 'Before photo' },
    { key: 'image_after', type: 'image', role: 'lifestyle', label: 'After photo' },
    { key: 'timeline', type: 'reasons', label: 'Weekly timeline (4)', count: 4, hint: 'label = "Week 1"…; title = the week’s headline; body = one or two sentences.' },
    { key: 'reviews_head', type: 'text', label: 'Reviews heading' },
    { key: 'reviews_rating', type: 'text', label: 'Reviews rating line' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews (3)', count: 3, hint: 'name + quote.' },
    { key: 'insecure_lead', type: 'text', label: 'Insecure card lead', hint: 'e.g. "Insecure about".' },
    { key: 'insecure_tag1', type: 'text', label: 'Insecure highlight 1', hint: 'e.g. "HYPERPIGMENTATION".' },
    { key: 'insecure_and', type: 'text', label: 'Insecure joining word', hint: 'e.g. "and".' },
    { key: 'insecure_tag2', type: 'text', label: 'Insecure highlight 2', hint: 'e.g. "DARK SPOTS".' },
    { key: 'insecure_points', type: 'list', label: 'Insecure card bullets', count: 3, hint: 'Each label only.' },
    { key: 'image_insecure', type: 'image', role: 'lifestyle', label: 'Insecure card portrait' },
    { key: 'solution_head', type: 'text', label: 'Solution heading' },
    { key: 'solution_sub', type: 'richtext', role: 'body', label: 'Solution subhead' },
    { key: 'solution_rows', type: 'reasons', label: 'Solution rows (3)', count: 3, hint: 'title = short claim; body = one sentence.' },
    { key: 'solution_cta', type: 'text', label: 'Solution button' },
    { key: 'struggle_head', type: 'text', label: 'Struggle heading', hint: 'Wrap the accent in ** ** (e.g. "The Tone Struggle — **Missing The Mark**").' },
    { key: 'struggle_body', type: 'richtext', role: 'body', label: 'Struggle paragraph' },
    { key: 'struggle_stats', type: 'reasons', label: 'Struggle stats (3)', count: 3, hint: 'label = a percentage like "96%"; body = what improved.' },
    { key: 'struggle_note', type: 'text', label: 'Struggle footnote' },
    { key: 'ing_head', type: 'text', label: 'Ingredients heading' },
    { key: 'ing_sub', type: 'text', label: 'Ingredients subhead' },
    { key: 'ingredients', type: 'reasons', label: 'Ingredients (4)', count: 4, hint: 'name/title = the ingredient; body = one line. Each has its own image slot.' },
    { key: 'life_head', type: 'text', label: 'Lifestyle heading' },
    { key: 'life_sub', type: 'text', label: 'Lifestyle subhead' },
    { key: 'life_cards', type: 'reasons', label: 'Lifestyle cards (3)', count: 3, hint: 'title + body; each has its own image slot.' },
    { key: 'press_logos', type: 'list', label: 'Press / "as seen on" names', count: 6, hint: 'Each label only: a publication name.' },
    { key: 'compare_head', type: 'text', label: 'Comparison heading' },
    { key: 'compare_body', type: 'richtext', role: 'body', label: 'Comparison paragraph' },
    { key: 'compare_rows', type: 'list', label: 'Comparison rows', count: 6, hint: 'Each label only: a feature you have and rivals don\'t.' },
    { key: 'faq_head', type: 'text', label: 'FAQ heading' },
    { key: 'faqs', type: 'faq', label: 'FAQ', count: 5, hint: 'Cover what it does, how to use, shipping/returns, sensitivity, guarantee.' },
    { key: 'guarantee_head', type: 'text', label: 'Guarantee heading' },
    { key: 'guarantee_body', type: 'richtext', role: 'body', label: 'Guarantee paragraph' },
    { key: 'guarantee_cta', type: 'text', label: 'Guarantee button' },
    { key: 'image_guar1', type: 'image', role: 'lifestyle', label: 'Guarantee photo (left top)' },
    { key: 'image_guar2', type: 'image', role: 'lifestyle', label: 'Guarantee photo (left bottom)' },
    { key: 'image_guar3', type: 'image', role: 'lifestyle', label: 'Guarantee photo (right top)' },
    { key: 'image_guar4', type: 'image', role: 'lifestyle', label: 'Guarantee photo (right bottom)' },
  ],
}
