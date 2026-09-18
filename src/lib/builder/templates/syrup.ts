/**
 * syrup_v1 — a hair-care pre-wash scalp-oil PDP in a clean white/indigo aesthetic, modelled
 * section-for-section on the PagePilot "Lemon Aid Pre-Wash Scalp Treatment" reference: hero creative
 * (headline + two-part benefit pills + bottle) beside a buy-box (bestseller badge, rating, benefit
 * checks, sale price, guarantee row, info accordion, review snippet, low-stock warning), a scrolling
 * pill strip, a "trusted by" split with lifestyle photos, a "how it works" split with a light
 * ingredient card, a vs-the-rest comparison card beside a numbered benefits list, a reviews block with
 * a press-quote strip, a stat band of circular percentage rings, a 3-up feature-card row, a
 * gold-standard comparison table, and a final CTA band. The page is predominantly white with indigo
 * accents. Layout is FIXED; the AI only fills `schema` slots. All CSS scoped under `.pgbld`. Responsive.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'
import { paysRowInner, benefitCheckIcon } from '../payicons'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const escp = (s: any) => esc(String(s ?? '').replace(/\*\*/g, '').replace(/^\s*[-•*]\s*/, '').trim())
const hl = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<span class="hl">$1</span>')
const bd = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
const arr = (v: SlotValue | undefined) => (Array.isArray(v) ? v : [])
const pctOf = (s: any) => { const m = String(s ?? '').match(/\d+/); return m ? parseInt(m[0], 10) : 95 }
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
.pgbld{--blue:#3f4bd6;--blue2:#5563f0;--ink:#191b3a;--sub:#6a6e93;--soft:#f3f4fe;--soft2:#eaecfd;--card:#ffffff;--line:#e7e9f7;--dark:#eef0fe;--deep:#f3f4fe;--good:#3f4bd6;--warn:#e88a2a;
  font-family:'Inter',system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);line-height:1.5;background:#fff;-webkit-font-smoothing:antialiased}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld .ph{background:#f1f2fc;border:1.5px dashed #d5d9f2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#a3a9d8;font-size:12px;min-height:120px;border-radius:14px;text-align:center;padding:14px}
.pgbld .ph .phi svg{width:30px;height:30px}
.pgbld .ph .phl{font-weight:700}
.pgbld .wrap{max-width:1140px;margin:0 auto;padding:0 22px}
.pgbld h1,.pgbld h2,.pgbld h3,.pgbld h4{margin:0;letter-spacing:-.02em;line-height:1.16}
.pgbld .hl{font-family:'Fraunces',Georgia,serif;font-style:italic;font-weight:500;letter-spacing:0}
.pgbld .btn{display:inline-flex;align-items:center;justify-content:center;gap:9px;background:linear-gradient(180deg,#4a56ea,#3a45d0);color:#fff;border:0;border-radius:999px;padding:15px 30px;font-size:15px;font-weight:800;cursor:pointer;text-decoration:none;width:100%;box-shadow:0 12px 24px -12px rgba(63,75,214,.7)}
.pgbld .pays{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;align-items:center}
.pgbld .pays span{font-size:10px;font-weight:800;color:#8f93bb;border:1px solid var(--line);border-radius:5px;padding:3px 7px;background:#fff}
.pgbld .payicon{display:inline-flex;align-items:center;line-height:0}
.pgbld .payicon svg{display:block;border-radius:4px}
.pgbld .stars{color:#4a56ea;letter-spacing:1px;font-size:13px}
.pgbld .secttl{font-size:30px;text-align:center;margin-bottom:8px;font-weight:800}
.pgbld .sectsub{text-align:center;color:var(--sub);font-size:14px;max-width:620px;margin:0 auto 32px}

/* 1 · HERO */
.pgbld .hero{padding:26px 0 40px}
.pgbld .hero .grid{display:grid;grid-template-columns:1.05fr 1fr;gap:36px;align-items:start}
.pgbld .hcre{background:linear-gradient(180deg,var(--soft),#fff);border:1px solid var(--line);border-radius:20px;padding:22px}
.pgbld .hcre .hd{font-size:20px;font-weight:900;line-height:1.18;margin-bottom:4px}
.pgbld .hcre .hd .hl{color:var(--blue)}
.pgbld .hcre .sd{font-size:14px;color:var(--sub);font-weight:500;margin-bottom:14px}
.pgbld .hcre .mid{display:grid;grid-template-columns:1fr .9fr;gap:12px;align-items:center}
.pgbld .ppills{display:flex;flex-direction:column;gap:8px}
.pgbld .ppill{display:grid;grid-template-columns:auto 1fr;border-radius:999px;overflow:hidden;font-size:10.5px;font-weight:800;box-shadow:0 3px 8px -5px rgba(63,75,214,.5)}
.pgbld .ppill .a{background:var(--blue);color:#fff;padding:6px 11px;white-space:nowrap}
.pgbld .ppill .b{background:#fff;color:var(--ink);padding:6px 11px;border:1px solid var(--line);border-left:0}
.pgbld .ppill.solo{display:inline-flex;grid-template-columns:none;align-self:flex-start;box-shadow:none}
.pgbld .ppill.solo .a{border-radius:999px;padding:6px 15px}
.pgbld .hbottle,.pgbld .hbottle.ph{aspect-ratio:3/4;border-radius:12px;min-height:0}
.pgbld .gwrap{position:relative}
.pgbld .garr{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.94);border:1px solid var(--line);display:grid;place-items:center;font-size:18px;color:var(--ink);cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.14);z-index:2;line-height:1;padding:0}
.pgbld .gwrap .gprev{left:6px}
.pgbld .gwrap .gnext{right:6px}
.pgbld .thumbs{display:flex;gap:8px;margin-top:12px}
.pgbld .thumbs img,.pgbld .thumbs .ph{width:56px;height:56px;object-fit:cover;border-radius:9px;border:1px solid var(--line);min-height:0;cursor:pointer}
.pgbld .thumbs img.on{border-color:var(--blue);border-width:2px}
/* clean hero gallery (real product images) + relocated benefit-creative section */
.pgbld .pgal .hbottle,.pgbld .pgal .hbottle.ph{aspect-ratio:4/5;width:100%;object-fit:contain;background:var(--soft)}
.pgbld .pcre{padding:6px 0 26px}
.pgbld .pcre-img .pcrei,.pgbld .pcre-img .ph{aspect-ratio:3/4;border-radius:12px;min-height:0;width:100%;object-fit:cover}
.pgbld .bestseller{display:inline-flex;align-items:center;gap:9px;background:var(--soft2);border:1px solid var(--line);border-radius:10px;padding:7px 12px;margin-bottom:12px}
.pgbld .bestseller .num{background:var(--blue);color:#fff;font-size:14px;font-weight:700;border-radius:6px;padding:3px 8px;flex:none}
.pgbld .bestseller .bst{display:flex;flex-direction:column;line-height:1.25}
.pgbld .bestseller .bst b{font-size:12px;font-weight:600;color:var(--ink);letter-spacing:.02em}
.pgbld .bestseller .bst span{font-size:11px;font-weight:400;color:var(--sub)}
.pgbld .ptitle{font-family:'Fraunces',Georgia,serif;font-size:32px;font-weight:600;line-height:1.12;letter-spacing:-.01em}
.pgbld .rlabel{font-size:14px;color:var(--sub);margin:7px 0 12px}
.pgbld .sfdiv{height:1px;width:100%;background:var(--line);border:0;margin:16px 0}
.pgbld .hchecks{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-bottom:16px}
.pgbld .hchecks .c{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:500}
.pgbld .hchecks .c .t{width:22px;height:22px;border-radius:50%;background:var(--soft2);color:var(--blue);display:flex;align-items:center;justify-content:center;flex:none}
.pgbld .vpick{margin-bottom:14px}
.pgbld .vpick .vlabel{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--sub);margin-bottom:8px}
.pgbld .vpick .vopts{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pgbld .vpick.list .vopts{grid-template-columns:1fr}
.pgbld .vpick .vopt{border:1.5px solid var(--line);background:#fff;color:var(--ink);border-radius:10px;padding:11px 12px;font-size:12.5px;font-weight:700;cursor:pointer;text-align:left}
.pgbld .vpick .vopt.on{border-color:var(--blue);background:var(--soft)}
.pgbld .price{display:flex;align-items:baseline;gap:10px;margin:4px 0 14px}
.pgbld .price .was{font-size:15px;color:#a6aac9;text-decoration:line-through}
.pgbld .price .now{font-size:24px;font-weight:900;color:var(--blue)}
.pgbld .price .save{font-size:11px;font-weight:800;color:#fff;background:var(--blue);border-radius:5px;padding:3px 8px}
.pgbld .grow{display:flex;gap:22px;flex-wrap:wrap;justify-content:center;margin:12px 0;font-size:13px;color:#6a6e93;font-weight:600}
.pgbld .grow span{display:inline-flex;align-items:center;gap:6px}
.pgbld .acc{margin-top:14px;border-top:1px solid var(--line)}
.pgbld .acc details{border-bottom:1px solid var(--line)}
.pgbld .acc summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:12px 2px;font-weight:600;font-size:14px}
.pgbld .acc summary::-webkit-details-marker{display:none}
.pgbld .acc summary::after{content:'⌄';margin-left:auto;color:var(--sub);font-size:17px}
.pgbld .acc .body{padding:0 2px 12px;font-size:14px;color:var(--sub);line-height:1.55}
.pgbld .hclaim{font-size:12px;color:var(--sub);text-align:center;margin-top:12px}
.pgbld .hrev{display:flex;gap:12px;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:13px 14px;margin-top:12px}
.pgbld .hrev .av,.pgbld .hrev .av.ph{width:40px;height:40px;border-radius:50%;flex:none;min-height:0}
.pgbld .hrev .q{font-size:12px;color:#6a6e93;line-height:1.5}
.pgbld .hrev .who{font-size:11px;font-weight:800;margin-top:5px}
.pgbld .warn{display:flex;gap:9px;background:#fdf1e2;border:1px solid #f5d9b4;border-radius:10px;padding:11px 13px;margin-top:12px;font-size:11.5px;color:#8a5a1e}
.pgbld .warn b{color:#b06a1c}

/* 2 · PILL STRIP */
/* Rotating Benefits — a horizontally-scrolling marquee band of icon pills (matches PagePilot's rotating row). */
.pgbld .strip{background:var(--blue);padding:16px 0;overflow:hidden}
.pgbld .strip .striptrack{display:flex;width:max-content;gap:14px;animation:sfmarquee 30s linear infinite}
.pgbld .strip:hover .striptrack{animation-play-state:paused}
.pgbld .strip .benfc{display:inline-flex;align-items:center;gap:9px;background:#fff;color:var(--ink);border-radius:999px;padding:10px 20px;font-size:14px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px -3px rgba(20,18,15,.25);flex:none}
.pgbld .strip .benfc .pico{display:inline-flex;color:var(--blue);flex:none}
.pgbld .strip .benfc .pico svg{width:16px;height:16px}
@keyframes sfmarquee{from{transform:translateX(0)}to{transform:translateX(calc(-50% - 7px))}}

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
.pgbld .sci{background:var(--dark);border:1px solid var(--line);border-radius:22px;padding:26px;color:var(--ink);text-align:center}
.pgbld .sci h3{font-size:18px;font-weight:800;margin-bottom:4px}
.pgbld .sci .ss{font-size:11.5px;color:var(--sub);margin-bottom:16px}
.pgbld .sci .body{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;text-align:left}
.pgbld .sci .ic{display:flex;gap:9px;margin-bottom:16px}
.pgbld .sci .ic .d{width:32px;height:32px;border-radius:9px;background:var(--soft2);display:flex;align-items:center;justify-content:center;flex:none;color:var(--blue)}.pgbld .sci .ic .d svg{width:16px;height:16px}
.pgbld .sci .ic .t b{font-size:11.5px;color:var(--ink);display:block}
.pgbld .sci .ic .t span{font-size:10.5px;color:var(--sub)}
.pgbld .sci .im,.pgbld .sci .im.ph{aspect-ratio:3/4;border-radius:12px;min-height:0}
.pgbld .sci .brand{margin-top:14px;font-size:11px;color:var(--sub)}.pgbld .sci .brand b{color:var(--ink);font-size:14px;display:block}

/* 5 · VERSUS + BENEFITS */
.pgbld .vs{padding:8px 0 52px}
.pgbld .vs .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.pgbld .vs h2{font-size:24px;font-weight:800;margin-bottom:6px}
.pgbld .vs .vsub{font-size:13px;color:var(--sub);margin-bottom:18px}
.pgbld .vcard{background:var(--soft);border:1px solid var(--line);border-radius:18px;padding:18px;display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center}
.pgbld .vcol h5{font-size:12px;font-weight:800;text-align:center;margin-bottom:10px}
.pgbld .vcol .r{display:flex;align-items:flex-start;gap:7px;font-size:11px;font-weight:600;margin-bottom:9px;color:var(--ink)}
.pgbld .vcol.o .r{color:var(--sub)}
.pgbld .vcol .r .ic{flex:none;margin-top:1px;display:inline-flex}
.pgbld .vcol .r .ic svg{display:block}
.pgbld .vcol .r .rt{flex:1}
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
.pgbld .stats .sc{background:linear-gradient(160deg,#6a5cf0,#4433c4);color:#fff;border-radius:18px;padding:26px 18px;text-align:center}
@property --p{syntax:'<number>';inherits:false;initial-value:0}
.pgbld .stats .ring{width:104px;height:104px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;background:conic-gradient(#fff calc(var(--p,0)*1%),rgba(255,255,255,.22) 0);animation:sffillp var(--dur,1.6s) ease forwards}
@keyframes sffillp{from{--p:0}to{--p:var(--pt,0)}}
.pgbld .stats .rc{width:82px;height:82px;border-radius:50%;background:#5245d6;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:900;color:#fff}
.pgbld .stats .sc p{font-size:14px;opacity:.95;color:inherit;margin:0;line-height:1.4}

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
.pgbld .final{background:linear-gradient(120deg,var(--blue),var(--blue2));padding:46px 0;color:#fff}
.pgbld .final .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.pgbld .final .prod{position:relative}
.pgbld .final .prod .name{font-size:11px;font-weight:800;letter-spacing:.1em;color:#dfe2fb;text-transform:uppercase;margin-bottom:6px}
.pgbld .final .prod .big{font-size:26px;font-weight:900;line-height:1.05;margin-bottom:14px}
.pgbld .final .prod .im,.pgbld .final .prod .im.ph{aspect-ratio:5/4;border-radius:16px;min-height:0}
.pgbld .final .forms{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.pgbld .final .forms span{font-size:10.5px;font-weight:800;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:999px;padding:6px 12px;backdrop-filter:blur(3px)}
.pgbld .final .cta{text-align:center}
.pgbld .final .cta .hz{width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.pgbld .final .cta h2{font-size:28px;font-weight:800;margin-bottom:10px}
.pgbld .final .cta p{font-size:13px;color:#eef0fe;margin:0 auto 20px;max-width:380px;line-height:1.55}
.pgbld .final .cta .btn{background:#fff;color:var(--blue);max-width:320px;margin:0 auto}
.pgbld .final .cta .pays{justify-content:center}
.pgbld .final .cta .pays span{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.24);color:#eef0fe}
/* review avatar (UGC-style reviewer row) */
.pgbld .rc .rhead{display:flex;align-items:center;gap:9px;margin-bottom:8px}
.pgbld .rc .rav,.pgbld .rc .rav.ph{width:34px;height:34px;border-radius:50%;object-fit:cover;flex:none;min-height:0;background:var(--soft)}
.pgbld .rc .rn .vf{color:var(--blue);font-size:11px}
/* As Seen On logos */
.pgbld .seen{padding:30px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#fff}
.pgbld .seen .lbl{text-align:center;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--sub);margin-bottom:16px}
.pgbld .seen .logos{display:flex;flex-wrap:wrap;gap:30px;justify-content:center;align-items:center}
.pgbld .seen .logo{font-size:19px;font-weight:800;color:#b7b7c4;font-family:'Fraunces',Georgia,serif}
/* Happiness Guarantee card */
.pgbld .hguar{padding:44px 0}
.pgbld .hguar .card{background:var(--blue);color:#fff;border-radius:20px;padding:38px 26px;text-align:center;max-width:720px;margin:0 auto}
.pgbld .hguar .hz{display:flex;justify-content:center;margin-bottom:10px}
.pgbld .hguar h2{font-size:26px;font-weight:900;margin:0 0 8px}
.pgbld .hguar p{font-size:13.5px;color:#eef0fe;max-width:520px;margin:0 auto 18px;line-height:1.6}
.pgbld .hguar .btn{background:#fff;color:var(--blue);max-width:300px;margin:0 auto}
.pgbld .hguar .pays{justify-content:center;margin-top:16px}
.pgbld .hguar .pays span{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.24);color:#eef0fe}
/* Recommended products */
.pgbld .recs{padding:46px 0}
.pgbld .rgridp{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.pgbld .rprod{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.pgbld .rprod img,.pgbld .rprod .ph{width:100%;aspect-ratio:1;object-fit:cover;min-height:0}
.pgbld .rprod .b{padding:12px}
.pgbld .rprod .t{font-size:13px;font-weight:700;margin-bottom:3px}
.pgbld .rprod .s{color:#4a56ea;font-size:11px;margin-bottom:8px}
.pgbld .rprod .row{display:flex;align-items:center;justify-content:space-between}
.pgbld .rprod .pr{font-size:14px;font-weight:800}
.pgbld .rprod .add{background:var(--blue);color:#fff;text-decoration:none;font-size:12px;font-weight:800;padding:7px 13px;border-radius:9px}
/* Sticky add-to-cart bar */
.pgbld .satc{position:sticky;bottom:0;z-index:30;background:var(--blue);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 18px;box-shadow:0 -4px 16px -8px rgba(20,18,15,.3)}
.pgbld .satc .p{display:flex;align-items:center;gap:11px;color:#fff;font-weight:700;font-size:14px;min-width:0}
.pgbld .satc .p img,.pgbld .satc .p .ph{width:42px;height:42px;border-radius:9px;object-fit:cover;flex:none;min-height:0}
.pgbld .satc .p span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pgbld .satc .add{background:#fff;color:var(--blue);text-decoration:none;padding:11px 24px;border-radius:10px;font-weight:800;font-size:14px;flex:none}

@media(max-width:900px){
  .pgbld .hero .grid,.pgbld .trust .grid,.pgbld .how .grid,.pgbld .vs .grid,.pgbld .gold .grid,.pgbld .final .grid,.pgbld .pcre .mid{grid-template-columns:1fr}
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
    { a: 'Purifies', b: 'The Scalp' }, { a: 'Lifts', b: 'Excess Oil' }, { a: 'Nourishes', b: 'The Roots' }, { a: 'Smooths', b: 'Wash Days' }, { a: 'Cold-Pressed', b: 'Citrus Oils' },
  ]).slice(0, 5).map((p: any) => {
    const a = escp(p.a || p.label || p.title), b = escp(p.b || p.body)
    return b ? `<div class="ppill"><span class="a">${a}</span><span class="b">${b}</span></div>` : `<div class="ppill solo"><span class="a">${a}</span></div>`
  }).join('')

  const checks = (arr(c.hero_benefits).length ? arr(c.hero_benefits) : ['Lifts excess oil', 'Smooths wash routines', 'Nourishes scalp', 'Natural ingredients'].map((l) => ({ label: l })))
    .slice(0, 4).map((f, i) => `<div class="c"><span class="t">${benefitCheckIcon(i)}</span>${escp(f.label)}</div>`).join('')
  const thumbs = [c.image_main, c.image_g2, c.image_g3, c.image_g4, c.image_g5].map((u) => img(u || P, o.productName, '', 'Img')).join('')
  const accItems = (arr(c.info_sections).length ? arr(c.info_sections) : [{ label: 'Description', body: 'A lightweight pre-wash oil that loosens buildup and excess oil before you shampoo.' }, { label: 'How to use', body: 'Massage into a dry scalp, leave on for 10–15 minutes, then wash as usual.' }, { label: 'Shipping & Returns', body: 'Fast, tracked delivery and a money-back guarantee.' }])
    .map((s, i) => `<details${i === 0 ? ' open' : ''}><summary>${escp(s.label)}</summary><div class="body">${esc(s.body)}</div></details>`).join('')

  const variants = (arr(c.variants).length ? arr(c.variants) : [{ label: 'Buy 1' }, { label: 'Buy 2 · Save 10%' }, { label: 'Buy 3 · Save 20%' }, { label: 'Subscribe · Save 25%' }])
    .slice(0, 4).map((v: any, i: number) => `<button class="vopt${(v.sel || i === 0) ? ' on' : ''}" type="button">${escp(v.label)}</button>`).join('')
  // Multiple option groups (real Shopify options: Color + Size + …) → one .vpick per group; falls back to the
  // single `variants` picker when the product has just one option.
  const vgroups = arr(c.variant_groups)
  const vpickers = vgroups.length
    ? vgroups.map((g: any) => {
        const opts = arr(g.values).slice(0, 12).map((v: any, i: number) => `<button class="vopt${i === 0 ? ' on' : ''}" type="button">${escp(typeof v === 'string' ? v : (v?.label || ''))}</button>`).join('')
        return `<div class="vpick"><div class="vlabel">${escp(g.name || 'Choose an option')}</div><div class="vopts">${opts}</div></div>`
      }).join('')
    : `<div class="vpick"><div class="vlabel">${escp(c.variant_label || 'Make a Choice')}</div><div class="vopts">${variants}</div></div>`
  // Split a money string into symbol / amount / code spans so the editor can show/hide the currency symbol & code.
  const mny = (s: any): string => { const str = String(s || ''); const m = str.match(/^(\D*)([\d.,\s]*\d)(.*)$/); if (!m) return escp(str); const sym = m[1].trim(), amt = m[2].trim(), code = m[3].trim(); return `${sym ? `<span class="cur">${escp(sym)}</span>` : ''}<span class="amt">${escp(amt)}</span>${code ? `<span class="code"> ${escp(code)}</span>` : ''}` }

  const stripPills = (arr(c.strip_pills).length ? arr(c.strip_pills) : ['Purifies The Scalp', 'Simple Pre-Wash Ritual', 'Cruelty-Free & Vegan', 'Lightweight, Non-Greasy', 'No Harsh Sulfates'].map((l) => ({ label: l })))
    .map((p, i) => `<div class="benfc"><span class="pico">${benefitCheckIcon(i)}</span><span class="ptext">${escp(p.label)}</span></div>`)
  const strip = stripPills.join('')
  const stripDup = stripPills.map((h) => h.replace('<div class="benfc"', '<div class="benfc" aria-hidden="true"')).join('')

  const sci = (arr(c.sci_points).length ? arr(c.sci_points) : [
    { title: 'Cold-Pressed Citrus Oil', body: 'Brightens and gently clarifies the scalp.' },
    { title: 'Nourishing Jojoba Oil', body: 'Mimics the scalp’s natural balance.' },
    { title: 'Soothing Aloe Extract', body: 'Calms and comforts between washes.' },
  ]).slice(0, 3).map((s: any, i: number) => `<div class="ic"><div class="d">${ICONS[i % ICONS.length]}</div><div class="t"><b>${escp(s.title || s.label)}</b><span>${escp(s.body)}</span></div></div>`).join('')

  const vGood = (arr(c.vs_ours).length ? arr(c.vs_ours) : ['Clarifies Without Stripping', 'Balances Oil Naturally', 'Lightweight, Fast-Absorbing', 'Fresh Citrus Scent', 'Cruelty-Free & Vegan'].map((l) => ({ label: l })))
    .map((r) => `<div class="r"><span class="ic">${CHKline}</span><span class="rt">${escp(r.label)}</span></div>`).join('')
  const vBad = (arr(c.vs_others).length ? arr(c.vs_others) : ['Strips Natural Oils', 'Leaves Residue Behind', 'Heavy, Greasy Feel', 'Synthetic Fragrance', 'Harsh Sulfates'].map((l) => ({ label: l })))
    .map((r) => `<div class="r"><span class="ic">${XMARKr}</span><span class="rt">${escp(r.label)}</span></div>`).join('')

  const bens = (arr(c.benefits).length ? arr(c.benefits) : [
    { title: 'Purified, Balanced Scalp', body: 'Dissolve buildup and excess oil so your scalp feels fresh and genuinely clean before every wash.' },
    { title: 'Nourished, Stronger Roots', body: 'Feed your roots with cold-pressed oils that support healthier-looking, more resilient hair over time.' },
    { title: 'Smoother Wash Days', body: 'Loosen product residue in minutes so shampoo works better and rinses cleaner every single time.' },
    { title: 'Soothed, Comfortable Skin', body: 'Calm tightness and flakiness between washes with gentle, skin-friendly botanicals.' },
    { title: 'Naturally Clean Formula', body: 'Trust a vegan, cruelty-free blend made without sulfates, silicones, or unnecessary additives.' },
  ]).slice(0, 5).map((b: any, i: number) => `<div class="brow"><div class="n">${i + 1}</div><div class="t"><b>${escp(b.title || b.label)}</b><p>${esc(b.body)}</p></div></div>`).join('')

  const revs = (arr(c.testimonials).length ? arr(c.testimonials) : [
    { name: 'Justin P.', quote: 'My scalp actually feels clean now, not stripped. Way less oily by day two and my hair looks fuller.' },
    { name: 'Sam T.', quote: 'I use it before every wash. Ten minutes and the buildup just rinses away. Love the fresh citrus smell.' },
    { name: 'Bri M.', quote: 'Flakiness calmed down after a week. It’s lightweight and never leaves my hair greasy.' },
    { name: 'Benny K.', quote: 'Finally something that preps my scalp instead of drying it out. My roots feel healthier already.' },
  ]).slice(0, 4).map((t: any) => `<div class="rc"><div class="rhead">${(t.image && typeof t.image === 'string') ? `<img class="rav" src="${esc(t.image)}" alt="${esc(t.name)}" loading="lazy">` : `<div class="rav" style="display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--blue)">${escp((t.name || '?').charAt(0))}</div>`}<div><div class="rn">${escp(t.name)} <span class="vf">✔</span></div><div class="rs">★★★★★</div></div></div><p>${esc(t.quote)}</p></div>`).join('')

  const press = (arr(c.press_quotes).length ? arr(c.press_quotes) : [
    { title: 'Allure', body: 'The pre-wash step your scalp has been missing.' },
    { title: 'Vogue', body: 'A fresh, clarifying ritual that never leaves hair greasy.' },
    { title: 'Byrdie', body: 'Lightweight, effective, and beautifully scented.' },
  ]).slice(0, 3).map((p: any) => `<div class="pq"><b>${escp(p.title || p.label)}</b><p>${esc(p.body)}</p></div>`).join('')

  const stats = (arr(c.stats).length ? arr(c.stats) : [
    { label: '97%', body: 'Said their scalp felt cleaner and lighter.' }, { label: '94%', body: 'Noticed less oil between washes.' }, { label: '96%', body: 'Loved the fresh, natural citrus scent.' }, { label: '91%', body: 'Saw smoother, healthier-looking roots.' },
  ]).slice(0, 4).map((s) => { const pct = pctOf(s.label); return `<div class="sc"><div class="ring" style="--pt:${pct};--dur:1.6s"><div class="rc">${pct}%</div></div><p>${bd(s.body)}</p></div>` }).join('')

  const feats = (arr(c.feature_cards).length ? arr(c.feature_cards) : [
    { title: 'Purifying Ritual', body: 'Loosen buildup and excess oil in minutes for a scalp that feels truly clean before you wash.' },
    { title: 'Root Nourishment', body: 'Cold-pressed oils feed the roots to support healthier, stronger-looking hair with every use.' },
    { title: 'Clean Ingredients', body: 'A vegan, cruelty-free blend made without sulfates, silicones, or unnecessary additives.' },
  ]).slice(0, 3).map((f: any) => `<div class="fc">${img(f.image, o.productName, 'im', 'Feature')}<h4>${escp(f.title)}</h4><p>${esc(f.body)}</p></div>`).join('')

  const goldRows = (arr(c.gold_rows).length ? arr(c.gold_rows) : ['Clarifies Gently', 'Balances Oil', 'Lightweight Feel', 'Fresh Citrus Scent', 'Cruelty-Free', 'Nourishes Roots'].map((l) => ({ label: l })))
    .map((r) => `<div class="cr"><div>${escp(r.label)}</div><div class="m">${CHK}</div><div class="m">${XMARK}</div></div>`).join('')

  const forms = (arr(c.final_forms).length ? arr(c.final_forms) : ['Cruelty-Free', 'Vegan Formula', 'Sulfate-Free'].map((l) => ({ label: l })))
    .map((f) => `<span>${escp(f.label)}</span>`).join('')

  // As Seen On logos + Recommended products (PagePilot-parity sections; only render when the template shows them).
  const seenLogos = (arr(c.seen_logos).length ? arr(c.seen_logos).map((x: any) => x.label || x) : ['Forbes', 'Vogue', 'Allure', 'GQ', 'Byrdie'])
    .map((l: string) => `<span class="logo">${escp(l)}</span>`).join('')
  const recs = (arr(c.recommended).length ? arr(c.recommended) : [
    { title: 'Daily Renewal Set', price: c.price || '$34', image: c.image_g2 },
    { title: 'Overnight Repair Oil', price: c.price || '$29', image: c.image_g3 },
    { title: 'Gentle Cleanser', price: c.price || '$24', image: c.image_g4 },
    { title: 'Barrier Cream', price: c.price || '$27', image: c.image_g5 },
  ]).slice(0, 4).map((r: any) => `<div class="rprod">${img(r.image || P, r.title, '', 'Product')}<div class="b"><div class="t">${escp(r.title)}</div><div class="s">★★★★★</div><div class="row"><span class="pr">${escp(r.price || '')}</span><a class="add" href="${esc(o.ctaHref || '#')}">Add</a></div></div></div>`).join('')

  return `<div class="pgbld">

  <!-- 1 · HERO -->
  <section class="hero"><div class="wrap"><div class="grid">
    <div class="pgal">
      <div class="gwrap">${img(c.image_hero || c.image_main || P, o.productName, 'hbottle', 'Product')}<button class="garr gprev" aria-label="Previous image">‹</button><button class="garr gnext" aria-label="Next image">›</button></div>
      <div class="thumbs">${thumbs}</div>
    </div>
    <div>
      <div class="bestseller"><span class="num">#1</span><span class="bst"><b>${escp(c.bestseller_label || 'BESTSELLER OF 2026')}</b><span>${escp(c.bestseller_sub || 'Trusted by thousands')}</span></span></div>
      <h1 class="ptitle">${esc(c.headline || o.productName)}</h1>
      <div class="rlabel"><span class="stars">★★★★★</span> <span class="rtext">${escp(c.rating_label || `Rated ${o.rating?.stars || '4.9'} by 17,873 buyers`)}</span></div>
      <div class="hchecks">${checks}</div>
      <div class="price">${c.compare_at ? `<span class="was">${mny(c.compare_at)}</span>` : ''}${price ? `<span class="now">${mny(price)}</span>` : ''}${c.save_pill ? `<span class="save">${escp(c.save_pill)}</span>` : ''}</div>
      ${vpickers}
      <a class="btn" href="${esc(o.ctaHref || '#')}">🛒 ${escp(String(c.cta_label || 'Add to Cart').toUpperCase())}</a>
      <div class="grow"><span>🛡 ${escp(c.guarantee_line || '30-Day Money-Back Guarantee')}</span><span>📦 ${escp(c.returns_line || '30 Day Returns')}</span></div>
      <div class="pays">${paysRowInner()}</div>
      <div class="sfdiv"></div>
      <div class="acc">${accItems}</div>
      <div class="hclaim">${escp(c.hero_claim || 'Join thousands of customers who trust our money-back guarantee.')}</div>
      <div class="hrev"><div class="av">${img(c.image_reviewer, 'Reviewer', 'avim', '')}</div><div><div class="q">${esc(c.hero_review || 'My scalp feels genuinely clean and my hair looks fuller by the second wash. No greasy residue at all, just fresh, healthy-feeling roots.')}</div><div class="who">${escp(c.hero_review_name || 'Verified Buyer')}</div></div></div>
      <div class="warn">⚠ <span><b>Low Stock Notice.</b> ${bd(c.warn_line || 'This pre-wash treatment sold out fast this year. We encourage you to take advantage of the limited sale while it lasts. It’s only available here and not sold in stores.')}</span></div>
    </div>
  </div></div></section>

  <!-- 1b · BENEFIT CREATIVE (Image with Numbered Benefits) — the "Awaken Your Radiance" pills beside the bottle.
       Lives as its OWN section now (PagePilot keeps the hero gallery clean = real product images only). -->
  <section class="pcre"><div class="wrap">
    <div class="hcre">
      <div class="hd">${hl(c.hero_headline || 'Your Scalp is Buried Under **Buildup**. Purify it & Unlock Healthier Roots.')}</div>
      <div class="sd">${escp(c.hero_subline || 'A Simple Pre-Wash. Visible Results.')}</div>
      <div class="mid">
        <div class="ppills">${pills}</div>
        <div class="pcre-img">${img(c.image_hero || P, o.productName, 'pcrei', 'Product')}</div>
      </div>
    </div>
  </div></section>

  <!-- 2 · PILL STRIP -->
  <section class="strip"><div class="striptrack">${strip}${stripDup}</div></section>

  <!-- 3 · TRUSTED -->
  <section class="trust"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.trust_head || 'Loved by stylists. Chosen by **healthy-hair devotees**.')}</h2>
      <p>${bd(c.trust_sub || 'A gentle pre-wash ritual that clarifies the scalp without stripping your hair.')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.trust_cta || 'Get Yours Now')}</a>
      <div class="rate"><span class="stars">★★★★★</span> ${escp(c.trust_rating || `Rated ${o.rating?.stars || '4.9'} by 15,000+ happy customers`)}</div>
    </div>
    <div class="ims"><div class="im">${img(c.image_trust1 || P, o.productName, 'gimg', 'Lifestyle')}</div><div class="im">${img(c.image_trust2 || P, o.productName, 'gimg', 'Lifestyle')}</div></div>
  </div></div></section>

  <!-- 4 · HOW IT WORKS -->
  <section class="how"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.how_head || 'How Does This Pre-Wash Oil Work?')}</h2>
      <p>${bd(c.how_body1 || 'It works before you shampoo, gently dissolving the buildup, excess oil, and product residue that weigh your hair down at the root.')}</p>
      <p>${bd(c.how_body2 || 'Instead of stripping your scalp, cold-pressed oils nourish and balance it. Regular use leaves roots cleaner, calmer, and healthier-looking.')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.how_cta || 'Buy It Now')}</a>
    </div>
    <div class="sci">
      <h3>${escp(c.sci_head || 'Pure By Design — Powered By Botanicals')}</h3>
      <div class="ss">${escp(c.sci_sub || 'Only a few carefully chosen oils. Free from sulfates, silicones, and unnecessary additives.')}</div>
      <div class="body">
        <div>${sci}</div>
        <div>${img(c.image_sci || P, o.productName, 'im', 'Product')}</div>
        <div class="brand"><b>${escp(c.sci_brand || o.productName)}</b>${escp(c.sci_brand_sub || 'Care You Can Trust.')}</div>
      </div>
    </div>
  </div></div></section>

  <!-- 5 · VERSUS + BENEFITS -->
  <section class="vs"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.vs_head || 'How We Compare vs. The Rest')}</h2>
      <div class="vsub">${esc(c.vs_sub || 'Gently clarifying. Naturally balancing. A fresher scalp — without the greasy residue.')}</div>
      <div class="vcard">
        <div class="vcol"><h5>${escp(c.vs_ours_label || o.productName)}</h5>${vGood}</div>
        <div>${img(c.image_vs || P, o.productName, 'vmid', '')}</div>
        <div class="vcol o"><h5>${escp(c.vs_others_label || 'Other Brands')}</h5>${vBad}</div>
      </div>
    </div>
    <div class="ben">
      <h2>${hl(c.ben_head || '5 Everyday Benefits of using **Us**')}</h2>
      <div class="vsub">${esc(c.ben_sub || 'Care for your scalp with a gentle, clarifying pre-wash ritual.')}</div>
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

  <!-- 6b · AS SEEN ON -->
  <section class="seen"><div class="wrap">
    <div class="lbl">${escp(c.seen_label || 'As seen on')}</div>
    <div class="logos">${seenLogos}</div>
  </div></section>

  <!-- 7 · STATS -->
  <section class="stats"><div class="wrap">
    <h2 class="secttl">${hl(c.stats_head || 'What Most Reviewers Noticed')}</h2>
    <div class="sectsub">${esc(c.stats_sub || 'A collection of real experiences from people who added a pre-wash ritual to their hair routine.')}</div>
    <div class="sgrid">${stats}</div>
  </div></section>

  <!-- 8 · FEATURE CARDS -->
  <section class="feat"><div class="wrap">
    <h2 class="secttl">${hl(c.feat_head || 'A gentle pre-wash ritual for a cleaner, healthier scalp')}</h2>
    <div class="sectsub">${esc(c.feat_sub || 'Clarify at the root to lift buildup and nourish your scalp — without stripping or greasy residue.')}</div>
    <div class="fgrid">${feats}</div>
  </div></section>

  <!-- 9 · GOLD STANDARD -->
  <section class="gold"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.gold_head || 'The Gold Standard for Scalp Care')}</h2>
      <p>${bd(c.gold_body || 'Step away from harsh, stripping shampoos. Our pre-wash oil clarifies at the root, lifting buildup and excess oil while cold-pressed botanicals nourish your scalp — a fresh, balanced clean that lasts.')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.gold_cta || 'Get Yours Now')}</a>
    </div>
    <div class="ctable"><div class="ctop"><span>Feature</span><span class="ours">Our product</span><span>Others</span></div>${goldRows}</div>
  </div></div></section>

  <!-- 9b · HAPPINESS GUARANTEE -->
  <section class="hguar"><div class="wrap"><div class="card">
    <div class="hz">${HEART}</div>
    <h2>${hl(c.hguar_head || '100% Happiness Guarantee')}</h2>
    <p>${esc(c.hguar_body || 'Try it risk-free for 30 days. If you don’t love the results, we’ll refund every penny — no questions asked.')}</p>
    <a class="btn" href="${esc(o.ctaHref || '#')}">${escp(c.hguar_cta || 'Buy It Now')}</a>
    <div class="pays">${paysRowInner()}</div>
  </div></div></section>

  <!-- 9c · RECOMMENDED PRODUCTS -->
  <section class="recs"><div class="wrap">
    <h2 class="secttl">${hl(c.recs_head || 'Recommended Products')}</h2>
    <div class="rgridp">${recs}</div>
  </div></section>

  <!-- 10 · FINAL CTA -->
  <section class="final"><div class="wrap"><div class="grid">
    <div class="prod">
      <div class="name">${escp(c.final_kicker || 'Salon Strength')}</div>
      <div class="big">${hl(c.final_prod_name || o.productName)}</div>
      <div class="im">${img(c.image_final || P, o.productName, 'gimg', 'Product')}</div>
      <div class="forms">${forms}</div>
    </div>
    <div class="cta">
      <div class="hz">${HEART}</div>
      <h2>${hl(c.final_head || 'Start your scalp ritual')}</h2>
      <p>${esc(c.final_body || 'Feel the freshness of a truly clean scalp without the stripped, tight feeling. Getting started is risk-free with our thirty-day satisfaction guarantee.')}</p>
      <a class="btn" href="${esc(o.ctaHref || '#')}">${escp(c.final_cta || 'Buy It Now')}</a>
      <div class="pays">${paysRowInner()}</div>
    </div>
  </div></div></section>

  <!-- 11 · STICKY ADD TO CART -->
  <div class="satc"><div class="p">${img(c.image_hero || P, o.productName, '', '')}<span>${esc(o.productName || 'Product')}</span></div><a class="add" href="${esc(o.ctaHref || '#')}">🛒 ${escp(c.satc_cta || 'Add to Cart')}</a></div>

  </div>`
}

export const syrupV1: PageTemplate = {
  id: 'syrup_v1',
  type: 'product',
  name: 'Lemon Aid (Hair Care)',
  description: 'Clean white/indigo hair-care pre-wash scalp-oil PDP — hero creative with two-part benefit pills + buy-box (bestseller badge, benefit checks, guarantee, info accordion, review + low-stock warning), pill strip, trusted-by split, how-it-works ingredient card, vs-the-rest comparison + numbered benefits, reviews + press quotes, a stat band of circular percentage rings, feature cards, gold-standard table, and a final CTA band.',
  css,
  render,
  schema: [
    { key: 'hero_headline', type: 'text', label: 'Hero creative headline', hint: 'Wrap 1 word in ** ** to accent it (e.g. "…Buried Under **Buildup**").' },
    { key: 'hero_subline', type: 'text', label: 'Hero creative subline', hint: 'e.g. "A Simple Pre-Wash. Visible Results.".' },
    { key: 'hero_pills', type: 'reasons', label: 'Hero benefit pills (5)', count: 5, hint: 'Each: a = left word (verb like "Purifies"); b = right word ("The Scalp").' },
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
    { key: 'trust_head', type: 'text', label: 'Trusted heading', hint: 'Accent a phrase with ** ** (e.g. "Chosen by **healthy-hair devotees**").' },
    { key: 'trust_sub', type: 'richtext', role: 'body', label: 'Trusted subhead' },
    { key: 'trust_cta', type: 'text', label: 'Trusted button' },
    { key: 'trust_rating', type: 'text', label: 'Trusted rating line' },
    { key: 'image_trust1', type: 'image', role: 'lifestyle', label: 'Trusted photo 1' },
    { key: 'image_trust2', type: 'image', role: 'lifestyle', label: 'Trusted photo 2' },
    { key: 'how_head', type: 'text', label: 'How-it-works heading' },
    { key: 'how_body1', type: 'richtext', role: 'body', label: 'How-it-works paragraph 1' },
    { key: 'how_body2', type: 'richtext', role: 'body', label: 'How-it-works paragraph 2' },
    { key: 'how_cta', type: 'text', label: 'How-it-works button' },
    { key: 'sci_head', type: 'text', label: 'Ingredients card heading' },
    { key: 'sci_sub', type: 'text', label: 'Ingredients card subhead' },
    { key: 'sci_points', type: 'reasons', label: 'Key ingredients (3)', count: 3, hint: 'title = ingredient; body = one line.' },
    { key: 'sci_brand', type: 'text', label: 'Ingredients card brand name' },
    { key: 'sci_brand_sub', type: 'text', label: 'Ingredients card brand tagline' },
    { key: 'image_sci', type: 'image', role: 'product', label: 'Ingredients card product image' },
    { key: 'vs_head', type: 'text', label: 'Versus heading' },
    { key: 'vs_sub', type: 'text', label: 'Versus subhead' },
    { key: 'vs_ours_label', type: 'text', label: 'Versus — our column label' },
    { key: 'vs_others_label', type: 'text', label: 'Versus — their column label' },
    { key: 'vs_ours', type: 'list', label: 'Versus — our strengths', count: 5, hint: 'Each label only.' },
    { key: 'vs_others', type: 'list', label: 'Versus — their weaknesses', count: 5, hint: 'Each label only.' },
    { key: 'image_vs', type: 'image', role: 'product', label: 'Versus card product image' },
    { key: 'ben_head', type: 'text', label: 'Benefits heading', hint: 'Accent brand with ** ** (e.g. "…using **Lemon Aid**").' },
    { key: 'ben_sub', type: 'text', label: 'Benefits subhead' },
    { key: 'benefits', type: 'reasons', label: 'Numbered benefits (5)', count: 5, hint: 'title + body.' },
    { key: 'reviews_head', type: 'text', label: 'Reviews heading' },
    { key: 'reviews_sub', type: 'text', label: 'Reviews rating line' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews (4)', count: 4, hint: 'name + quote.' },
    { key: 'press_quotes', type: 'reasons', label: 'Press quotes (3)', count: 3, hint: 'title = publication; body = the quote.' },
    { key: 'stats_head', type: 'text', label: 'Stats heading' },
    { key: 'stats_sub', type: 'text', label: 'Stats subhead' },
    { key: 'stats', type: 'reasons', label: 'Stats (4)', count: 4, hint: 'label = a percentage like "97%" (shown as a ring); body = what improved.' },
    { key: 'feat_head', type: 'text', label: 'Feature-cards heading' },
    { key: 'feat_sub', type: 'text', label: 'Feature-cards subhead' },
    { key: 'feature_cards', type: 'reasons', label: 'Feature cards (3)', count: 3, hint: 'title + body; each has its own image slot.' },
    { key: 'gold_head', type: 'text', label: 'Gold-standard heading' },
    { key: 'gold_body', type: 'richtext', role: 'body', label: 'Gold-standard paragraph' },
    { key: 'gold_cta', type: 'text', label: 'Gold-standard button' },
    { key: 'gold_rows', type: 'list', label: 'Gold-standard comparison rows', count: 6, hint: 'Each label only: a feature you have and rivals don\'t.' },
    { key: 'final_kicker', type: 'text', label: 'Final CTA kicker', hint: 'e.g. "Salon Strength".' },
    { key: 'final_prod_name', type: 'text', label: 'Final CTA product name' },
    { key: 'final_forms', type: 'list', label: 'Final CTA form badges', count: 3, hint: 'Each label only (e.g. "Vegan Formula").' },
    { key: 'image_final', type: 'image', role: 'product', label: 'Final CTA product image' },
    { key: 'final_head', type: 'text', label: 'Final CTA heading' },
    { key: 'final_body', type: 'richtext', role: 'body', label: 'Final CTA paragraph' },
    { key: 'final_cta', type: 'text', label: 'Final CTA button' },
  ],
}
