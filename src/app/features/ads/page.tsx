'use client'
/**
 * /features/ads — a capability detail page in the Runable "/slides" mould: hero → "How to get the best
 * results" 3-step flow → template gallery → features → FAQ → CTA. Same design language as the landing
 * (sky hero, Hedvig Letters Serif display, Satoshi UI). Every CTA runs the signup→audit flow, so it
 * funnels exactly like the rest of the site. This is the first of a set (SEO / Websites / … reuse it).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

const CTA = '/signup?next=/store-audit'

const STEPS = [
  { n: 1, t: 'Describe your product — or pick a template', d: 'Tell Mello what you sell, or paste your store and start from a proven ad template. It reads your brand automatically.' },
  { n: 2, t: 'Mello writes, designs & refines it with AI', d: 'On-brand copy, visuals and hooks — generated, then refined by chatting. Ask for variants, a different angle, a new format.' },
  { n: 3, t: 'Publish to Meta, Google & TikTok — or export', d: 'One click to launch across channels, auto-resized for every placement. Nothing goes live without your yes.' },
]

const TEMPLATES = [
  { t: 'Product hero', d: 'Clean studio shot + one sharp claim', g: 'linear-gradient(135deg,#ffd9c2,#ff8a5a)', k: 'hero' },
  { t: 'UGC testimonial', d: 'Creator-style talking-head with captions', g: 'linear-gradient(135deg,#cfe8ff,#7db4f0)', k: 'ugc' },
  { t: 'Flash sale', d: 'Bold offer, urgency, big price', g: 'linear-gradient(135deg,#ffe6a3,#ff9f43)', k: 'sale' },
  { t: 'Carousel set', d: 'Swipeable multi-frame story', g: 'linear-gradient(135deg,#e2d5ff,#a487f0)', k: 'carousel' },
  { t: 'Before / after', d: 'Show the transformation side by side', g: 'linear-gradient(135deg,#c8f0e0,#5bc9a0)', k: 'ba' },
  { t: 'Founder story', d: 'Personal, trust-building, native feel', g: 'linear-gradient(135deg,#ffd0d8,#f0879a)', k: 'founder' },
]

// Mini ad preview rendered inside each template thumbnail — a schematic of that ad style.
function AdPreview({ k }: { k: string }) {
  if (k === 'ugc') return (<div className="ap"><div className="ap-play">▶</div><div className="ap-cap" style={{ marginTop: 'auto' }} /><div className="ap-cap s" /></div>)
  if (k === 'sale') return (<div className="ap" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="ap-big">−40%</div><div className="ap-cta">SHOP NOW</div></div>)
  if (k === 'carousel') return (<div className="ap"><div className="ap-frames"><span /><span /><span /></div><div className="ap-dots"><i /><i /><i /></div></div>)
  if (k === 'ba') return (<div className="ap ap-split"><div className="ap-half">BEFORE</div><div className="ap-half">AFTER</div></div>)
  if (k === 'founder') return (<div className="ap"><div className="ap-face" /><div className="ap-h" /><div className="ap-h s" /><div className="ap-h s" /></div>)
  return (<div className="ap"><div className="ap-prod" /><div className="ap-h" /><div className="ap-h s" /><div className="ap-cta">Shop now</div></div>)
}

// Mini product-UI mockup under each how-to step.
function StepMock({ n }: { n: number }) {
  if (n === 2) return (<div className="mk"><div className="mk-bar"><span className="mk-chip">Edit</span><span className="mk-chip">Add instructions</span><span className="mk-apply">Apply</span></div><div className="mk-card"><div className="mk-ad">Glow Serum</div></div></div>)
  if (n === 3) return (<div className="mk"><div className="mk-tt">Publish to</div><div className="mk-row"><span className="mk-dot" style={{ background: '#0866FF' }} />Meta</div><div className="mk-row"><span className="mk-dot" style={{ background: '#4285F4' }} />Google</div><div className="mk-row"><span className="mk-dot" style={{ background: '#111' }} />TikTok</div><div className="mk-go">Launch →</div></div>)
  return (<div className="mk"><div className="mk-input">Create an ad for my vitamin-C serum…</div><div className="mk-tt">Templates</div><div className="mk-grid">{['#ffd9c2', '#cfe8ff', '#ffe6a3', '#e2d5ff', '#c8f0e0', '#ffd0d8'].map((c) => <span className="mk-th" key={c} style={{ background: c }} />)}</div></div>)
}

const FEATURES = [
  { t: 'Brand-locked', d: 'Your logo, colours, fonts and voice — applied to every ad automatically.' },
  { t: 'Copy that converts', d: 'Hooks and angles written from what actually sells in your category.' },
  { t: 'Publish in one click', d: 'Straight to Meta, Google and TikTok — no exporting and re-uploading.' },
  { t: 'A/B variants on demand', d: 'Spin up ten angles from one idea and let the winners rise.' },
  { t: 'Rival-inspired', d: 'See what competitors run, then out-make it — legally and on-brand.' },
  { t: 'Every size, auto', d: 'Feed, story, reel, square — resized and re-laid-out for each placement.' },
]

const FAQ = [
  { q: 'Do I need design skills?', a: 'No. Describe your product or pick a template — Mello does the design, copy and layout. You just approve or ask for changes.' },
  { q: 'Which platforms can I publish to?', a: 'Meta (Facebook & Instagram), Google, and TikTok, with more on the way. You approve every launch.' },
  { q: 'Where do the templates come from?', a: 'They’re proven ad structures, adapted to your brand. Start from one, or describe something new from scratch.' },
  { q: 'Will the ads actually look on-brand?', a: 'Yes — Selfmade reads your store for your logo, colours, fonts and tone, and locks every ad to them.' },
]

const CSS = `
  :root{--ink:#14232f;--sub:#5b6b78;--line:#e4ecf2;--accent:#ff5a2c;
    --serif:'Hedvig Letters Serif',Georgia,serif;--sans:'Satoshi','General Sans',system-ui,-apple-system,Arial,sans-serif}
  .fa *{box-sizing:border-box}
  .fa{font-family:var(--sans);color:var(--ink);background:#fff;-webkit-font-smoothing:antialiased;line-height:1.5}
  .fa a{color:inherit;text-decoration:none}
  .wrap{max-width:1120px;margin:0 auto;padding:0 26px}
  .serif{font-family:var(--serif);font-weight:400;letter-spacing:-.015em;line-height:1.08}
  /* nav */
  .nav{position:absolute;top:0;left:0;right:0;z-index:20}
  .nav-in{max-width:1120px;margin:0 auto;padding:20px 26px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:inline-flex;align-items:center}
  .brand img{height:19px;width:auto;display:block;filter:brightness(0)}
  .nav-r{display:flex;align-items:center;gap:20px}
  .nav-r a{font-weight:500;font-size:15px}
  .fa a.btn-dark{background:#141d15;color:#fff;padding:10px 18px;border-radius:100px;font-weight:600;font-size:14px}
  .fa a.btn-dark:hover{opacity:.92}
  /* hero */
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
  /* section */
  section{padding:84px 0}
  .kicker{text-align:center;font-size:12.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);margin-bottom:10px}
  h2.sec{font-size:clamp(28px,3.6vw,42px);text-align:center;margin:0 auto 54px;max-width:20ch}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:34px}
  .step .num{width:44px;height:44px;border-radius:50%;background:#f1ede6;color:#8a7f70;font-family:var(--serif);font-size:19px;display:grid;place-items:center;margin:0 auto 18px}
  .step h3{font-size:18px;margin:0 0 8px;text-align:center}
  .step p{color:var(--sub);font-size:14.5px;text-align:center;margin:0 auto;max-width:30ch}
  .step .shot{margin-top:22px;height:196px;border-radius:16px;border:1px solid var(--line);background:#f7fafc;overflow:hidden}
  .mk{padding:14px;height:100%;display:flex;flex-direction:column;gap:8px;text-align:left}
  .mk-tt{font-size:10.5px;font-weight:700;color:#9aa7b2;text-transform:uppercase;letter-spacing:.1em}
  .mk-input{background:#fff;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:12px;color:#5b6b78}
  .mk-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
  .mk-th{height:30px;border-radius:6px}
  .mk-card{background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;flex:1;display:flex;flex-direction:column}
  .mk-ad{flex:1;background:linear-gradient(135deg,#ffd9c2,#ff8a5a);display:grid;place-items:center;color:#fff;font-weight:700;font-family:var(--serif);font-size:16px}
  .mk-bar{display:flex;gap:6px;align-items:center}
  .mk-chip{font-size:10px;font-weight:600;padding:4px 9px;border-radius:100px;border:1px solid var(--line);color:#5b6b78;background:#fff}
  .mk-apply{margin-left:auto;font-size:10px;font-weight:700;background:#141d15;color:#fff;padding:4px 11px;border-radius:100px}
  .mk-row{display:flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 11px;font-size:12px;font-weight:600}
  .mk-dot{width:15px;height:15px;border-radius:4px;flex:none}
  .mk-go{margin-top:auto;background:#141d15;color:#fff;text-align:center;border-radius:8px;padding:9px;font-size:12px;font-weight:700}
  /* templates */
  .tgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  .tcard{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;transition:transform .15s,box-shadow .15s;display:block}
  .tcard:hover{transform:translateY(-3px);box-shadow:0 18px 40px -22px rgba(30,60,90,.35)}
  .tcard .thumb{height:150px;position:relative}
  .ap{position:absolute;inset:0;padding:18px 22px;display:flex;flex-direction:column;gap:7px}
  .ap-prod{flex:1;background:rgba(255,255,255,.92);border-radius:8px;margin-bottom:3px}
  .ap-h{height:8px;border-radius:4px;background:rgba(255,255,255,.92);width:72%}
  .ap-h.s{width:46%}
  .ap-cta{align-self:flex-start;background:#141d15;color:#fff;font-size:9px;font-weight:700;padding:4px 11px;border-radius:100px;letter-spacing:.02em}
  .ap-big{font-family:var(--serif);font-size:38px;color:#fff;line-height:1;text-shadow:0 2px 10px rgba(0,0,0,.15)}
  .ap-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.92);display:grid;place-items:center;color:#14232f;font-size:11px}
  .ap-cap{height:8px;border-radius:4px;background:rgba(0,0,0,.32);width:66%}
  .ap-cap.s{width:44%}
  .ap-frames{flex:1;display:flex;gap:7px}
  .ap-frames span{flex:1;background:rgba(255,255,255,.85);border-radius:6px}
  .ap-dots{display:flex;gap:5px;justify-content:center}
  .ap-dots i{width:5px;height:5px;border-radius:50%;background:rgba(255,255,255,.92)}
  .ap-split{flex-direction:row;gap:0;padding:0}
  .ap-half{flex:1;display:grid;place-items:end center;padding-bottom:12px;font-size:9px;font-weight:800;color:#14232f;letter-spacing:.08em}
  .ap-half:first-child{border-right:2px dashed rgba(255,255,255,.85)}
  .ap-face{width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.92);margin-bottom:4px}
  .tcard .body{padding:15px 16px}
  .tcard h4{font-size:15.5px;margin:0 0 3px}
  .tcard p{font-size:13px;color:var(--sub);margin:0}
  .tcard .use{margin-top:10px;font-size:13px;font-weight:700;color:var(--accent)}
  /* real ads */
  .real-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
  .real-card{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;display:block;transition:transform .15s,box-shadow .15s}
  .real-card:hover{transform:translateY(-3px);box-shadow:0 18px 40px -22px rgba(30,60,90,.35)}
  .real-card img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:#eef3f7}
  .real-brand{padding:9px 12px;font-size:12.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:820px){.real-grid{grid-template-columns:repeat(2,1fr)}}
  /* features */
  .sec-gray{background:#f7fafc;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
  .fcard{background:#fff;border:1px solid var(--line);border-radius:16px;padding:22px}
  .fcard h4{font-size:16px;margin:0 0 7px}
  .fcard p{font-size:14px;color:var(--sub);margin:0}
  /* faq */
  .faq{max-width:760px;margin:0 auto}
  .qa{border-bottom:1px solid var(--line);padding:22px 0}
  .qa h4{font-size:17px;margin:0 0 8px}
  .qa p{font-size:14.5px;color:var(--sub);margin:0}
  /* cta band */
  .cta{background:#141d15;color:#fff;text-align:center;border-radius:28px;padding:64px 26px;margin:0 26px}
  .cta h2{font-size:clamp(28px,3.6vw,40px);margin:0 0 14px;color:#fff}
  .cta p{color:rgba(255,255,255,.7);margin:0 auto 26px;max-width:44ch;font-size:16px}
  .cta a{background:#fff;color:#141d15;font-weight:700;font-size:15.5px;padding:15px 30px;border-radius:100px;display:inline-block}
  .foot{text-align:center;color:var(--sub);font-size:13px;padding:40px 0 56px}
  @media(max-width:820px){.steps,.tgrid,.fgrid{grid-template-columns:1fr}.nav-r a.hide{display:none}}
`

export default function AdsFeaturePage() {
  // Real ads pulled from Discover (public endpoint). Fails soft: on local/no-DB it stays empty and the
  // section simply doesn't render.
  const [realAds, setRealAds] = useState<{ thumb: string; brand: string; title: string }[]>([])
  useEffect(() => { (async () => { try { const r = await fetch('/api/showcase-ads'); const j = await r.json(); if (Array.isArray(j.ads)) setRealAds(j.ads) } catch { /* ignore */ } })() }, [])
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&f[]=satoshi@400,500,700,900&display=swap" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css2?family=Hedvig+Letters+Serif&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="fa">
        {/* nav */}
        <nav className="nav"><div className="nav-in">
          <Link href="/" className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/selfmade-wordmark.png" alt="Selfmade" />
          </Link>
          <div className="nav-r">
            <Link href="/features/ads" className="hide">Paid Ads</Link>
            <Link href="/store-audit?focus=seo" className="hide">SEO</Link>
            <Link href="/login">Log in</Link>
            <Link href={CTA} className="btn-dark">Get started</Link>
          </div>
        </div></nav>

        {/* hero */}
        <header className="hero"><div className="wrap">
          <span className="eyebrow">Paid Ads</span>
          <h1 className="serif">Winning ads, made for your store.</h1>
          <p className="sub">Describe your product or start from a template. Mello writes it, designs it, and publishes it to Meta, Google & TikTok — on brand, in minutes.</p>
          <Link href={CTA} className="capbox" style={{ cursor: 'pointer' }}>
            <div className="ph">Describe the ad you want — or paste your store…</div>
            <div className="row"><span className="send">→</span></div>
          </Link>
          <div className="tstrip">
            {TEMPLATES.slice(0, 4).map((t) => <span key={t.t} className="tchip">{t.t}</span>)}
          </div>
        </div></header>

        {/* how to */}
        <section><div className="wrap">
          <h2 className="sec serif">How to get the best results</h2>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <div className="num">{s.n}</div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
                <div className="shot"><StepMock n={s.n} /></div>
              </div>
            ))}
          </div>
        </div></section>

        {/* templates */}
        <section className="sec-gray"><div className="wrap">
          <div className="kicker">Start from proven structures</div>
          <h2 className="sec serif">Ad templates for every goal</h2>
          <div className="tgrid">
            {TEMPLATES.map((t) => (
              <Link href={CTA} className="tcard" key={t.t}>
                <div className="thumb" style={{ background: t.g }}><AdPreview k={t.k} /></div>
                <div className="body">
                  <h4>{t.t}</h4>
                  <p>{t.d}</p>
                  <div className="use">Use template →</div>
                </div>
              </Link>
            ))}
          </div>
        </div></section>

        {/* real ads from Discover (only when the public feed returns some) */}
        {realAds.length > 0 && (
          <section><div className="wrap">
            <div className="kicker">Live from Discover</div>
            <h2 className="sec serif">Real winning ads, running right now</h2>
            <div className="real-grid">
              {realAds.map((a, i) => (
                <Link href={CTA} className="real-card" key={i}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.thumb} alt={a.brand || 'Ad'} loading="lazy" />
                  {a.brand && <div className="real-brand">{a.brand}</div>}
                </Link>
              ))}
            </div>
            <div style={{ textAlign: 'center', marginTop: 34 }}>
              <Link href={CTA} style={{ fontWeight: 700, color: 'var(--accent)', fontSize: 15 }}>Remake any of these for your brand →</Link>
            </div>
          </div></section>
        )}

        {/* features */}
        <section><div className="wrap">
          <h2 className="sec serif">The best features, designed for growth</h2>
          <div className="fgrid">
            {FEATURES.map((f) => (
              <div className="fcard" key={f.t}><h4>{f.t}</h4><p>{f.d}</p></div>
            ))}
          </div>
        </div></section>

        {/* faq */}
        <section className="sec-gray"><div className="wrap">
          <h2 className="sec serif">Questions, answered</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <div className="qa" key={f.q}><h4>{f.q}</h4><p>{f.a}</p></div>
            ))}
          </div>
        </div></section>

        {/* cta */}
        <section style={{ paddingBottom: 0 }}>
          <div className="cta">
            <h2 className="serif">Ready to run ads that sell?</h2>
            <p>Start free — Selfmade audits your store and builds your first ad. You approve every move.</p>
            <Link href={CTA}>Start free →</Link>
          </div>
        </section>

        <div className="foot">© {new Date().getFullYear()} Selfmade · <Link href="/">Home</Link></div>
      </div>
    </>
  )
}
