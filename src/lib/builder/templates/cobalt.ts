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
import { paysRowInner, benefitCheckIcon } from '../payicons'

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
const VERIFIED = '<svg viewBox="0 0 24 24" width="15" height="15" fill="#3f4bd6" stroke="none"><path d="M12 1.5l2.6 1.9 3.2-.2 1 3 2.7 1.8-1.2 3 .0 .0 1.2 3-2.7 1.8-1 3-3.2-.2L12 22.5l-2.6-1.9-3.2.2-1-3L2.5 16l1.2-3-1.2-3 2.7-1.8 1-3 3.2.2z"/><path d="M8.5 12.2l2.3 2.3 4.7-4.9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
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
.pgbld .hbottle,.pgbld .hbottle.ph{aspect-ratio:3/4;border-radius:12px;min-height:0;object-fit:contain;background:var(--soft)}
.pgbld .pgal .hbottle,.pgbld .pgal .hbottle.ph{width:100%;aspect-ratio:4/5}
.pgbld .gwrap{position:relative}
.pgbld .garr{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.94);border:1px solid var(--line);display:grid;place-items:center;font-size:18px;color:var(--ink);cursor:pointer;box-shadow:0 3px 10px rgba(0,0,0,.14);z-index:2;line-height:1;padding:0}
.pgbld .gwrap .gprev{left:6px}
.pgbld .gwrap .gnext{right:6px}
.pgbld .thumbs{display:flex;gap:8px;margin-top:12px}
.pgbld .thumbs img,.pgbld .thumbs .ph{width:56px;height:56px;object-fit:cover;border-radius:9px;border:1px solid var(--line);min-height:0;cursor:pointer}
.pgbld .thumbs img.on{border-color:var(--blue);border-width:2px}
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
.pgbld .how p{font-size:14px;color:var(--sub);margin-bottom:16px;line-height:1.6}
.pgbld .how .rgroup .howimg,.pgbld .how .rgroup .howimg.ph{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:18px;background:var(--soft2);min-height:0}
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

/* 4b · IMAGE WITH NUMBERED BENEFITS */
.pgbld .numbf{padding:8px 0 52px}
.pgbld .numbf .grid{display:grid;grid-template-columns:1fr 1.05fr;gap:44px;align-items:center}
.pgbld .numbf .imgcol .numbimg,.pgbld .numbf .imgcol .numbimg.ph{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:18px;background:var(--soft2);min-height:0}
.pgbld .numbf .contcol h2{font-size:26px;font-weight:800;margin-bottom:10px}
.pgbld .numbf .contcol h2 .hl{color:var(--blue)}
.pgbld .numbf .nsub{font-size:14px;color:var(--sub);margin-bottom:22px;line-height:1.6}
.pgbld .numbf .bcard{display:flex;flex-direction:column;gap:18px}
.pgbld .numbf .brow{display:flex;gap:14px;align-items:flex-start;margin-bottom:0}
.pgbld .numbf .brow .pico{width:38px;height:38px;border-radius:11px;background:var(--soft2);color:var(--blue);display:flex;align-items:center;justify-content:center;flex:none}
.pgbld .numbf .brow .pico svg{width:19px;height:19px}
.pgbld .numbf .btg{flex:1}
.pgbld .numbf .btitle{font-size:15px;font-weight:800;color:var(--ink);margin-bottom:3px}
.pgbld .numbf .bdesc{font-size:13px;color:var(--sub);line-height:1.55}

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
.pgbld .rvtitle{text-align:center;margin-bottom:26px}
.pgbld .ratedby{display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line);border-radius:999px;padding:7px 14px;margin-bottom:14px;font-size:12.5px;font-weight:700;color:var(--ink)}
.pgbld .ratedby .stars{font-size:13px}
.pgbld .rcar{display:flex;gap:16px;overflow-x:auto;padding:4px 2px 8px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
.pgbld .rcar::-webkit-scrollbar{height:6px}.pgbld .rcar::-webkit-scrollbar-thumb{background:var(--line);border-radius:99px}
.pgbld .frev{flex:0 0 300px;max-width:300px;scroll-snap-align:start;background:#fff;border:1px solid var(--line);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:11px}
.pgbld .frev .frimg,.pgbld .frev .frimg.ph{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;background:var(--soft2);min-height:0}
.pgbld .frwho{display:flex;align-items:center;gap:7px}
.pgbld .frwho .ic{display:inline-flex;flex:none}
.pgbld .frwho .ic svg{display:block}
.pgbld .frname{font-weight:800;font-size:13.5px;color:var(--ink)}
.pgbld .frstars{color:#4a56ea;font-size:13px;letter-spacing:1px}
.pgbld .frq{font-size:13px;color:var(--sub);margin:0;line-height:1.55}
/* 6b · AS SEEN ON WITH QUOTES (marquee) */
.pgbld .seen{background:#fff;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:18px 0;overflow:hidden}
.pgbld .seen .seentrack{display:flex;width:max-content;gap:40px;align-items:center;animation:sfmarquee2 38s linear infinite}
.pgbld .seen:hover .seentrack{animation-play-state:paused}
.pgbld .qitem{display:inline-flex;align-items:center;gap:16px;flex:none;white-space:nowrap}
.pgbld .qlogo{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:19px;color:var(--ink);letter-spacing:.01em}
.pgbld .qquote{font-size:13.5px;color:var(--sub);font-style:italic}
@keyframes sfmarquee2{from{transform:translateX(0)}to{transform:translateX(calc(-50% - 20px))}}

/* 7 · STATS */
.pgbld .stats{padding:52px 0}
.pgbld .stats .shead{text-align:center}
.pgbld .sgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.pgbld .sc{background:var(--blue);border-radius:16px;padding:22px 18px;text-align:center;color:#fff}
@property --p{syntax:'<number>';inherits:false;initial-value:0}
.pgbld .stats .ring{width:92px;height:92px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;background:conic-gradient(#fff calc(var(--p,0)*1%),rgba(255,255,255,.26) 0);animation:sffillp var(--dur,1.6s) ease forwards}
@keyframes sffillp{from{--p:0}to{--p:var(--pt,0)}}
.pgbld .stats .rc{width:72px;height:72px;border-radius:50%;background:var(--blue);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900;color:#fff}
.pgbld .sc p{font-size:12px;color:#dfe2fb;margin:0;line-height:1.4}

/* 8 · FEATURE CARDS */
.pgbld .feat{padding:12px 0 54px}
.pgbld .fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.pgbld .fc .im,.pgbld .fc .im.ph{aspect-ratio:4/3;border-radius:16px;margin-bottom:12px;min-height:0}
.pgbld .fc h4{font-size:16px;font-weight:800;color:var(--blue);margin-bottom:4px}
.pgbld .fc p{font-size:12.5px;color:var(--sub);margin:0;line-height:1.45}

/* 9b · HAPPINESS GUARANTEE */
.pgbld .hguar{padding:16px 0 52px}
.pgbld .hguar .hgbox{background:var(--blue);border-radius:22px;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;align-items:stretch;color:#fff}
.pgbld .hguar .hgimg,.pgbld .hguar .hgimg.ph{width:100%;height:100%;min-height:300px;object-fit:cover;background:var(--dark);border-radius:0;min-width:0}
.pgbld .hguar .hgel{padding:44px 38px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px}
.pgbld .hguar .hgico{display:inline-flex;color:#fff}
.pgbld .hguar .hgico svg{width:34px;height:34px}
.pgbld .hguar .hgel h2{font-size:26px;font-weight:800;color:#fff}
.pgbld .hguar .hgel h2 .hl{color:#cdd3ff}
.pgbld .hguar .hgel p{font-size:14px;color:#dfe2fb;line-height:1.6;margin:0;max-width:420px}
.pgbld .hguar .hgbtn{display:inline-block;background:#fff;color:var(--blue);font-weight:800;font-size:14px;padding:13px 28px;border-radius:12px;text-decoration:none}
.pgbld .hguar .pays{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:4px}

/* 9c · RECOMMENDED PRODUCTS (carousel) */
.pgbld .recs{padding:16px 0 52px}
.pgbld .reccar{display:flex;gap:16px;overflow-x:auto;padding:8px 2px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}
.pgbld .reccar::-webkit-scrollbar{height:6px}.pgbld .reccar::-webkit-scrollbar-thumb{background:var(--line);border-radius:99px}
.pgbld .reccard{flex:0 0 220px;max-width:220px;scroll-snap-align:start;display:flex;flex-direction:column}
.pgbld .reccard .recimg,.pgbld .reccard .recimg.ph{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:14px;background:var(--soft2);margin-bottom:10px;min-height:0}
.pgbld .rectitle{font-size:14px;font-weight:800;color:var(--ink);margin-bottom:3px}
.pgbld .recprice{font-size:13px;color:var(--ink);font-weight:700;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.pgbld .recprice .rwas{color:var(--sub);font-weight:500;text-decoration:line-through}
.pgbld .recprice .roff{background:var(--blue);color:#fff;font-size:10px;font-weight:800;padding:2px 7px;border-radius:5px}

/* 11 · STICKY ADD TO CART */
.pgbld .satc{position:sticky;bottom:0;z-index:50}
.pgbld .satcbar{display:flex;align-items:center;justify-content:space-between;gap:14px;background:#fff;border-top:1px solid var(--line);box-shadow:0 -6px 22px -14px rgba(20,18,15,.4);padding:12px 20px}
.pgbld .satcgroup{display:flex;align-items:center;gap:12px;min-width:0}
.pgbld .satcimg,.pgbld .satcimg.ph{width:44px;height:44px;border-radius:10px;object-fit:cover;background:var(--soft2);flex:none;min-height:0}
.pgbld .satcinfo{min-width:0}
.pgbld .satctitle{font-size:14px;font-weight:800;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pgbld .satcbtn{flex:none;background:var(--blue);color:#fff;font-weight:800;font-size:14px;padding:12px 26px;border-radius:12px;text-decoration:none}

/* 9d · AS SEEN ON (logos marquee) */
.pgbld .seenl{padding:8px 0 40px;overflow:hidden}
.pgbld .slhead{text-align:center;margin-bottom:18px}
.pgbld .slhead .secttl{font-size:15px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--sub)}
.pgbld .seenl .sltrack{display:flex;width:max-content;gap:56px;align-items:center;animation:sfmarquee2 34s linear infinite}
.pgbld .seenl:hover .sltrack{animation-play-state:paused}
.pgbld .sllogo{font-family:'Fraunces',Georgia,serif;font-weight:600;font-size:22px;color:var(--ink);opacity:.7;white-space:nowrap;flex:none}

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
.pgbld .final .forms{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.pgbld .final .forms span{font-size:10.5px;font-weight:800;background:rgba(20,24,90,.55);border:1px solid rgba(255,255,255,.45);color:#fff;border-radius:999px;padding:6px 12px;backdrop-filter:blur(3px)}
.pgbld .final .cta{text-align:center}
.pgbld .final .cta .hz{width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.pgbld .final .cta h2{font-size:28px;font-weight:800;margin-bottom:10px}
.pgbld .final .cta p{font-size:13px;color:#d5d8f7;margin:0 auto 20px;max-width:380px;line-height:1.55}
.pgbld .final .cta .btn{background:#fff;color:var(--blue);max-width:320px;margin:0 auto}
.pgbld .final .cta .pays{justify-content:center}
.pgbld .final .cta .pays span{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.24);color:#d5d8f7}

@media(max-width:900px){
  .pgbld .hero .grid,.pgbld .trust .grid,.pgbld .how .grid,.pgbld .numbf .grid,.pgbld .vs .grid,.pgbld .gold .grid,.pgbld .final .grid,.pgbld .hguar .hgbox{grid-template-columns:1fr}
  .pgbld .hguar .hgimg,.pgbld .hguar .hgimg.ph{min-height:220px}
  .pgbld .sgrid{grid-template-columns:1fr 1fr}
  .pgbld .fgrid{grid-template-columns:1fr}
}
@media(max-width:520px){
  .pgbld .hcre .mid{grid-template-columns:1fr}
  .pgbld .sgrid{grid-template-columns:1fr}
  .pgbld .frev{flex-basis:82%;max-width:82%}
  .pgbld .reccard{flex-basis:62%;max-width:62%}
  .pgbld .hchecks{grid-template-columns:1fr}
  .pgbld .wrap{padding:0 16px}
}
`.trim()

function render(c: FilledContent, o: RenderOpts): string {
  const P = o.productImage
  const price = o.priceLabel || ''
  // Split a money string into symbol / amount / code spans so the editor can show/hide the currency symbol & code.
  const mny = (s: any): string => { const str = String(s || ''); const m = str.match(/^(\D*)([\d.,\s]*\d)(.*)$/); if (!m) return escp(str); const sym = m[1].trim(), amt = m[2].trim(), code = m[3].trim(); return `${sym ? `<span class="cur">${escp(sym)}</span>` : ''}<span class="amt">${escp(amt)}</span>${code ? `<span class="code"> ${escp(code)}</span>` : ''}` }

  const pills = (arr(c.hero_pills).length ? arr(c.hero_pills) : [
    { a: 'Supercharges', b: 'Brainpower' }, { a: 'Increases', b: 'Oxygen Utilization' }, { a: 'Supports', b: 'Mitochondria' }, { a: 'Balances', b: 'Mood & Stress' }, { a: 'High-Potency', b: 'Ultra-Pure' },
  ]).slice(0, 5).map((p: any) => {
    const a = escp(p.a || p.label || p.title), b = escp(p.b || p.body)
    return b ? `<div class="ppill"><span class="a">${a}</span><span class="b">${b}</span></div>` : `<div class="ppill solo"><span class="a">${a}</span></div>`
  }).join('')

  const checks = (arr(c.hero_benefits).length ? arr(c.hero_benefits) : ['Steady mental clarity', 'No afternoon crash', 'Uplifted daily mood', 'Simple glass dropper'].map((l) => ({ label: l })))
    .slice(0, 4).map((f, i) => `<div class="c"><span class="t">${benefitCheckIcon(i)}</span>${escp(f.label)}</div>`).join('')
  const thumbs = [c.image_main, c.image_g2, c.image_g3, c.image_g4, c.image_g5].map((u) => img(u || P, o.productName, '', 'Img')).join('')
  const accItems = (arr(c.info_sections).length ? arr(c.info_sections) : [{ label: 'Description', body: 'What it is and what’s inside.' }, { label: 'How to use', body: 'A few drops daily, on or under the tongue.' }, { label: 'Shipping & Returns', body: 'Fast, tracked delivery and a money-back guarantee.' }])
    .map((s, i) => `<details${i === 0 ? ' open' : ''}><summary>${escp(s.label)}</summary><div class="body">${esc(s.body)}</div></details>`).join('')

  const stripPills = (arr(c.strip_pills).length ? arr(c.strip_pills) : ['Sustained Cellular Energy', 'Simple Daily Drops', 'Triple Lab Tested', 'Instant Mental Clarity', 'No Jittery Crash'].map((l) => ({ label: l })))
    .map((p, i) => `<div class="benfc"><span class="pico">${benefitCheckIcon(i)}</span><span class="ptext">${escp(p.label)}</span></div>`)
  const strip = stripPills.join('')
  // duplicate set (aria-hidden, skipped in the tree) makes the marquee loop seamlessly
  const stripDup = stripPills.map((h) => h.replace('<div class="benfc"', '<div class="benfc" aria-hidden="true"')).join('')
  // Image with Numbered Benefits — a Benefits Card of numbered rows (icon + title + description) beside an image.
  const numbRows = (arr(c.numb_benefits).length ? arr(c.numb_benefits) : [
    { title: 'Absorbs excess oil', body: 'Effortlessly lift away buildup for a fresh, airy finish that lasts.' },
    { title: 'Refreshes flat hair', body: 'Clarifying botanicals bring dull strands back to vibrant life.' },
    { title: 'Natural citrus boost', body: 'Cold-pressed oils purify the scalp for an invigorating reset.' },
    { title: 'Pre-wash prep', body: 'Balances your hair for a total reset before your favourite shampoo.' },
  ]).slice(0, 5).map((b: any, i: number) => `<div class="brow"><span class="pico">${benefitCheckIcon(i)}</span><div class="btg"><div class="btitle">${escp(b.title || b.label)}</div><div class="bdesc">${escp(b.body || '')}</div></div></div>`).join('')

  const vGood = (arr(c.vs_ours).length ? arr(c.vs_ours) : ['USP-Grade Purity', 'Accurate Microdosing', 'Rapid Brain & Energy Boost', 'Clean Taste, No Bitterness', 'Leakproof, Stable Formula'].map((l) => ({ label: l })))
    .map((r) => `<div class="r"><span class="ic">${CHKline}</span><span class="rt">${escp(r.label)}</span></div>`).join('')
  const vBad = (arr(c.vs_others).length ? arr(c.vs_others) : ['Unverified Purity', 'Inconsistent Dosing', 'Slower Absorption', 'Harsh Chemical Taste', 'Leaky, Unstable Packaging'].map((l) => ({ label: l })))
    .map((r) => `<div class="r"><span class="ic">${XMARKr}</span><span class="rt">${escp(r.label)}</span></div>`).join('')

  const bens = (arr(c.benefits).length ? arr(c.benefits) : [
    { title: 'Sustained Cellular Energy', body: 'Fuel your mitochondria for steady stamina that lasts all day without the caffeine crash.' },
    { title: 'Instant Mental Clarity', body: 'Clear away brain fog in minutes to feel sharper and more present during demanding tasks.' },
    { title: 'Reliable Neuroprotection', body: 'Defend your brain against oxidative stress to maintain long-term cognitive health and resilience.' },
    { title: 'Elevated Daily Motivation', body: 'Transform stress into flow and enjoy an uplifted mood that keeps you moving forward.' },
    { title: 'Triple Tested Purity', body: 'Trust in pharmaceutical-grade quality with every batch tested in protective cobalt glass.' },
  ]).slice(0, 5).map((b: any, i: number) => `<div class="brow"><div class="n">${i + 1}</div><div class="t"><b>${escp(b.title || b.label)}</b><p>${esc(b.body)}</p></div></div>`).join('')

  // Reviews Carousel — Featured Review cards (image + verified reviewer + stars + quote), swiperized on publish.
  const revs = (arr(c.testimonials).length ? arr(c.testimonials) : [
    { name: 'Justin P.', quote: 'I was skeptical, but this smooths out my whole day. Less stress, more getting things done. Way different than coffee.' },
    { name: 'Sam T.', quote: 'I feel lighter, more positive, and just generally driven without feeling wired. Simple addition to my water.' },
    { name: 'Bri M.', quote: 'Helps me stay sharp during long meetings. I like that it supports my cells instead of just spiking me.' },
    { name: 'Benny K.', quote: 'Love skipping the third cup of coffee now. This gives me that grounded alertness I’ve been searching for.' },
    { name: 'Dana R.', quote: 'A calm, steady lift with none of the afternoon crash. It has quietly become part of my morning.' },
    { name: 'Theo L.', quote: 'Clean and simple. I feel focused for hours and my mood is noticeably better through the week.' },
  ]).slice(0, 6).map((t: any) => `<div class="frev">${img(t.image || P, escp(t.name), 'frimg', 'Image')}<div class="frwho"><span class="ic">${VERIFIED}</span><span class="frname">${escp(t.name)}</span></div><div class="frstars">★★★★★</div><p class="frq">${esc(t.quote)}</p></div>`).join('')

  // As Seen On with Quotes — a marquee (Rotating Content) of Item = press Logo (wordmark) + Quote.
  const seenSrc = (arr(c.press_quotes).length ? arr(c.press_quotes) : [
    { title: 'New Scientist', body: 'The ultimate upgrade for clean mental clarity and focus.' },
    { title: 'Bloomberg', body: 'An effortless way to perk up your whole morning routine.' },
    { title: 'Cosmopolitan', body: 'A calm, steady lift the whole team swears by now.' },
    { title: 'Forbes', body: 'A genuine standout in the daily wellness category.' },
    { title: 'Vogue', body: 'It quietly became part of my everyday ritual.' },
  ]).slice(0, 6)
  const seenItem = (p: any) => `<div class="qitem"><span class="qlogo">${escp(p.title || p.label)}</span><span class="qquote">${esc(p.body)}</span></div>`
  const seenItems = seenSrc.map(seenItem).join('')
  // aria-hidden duplicate set → seamless marquee loop (skipped in the editor tree, like Rotating Benefits)
  const seenDup = seenSrc.map((p) => seenItem(p).replace('<div class="qitem"', '<div class="qitem" aria-hidden="true"')).join('')

  // As Seen On — a Rotating Content marquee of press Logos (wordmarks; no quotes).
  const slogo = (p: any) => `<span class="sllogo">${escp(p.title || p.label)}</span>`
  const slItems = seenSrc.map(slogo).join('')
  const slDup = seenSrc.map((p) => slogo(p).replace('<span class="sllogo"', '<span class="sllogo" aria-hidden="true"')).join('')

  // Statistics With Percentages — Item Group (Percentage Circle [proportional ring] + Text) per stat.
  const stats = (arr(c.stats).length ? arr(c.stats) : [
    { label: '97%', body: 'Felt reliable clarity in every drop.' }, { label: '96%', body: 'Gained brain fuel for a sharper edge.' }, { label: '98%', body: 'Maintained steady focus without any crashes.' }, { label: '89%', body: 'Found a lighter, more motivated mood.' },
  ]).slice(0, 4).map((s: any) => {
    const pct = Math.max(0, Math.min(100, parseInt(String(s.label).replace(/[^0-9]/g, ''), 10) || 90))
    return `<div class="sc"><div class="ring" style="--pt:${pct};--dur:1.6s"><div class="rc">${pct}%</div></div><p>${bd(s.body)}</p></div>`
  }).join('')

  const feats = (arr(c.feature_cards).length ? arr(c.feature_cards) : [
    { title: 'Sustained Vitality', body: 'Experience clean cellular energy that keeps you alert and steady from morning until evening.' },
    { title: 'Sharp Cognition', body: 'Clear away mental fog to find a natural flow state that helps you stay productive.' },
    { title: 'Trusted Purity', body: 'Every drop is triple-lab tested, ensuring long-term safety for daily use without doubt.' },
  ]).slice(0, 3).map((f: any) => `<div class="fc" style="display:flex;flex-direction:column">${img(f.image, o.productName, 'im', 'Image')}<h4>${escp(f.title)}</h4><p>${esc(f.body)}</p></div>`).join('')

  // Recommended Products — a carousel of Product Cards (Image + Product Title + Price); swiperized on publish.
  const recProducts = (arr(c.rec_products).length ? arr(c.rec_products) : [
    { title: 'Complete Starter Kit', price: '$29.99', was: '$39.99', off: '25% OFF' },
    { title: 'Travel Companion Pack', price: '$19.99', was: '$24.99', off: '20% OFF' },
    { title: 'Refill 3-Pack', price: '$34.99', was: '$44.99', off: '22% OFF' },
    { title: 'Deluxe Gift Box', price: '$49.99', was: '$64.99', off: '23% OFF' },
    { title: 'Everyday Essentials', price: '$24.99', was: '$29.99', off: '17% OFF' },
    { title: 'Premium Bundle', price: '$59.99', was: '$79.99', off: '25% OFF' },
  ]).slice(0, 8).map((p: any) => `<div class="reccard">${img(p.image, o.productName, 'recimg', 'Image')}<div class="rectitle">${escp(p.title || p.label)}</div><div class="recprice"><span class="rn">${escp(p.price || '$19.99')}</span> <s class="rwas">${escp(p.was || '$24.99')}</s> <span class="roff">${escp(p.off || '20% OFF')}</span></div></div>`).join('')

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
          <div class="gwrap">${img(c.image_hero || P, o.productName, 'hbottle', 'Product')}<button class="garr gprev" aria-label="Previous image">‹</button><button class="garr gnext" aria-label="Next image">›</button></div>
        </div>
      </div>
      <div class="thumbs">${thumbs}</div>
    </div>
    <div>
      <div class="bestseller"><span class="num">#1</span><span class="bst"><b>${escp(c.bestseller_label || 'BESTSELLER OF 2026')}</b><span>${escp(c.bestseller_sub || 'Trusted by thousands')}</span></span></div>
      <h1 class="ptitle">${esc(c.headline || o.productName)}</h1>
      <div class="rlabel"><span class="stars">★★★★★</span> <span class="rtext">${escp(c.rating_label || `Rated ${o.rating?.stars || '4.9'} by 17,873 buyers`)}</span></div>
      <div class="hchecks">${checks}</div>
      <div class="price">${c.compare_at ? `<span class="was">${mny(c.compare_at)}</span>` : ''}${price ? `<span class="now">${mny(price)}</span>` : ''}${c.save_pill ? `<span class="save">${escp(c.save_pill)}</span>` : ''}</div>
      <a class="btn" href="${esc(o.ctaHref || '#')}">🛒 ${escp(String(c.cta_label || 'Add to Cart').toUpperCase())}</a>
      <div class="grow"><span>🛡 ${escp(c.guarantee_line || '30-Day Money-Back Guarantee')}</span><span>📦 ${escp(c.returns_line || '30 Day Returns')}</span></div>
      <div class="pays">${paysRowInner()}</div>
      <div class="sfdiv"></div>
      <div class="acc">${accItems}</div>
      <div class="hclaim">${escp(c.hero_claim || 'Join thousands of customers who trust our money-back guarantee.')}</div>
      <div class="hrev"><div class="av">${img(c.image_reviewer, 'Reviewer', 'avim', '')}</div><div><div class="q">${esc(c.hero_review || 'Actually feels like clean fuel. No racing heart or crash later, just a steady sense of being ‘on’ while I work through my day.')}</div><div class="who">${escp(c.hero_review_name || 'Verified Buyer')}</div></div></div>
      <div class="warn">⚠ <span><b>Low Stock Notice.</b> ${bd(c.warn_line || 'This product sold out fast this year. We encourage you to take advantage of the limited sale while it lasts. It’s only available here and not sold in stores.')}</span></div>
    </div>
  </div></div></section>

  <!-- 2 · PILL STRIP -->
  <section class="strip"><div class="striptrack">${strip}${stripDup}</div></section>

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
    <div class="lgroup">
      <h2>${hl(c.how_head || 'How Does This Liquid Energy Work?')}</h2>
      <p>${bd(c.how_body1 || 'It acts directly on your mitochondria, the tiny engines that power every cell. It helps them convert fuel into energy more efficiently than caffeine can.')}</p>
      <p>${bd(c.how_body2 || 'Instead of a temporary spike, you feel steady focus and sustained stamina. Daily use helps protect brain cells and lifts your mood naturally.')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.how_cta || 'Buy It Now')}</a>
    </div>
    <div class="rgroup">${img(c.image_sci || c.image_g2 || P, o.productName, 'howimg', 'Product')}</div>
  </div></div></section>

  <!-- 4b · IMAGE WITH NUMBERED BENEFITS -->
  <section class="numbf"><div class="wrap"><div class="grid">
    <div class="imgcol">${img(c.image_numb || c.image_trust1 || P, o.productName, 'numbimg', 'Image')}</div>
    <div class="contcol">
      <h2>${hl(c.numb_head || 'Everything you need in **one daily ritual**')}</h2>
      <p class="nsub">${bd(c.numb_sub || 'Four reasons thousands make this the first thing they reach for every morning.')}</p>
      <div class="bcard">${numbRows}</div>
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
    <div class="rvtitle">
      <div class="ratedby"><span class="stars">★★★★★</span> <span class="rbtxt">${escp(c.reviews_sub || `Rated ${o.rating?.stars || '4.9'} based on 7,000+ reviews`)}</span></div>
      <h2 class="secttl">${hl(c.reviews_head || 'What Real People Are Saying')}</h2>
      <div class="sectsub">${escp(c.reviews_intro || 'Join our growing community of people who made this part of their daily routine.')}</div>
    </div>
    <div class="rcar">${revs}</div>
  </div></section>

  <!-- 6b · AS SEEN ON WITH QUOTES -->
  <section class="seen"><div class="seentrack">${seenItems}${seenDup}</div></section>

  <!-- 7 · STATS -->
  <section class="stats"><div class="wrap">
    <div class="shead" style="display:flex;flex-direction:column;align-items:center">
      <h2 class="secttl">${hl(c.stats_head || 'What Most High Performers Noticed')}</h2>
      <div class="sectsub">${esc(c.stats_sub || 'A collection of real experiences from people who chose mitochondrial support over their morning cup of coffee.')}</div>
    </div>
    <div class="sgrid">${stats}</div>
  </div></section>

  <!-- 8 · FEATURE CARDS -->
  <section class="feat"><div class="wrap">
    <div class="fhead" style="display:flex;flex-direction:column;align-items:center">
      <h2 class="secttl">${hl(c.feat_head || 'Pure mitochondria support for daily mental clarity')}</h2>
      <div class="sectsub">${esc(c.feat_sub || 'Fuel your cells directly to activate natural focus and steady stamina without the usual caffeine crash.')}</div>
    </div>
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

  <!-- 9b · HAPPINESS GUARANTEE -->
  <section class="hguar"><div class="wrap">
    <div class="hgbox">
      ${img(c.image_hguar || c.image_trust1 || P, o.productName, 'hgimg', 'Image')}
      <div class="hgel">
        <span class="pico hgico">${HEART}</span>
        <h2>${hl(c.hguar_head || 'Our Happiness **Guarantee**')}</h2>
        <p>${esc(c.hguar_body || 'Try it risk-free for 30 days. If you do not feel the difference, we will refund you in full — no questions asked.')}</p>
        <a class="hgbtn" href="${esc(o.ctaHref || '#')}">${escp(c.hguar_cta || 'Buy It Now')}</a>
        <div class="pays">${paysRowInner()}</div>
      </div>
    </div>
  </div></section>

  <!-- 9c · RECOMMENDED PRODUCTS -->
  <section class="recs"><div class="wrap">
    <h2 class="secttl">${hl(c.recs_head || 'You May Also **Like**')}</h2>
    <div class="reccar">${recProducts}</div>
  </div></section>

  <!-- 9d · AS SEEN ON (logos) -->
  <section class="seenl"><div class="wrap">
    <div class="slhead"><h2 class="secttl">${hl(c.seenl_head || 'As Seen On')}</h2></div>
    <div class="sltrack">${slItems}${slDup}</div>
  </div></section>

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
      <div class="pays">${paysRowInner()}</div>
    </div>
  </div></div></section>

  <!-- 11 · STICKY ADD TO CART -->
  <section class="satc"><div class="satcbar">
    <div class="satcgroup">
      ${img(c.image_satc || P, o.productName, 'satcimg', 'Image')}
      <div class="satcinfo">
        <div class="satctitle">${escp(c.satc_title || o.productName)}</div>
      </div>
    </div>
    <a class="satcbtn" href="${esc(o.ctaHref || '#')}">${escp(c.satc_cta || 'Add to Cart')}</a>
  </div></section>

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
    { key: 'numb_head', type: 'text', label: 'Numbered-benefits heading', hint: 'Accent 1-2 words with ** ** (e.g. "one daily **ritual**").' },
    { key: 'numb_sub', type: 'richtext', role: 'body', label: 'Numbered-benefits subhead' },
    { key: 'numb_benefits', type: 'reasons', label: 'Numbered benefits (4)', count: 4, hint: 'title = short benefit; body = one supporting line.' },
    { key: 'image_numb', type: 'image', role: 'lifestyle', label: 'Numbered-benefits image' },
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
    { key: 'reviews_intro', type: 'text', label: 'Reviews subtitle' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews (6)', count: 6, hint: 'name + quote.' },
    { key: 'press_quotes', type: 'reasons', label: 'As-seen-on quotes (6)', count: 6, hint: 'title = publication name (shown as a wordmark); body = a short one-line quote.' },
    { key: 'stats_head', type: 'text', label: 'Stats heading' },
    { key: 'stats_sub', type: 'text', label: 'Stats subhead' },
    { key: 'stats', type: 'reasons', label: 'Stats (4)', count: 4, hint: 'label = a percentage like "97%"; body = what improved.' },
    { key: 'feat_head', type: 'text', label: 'Feature-cards heading' },
    { key: 'feat_sub', type: 'text', label: 'Feature-cards subhead' },
    { key: 'feature_cards', type: 'reasons', label: 'Feature cards (3)', count: 3, hint: 'title + body; each has its own image slot.' },
    { key: 'hguar_head', type: 'text', label: 'Happiness-guarantee heading', hint: 'Accent 1-2 words with ** ** (e.g. "Our Happiness **Guarantee**").' },
    { key: 'hguar_body', type: 'text', label: 'Happiness-guarantee text' },
    { key: 'hguar_cta', type: 'text', label: 'Happiness-guarantee button' },
    { key: 'image_hguar', type: 'image', role: 'lifestyle', label: 'Happiness-guarantee image' },
    { key: 'recs_head', type: 'text', label: 'Recommended-products heading', hint: 'Accent 1-2 words with ** ** (e.g. "You May Also **Like**").' },
    { key: 'seenl_head', type: 'text', label: 'As-seen-on (logos) heading' },
    { key: 'satc_title', type: 'text', label: 'Sticky bar product name' },
    { key: 'satc_cta', type: 'text', label: 'Sticky bar button' },
    { key: 'image_satc', type: 'image', role: 'product', label: 'Sticky bar thumbnail' },
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
