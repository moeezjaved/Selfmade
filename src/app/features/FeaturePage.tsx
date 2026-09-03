'use client'
/**
 * Shared capability-page shell (Runable /slides mould), reused by every /features/* page:
 * hero → 3-step how-to (with generic UI mockups) → card gallery → features → FAQ → CTA.
 * Same design language as the landing (sky hero, Hedvig Letters Serif display, Satoshi UI).
 * Every CTA runs the signup→audit flow. Pass a FeatureConfig; see the per-capability page files.
 */
import Link from 'next/link'
import { V3Mark } from '@/app/v3/V3Mark'

const CTA = '/signup?next=/store-audit'

export type FeatureConfig = {
  eyebrow: string
  h1: string
  sub: string
  capPlaceholder: string
  chips: string[]
  steps: { n: number; t: string; d: string }[]
  galleryKicker: string
  galleryTitle: string
  cardCta: string
  cards: { t: string; d: string; g: string; ic: string }[]
  featuresTitle: string
  features: { t: string; d: string }[]
  faqTitle: string
  faq: { q: string; a: string }[]
  ctaTitle: string
  ctaSub: string
}

const GRADS = ['#ffd9c2', '#cfe8ff', '#ffe6a3', '#e2d5ff', '#c8f0e0', '#ffd0d8']

// White line icons drawn on each gallery card's gradient thumbnail.
const ICONS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  tag: '<path d="M3 11.5 11.5 3H20a1 1 0 0 1 1 1v8.5L12.5 21a1.5 1.5 0 0 1-2 0L3 13.5a1.5 1.5 0 0 1 0-2z"/><circle cx="16" cy="8" r="1.3"/>',
  link: '<path d="M9 15l6-6"/><path d="M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5"/><path d="M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5"/>',
  doc: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  code: '<path d="m9 8-4 4 4 4"/><path d="m15 8 4 4-4 4"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  compare: '<path d="M12 4v16"/><path d="M6 8 3 11l3 3"/><path d="m18 8 3 3-3 3"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1.3.9-1.3 1.7v.4"/><circle cx="12" cy="16.6" r="0.6"/>',
  quote: '<path d="M9 7H6a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3H5"/><path d="M18 7h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v3h-3"/>',
  chat: '<path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  megaphone: '<path d="m3 11 15-5v12L3 14z"/><path d="M8 14v4a2 2 0 0 0 4 0"/>',
  trend: '<path d="m3 16 6-6 4 4 8-8"/><path d="M17 6h4v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 20V9"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5"/><path d="M12 12v9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  cart: '<path d="M4 5h2l2 11h9l2-8H7"/><circle cx="9" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8"/>',
}

function StepShot({ n }: { n: number }) {
  if (n === 2) return (<div className="mk"><div className="mk-bar"><span className="mk-chip">Edit</span><span className="mk-chip">Refine</span><span className="mk-apply">Apply</span></div><div className="mk-card"><div className="mk-prev" /></div></div>)
  if (n === 3) return (<div className="mk"><div className="mk-tt">Ready to ship</div><div className="mk-row"><span className="mk-dot" style={{ background: '#22c55e' }} />Approved</div><div className="mk-row"><span className="mk-dot" style={{ background: '#22c55e' }} />Approved</div><div className="mk-row"><span className="mk-dot" style={{ background: '#f59e0b' }} />Review</div><div className="mk-go">Publish →</div></div>)
  return (<div className="mk"><div className="mk-input">Paste your store — or describe it…</div><div className="mk-grid">{GRADS.map((c) => <span className="mk-th" key={c} style={{ background: c }} />)}</div></div>)
}

const CSS = `
  :root{--ink:#14232f;--sub:#5b6b78;--line:#e4ecf2;--accent:#ff5a2c;
    --serif:'Hedvig Letters Serif',Georgia,serif;--sans:'Satoshi','General Sans',system-ui,-apple-system,Arial,sans-serif}
  .fa *{box-sizing:border-box}
  .fa{font-family:var(--sans);color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased;line-height:1.5}
  .fa a{color:inherit;text-decoration:none}
  .wrap{max-width:1120px;margin:0 auto;padding:0 26px}
  .serif{font-family:var(--serif);font-weight:400;letter-spacing:-.015em;line-height:1.08}
  .nav{position:absolute;top:0;left:0;right:0;z-index:20}
  .nav-in{max-width:1120px;margin:0 auto;padding:20px 26px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:19px;letter-spacing:-.02em;color:#0d0d0d}
  .fmark{color:#ff5a2c;display:inline-flex}
  .fbrand-t{line-height:1}
  .nav-r{display:flex;align-items:center;gap:20px}
  .nav-r a{font-weight:500;font-size:15px}
  .fa a.btn-dark{background:#141d15;color:#fff;padding:10px 18px;border-radius:100px;font-weight:600;font-size:14px}
  .fa a.btn-dark:hover{opacity:.92}
  .hero{position:relative;padding:150px 0 80px;background:radial-gradient(58% 60% at 50% 40%,rgba(255,255,255,.95) 0%,rgba(255,255,255,.5) 34%,rgba(255,255,255,0) 66%),linear-gradient(180deg,#e2f1ff 0%,#d0e8ff 55%,#bfe1fb 100%);text-align:center}
  .eyebrow{display:inline-block;font-weight:600;font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:16px}
  .hero h1{font-size:clamp(38px,5.2vw,64px);margin:0 auto 16px;max-width:16ch}
  .hero p.sub{font-size:clamp(16px,1.6vw,19px);color:var(--sub);max-width:52ch;margin:0 auto 30px}
  .capbox{display:block;max-width:620px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 20px 54px -24px rgba(30,60,90,.28);padding:20px;text-align:left}
  .capbox .ph{color:#9aa7b2;font-size:16.5px;min-height:52px}
  .capbox .row{display:flex;justify-content:flex-end}
  .send{width:46px;height:46px;border-radius:50%;background:#141d15;color:#fff;display:grid;place-items:center;font-size:19px}
  .tstrip{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:18px}
  .tchip{background:rgba(255,255,255,.75);border:1px solid var(--line);border-radius:100px;padding:8px 15px;font-size:13.5px;font-weight:500;color:var(--ink)}
  section{padding:84px 0}
  .kicker{text-align:center;font-size:12.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);margin-bottom:10px}
  h2.sec{font-size:clamp(28px,3.6vw,42px);text-align:center;margin:0 auto 54px;max-width:22ch}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:34px}
  .step .num{width:44px;height:44px;border-radius:50%;background:#f1ede6;color:#8a7f70;font-family:var(--serif);font-size:19px;display:grid;place-items:center;margin:0 auto 18px}
  .step h3{font-size:18px;margin:0 0 8px;text-align:center}
  .step p{color:var(--sub);font-size:14.5px;text-align:center;margin:0 auto;max-width:30ch}
  .step .shot{margin-top:22px;height:196px;border-radius:16px;border:1px solid var(--line);background:#f7fafc;overflow:hidden}
  .mk{padding:14px;height:100%;display:flex;flex-direction:column;gap:8px;text-align:left}
  .mk-tt{font-size:10.5px;font-weight:700;color:#9aa7b2;text-transform:uppercase;letter-spacing:.1em}
  .mk-input{background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:12px;color:#5b6b78}
  .mk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;flex:1}
  .mk-th{border-radius:6px}
  .mk-card{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;flex:1}
  .mk-prev{height:100%;background:linear-gradient(135deg,#cfe8ff,#7db4f0)}
  .mk-bar{display:flex;gap:6px;align-items:center}
  .mk-chip{font-size:10px;font-weight:600;padding:4px 9px;border-radius:100px;border:1px solid var(--line);color:#5b6b78;background:#fff}
  .mk-apply{margin-left:auto;font-size:10px;font-weight:700;background:#141d15;color:#fff;padding:4px 11px;border-radius:100px}
  .mk-row{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:12px;font-weight:600}
  .mk-dot{width:15px;height:15px;border-radius:4px;flex:none}
  .mk-go{margin-top:auto;background:#141d15;color:#fff;text-align:center;border-radius:8px;padding:9px;font-size:12px;font-weight:700}
  .sec-gray{background:#f7fafc;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .tgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  .tcard{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;transition:transform .15s,box-shadow .15s;display:block}
  .tcard:hover{transform:translateY(-3px);box-shadow:0 18px 40px -22px rgba(30,60,90,.35)}
  .tcard .thumb{height:150px;position:relative;display:grid;place-items:center}
  .tcard .thumb span{font-family:var(--serif);font-size:34px;color:rgba(255,255,255,.9)}
  .tcard .body{padding:15px 16px}
  .tcard h4{font-size:15.5px;margin:0 0 3px}
  .tcard .body p{font-size:13px;color:var(--sub);margin:0}
  .tcard .use{margin-top:10px;font-size:13px;font-weight:700;color:var(--accent)}
  .fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
  .fcard{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px}
  .fcard h4{font-size:16px;margin:0 0 7px}
  .fcard p{font-size:14px;color:var(--sub);margin:0}
  .faq{max-width:760px;margin:0 auto}
  .qa{border-bottom:1px solid var(--line);padding:22px 0}
  .qa h4{font-size:17px;margin:0 0 8px}
  .qa p{font-size:14.5px;color:var(--sub);margin:0}
  .cta{background:#141d15;color:#fff;text-align:center;border-radius:28px;padding:64px 26px;margin:0 26px}
  .cta h2{font-size:clamp(28px,3.6vw,40px);margin:0 0 14px;color:#fff}
  .cta p{color:rgba(255,255,255,.7);margin:0 auto 26px;max-width:44ch;font-size:16px}
  .fa a.cta-btn{background:#fff;color:#141d15;font-weight:700;font-size:15.5px;padding:15px 30px;border-radius:100px;display:inline-block}
  .foot{text-align:center;color:var(--sub);font-size:13px;padding:40px 0 56px}
  @media(max-width:820px){.steps,.tgrid,.fgrid{grid-template-columns:1fr}.nav-r a.hide{display:none}}
  @media(max-width:600px){.hero{padding:120px 0 56px}section{padding:56px 0}h2.sec{margin-bottom:36px}.nav-in{padding:16px 18px}.wrap{padding:0 18px}.cta{padding:44px 20px;margin:0 16px;border-radius:22px}.capbox{padding:16px}.tcard .thumb{height:130px}}
`

export default function FeaturePage({ config: c }: { config: FeatureConfig }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&f[]=satoshi@400,500,700,900&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Hedvig+Letters+Serif&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="fa">
        <nav className="nav"><div className="nav-in">
          <Link href="/" className="brand">
            <span className="fmark"><V3Mark size={22} /></span>
            <span className="fbrand-t">Selfmade</span>
          </Link>
          <div className="nav-r">
            <Link href="/features/ads" className="hide">Paid Ads</Link>
            <Link href="/features/seo" className="hide">SEO</Link>
            <Link href="/login">Log in</Link>
            <Link href={CTA} className="btn-dark">Get started</Link>
          </div>
        </div></nav>

        <header className="hero"><div className="wrap">
          <span className="eyebrow">{c.eyebrow}</span>
          <h1 className="serif">{c.h1}</h1>
          <p className="sub">{c.sub}</p>
          <Link href={CTA} className="capbox" style={{ cursor: 'pointer' }}>
            <div className="ph">{c.capPlaceholder}</div>
            <div className="row"><span className="send">→</span></div>
          </Link>
          <div className="tstrip">{c.chips.map((t) => <span key={t} className="tchip">{t}</span>)}</div>
        </div></header>

        <section><div className="wrap">
          <h2 className="sec serif">How to get the best results</h2>
          <div className="steps">
            {c.steps.map((s) => (
              <div className="step" key={s.n}>
                <div className="num">{s.n}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
                <div className="shot"><StepShot n={s.n} /></div>
              </div>
            ))}
          </div>
        </div></section>

        <section className="sec-gray"><div className="wrap">
          <div className="kicker">{c.galleryKicker}</div>
          <h2 className="sec serif">{c.galleryTitle}</h2>
          <div className="tgrid">
            {c.cards.map((t) => (
              <Link href={CTA} className="tcard" key={t.t}>
                <div className="thumb" style={{ background: t.g }}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: ICONS[t.ic] || ICONS.spark }} /></div>
                <div className="body"><h4>{t.t}</h4><p>{t.d}</p><div className="use">{c.cardCta}</div></div>
              </Link>
            ))}
          </div>
        </div></section>

        <section><div className="wrap">
          <h2 className="sec serif">{c.featuresTitle}</h2>
          <div className="fgrid">{c.features.map((f) => <div className="fcard" key={f.t}><h4>{f.t}</h4><p>{f.d}</p></div>)}</div>
        </div></section>

        <section className="sec-gray"><div className="wrap">
          <h2 className="sec serif">{c.faqTitle}</h2>
          <div className="faq">{c.faq.map((f) => <div className="qa" key={f.q}><h4>{f.q}</h4><p>{f.a}</p></div>)}</div>
        </div></section>

        <section style={{ paddingBottom: 0 }}>
          <div className="cta">
            <h2 className="serif">{c.ctaTitle}</h2>
            <p>{c.ctaSub}</p>
            <Link href={CTA} className="cta-btn">Start free →</Link>
          </div>
        </section>

        <div className="foot">© {new Date().getFullYear()} Selfmade · <Link href="/">Home</Link></div>
      </div>
    </>
  )
}
