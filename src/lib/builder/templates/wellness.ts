/**
 * wellness_v1 — a premium supplement/wellness product page modelled section-for-section on the AG1 landing
 * page: hero buy-box (gallery + rating + sale price + benefit checks + add-to-cart + Trustpilot), a cream
 * "holistic support" split with an icon grid + a timeline accordion, an image/text "starter" block with an
 * upgrade card, a forest-green benefits band with a centre lifestyle photo, a customer-results stats band
 * with an ingredients card, a comparison table, a press logo strip, and a reviews carousel.
 * Layout is FIXED; the AI only fills `schema` slots. All CSS scoped under `.pgbld`. Fully responsive.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const escp = (s: any) => esc(String(s ?? '').replace(/\*\*/g, '').replace(/^\s*[-•*]\s*/, '').trim())
const hl = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<span class="hl">$1</span>')
const arr = (v: SlotValue | undefined) => (Array.isArray(v) ? v : [])
const PH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/></svg>'
function img(url: any, alt: string, cls: string, label?: string): string {
  if (url && typeof url === 'string') return `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`
  return `<div class="${cls} ph"><span class="phi">${PH_ICON}</span><span class="phl">${esc(label || 'Image')}</span></div>`
}
// Thin line icons matching the AG1 aesthetic (stroke = currentColor so they inherit each section's colour).
const S = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`
const ICONS = [
  S('<path d="M11 21C6 21 4 16 4 12c0-5 4-8 9-9 1 6 0 12-2 15"/><path d="M4 21c5 0 9-3 11-8"/>'),          // leaf — ingredients
  S('<path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11z"/>'),                                        // droplet — digestion
  S('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>'),                                                          // bolt — energy
  S('<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),                    // shield — immune
  S('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>'),      // smile — mood
  S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>'),      // target — focus
  S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>'),   // sun — routine
  S('<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>'),                       // heart — quality
]

const css = `
.pgbld{--grn:#14311f;--grn2:#1d4029;--cream:#efece3;--ink:#16241a;--sub:#6b7268;--line:#e3ded2;--btn:#2f5d3f;--good:#2f8a4e;--bad:#d9534f;--paper:#fbfaf7;
  font-family:'Inter',system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);line-height:1.5;background:#fff;-webkit-font-smoothing:antialiased}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld .ph{background:#f2efe7;border:1.5px dashed #cfc9ba;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#9a9384;font-size:12px;min-height:120px;border-radius:12px;text-align:center;padding:14px}
.pgbld .ph .phi svg{width:30px;height:30px}
.pgbld .ph .phl{font-weight:700;letter-spacing:.02em}
.pgbld .wrap{max-width:1120px;margin:0 auto;padding:0 22px}
.pgbld .hl{color:var(--btn)}
.pgbld h1,.pgbld h2,.pgbld h3{margin:0;letter-spacing:-.02em;line-height:1.12}
.pgbld .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--btn);color:#fff;border:0;border-radius:10px;padding:14px 26px;font-size:15px;font-weight:800;cursor:pointer;text-decoration:none;width:100%}
.pgbld .pays{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.pgbld .pays span{font-size:10px;font-weight:800;color:#8a8578;border:1px solid var(--line);border-radius:5px;padding:3px 7px;background:#fff}

/* 1 · HERO */
.pgbld .hero{padding:34px 0 40px}
.pgbld .hero .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.pgbld .gmain{border-radius:18px;overflow:hidden;background:var(--cream);aspect-ratio:1/1}
.pgbld .gmain img{width:100%;height:100%;object-fit:cover}
.pgbld .thumbs{display:flex;gap:10px;margin-top:12px}
.pgbld .thumbs img,.pgbld .thumbs .ph{width:74px;height:74px;object-fit:cover;border-radius:10px;border:1px solid var(--line)}
.pgbld .stars{color:#2f8a4e;letter-spacing:2px;font-size:14px}
.pgbld .rlabel{font-size:12.5px;color:var(--sub);margin:6px 0 8px}
.pgbld .ptitle{font-size:30px;font-weight:800}
.pgbld .badge{display:inline-block;background:#eef4ee;color:var(--btn);font-size:11px;font-weight:800;border-radius:6px;padding:3px 9px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em}
.pgbld .price{display:flex;align-items:baseline;gap:10px;margin:10px 0}
.pgbld .price .now{font-size:24px;font-weight:800}
.pgbld .price .was{font-size:15px;color:#9a958a;text-decoration:line-through}
.pgbld .price .save{font-size:11px;font-weight:800;color:#fff;background:var(--good);border-radius:5px;padding:3px 8px}
.pgbld .psub{font-size:14px;color:var(--sub);margin-bottom:14px}
.pgbld .checks{display:flex;flex-direction:column;gap:9px;margin:14px 0 16px}
.pgbld .checks .c{display:flex;align-items:center;gap:9px;font-size:13.5px}
.pgbld .checks .c b{width:20px;height:20px;border-radius:50%;background:#eef4ee;color:var(--good);display:grid;place-items:center;font-size:12px;flex:none}
.pgbld .titlesel{border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:13px;color:var(--ink);margin-bottom:12px;background:#fff}
.pgbld .titlesel small{display:block;color:var(--sub);font-size:11px;margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em}
.pgbld .hquote{margin-top:16px;border-top:1px solid var(--line);padding-top:14px;font-size:13px;color:var(--sub);font-style:italic}
.pgbld .tpilot{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12.5px;color:var(--sub)}
.pgbld .tpilot b{color:var(--ink)}

/* 2 · HOLISTIC */
.pgbld .holistic{background:var(--cream);padding:56px 0}
.pgbld .holistic .grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .hcol h2{font-size:26px;text-align:center;margin-bottom:26px}
.pgbld .hbag{max-width:300px;margin:22px auto 0}
.pgbld .icgrid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px 16px}
.pgbld .icg{text-align:center}
.pgbld .icg .ic{color:var(--btn);margin-bottom:6px;display:flex;justify-content:center}
.pgbld .icg .ic svg{width:28px;height:28px}
.pgbld .minf .ic svg{width:22px;height:22px}
.pgbld .minf .ic{color:var(--btn);display:flex;justify-content:center}
.pgbld .fb .ic svg{width:19px;height:19px;color:#fff}
.pgbld .icg .t{font-size:12.5px;color:var(--sub);line-height:1.35}
.pgbld .fhead{font-size:26px;margin-bottom:12px}
.pgbld .fbody{font-size:14.5px;color:var(--sub);margin-bottom:20px}
.pgbld .acc{border-top:1px solid #dcd7ca}
.pgbld .acc details{border-bottom:1px solid #dcd7ca}
.pgbld .acc summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:12px;padding:15px 2px;font-weight:700;font-size:15px}
.pgbld .acc summary::-webkit-details-marker{display:none}
.pgbld .acc summary::after{content:'⌄';margin-left:auto;color:var(--sub);font-size:18px}
.pgbld .acc .tag{font-size:10.5px;font-weight:800;color:var(--btn);background:#e3ebe4;border-radius:5px;padding:3px 8px;text-transform:uppercase}
.pgbld .acc .body{padding:0 2px 15px;font-size:13.5px;color:var(--sub)}

/* 3 · STARTER + UPGRADE */
.pgbld .starter{padding:56px 0}
.pgbld .starter .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.pgbld .starter h2{font-size:26px;margin-bottom:14px}
.pgbld .starter p{font-size:14.5px;color:var(--sub);margin-bottom:20px}
.pgbld .minf{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:20px}
.pgbld .minf .m{text-align:center}
.pgbld .minf .ic{font-size:20px;margin-bottom:5px}
.pgbld .minf .t{font-size:11.5px;color:var(--sub);line-height:1.35}
.pgbld .upgrade{background:var(--cream);border-radius:18px;padding:28px;display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:center}
.pgbld .upgrade h3{font-size:22px;margin-bottom:14px}
.pgbld .upgrade h3 em{font-style:italic;color:var(--btn)}
.pgbld .upgrade .ulist{display:flex;flex-direction:column;gap:10px}
.pgbld .upgrade .u{display:flex;gap:8px;font-size:12.5px;color:var(--ink)}
.pgbld .upgrade .u b{color:var(--good);flex:none}

/* 4 · FOCUS BAND (dark green, angled) */
.pgbld .focus{background:var(--grn);color:#eef1ea;padding:70px 0 64px;clip-path:polygon(0 3%,100% 0,100% 100%,0 100%)}
.pgbld .focus h2{font-size:28px;text-align:center;color:#fff;max-width:640px;margin:0 auto 8px}
.pgbld .focus .sub{text-align:center;color:#b9c6bb;font-size:14px;max-width:620px;margin:0 auto 40px}
.pgbld .fbwrap{display:grid;grid-template-columns:1fr auto 1fr;gap:28px;align-items:center;max-width:900px;margin:0 auto}
.pgbld .fbcol{display:flex;flex-direction:column;gap:30px}
.pgbld .fbcol.r{text-align:left}.pgbld .fbcol.l{text-align:right}
.pgbld .fb .ic{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.12);display:inline-grid;place-items:center;font-size:17px;margin-bottom:7px}
.pgbld .fb h4{font-size:15px;color:#fff;margin:0 0 4px}
.pgbld .fb p{font-size:12.5px;color:#b9c6bb;margin:0;line-height:1.45}
.pgbld .fbimg{width:190px;height:190px;border-radius:50%;object-fit:cover;border:5px solid rgba(255,255,255,.1)}

/* 5 · STATS */
.pgbld .stats{background:var(--grn);color:#eef1ea;padding:20px 0 70px}
.pgbld .stats h2{font-size:24px;text-align:center;color:#fff;margin-bottom:30px}
.pgbld .stats .row{display:grid;grid-template-columns:1fr 1fr;gap:26px;align-items:stretch}
.pgbld .scards{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.pgbld .scard{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:24px 18px;text-align:center}
.pgbld .scard .n{font-size:34px;font-weight:800;color:#fff}
.pgbld .scard .t{font-size:13px;color:#fff;margin-top:4px}
.pgbld .scard .s{font-size:11.5px;color:#9fb0a2;margin-top:2px}
.pgbld .ingcard{background:var(--cream);color:var(--ink);border-radius:16px;padding:26px;text-align:center;display:flex;flex-direction:column;justify-content:center}
.pgbld .ingcard h3{font-size:19px;margin-bottom:16px}
.pgbld .ingcard .imr{position:relative}
.pgbld .ingcard .imr img,.pgbld .ingcard .imr .ph{max-width:180px;margin:0 auto;border-radius:12px}
.pgbld .inglabs{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:14px}
.pgbld .inglabs span{font-size:11px;font-weight:700;color:var(--sub);background:#fff;border:1px solid var(--line);border-radius:999px;padding:4px 10px}

/* 6 · COMPARISON */
.pgbld .compare{padding:60px 0}
.pgbld .compare .grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .compare h2{font-size:26px;margin-bottom:12px}
.pgbld .compare p{font-size:14px;color:var(--sub);margin-bottom:20px}
.pgbld .ctable{background:var(--cream);border-radius:16px;padding:10px 16px}
.pgbld .ctop{display:grid;grid-template-columns:1fr 90px 90px;padding:12px 4px;font-size:11.5px;font-weight:800;color:var(--sub);text-transform:uppercase;letter-spacing:.03em;text-align:center}
.pgbld .ctop span:first-child{text-align:left}
.pgbld .ctop .ours{color:var(--btn)}
.pgbld .cr{display:grid;grid-template-columns:1fr 90px 90px;align-items:center;padding:13px 4px;border-top:1px solid #dcd7ca;font-size:13.5px}
.pgbld .cr .yes{color:var(--good);font-weight:900}
.pgbld .cr .no{color:var(--bad);font-weight:900}
.pgbld .cr .m{text-align:center}
.pgbld .cr .ourcol{background:#e6efe7;border-radius:8px}

/* 7 · PRESS */
.pgbld .press{background:var(--grn2);padding:20px 0}
.pgbld .press .logos{display:flex;flex-wrap:wrap;gap:22px 40px;justify-content:center;align-items:center}
.pgbld .press .logos span{color:#dfe6df;font-weight:800;font-size:16px;opacity:.85;letter-spacing:.02em}

/* 8 · REVIEWS */
.pgbld .reviews{background:var(--cream);padding:56px 0}
.pgbld .reviews .rh{text-align:center;margin-bottom:30px}
.pgbld .reviews .rh .st{color:#2f8a4e;letter-spacing:3px;margin-bottom:8px}
.pgbld .reviews h2{font-size:26px;margin-bottom:8px}
.pgbld .reviews .rsub{font-size:14px;color:var(--sub)}
.pgbld .rgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.pgbld .rcard{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.pgbld .rcard .rimg,.pgbld .rcard .rimg.ph{width:100%;aspect-ratio:1/1;object-fit:cover}
.pgbld .rcard .rb{padding:13px}
.pgbld .rcard .rname{font-weight:700;font-size:13.5px}
.pgbld .rcard .rst{color:#2f8a4e;font-size:12px;letter-spacing:1px;margin:2px 0 6px}
.pgbld .rcard p{font-size:12.5px;color:var(--sub);margin:0;line-height:1.45}

/* ── responsive ── */
@media(max-width:860px){
  .pgbld .hero .grid,.pgbld .holistic .grid,.pgbld .starter .grid,.pgbld .compare .grid,.pgbld .stats .row,.pgbld .upgrade{grid-template-columns:1fr}
  .pgbld .fbwrap{grid-template-columns:1fr;text-align:center}
  .pgbld .fbcol.l,.pgbld .fbcol.r{text-align:center;flex-direction:row;flex-wrap:wrap;justify-content:center;gap:18px}
  .pgbld .fbcol .fb{flex:1;min-width:130px}
  .pgbld .fbimg{width:150px;height:150px;margin:8px auto}
  .pgbld .rgrid{grid-template-columns:1fr 1fr}
  .pgbld .focus{clip-path:none}
  .pgbld .ptitle{font-size:26px}
}
@media(max-width:520px){
  .pgbld .icgrid,.pgbld .minf,.pgbld .scards{grid-template-columns:1fr 1fr}
  .pgbld .rgrid{grid-template-columns:1fr}
  .pgbld .wrap{padding:0 16px}
}
`.trim()

function render(c: FilledContent, o: RenderOpts): string {
  const rating = o.rating ? `${o.rating.stars}` : '4.9'
  const checks = (arr(c.hero_benefits).length ? arr(c.hero_benefits) : ['Refreshing taste', 'Fits into your routine', 'Feel centered daily', 'Support for busy days'].map((l) => ({ label: l })))
    .slice(0, 4).map((b) => `<div class="c"><b>✓</b>${escp(b.label)}</div>`).join('')
  const thumbs = [c.image_main, c.image_g2, c.image_g3, c.image_g4].map((u) => img(u || o.productImage, o.productName, '', 'Product')).join('')

  const holFeat = (arr(c.holistic_features).length ? arr(c.holistic_features) : ['70+ ingredients', 'Supports digestion', 'Supports energy', 'Supports immune system', 'Stress & mood balance', 'Focus & concentration'].map((l) => ({ label: l })))
    .slice(0, 6).map((f, i) => `<div class="icg"><div class="ic">${ICONS[i % ICONS.length]}</div><div class="t">${escp(f.label)}</div></div>`).join('')
  const steps = (arr(c.foundation_steps).length ? arr(c.foundation_steps) : [{ label: 'Day 1', title: 'The Initial Spark', body: 'A gentle lift as your body takes in the nutrients.' }, { label: '1 Week', title: 'Steady Rhythm', body: 'Energy evens out across the day.' }, { label: '1 Month', title: 'Mental Momentum', body: 'Sharper focus becomes your normal.' }, { label: '3 Months', title: 'Optimized Baseline', body: 'A new, higher baseline of wellbeing.' }])
    .map((s, i) => `<details${i === 0 ? ' open' : ''}><summary><span class="tag">${escp(s.label)}</span>${escp((s as any).title || 'Step')}</summary><div class="body">${esc(s.body)}</div></details>`).join('')

  const minf = (arr(c.morning_features).length ? arr(c.morning_features) : ['Smoothly dissolving blend', 'Steady focus for deep work', 'Reliable energy all day'].map((l) => ({ label: l })))
    .slice(0, 3).map((m, i) => `<div class="m"><div class="ic">${ICONS[i % ICONS.length]}</div><div class="t">${escp(m.label)}</div></div>`).join('')
  const upg = (arr(c.upgrade_items).length ? arr(c.upgrade_items) : ['Clinically shown to support digestive function', '5 optimized bacterial cultures', '10x more beneficial gut bacteria', 'Backed by 4 clinical trials'].map((l) => ({ label: l })))
    .slice(0, 4).map((u) => `<div class="u"><b>✓</b>${escp(u.label)}</div>`).join('')

  const focusB = (arr(c.focus_benefits).length ? arr(c.focus_benefits) : [{ title: 'Morning Routine', body: 'Replace a cabinet of supplements with one simple scoop.' }, { title: 'Balanced Mood', body: 'A calm feeling of steady support all day.' }, { title: 'Steady Focus', body: 'The vitamins and minerals your brain needs.' }, { title: 'Trusted Quality', body: 'Third-party tested for purity and safety.' }])
  const FB_ICONS = [ICONS[6], ICONS[4], ICONS[5], ICONS[3]]   // routine · mood · focus · quality
  const fb = (b: any, i: number) => `<div class="fb"><div class="ic">${FB_ICONS[i] || ICONS[0]}</div><h4>${escp(b.title || b.label)}</h4><p>${esc(b.body)}</p></div>`

  const scards = (arr(c.stats).length ? arr(c.stats) : [{ label: '100%', title: 'Sustained focus', body: 'Throughout their workday' }, { label: '99%', title: 'Improved mood', body: 'Within the first week' }, { label: '99%', title: 'Steady energy', body: 'When they start their day' }, { label: '95%', title: 'Consistent performance', body: 'Through consistent use' }])
    .slice(0, 4).map((s) => `<div class="scard"><div class="n">${escp(s.label)}</div><div class="t">${escp((s as any).title)}</div><div class="s">${esc(s.body)}</div></div>`).join('')
  const inglabs = (arr(c.ingredient_labels).length ? arr(c.ingredient_labels) : ['Vitamins', 'Fiber', 'Minerals', 'Botanicals', 'Bacterial cultures'].map((l) => ({ label: l })))
    .map((l) => `<span>${escp(l.label)}</span>`).join('')

  const cmpRows = (arr(c.compare_rows).length ? arr(c.compare_rows) : ['Steady Focus', 'Easy Swaps', 'Daily Synergy', 'Zero Crashes', 'Better Mornings'].map((l) => ({ label: l })))
    .map((r) => `<div class="cr"><div>${escp(r.label)}</div><div class="m ourcol"><span class="yes">✓</span></div><div class="m"><span class="no">✕</span></div></div>`).join('')

  const logos = (arr(c.press_logos).length ? arr(c.press_logos) : ['New Scientist', 'Bloomberg', 'Cosmopolitan', "Women's Health", 'Allure'].map((l) => ({ label: l })))
    .map((l: any) => l.image ? `<img src="${esc(l.image)}" alt="${escp(l.label)}" style="height:20px">` : `<span>${escp(l.label)}</span>`).join('')

  const revPhotos = [c.image_rev1, c.image_rev2, c.image_rev3, c.image_rev4]
  const revs = (arr(c.testimonials).length ? arr(c.testimonials) : [{ name: 'Jordan K.', quote: 'Makes tackling the day feel much less breathless.' }, { name: 'Samara', quote: 'No more crashing mid-morning through deep work.' }, { name: 'Maddie', quote: 'I don’t have to think about my energy levels — so easy.' }, { name: 'Taylor V.', quote: 'Finally something that helps me feel sharp. Game changer.' }])
    .slice(0, 4).map((t, i) => `<div class="rcard">${img(revPhotos[i] || o.productImage, o.productName, 'rimg', 'Customer photo')}<div class="rb"><div class="rname">${escp(t.name)}</div><div class="rst">★★★★★</div><p>${esc(t.quote)}</p></div></div>`).join('')

  const price = o.priceLabel || ''
  return `<div class="pgbld">

  <!-- 1 · HERO -->
  <section class="hero"><div class="wrap"><div class="grid">
    <div>
      <div class="gmain">${img(c.image_main || o.productImage, o.productName, 'gimg', 'Product photo')}</div>
      <div class="thumbs">${thumbs}</div>
    </div>
    <div>
      <div class="stars">★★★★★</div><div class="rlabel">${escp(c.rating_label || `${rating}/5 based on happy customers`)}</div>
      ${c.badge || o.productName ? `<div class="badge">${escp(c.badge || 'Best Seller')}</div>` : ''}
      <h1 class="ptitle">${esc(c.headline || o.productName)}</h1>
      <div class="price">${price ? `<span class="now">${esc(price)}</span>` : ''}${c.compare_at ? `<span class="was">${escp(c.compare_at)}</span>` : ''}${c.save_pill ? `<span class="save">${escp(c.save_pill)}</span>` : ''}</div>
      <div class="psub">${esc(c.psub || c.subhead || '')}</div>
      <div class="checks">${checks}</div>
      <div class="titlesel"><small>Title</small>${escp(c.title_option || 'Default')}</div>
      <a class="btn" href="${esc(o.ctaHref || '#')}">🛒 ${escp(c.cta_label || 'Add to Cart')}</a>
      <div class="pays"><span>VISA</span><span>Mastercard</span><span>AMEX</span><span>PayPal</span><span>G Pay</span><span>Shop</span></div>
      ${c.hero_quote ? `<div class="hquote">“${esc(c.hero_quote)}”</div>` : ''}
      <div class="tpilot"><b>Excellent</b> <span class="stars">★★★★★</span> ${escp(c.trust_label || 'Trustpilot')}</div>
    </div>
  </div></div></section>

  <!-- 2 · HOLISTIC -->
  <section class="holistic"><div class="wrap"><div class="grid">
    <div class="hcol">
      <h2>${hl(c.holistic_head || 'Holistic support for your health')}</h2>
      <div class="icgrid">${holFeat}</div>
      <div class="hbag">${img(c.image_holistic || o.productImage, o.productName, 'gimg', 'Product photo')}</div>
    </div>
    <div class="hcol">
      <h2 class="fhead">${hl(c.foundation_head || 'Your daily foundation for focus.')}</h2>
      <div class="fbody">${esc(c.foundation_body || '')}</div>
      <div class="acc">${steps}</div>
    </div>
  </div></div></section>

  <!-- 3 · STARTER + UPGRADE -->
  <section class="starter"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.morning_head || 'Smooth Morning Mental Momentum Starter')}</h2>
      <p>${esc(c.morning_body || '')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.morning_cta || 'Buy It Now')}</a>
      <div class="minf">${minf}</div>
    </div>
    <div class="upgrade">
      <div>${img(c.image_upgrade || o.productImage, o.productName, 'gimg', 'Product photo')}</div>
      <div><h3>${hl(c.upgrade_head || 'The <em>Upgrade</em>')}</h3><div class="ulist">${upg}</div></div>
    </div>
  </div></div></section>

  <!-- 4 · FOCUS BAND -->
  <section class="focus"><div class="wrap">
    <h2>${hl(c.focus_head || 'Start your day with a focused mind and steady energy')}</h2>
    <div class="sub">${esc(c.focus_sub || '')}</div>
    <div class="fbwrap">
      <div class="fbcol l">${fb(focusB[0] || {}, 0)}${fb(focusB[2] || {}, 2)}</div>
      <div>${img(c.image_focus || o.productImage, o.productName, 'fbimg', 'Lifestyle photo')}</div>
      <div class="fbcol r">${fb(focusB[1] || {}, 1)}${fb(focusB[3] || {}, 3)}</div>
    </div>
  </div></section>

  <!-- 5 · STATS -->
  <section class="stats"><div class="wrap">
    <h2>${esc(c.stats_head || 'Actual Customer Results Reported')}</h2>
    <div class="row">
      <div class="scards">${scards}</div>
      <div class="ingcard"><h3>${hl(c.ingredients_head || '70+ high-quality ingredients optimised for impact')}</h3><div class="imr">${img(c.image_ingredients || o.productImage, o.productName, 'gimg', 'Bottle / ingredients')}</div><div class="inglabs">${inglabs}</div></div>
    </div>
  </div></section>

  <!-- 6 · COMPARISON -->
  <section class="compare"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.compare_head || 'The Difference Between Surviving and Thriving')}</h2>
      <p>${esc(c.compare_body || '')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.compare_cta || 'Get Yours')}</a>
      <div class="pays"><span>VISA</span><span>Mastercard</span><span>AMEX</span><span>PayPal</span><span>Shop</span></div>
    </div>
    <div class="ctable">
      <div class="ctop"><span>Feature</span><span class="ours">Our product</span><span>Others</span></div>
      ${cmpRows}
    </div>
  </div></div></section>

  <!-- 7 · PRESS -->
  <section class="press"><div class="wrap"><div class="logos">${logos}</div></div></section>

  <!-- 8 · REVIEWS -->
  <section class="reviews"><div class="wrap">
    <div class="rh"><div class="st">★★★★★</div><h2>${hl(c.reviews_head || 'See Why Everyone Stays Consistent')}</h2><div class="rsub">${esc(c.reviews_sub || 'Join the community focusing on consistent energy.')}</div></div>
    <div class="rgrid">${revs}</div>
  </div></section>

  </div>`
}

export const wellnessV1: PageTemplate = {
  id: 'wellness_v1',
  type: 'product',
  name: 'Wellness Supplement',
  description: 'Premium supplement/wellness PDP — forest-green + cream, buy-box hero, holistic split with timeline, results stats, comparison and reviews.',
  css,
  render,
  schema: [
    { key: 'headline', type: 'text', role: 'headline', label: 'Product title', hint: 'The product name / benefit-led title.' },
    { key: 'badge', type: 'text', label: 'Badge', hint: 'e.g. "Best Seller". Optional.' },
    { key: 'rating_label', type: 'text', label: 'Rating line', hint: 'e.g. "4.9/5 based on 8500+ happy customers".' },
    { key: 'compare_at', type: 'text', label: 'Compare-at price', hint: 'Struck-through original price, e.g. "$236.25".' },
    { key: 'save_pill', type: 'text', label: 'Save pill', hint: 'e.g. "SAVE 20%".' },
    { key: 'subhead', type: 'text', role: 'body', label: 'Hero subhead', hint: 'One line under the title on what the product does.' },
    { key: 'hero_benefits', type: 'list', label: 'Hero benefit checks', count: 4, hint: 'Each label only: a short benefit with a ✓.' },
    { key: 'cta_label', type: 'text', label: 'Add-to-cart label', hint: 'e.g. "Add to Cart".' },
    { key: 'hero_quote', type: 'text', label: 'Hero review quote', hint: 'A short real-sounding customer quote.' },
    { key: 'trust_label', type: 'text', label: 'Trust line', hint: 'e.g. "Trustpilot" or a review count.' },
    { key: 'image_main', type: 'image', role: 'product', label: 'Main product image' },
    { key: 'image_g2', type: 'image', role: 'product', label: 'Gallery image 2' },
    { key: 'image_g3', type: 'image', role: 'product', label: 'Gallery image 3' },
    { key: 'image_g4', type: 'image', role: 'lifestyle', label: 'Gallery image 4' },
    { key: 'holistic_head', type: 'text', label: 'Holistic heading', hint: 'e.g. "Holistic support for your health".' },
    { key: 'holistic_features', type: 'list', label: 'Holistic icon features', count: 6, hint: 'Each label only: a short support claim (e.g. "70+ ingredients").' },
    { key: 'image_holistic', type: 'image', role: 'product', label: 'Holistic section image' },
    { key: 'foundation_head', type: 'text', label: 'Foundation heading', hint: 'e.g. "Your daily foundation for **focus**.".' },
    { key: 'foundation_body', type: 'text', role: 'body', label: 'Foundation paragraph' },
    { key: 'foundation_steps', type: 'timeline', label: 'Timeline accordion', count: 4, hint: 'label = timeframe (Day 1 / 1 Week / 1 Month / 3 Months); title = the phase name; body = what happens.' },
    { key: 'morning_head', type: 'text', label: 'Starter heading' },
    { key: 'morning_body', type: 'richtext', role: 'body', label: 'Starter paragraph' },
    { key: 'morning_cta', type: 'text', label: 'Starter button label' },
    { key: 'morning_features', type: 'list', label: 'Starter mini-features', count: 3, hint: 'Each label only.' },
    { key: 'upgrade_head', type: 'text', label: 'Upgrade card heading', hint: 'e.g. "The **Upgrade**".' },
    { key: 'image_upgrade', type: 'image', role: 'product', label: 'Upgrade card image' },
    { key: 'upgrade_items', type: 'list', label: 'Upgrade improvements', count: 4, hint: 'Each label only: a proof point with a ✓.' },
    { key: 'focus_head', type: 'text', label: 'Focus band heading' },
    { key: 'focus_sub', type: 'text', role: 'body', label: 'Focus band subhead' },
    { key: 'focus_benefits', type: 'reasons', label: 'Focus benefits (4)', count: 4, hint: 'title = 1-3 word benefit; body = one sentence. Ranked; shown around a photo.' },
    { key: 'image_focus', type: 'image', role: 'lifestyle', label: 'Focus band centre photo (person)' },
    { key: 'stats_head', type: 'text', label: 'Stats heading' },
    { key: 'stats', type: 'reasons', label: 'Result stats (4)', count: 4, hint: 'label = a percentage like "99%"; title = what improved; body = short context.' },
    { key: 'ingredients_head', type: 'text', label: 'Ingredients card heading' },
    { key: 'image_ingredients', type: 'image', role: 'product', label: 'Ingredients card image (bottle)' },
    { key: 'ingredient_labels', type: 'list', label: 'Ingredient labels', count: 5, hint: 'Each label only: e.g. "Vitamins", "Minerals", "Botanicals".' },
    { key: 'compare_head', type: 'text', label: 'Comparison heading' },
    { key: 'compare_body', type: 'text', role: 'body', label: 'Comparison paragraph' },
    { key: 'compare_cta', type: 'text', label: 'Comparison button label' },
    { key: 'compare_rows', type: 'list', label: 'Comparison rows', count: 5, hint: 'Each label only: a feature you have and rivals don\'t.' },
    { key: 'press_logos', type: 'list', label: 'Press logos', count: 5, hint: 'Each label only: a publication name shown as a wordmark.' },
    { key: 'reviews_head', type: 'text', label: 'Reviews heading' },
    { key: 'reviews_sub', type: 'text', role: 'body', label: 'Reviews subhead' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews', count: 4, hint: 'name + quote. 5-star review cards with a photo.' },
    { key: 'image_rev1', type: 'image', role: 'lifestyle', label: 'Review photo 1' },
    { key: 'image_rev2', type: 'image', role: 'lifestyle', label: 'Review photo 2' },
    { key: 'image_rev3', type: 'image', role: 'lifestyle', label: 'Review photo 3' },
    { key: 'image_rev4', type: 'image', role: 'lifestyle', label: 'Review photo 4' },
  ],
}
