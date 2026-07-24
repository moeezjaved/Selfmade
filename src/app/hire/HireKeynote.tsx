'use client'
/**
 * /hire — the keynote landing: a scroll of one-line beats on a black stage that ends in Mello's
 * employment offer, waiting for the founder's countersignature. Additive route (the root homepage
 * is untouched); this is the shareable "category launch" surface. Countersign → /signup.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HireKeynote() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [hired, setHired] = useState(false)
  const [today, setToday] = useState('')
  const rvRoot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('in')), { rootMargin: '-60px' })
    rvRoot.current?.querySelectorAll('.rv').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])

  const hire = () => {
    if (name.trim().length < 2) return
    setHired(true)
    setTimeout(() => router.push('/signup'), 1300)
  }

  return (
    // Inline black background wins over the app's global body.bg-dark (class > element selector) and
    // covers the whole scroll — the keynote is a black stage regardless of the surrounding app theme.
    <div ref={rvRoot} style={{ background: '#0b1220', minHeight: '100vh', color: '#f2f5ef' }}>
      {/* Persistent glassmorphic nav — Instrument Serif wordmark, liquid-glass CTA. */}
      <nav className="glassnav">
        <a href="/" className="gn-logo">Selfmade</a>
        <div className="gn-right">
          <a href="/login" className="gn-link">Log in</a>
          <a href="#offer" className="liquid-glass gn-cta">Hire Mello</a>
        </div>
      </nav>

      {/* HERO — the opening screen: full-bright reel, cinematic serif, glass CTA. */}
      <section className="beat beat--hero">
        <video className="hero-vid" autoPlay muted loop playsInline preload="auto"
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4" />
        <h1 className="hero-h1 fr">Every morning, marketers wake up <em>already behind.</em></h1>
        <p className="hero-sub fr fr-d1">The market moved all night. Nobody was watching.</p>
        <a href="#offer" className="liquid-glass hero-cta fr fr-d2">Hire Mello</a>
        <div className="hint">Scroll</div>
      </section>

      <section className="beat"><p className="rv">What if someone <span className="lime">was</span>?</p></section>

      <section className="beat">
        <div className="mello rv" />
        <p className="rv d2">This is Mello.</p>
        <div className="small rv d3">It is not an app. It is not a dashboard. It is a marketer.</div>
      </section>

      <section className="beat">
        <p className="rv"><span className="num">Last night it read 41,382&nbsp;ads.</span></p>
        <div className="small rv d2">It does that every night. It has studied <b className="brt">3,127,442</b> — and it remembers every single one.</div>
        <div className="workline rv d3">reading: olpers · dayfresh · gymshark · nurpur<span className="cur" /></div>
      </section>

      <section className="beat">
        <p className="rv">It watches your competitors while they sleep.</p>
        <div className="small rv d2">Because it doesn&rsquo;t.</div>
      </section>

      <section className="beat">
        <p className="rv">Every morning it hands you a brief:</p>
        <div className="small rv d2">what happened, what matters, and the work — <b className="brt">already done</b>, waiting for your yes.</div>
      </section>

      <section className="beat">
        <p className="rv">You&rsquo;ve never hired anyone like&nbsp;this.</p>
        <div className="small rv d2">Nobody has. Which is why Mello would like to make the first move.</div>
      </section>

      {/* THE OFFER */}
      <div className="stage" id="offer">
        <div className="paper rv">
          <div className="p-eyebrow">Employment offer · for your countersignature</div>
          <div className="p-title">Offer of Employment</div>
          <div className="p-date">{today ? `Prepared ${today}` : 'Prepared this morning'}</div>
          {[['Candidate', 'Mello'], ['Position', 'Marketer — your first'], ['Hours', 'All of them'], ['Education', '3,127,442 winning ads'], ['References', '611,000 brands, studied'], ['Compensation', '$49 / month'], ['Start date', 'Tonight']].map(([k, v]) => (
            <div className="p-row" key={k}><span>{k}</span><b>{v}</b></div>
          ))}
          <div className="p-note">I will study your market every night and report every morning. I will bring you the work already done. Nothing ships without your approval. You may terminate this arrangement at any time, effective immediately, no questions asked. <b>— I only ask for the nights.</b></div>
          <div className="sigs">
            <div className="sig"><div className="line">Mello</div><div className="who">Mello · The Candidate</div></div>
            <div className="sig">
              <div className="line"><input value={name} onChange={e => setName(e.target.value)} placeholder="Type your name to sign" autoComplete="name" /></div>
              <div className="who">You · The Founder</div>
            </div>
          </div>
          <button className="hirebtn" disabled={name.trim().length < 2} onClick={hire}>
            {hired ? '✓ Hired. Mello starts tonight.' : 'Countersign & hire Mello'}
          </button>
          <div className="p-fine">No card to start · first work is free · effective tonight</div>
        </div>
      </div>

      <div className="after">
        <p>{hired ? `Welcome aboard${name.trim() ? ', ' + name.trim().split(' ')[0] : ''} — your first brief arrives tomorrow morning.` : 'Your first brief arrives tomorrow morning.'}</p>
        <a className="afterlink" href="/home#pricing">How Mello works &amp; pricing →</a>
      </div>

      <style>{`
        html,body{background:#0b1220}
        /* Glassmorphic nav — persistent, centered, Instrument Serif wordmark. */
        .glassnav{position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:1220px;z-index:30;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 32px;font-family:'Inter',sans-serif}
        .gn-logo{font-family:'Inter',-apple-system,system-ui,sans-serif;font-size:22px;font-weight:850;letter-spacing:-.03em;color:#fff;text-decoration:none;text-shadow:0 2px 18px rgba(0,0,0,.55)}
        .gn-links{display:none;align-items:center;gap:30px}
        @media(min-width:768px){.gn-links{display:flex}}
        .gn-link{font-size:13.5px;font-weight:500;color:#b3bbb0;text-decoration:none;transition:color .2s;text-shadow:0 1px 10px rgba(0,0,0,.5)}
        .gn-link:hover{color:#fff}
        .gn-active{color:#fff}
        .gn-right{display:flex;align-items:center;gap:18px}
        .gn-cta{border-radius:100px;padding:10px 22px;font-size:13.5px;font-weight:600;color:#fff;text-decoration:none;transition:transform .15s}
        .gn-cta:hover{transform:scale(1.03)}
        /* liquid glass — a whisper of frost with a light-catching rim. */
        .liquid-glass{background:rgba(255,255,255,.01);background-blend-mode:luminosity;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);border:none;box-shadow:inset 0 1px 1px rgba(255,255,255,.1);position:relative;overflow:hidden}
        .liquid-glass:before{content:'';position:absolute;inset:0;border-radius:inherit;padding:1.4px;background:linear-gradient(180deg,rgba(255,255,255,.45) 0%,rgba(255,255,255,.15) 20%,rgba(255,255,255,0) 40%,rgba(255,255,255,0) 60%,rgba(255,255,255,.15) 80%,rgba(255,255,255,.45) 100%);-webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
        .beat{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 24px;position:relative;font-family:'Inter',-apple-system,system-ui,sans-serif}
        /* HERO — full-bright reel, cinematic serif, glass CTA. No dimming overlay. */
        .beat--hero{overflow:hidden;justify-content:flex-start;padding-top:clamp(132px,23vh,240px)}
        .hero-vid{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;background:#0b1220}
        /* gentle fade at the base of the hero so the night video melts into the navy scroll below */
        .beat--hero:after{content:'';position:absolute;left:0;right:0;bottom:0;height:16%;z-index:1;background:linear-gradient(to bottom,rgba(11,18,32,0),rgba(11,18,32,.92));pointer-events:none}
        .beat--hero>*:not(.hero-vid){position:relative;z-index:2}
        .beat--hero .hero-h1{font-family:'Instrument Serif',serif;font-weight:400;font-size:clamp(34px,5.4vw,66px);line-height:1.04;letter-spacing:-.015em;max-width:24ch;color:#fff;text-shadow:0 1px 22px rgba(0,0,0,.26)}
        .beat--hero .hero-h1 em{font-style:normal;color:#c4ccc0}
        .beat--hero .hero-sub{margin-top:24px;max-width:44ch;font-size:clamp(15px,1.6vw,18px);font-weight:500;color:#eef2ec;line-height:1.6;text-shadow:0 1px 14px rgba(0,0,0,.34)}
        .hero-cta{margin-top:40px;display:inline-block;border-radius:100px;padding:18px 46px;font-size:16px;font-weight:600;color:#fff;text-decoration:none;transition:transform .15s}
        .hero-cta:hover{transform:scale(1.03)}
        .beat--hero .hint{color:rgba(240,244,236,.7)}
        .beat--hero .hint:after{background:linear-gradient(rgba(240,244,236,.6),transparent)}
        @keyframes fr{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
        .fr{animation:fr .8s ease-out both}
        .fr-d1{animation-delay:.2s}.fr-d2{animation-delay:.4s}
        @media(prefers-reduced-motion:reduce){.fr{animation:none}}
        .beat p{font-size:clamp(30px,5.6vw,64px);font-weight:800;letter-spacing:-.04em;line-height:1.12;max-width:20ch;text-wrap:balance;color:#f2f5ef}
        .beat .small{font-size:clamp(16px,2vw,20px);font-weight:600;color:#8b978a!important;letter-spacing:-.01em;max-width:44ch;line-height:1.6;margin-top:22px}
        .lime{color:#dffe95}
        .brt{color:#f2f5ef}
        .num{font-variant-numeric:tabular-nums}
        /* reveal is a pure enhancement: content is ALWAYS visible (opacity 1); when the observer
           marks an element .in it replays a gentle rise. No JS / no observer → still fully visible. */
        .rv{opacity:1;transform:none}
        .rv.in{animation:riseIn .9s cubic-bezier(0,0,.2,1) both}
        .rv.in.d2{animation-delay:.2s}.rv.in.d3{animation-delay:.4s}
        @keyframes riseIn{from{opacity:.001;transform:translateY(28px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion: reduce){.rv.in{animation:none}}
        .hint{position:absolute;bottom:34px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:700;letter-spacing:.22em;color:#4a544a;text-transform:uppercase}
        .hint:after{content:'';display:block;width:1px;height:34px;background:linear-gradient(#4a544a,transparent);margin:10px auto 0}
        .mello{width:88px;height:88px;border-radius:28px;background:#dffe95;border:3px solid #10180f;position:relative;margin-bottom:38px;animation:floaty 4.5s ease-in-out infinite}
        .mello:before{content:'';position:absolute;left:18px;right:18px;top:22px;height:27px;border-radius:14px;background:#fff;border:3px solid #10180f}
        .mello:after{content:'• •';position:absolute;left:0;right:0;top:22px;text-align:center;font-size:17px;letter-spacing:6px;color:#10180f;font-weight:900}
        @keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
        .workline{margin-top:34px;font:600 13px/1 ui-monospace,'SF Mono',Menlo,monospace;color:#5d675c;letter-spacing:.02em}
        .workline b{color:#9fbf72;font-weight:700}
        .workline .cur{display:inline-block;width:7px;height:13px;background:#9fbf72;vertical-align:-2px;margin-left:3px;animation:blink 1.1s step-start infinite}
        @keyframes blink{50%{opacity:0}}
        .stage{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:90px 20px;background:radial-gradient(90% 70% at 50% 30%,#141a13 0%,#0a0d0a 70%);font-family:'Inter',-apple-system,system-ui,sans-serif}
        .paper{background:#fbfaf6;color:#191d17;width:100%;max-width:560px;border-radius:6px;padding:54px 56px 44px;box-shadow:0 60px 140px -30px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.04);position:relative}
        @media(max-width:560px){.paper{padding:38px 26px 32px}}
        .paper:before{content:'';position:absolute;top:0;left:0;right:0;height:5px;border-radius:6px 6px 0 0;background:#dffe95}
        .p-eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;color:#8a927f;margin-bottom:26px}
        .p-title{font-size:26px;font-weight:850;letter-spacing:-.03em;margin-bottom:6px}
        .p-date{font-size:12.5px;color:#8a927f;margin-bottom:30px}
        .p-row{display:flex;justify-content:space-between;gap:18px;padding:12px 0;border-bottom:1px solid #ecebe4;font-size:14.5px}
        .p-row span{color:#8a927f}.p-row b{font-weight:750;text-align:right}
        .p-note{font-size:13.5px;line-height:1.75;color:#4c5347;margin:26px 0 34px}
        .p-note b{color:#191d17}
        .sigs{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:end}
        @media(max-width:480px){.sigs{grid-template-columns:1fr}}
        .sig .line{border-bottom:1.5px solid #191d17;height:44px;display:flex;align-items:flex-end;padding-bottom:4px;font-family:'Snell Roundhand','Segoe Script','Brush Script MT',cursive;font-size:26px;color:#1f2a1c}
        .sig .who{font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8a927f;margin-top:8px}
        .sig input{all:unset;width:100%;font-family:'Snell Roundhand','Segoe Script','Brush Script MT',cursive;font-size:26px;color:#1f2a1c;caret-color:#3f8f4f}
        .sig input::placeholder{color:#c6c9bd;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;letter-spacing:0}
        .hirebtn{display:flex;width:100%;justify-content:center;align-items:center;gap:10px;margin-top:36px;background:#10180f;color:#dffe95;border:none;border-radius:100px;padding:17px 20px;font:800 16px/1 'Inter',sans-serif;letter-spacing:-.01em;cursor:pointer;transition:transform .15s,box-shadow .15s}
        .hirebtn:hover{transform:translateY(-2px);box-shadow:0 16px 40px rgba(0,0,0,.35)}
        .hirebtn:disabled{opacity:.45;cursor:default;transform:none;box-shadow:none}
        .p-fine{text-align:center;font-size:11.5px;color:#8a927f;margin-top:16px}
        .after{min-height:46vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:10px;padding:0 24px;font-family:'Inter',-apple-system,system-ui,sans-serif}
        .after p{font-size:15px;color:#5d675c;font-weight:600}
        .afterlink{font-size:13px;color:#8b978a;font-weight:700;text-decoration:none;border-bottom:1px solid #2a332a;padding-bottom:2px;transition:color .2s}
        .afterlink:hover{color:#dffe95}
      `}</style>
    </div>
  )
}
