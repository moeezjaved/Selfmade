/**
 * botanical_v1 — a premium wellness/supplement product page in a soft pink/rose aesthetic, modelled
 * section-for-section on the Bloomin honey-sticks page: hero buy-box (product with feature badges +
 * thumbnails, rating, sale price, guarantee bar, product-info accordion), an image/text "feel like
 * yourself" card, a happy-customers photo grid, a difference/stats split, a "what women notice" card,
 * a benefits band with a centre photo, a comparison table, an FAQ, and a review wall.
 * Layout is FIXED; the AI only fills `schema` slots. All CSS scoped under `.pgbld`. Fully responsive.
 */
import type { PageTemplate, FilledContent, RenderOpts, SlotValue } from '../types'

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
const escp = (s: any) => esc(String(s ?? '').replace(/\*\*/g, '').replace(/^\s*[-•*]\s*/, '').trim())
const hl = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<span class="hl">$1</span>')
const bd = (s: any) => esc(String(s ?? '')).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
const arr = (v: SlotValue | undefined) => (Array.isArray(v) ? v : [])
const PH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/></svg>'
const CHK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" fill="#e5568c" stroke="#e5568c"/><path d="M8.4 12.4l2.4 2.4 4.7-5"/></svg>'
const XMARK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#c9c2cc" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>'
const S = (p: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`
const ICONS = [
  S('<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>'),                        // heart
  S('<path d="M11 21C6 21 4 16 4 12c0-5 4-8 9-9 1 6 0 12-2 15"/><path d="M4 21c5 0 9-3 11-8"/>'),              // leaf
  S('<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>'),                                                             // bolt
  S('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>'),        // smile
  S('<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/>'),                       // shield
  S('<path d="M12 2a5 5 0 0 1 5 5c0 3-5 9-5 9s-5-6-5-9a5 5 0 0 1 5-5z"/><circle cx="12" cy="7" r="1.6"/>'),    // sparkle-ish
]
const img = (url: any, alt: string, cls: string, label?: string): string =>
  (url && typeof url === 'string') ? `<img class="${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy">`
    : `<div class="${cls} ph"><span class="phi">${PH_ICON}</span><span class="phl">${esc(label || 'Image')}</span></div>`

const css = `
@import url('https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap');
.pgbld{--pink:#e5568c;--pink2:#f27ba8;--rose:#fdeef5;--rose2:#fce4ef;--ink:#2b2430;--sub:#7a7280;--line:#f0dde6;--good:#e5568c;--cream:#fff;
  font-family:'Figtree',system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);line-height:1.5;background:#fff;-webkit-font-smoothing:antialiased}
.pgbld *{box-sizing:border-box}
.pgbld img{max-width:100%;display:block}
.pgbld .ph{background:#fbe9f1;border:1.5px dashed #f3cfe0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#d09bb6;font-size:12px;min-height:120px;border-radius:14px;text-align:center;padding:14px}
.pgbld .ph .phi svg{width:30px;height:30px}
.pgbld .ph .phl{font-weight:700}
.pgbld .wrap{max-width:1120px;margin:0 auto;padding:0 22px}
.pgbld h1,.pgbld h2,.pgbld h3{margin:0;letter-spacing:-.02em;line-height:1.14}
.pgbld .hl{color:var(--pink)}
.pgbld .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(90deg,#e5568c,#ef7ba6);color:#fff;border:0;border-radius:999px;padding:15px 28px;font-size:15px;font-weight:800;cursor:pointer;text-decoration:none;width:100%;box-shadow:0 8px 22px -10px rgba(229,86,140,.6)}
.pgbld .pays{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.pgbld .pays span{font-size:10px;font-weight:800;color:#b48aa0;border:1px solid var(--line);border-radius:5px;padding:3px 7px;background:#fff}
.pgbld .stars{color:#e5568c;letter-spacing:1px;font-size:14px}
.pgbld .secttl{font-size:28px;text-align:center;margin-bottom:8px}
.pgbld .sectsub{text-align:center;color:var(--sub);font-size:14px;max-width:640px;margin:0 auto 30px}

/* 1 · HERO */
.pgbld .hero{background:linear-gradient(180deg,var(--rose),#fff);padding:32px 0 42px}
.pgbld .hero .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.pgbld .gwrap{position:relative}
.pgbld .gmain{border-radius:18px;overflow:hidden;background:#fff;aspect-ratio:1/1;border:1px solid var(--line)}
.pgbld .gmain img{width:100%;height:100%;object-fit:cover}
.pgbld .feat{position:absolute;top:6px;bottom:6px;left:-8px;z-index:2;display:flex;flex-direction:column;justify-content:space-around;gap:10px}
.pgbld .feat .f{display:flex;flex-direction:column;align-items:center;gap:4px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:8px 6px;width:76px;text-align:center;box-shadow:0 4px 14px -8px rgba(229,86,140,.4)}
.pgbld .feat .f .ic{color:var(--pink)}.pgbld .feat .f .ic svg{width:20px;height:20px}
.pgbld .feat .f .t{font-size:9.5px;font-weight:700;color:var(--ink);line-height:1.2}
.pgbld .thumbs{display:flex;gap:8px;margin-top:12px}
.pgbld .thumbs img,.pgbld .thumbs .ph{width:66px;height:66px;object-fit:cover;border-radius:10px;border:1px solid var(--line);min-height:0}
.pgbld .rlabel{font-size:12.5px;color:var(--sub);margin:6px 0 8px}
.pgbld .ptitle{font-size:26px;font-weight:800}
.pgbld .price{display:flex;align-items:baseline;gap:10px;margin:12px 0}
.pgbld .price .was{font-size:15px;color:#b7a9b2;text-decoration:line-through}
.pgbld .price .now{font-size:24px;font-weight:800;color:var(--pink)}
.pgbld .price .save{font-size:11px;font-weight:800;color:#fff;background:var(--pink);border-radius:5px;padding:3px 8px}
.pgbld .psub{font-size:14px;color:var(--sub);margin-bottom:12px}
.pgbld .updal{font-size:12.5px;color:var(--ink);background:var(--rose);border-radius:8px;padding:9px 12px;margin-bottom:8px}
.pgbld .stock{font-size:12px;color:var(--pink);font-weight:700;margin-bottom:12px}
.pgbld .titlesel{border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:14px;margin-bottom:14px;background:#fff}
.pgbld .titlesel small{display:block;color:var(--sub);font-size:11px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.05em}
.pgbld .gbar{display:flex;align-items:center;gap:10px;background:var(--rose);border-radius:12px;padding:12px 14px;margin-top:14px;font-size:12.5px;color:var(--ink)}
.pgbld .gbar b{color:var(--pink)}
.pgbld .acc{margin-top:14px;border-top:1px solid var(--line)}
.pgbld .acc details{border-bottom:1px solid var(--line)}
.pgbld .acc summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:13px 2px;font-weight:700;font-size:14px}
.pgbld .acc summary::-webkit-details-marker{display:none}
.pgbld .acc summary::after{content:'⌄';margin-left:auto;color:var(--sub);font-size:18px}
.pgbld .acc .body{padding:0 2px 13px;font-size:13px;color:var(--sub)}

/* 2 · FEEL LIKE YOURSELF */
.pgbld .feel{background:var(--rose);padding:52px 0}
.pgbld .feel .card{background:#fff;border:1px solid var(--line);border-radius:20px;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;gap:0;align-items:stretch}
.pgbld .feel .card .im,.pgbld .feel .card .im.ph{min-height:340px;border-radius:0}
.pgbld .feel .card .im img{width:100%;height:100%;object-fit:cover}
.pgbld .feel .card .tx{padding:36px 34px}
.pgbld .feel .card h3{font-size:24px;margin-bottom:14px}
.pgbld .feel .card p{font-size:14px;color:var(--sub);margin-bottom:20px}

/* 3 · HAPPY CUSTOMERS grid */
.pgbld .happy{padding:52px 0}
.pgbld .hgrid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
.pgbld .hgrid .im,.pgbld .hgrid .im.ph{aspect-ratio:3/4;border-radius:14px;min-height:0}
.pgbld .hgrid .im{object-fit:cover}

/* 4 · DIFFERENCE / stats */
.pgbld .diff{padding:20px 0 56px}
.pgbld .diff .grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .diff .im,.pgbld .diff .im.ph{border-radius:20px;aspect-ratio:4/5;object-fit:cover}
.pgbld .diff h2{font-size:26px;margin-bottom:22px}
.pgbld .drow{display:flex;align-items:center;gap:16px;margin-bottom:18px}
.pgbld .dbadge{width:56px;height:56px;border-radius:50%;background:var(--rose);border:2px solid var(--pink);color:var(--pink);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;flex:none}
.pgbld .drow .t{font-size:13.5px;color:var(--sub);line-height:1.4}
.pgbld .drow .t b{color:var(--ink)}

/* 5 · SWEET DROPS + NOTICE card */
.pgbld .sweet{padding:56px 0}
.pgbld .sweet .grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center}
.pgbld .sweet h2{font-size:26px;margin-bottom:14px}
.pgbld .sweet p{font-size:14px;color:var(--sub);margin-bottom:20px}
.pgbld .notice{background:var(--rose);border-radius:20px;padding:30px 28px;text-align:center}
.pgbld .notice h3{font-size:22px;margin-bottom:6px}
.pgbld .notice .nsub{font-size:13px;color:var(--sub);margin-bottom:16px}
.pgbld .notice .nimg,.pgbld .notice .nimg.ph{max-width:150px;margin:0 auto 16px}
.pgbld .nlist{display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:left}
.pgbld .nlist .n{display:flex;align-items:center;gap:9px;font-size:12.5px;font-weight:600}
.pgbld .nlist .n .ic{width:30px;height:30px;border-radius:50%;background:#fff;color:var(--pink);display:flex;align-items:center;justify-content:center;flex:none}.pgbld .nlist .n .ic svg{width:16px;height:16px}
.pgbld .notice .nbased{font-size:12px;color:var(--sub);margin-top:16px}

/* 6 · BENEFITS band */
.pgbld .band{background:var(--rose);padding:56px 0}
.pgbld .band .bcard{background:#fff;border:1px solid var(--line);border-radius:24px;padding:40px 34px;max-width:1000px;margin:0 auto}
.pgbld .bwrap{display:grid;grid-template-columns:1fr auto 1fr;gap:30px;align-items:center}
.pgbld .bcol{display:flex;flex-direction:column;gap:36px}
.pgbld .bb{text-align:center}
.pgbld .bb .ic{width:48px;height:48px;border-radius:50%;background:var(--rose);color:var(--pink);display:flex;align-items:center;justify-content:center;margin:0 auto 10px}.pgbld .bb .ic svg{width:22px;height:22px}
.pgbld .bb h4{font-size:16px;margin:0 0 4px}
.pgbld .bb p{font-size:12.5px;color:var(--sub);margin:0;line-height:1.45}
.pgbld .bimg,.pgbld .bimg.ph{width:230px;height:230px;border-radius:50%;object-fit:cover;border:6px solid var(--rose)}

/* 7 · COMPARISON */
.pgbld .cmp{padding:56px 0}
.pgbld .cmp .grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
.pgbld .cmp h2{font-size:26px;margin-bottom:14px}
.pgbld .cmp p{font-size:14px;color:var(--sub);margin-bottom:20px}
.pgbld .ctable{position:relative;padding:0 4px}
.pgbld .ctable::before{content:'';position:absolute;top:-20px;bottom:6px;right:104px;width:96px;background:linear-gradient(180deg,#f9d4e4,#fbe4ee);border-radius:16px;z-index:0}
.pgbld .ctop,.pgbld .cr{position:relative;z-index:1;display:grid;grid-template-columns:1fr 100px 100px;align-items:center}
.pgbld .ctop{padding:14px 4px 12px;font-size:11px;font-weight:800;color:var(--sub);text-transform:uppercase;letter-spacing:.03em;text-align:center}
.pgbld .ctop span:first-child{text-align:left}.pgbld .ctop .ours{color:var(--pink)}
.pgbld .cr{padding:15px 4px;border-top:1px solid var(--line);font-size:14px}
.pgbld .cr>div:first-child{text-align:left;color:var(--ink)}
.pgbld .cr .m{text-align:center;display:flex;justify-content:center;align-items:center}

/* 8 · FAQ */
.pgbld .faq{padding:40px 0 56px;max-width:820px;margin:0 auto}
.pgbld .faq details{border:1px solid var(--line);border-radius:12px;margin-bottom:10px;background:#fff}
.pgbld .faq summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;padding:16px 18px;font-weight:700;font-size:14.5px}
.pgbld .faq summary::-webkit-details-marker{display:none}
.pgbld .faq summary::after{content:'⌄';margin-left:auto;color:var(--pink);font-size:18px}
.pgbld .faq .body{padding:0 18px 16px;font-size:13.5px;color:var(--sub)}

/* 9 · REVIEW WALL */
.pgbld .wall{background:linear-gradient(180deg,#fff,var(--rose));padding:52px 0 60px}
.pgbld .rgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.pgbld .rc{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px}
.pgbld .rc .rn{font-weight:700;font-size:13px}
.pgbld .rc .rs{color:var(--pink);font-size:12px;letter-spacing:1px;margin:3px 0 7px}
.pgbld .rc p{font-size:12px;color:var(--sub);margin:0;line-height:1.45}

@media(max-width:860px){
  .pgbld .hero .grid,.pgbld .diff .grid,.pgbld .sweet .grid,.pgbld .cmp .grid,.pgbld .feel .card,.pgbld .notice .nlist{grid-template-columns:1fr}
  .pgbld .bwrap{grid-template-columns:1fr;text-align:center}
  .pgbld .bcol{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:20px}.pgbld .bcol .bb{flex:1;min-width:130px}
  .pgbld .bimg,.pgbld .bimg.ph{width:170px;height:170px;margin:6px auto}
  .pgbld .hgrid{grid-template-columns:repeat(3,1fr)}
  .pgbld .rgrid{grid-template-columns:1fr 1fr}
  .pgbld .feat{position:static;flex-direction:row;flex-wrap:wrap;margin-bottom:12px}
}
@media(max-width:520px){ .pgbld .hgrid{grid-template-columns:1fr 1fr}.pgbld .rgrid{grid-template-columns:1fr}.pgbld .wrap{padding:0 16px} }
`.trim()

function render(c: FilledContent, o: RenderOpts): string {
  const P = o.productImage
  const feats = (arr(c.hero_badges).length ? arr(c.hero_badges) : ['Women-loved favorite', 'Hormone-free formula', 'Boosts desire naturally', 'Feel the difference'].map((l) => ({ label: l })))
    .slice(0, 4).map((f, i) => `<div class="f"><span class="ic">${ICONS[i % ICONS.length]}</span><span class="t">${escp(f.label)}</span></div>`).join('')
  const thumbs = [c.image_main, c.image_g2, c.image_g3, c.image_g4].map((u) => img(u || P, o.productName, '', 'Img')).join('')
  const accItems = (arr(c.info_sections).length ? arr(c.info_sections) : [{ label: 'Product Information', body: 'What it is and what’s inside.' }, { label: 'Shipping Information', body: 'Discreet, tracked delivery.' }, { label: 'Refund Information', body: '100% money-back guarantee.' }])
    .map((s, i) => `<details${i === 0 ? ' open' : ''}><summary>${escp(s.label)}</summary><div class="body">${esc(s.body)}</div></details>`).join('')

  const stats = (arr(c.diff_stats).length ? arr(c.diff_stats) : [{ label: '98%', body: 'Felt a genuine difference in their day-to-day.' }, { label: '96%', body: 'Maintained steady energy that lasted the morning.' }, { label: '91%', body: 'Gained a new sense of confidence in their routine.' }])
    .slice(0, 3).map((s) => `<div class="drow"><div class="dbadge">${escp(s.label)}</div><div class="t">${bd(s.body)}</div></div>`).join('')

  const notice = (arr(c.notice_items).length ? arr(c.notice_items) : ['Better mood', 'Calmer daily balance', 'More natural energy', 'Feeling more like themselves'].map((l) => ({ label: l })))
    .slice(0, 4).map((n, i) => `<div class="n"><span class="ic">${ICONS[i % ICONS.length]}</span>${escp(n.label)}</div>`).join('')

  const bandB = (arr(c.band_benefits).length ? arr(c.band_benefits) : [{ title: 'Daily Ease', body: 'A simple daily ritual that supports steady energy.' }, { title: 'Pure Confidence', body: 'A gentle boost you can feel in your body.' }, { title: 'Daily Delight', body: 'A sweet moment that makes your self-care something you look forward to.' }, { title: 'Steady Balance', body: 'Stops the cycle of highs and lows so you stay level.' }])
  const bb = (b: any, i: number) => `<div class="bb"><div class="ic">${ICONS[i % ICONS.length]}</div><h4>${escp(b.title || b.label)}</h4><p>${esc(b.body)}</p></div>`

  const cmpRows = (arr(c.compare_rows).length ? arr(c.compare_rows) : ['Botanical Vitality', 'Steady Energy', 'Zero Hormones', 'Discreet Ritual', 'Naturally Sweet', 'Gentle Support'].map((l) => ({ label: l })))
    .map((r) => `<div class="cr"><div>${escp(r.label)}</div><div class="m">${CHK}</div><div class="m">${XMARK}</div></div>`).join('')

  const faqs = (arr(c.faqs).length ? arr(c.faqs) : [{ q: 'What exactly do these do for me?', a: 'A simple daily botanical ritual for steady energy and wellbeing.' }, { q: 'How should I take this daily?', a: 'One stick a day, on its own or in a warm drink.' }, { q: 'Is the shipping discreet and how do I handle returns?', a: 'Plain packaging, tracked delivery, and a money-back guarantee.' }, { q: 'Are the botanicals inside clean and trustworthy?', a: 'Yes — clean, tested ingredients with nothing you can’t pronounce.' }, { q: 'What if it doesn’t feel like it’s working for me?', a: 'You’re covered by our money-back guarantee, no questions asked.' }])
    .map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${escp(f.q)}</summary><div class="body">${esc(f.a)}</div></details>`).join('')

  const revs = (arr(c.testimonials).length ? arr(c.testimonials) : Array.from({ length: 8 }, (_, i) => ({ name: ['Maria L.', 'Chloe R.', 'Dana T.', 'Jenna K.', 'Anna M.', 'Sara V.', 'Keeley H.', 'Beth F.'][i], quote: 'It’s subtle, but I feel more like myself again — steady, calm, and it’s become part of my daily ritual.' })))
    .map((t) => `<div class="rc"><div class="rn">${escp(t.name)}</div><div class="rs">★★★★★</div><p>${esc(t.quote)}</p></div>`).join('')

  const price = o.priceLabel || ''
  return `<div class="pgbld">

  <!-- 1 · HERO -->
  <section class="hero"><div class="wrap"><div class="grid">
    <div class="gwrap">
      <div class="feat">${feats}</div>
      <div class="gmain">${img(c.image_main || P, o.productName, 'gimg', 'Product photo')}</div>
      <div class="thumbs">${thumbs}</div>
    </div>
    <div>
      <h1 class="ptitle">${esc(c.headline || o.productName)}</h1>
      <div class="rlabel"><span class="stars">★★★★★</span> ${escp(c.rating_label || `${o.rating?.stars || '4.9'}/5 — loved by real customers`)}</div>
      <div class="psub">${bd(c.subhead || '')}</div>
      <div class="price">${c.compare_at ? `<span class="was">${escp(c.compare_at)}</span>` : ''}${price ? `<span class="now">${esc(price)}</span>` : ''}${c.save_pill ? `<span class="save">${escp(c.save_pill)}</span>` : ''}</div>
      ${c.update_line ? `<div class="updal"><b>UPDATE:</b> ${esc(c.update_line)}</div>` : ''}
      ${c.stock_line ? `<div class="stock">${escp(c.stock_line)}</div>` : ''}
      <div class="titlesel"><small>Title</small>${escp(c.title_option || 'Default')}</div>
      <a class="btn" href="${esc(o.ctaHref || '#')}">${escp(c.cta_label || 'Add to Cart')}</a>
      <div class="pays"><span>VISA</span><span>Mastercard</span><span>AMEX</span><span>PayPal</span><span>Shop</span></div>
      <div class="gbar">${CHK}<span><b>100% Money-Back Guarantee.</b> ${esc(c.guarantee_line || 'Not happy? Return it for a full refund, no questions asked.')}</span></div>
      <div class="acc">${accItems}</div>
    </div>
  </div></div></section>

  <!-- 2 · FEEL LIKE YOURSELF -->
  <section class="feel"><div class="wrap">
    <h2 class="secttl">${hl(c.feel_head || 'Start feeling like yourself again today')}</h2>
    <div class="sectsub">${esc(c.feel_sub || 'Choose to prioritise your own wellbeing today — backed by our money-back guarantee.')}</div>
    <div class="card">
      <div class="im">${img(c.image_feel || P, o.productName, 'gimg', 'Lifestyle photo')}</div>
      <div class="tx"><h3>${hl(c.feel_card_head || 'Smooth Golden Berry Nectar')}</h3><p>${bd(c.feel_card_body || '')}</p><a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.feel_cta || 'Get Yours Now')}</a></div>
    </div>
  </div></section>

  <!-- 3 · HAPPY CUSTOMERS -->
  <section class="happy"><div class="wrap">
    <h2 class="secttl">${hl(c.happy_head || '10,000+ Happy Customers')}</h2>
    <div class="hgrid">${[c.image_c1, c.image_c2, c.image_c3, c.image_c4, c.image_c5, c.image_c6].map((u) => img(u || P, o.productName, 'im', 'Customer photo')).join('')}</div>
  </div></section>

  <!-- 4 · DIFFERENCE / STATS -->
  <section class="diff"><div class="wrap"><div class="grid">
    <div>${img(c.image_diff || P, o.productName, 'im', 'Lifestyle photo')}</div>
    <div>
      <h2>${hl(c.diff_head || 'The Difference a Daily Honey Ritual Makes')}</h2>
      ${stats}
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.diff_cta || 'Buy It Now')}</a>
    </div>
  </div></div></section>

  <!-- 5 · SWEET DROPS + NOTICE -->
  <section class="sweet"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.sweet_head || 'Sweet Botanical Energy Drops')}</h2>
      <p>${bd(c.sweet_body || '')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.sweet_cta || 'Buy It Now')}</a>
    </div>
    <div class="notice">
      <h3>${hl(c.notice_head || 'What Women Notice With Us')}</h3>
      <div class="nsub">${esc(c.notice_sub || '90% of customers say they start feeling positive changes within a few months, including:')}</div>
      <div class="nimg">${img(c.image_notice || P, o.productName, 'gimg', 'Product photo')}</div>
      <div class="nlist">${notice}</div>
      <div class="nbased">${escp(c.notice_based || 'Based on 28,676 customer feedback')}</div>
    </div>
  </div></div></section>

  <!-- 6 · BENEFITS BAND -->
  <section class="band"><div class="wrap">
    <h2 class="secttl">${hl(c.band_head || 'Brings you back to your natural self')}</h2>
    <div class="sectsub">${esc(c.band_sub || 'A daily botanical ritual that helps you reclaim your natural spark.')}</div>
    <div class="bcard"><div class="bwrap">
      <div class="bcol">${bb(bandB[0] || {}, 0)}${bb(bandB[2] || {}, 2)}</div>
      <div>${img(c.image_band || P, o.productName, 'bimg', 'Product photo')}</div>
      <div class="bcol">${bb(bandB[1] || {}, 3)}${bb(bandB[3] || {}, 4)}</div>
    </div></div>
  </div></section>

  <!-- 7 · COMPARISON -->
  <section class="cmp"><div class="wrap"><div class="grid">
    <div>
      <h2>${hl(c.compare_head || 'Why Women Choose Us')}</h2>
      <p>${bd(c.compare_body || '')}</p>
      <a class="btn" style="width:auto" href="${esc(o.ctaHref || '#')}">${escp(c.compare_cta || 'Buy It Now')}</a>
    </div>
    <div class="ctable"><div class="ctop"><span>Feature</span><span class="ours">Our product</span><span>Others</span></div>${cmpRows}</div>
  </div></div></section>

  <!-- 8 · FAQ -->
  <section><div class="wrap"><h2 class="secttl" style="margin-bottom:24px">${hl(c.faq_head || 'Frequently Asked Questions')}</h2><div class="faq">${faqs}</div></div></section>

  <!-- 9 · REVIEW WALL -->
  <section class="wall"><div class="wrap">
    <h2 class="secttl">${hl(c.reviews_head || 'See What Our Community Loves')}</h2>
    <div class="sectsub">${esc(c.reviews_sub || 'Join thousands of happy customers who have found consistent wellbeing and balance.')}</div>
    <div class="rgrid">${revs}</div>
  </div></section>

  </div>`
}

export const botanicalV1: PageTemplate = {
  id: 'botanical_v1',
  type: 'product',
  name: 'Botanical Wellness (Pink)',
  description: 'Soft pink/rose wellness PDP — buy-box with feature badges + guarantee bar, image/text card, happy-customer grid, results stats, comparison, benefits band, FAQ and a review wall.',
  css,
  render,
  schema: [
    { key: 'headline', type: 'text', role: 'headline', label: 'Product title' },
    { key: 'rating_label', type: 'text', label: 'Rating line', hint: 'e.g. "4.9/5 — reviewed by 181 people".' },
    { key: 'subhead', type: 'richtext', role: 'body', label: 'Hero subhead' },
    { key: 'compare_at', type: 'text', label: 'Compare-at price' },
    { key: 'save_pill', type: 'text', label: 'Save pill', hint: 'e.g. "SAVE 20%".' },
    { key: 'update_line', type: 'text', label: 'Urgency / update line', hint: 'e.g. "New Year Sale stock is limited."' },
    { key: 'stock_line', type: 'text', label: 'Low-stock line', hint: 'e.g. "Only 8 left in stock…".' },
    { key: 'cta_label', type: 'text', label: 'Add-to-cart label' },
    { key: 'guarantee_line', type: 'text', label: 'Guarantee sentence' },
    { key: 'hero_badges', type: 'list', label: 'Product feature badges', count: 4, hint: 'Each label only: a short product claim (e.g. "Hormone-free formula").' },
    { key: 'info_sections', type: 'list', label: 'Product-info accordion', count: 3, hint: 'Each: label = section title (Product Information / Shipping / Refund); body = the detail.' },
    { key: 'image_main', type: 'image', role: 'product', label: 'Main product image' },
    { key: 'image_g2', type: 'image', role: 'product', label: 'Gallery image 2' },
    { key: 'image_g3', type: 'image', role: 'product', label: 'Gallery image 3' },
    { key: 'image_g4', type: 'image', role: 'lifestyle', label: 'Gallery image 4' },
    { key: 'feel_head', type: 'text', label: '"Feel like yourself" heading' },
    { key: 'feel_sub', type: 'text', label: '"Feel like yourself" subhead' },
    { key: 'feel_card_head', type: 'text', label: 'Feel card heading' },
    { key: 'feel_card_body', type: 'richtext', role: 'body', label: 'Feel card paragraph' },
    { key: 'feel_cta', type: 'text', label: 'Feel card button' },
    { key: 'image_feel', type: 'image', role: 'lifestyle', label: 'Feel card image' },
    { key: 'happy_head', type: 'text', label: 'Happy-customers heading' },
    { key: 'image_c1', type: 'image', role: 'lifestyle', label: 'Customer photo 1' },
    { key: 'image_c2', type: 'image', role: 'lifestyle', label: 'Customer photo 2' },
    { key: 'image_c3', type: 'image', role: 'lifestyle', label: 'Customer photo 3' },
    { key: 'image_c4', type: 'image', role: 'lifestyle', label: 'Customer photo 4' },
    { key: 'image_c5', type: 'image', role: 'lifestyle', label: 'Customer photo 5' },
    { key: 'image_c6', type: 'image', role: 'lifestyle', label: 'Customer photo 6' },
    { key: 'diff_head', type: 'text', label: 'Difference heading' },
    { key: 'diff_stats', type: 'reasons', label: 'Difference stats (3)', count: 3, hint: 'label = a percentage like "98%"; body = what improved.' },
    { key: 'diff_cta', type: 'text', label: 'Difference button' },
    { key: 'image_diff', type: 'image', role: 'lifestyle', label: 'Difference section image' },
    { key: 'sweet_head', type: 'text', label: 'Sweet-drops heading' },
    { key: 'sweet_body', type: 'richtext', role: 'body', label: 'Sweet-drops paragraph' },
    { key: 'sweet_cta', type: 'text', label: 'Sweet-drops button' },
    { key: 'notice_head', type: 'text', label: 'Notice-card heading' },
    { key: 'notice_sub', type: 'text', label: 'Notice-card subhead' },
    { key: 'notice_items', type: 'list', label: 'Notice-card benefits', count: 4, hint: 'Each label only.' },
    { key: 'notice_based', type: 'text', label: 'Notice-card "based on" line' },
    { key: 'image_notice', type: 'image', role: 'product', label: 'Notice-card product image' },
    { key: 'band_head', type: 'text', label: 'Benefits-band heading' },
    { key: 'band_sub', type: 'text', label: 'Benefits-band subhead' },
    { key: 'band_benefits', type: 'reasons', label: 'Band benefits (4)', count: 4, hint: 'title = 1-2 word benefit; body = one sentence.' },
    { key: 'image_band', type: 'image', role: 'product', label: 'Benefits-band centre image' },
    { key: 'compare_head', type: 'text', label: 'Comparison heading' },
    { key: 'compare_body', type: 'richtext', role: 'body', label: 'Comparison paragraph' },
    { key: 'compare_cta', type: 'text', label: 'Comparison button' },
    { key: 'compare_rows', type: 'list', label: 'Comparison rows', count: 6, hint: 'Each label only: a feature you have and rivals don\'t.' },
    { key: 'faq_head', type: 'text', label: 'FAQ heading' },
    { key: 'faqs', type: 'faq', label: 'FAQ', count: 5, hint: 'Cover what it does, how to take it, discreet shipping, ingredient safety, guarantee.' },
    { key: 'reviews_head', type: 'text', label: 'Review-wall heading' },
    { key: 'reviews_sub', type: 'text', label: 'Review-wall subhead' },
    { key: 'testimonials', type: 'testimonials', label: 'Reviews (wall)', count: 8, hint: 'name + quote. Shown as a grid of short review cards.' },
  ],
}
