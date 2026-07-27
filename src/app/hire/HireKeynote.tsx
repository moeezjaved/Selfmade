'use client'
/**
 * The landing — "Apple launches Marketing as a category."
 *
 * One story per screen, told on paper. The page has a circadian spine — Day (the claim) → Night
 * (Mello works) → Morning (the brief: the REAL product, shown not described) → How (3 beats) → the
 * Co-founder Agreement, which the founder countersigns. The signature IS the conversion: you don't
 * "sign up" for Selfmade, you countersign a co-founder.
 *
 * Design laws: typography carries the page (Instrument Serif = the editorial voice, Inter = UI,
 * mono = the machine), whitespace creates hierarchy, lime appears exactly where it means something
 * (the agreement's rule + the machine's eyes). No glass, no gradients, no AI clichés.
 * Countersign → /signup. Reveal animations are pure enhancement (content always visible).
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HireKeynote() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [hired, setHired] = useState(false)
  const [today, setToday] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('in')), { rootMargin: '-70px' })
    root.current?.querySelectorAll('.rv').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [])

  const hire = () => {
    if (name.trim().length < 2) return
    setHired(true)
    setTimeout(() => router.push('/signup'), 1300)
  }

  return (
    <div ref={root} className="lp">
      {/* NAV — quiet. A wordmark, a way in, a way to sign. Nothing else. */}
      <nav className="nav">
        <a href="/" className="nav-logo">Selfmade</a>
        <div className="nav-right">
          <a href="/login" className="nav-link">Log in</a>
          <a href="#agreement" className="nav-cta">Hire Mello</a>
        </div>
      </nav>

      {/* DAY — the claim. One sentence that names the category. */}
      <header className="hero">
        <div className="eyebrow rv">Introducing Mello</div>
        <h1 className="rv d2">The Marketing<br />Co&#8209;founder.</h1>
        <p className="hero-sub rv d3">Every founder needs one. Almost nobody has one. Mello studies your
        market all night — and walks in every morning with the work, already done.</p>
        <div className="hero-cta rv d3">
          <a href="#agreement" className="btn-forest">Hire Mello</a>
          <a href="#night" className="quiet-link">See a day of work ↓</a>
        </div>
        <div className="fine rv d3">$49/month · starts tonight · no card to start</div>
      </header>

      {/* NIGHT — Mello works. The one dark screen on the page, because it is night. */}
      <section className="night" id="night">
        <div className="n-time rv">3:47 AM · your market, watched</div>
        <h2 className="rv d2">While you sleep,<br />Mello reads.</h2>
        <p className="n-sub rv d3">Every ad your competitors launch. Every hook, offer and format that&rsquo;s
        winning right now. It has studied <b>3,127,442</b> ads across <b>611,000</b> brands — and it
        remembers every one.</p>
        <div className="workline rv d3">reading: olpers · dayfresh · gymshark · nurpur<span className="cur" /></div>
      </section>

      {/* MORNING — the product itself. Shown, not described. */}
      <section className="morning">
        <div className="m-time rv">7:00 AM · the brief</div>
        <h2 className="rv d2">You wake up to decisions,<br />not dashboards.</h2>
        <p className="m-sub rv d3">One brief: what happened, what matters, and the work — researched,
        drafted, storyboarded — waiting for your yes.</p>

        <div className="brief rv d3" aria-hidden="true">
          <div className="b-term">&gt; read <b>1,001 ads</b> across your 3 competitors&nbsp;&nbsp;·&nbsp;&nbsp;drafted <b>4 creatives</b>&nbsp;&nbsp;·&nbsp;&nbsp;last worked 1h ago</div>
          <div className="b-body">
            <div className="b-card">
              <span className="b-chip b-chip--done">Done for you</span>
              <div className="b-title">I finished 4 new creatives — this is the strongest.</div>
              <div className="b-why">Built from what&rsquo;s winning in your market this week. Nothing goes live until you say so.</div>
              <span className="b-btn">Review &amp; approve →</span>
            </div>
            <div className="b-card">
              <span className="b-chip">Competitor</span>
              <div className="b-title">Country Delight launched 12 new ads.</div>
              <div className="b-why">A real push, not rotation — 12 in 48h. Here&rsquo;s their angle before it compounds.</div>
              <span className="b-btn b-btn--ghost">Open the brand file →</span>
            </div>
          </div>
        </div>
        <div className="b-caption rv">A representative morning brief. Yours is built from your own market — and nothing ships without your approval.</div>
      </section>

      {/* HOW — the whole arrangement in three beats. A real sequence, so the numbers are honest. */}
      <section className="how">
        {[
          ['01', 'Nights', 'Mello reads everything your market launched — every ad, every angle, every offer.'],
          ['02', 'Mornings', 'A brief lands: the read, the call, and the work already made — reports, image ads, UGC and cinematic video.'],
          ['03', 'You', 'Approve, edit, or kill. Your name is on the company; your yes is what ships.'],
        ].map(([n, t, d]) => (
          <div className="how-row rv" key={n}>
            <div className="how-num">{n}</div>
            <div className="how-t">{t}</div>
            <div className="how-d">{d}</div>
          </div>
        ))}
      </section>

      {/* A single quiet turn before the ceremony. */}
      <section className="turn">
        <p className="rv">You&rsquo;ve never hired anyone like this.<br />
        <span className="turn-sub">Nobody has. Which is why Mello would like to make the first move.</span></p>
      </section>

      {/* THE AGREEMENT — the conversion is a countersignature, kept exactly as loved. */}
      <div className="stage" id="agreement">
        <div className="paper rv">
          <div className="p-eyebrow">Co-founder agreement · for your countersignature</div>
          <div className="p-title">Co-founder Agreement</div>
          <div className="p-date">{today ? `Prepared ${today}` : 'Prepared this morning'}</div>
          {[
            ['Candidate', 'Mello'],
            ['Role', 'Marketing co-founder — your first'],
            ['Hours', 'All of them'],
            ['Education', '3,127,442 winning ads'],
            ['References', '611,000 brands, studied'],
            ['Equity', 'None — $49 / month'],
            ['Start date', 'Tonight'],
          ].map(([k, v]) => (
            <div className="p-row" key={k}><span>{k}</span><b>{v}</b></div>
          ))}
          <div className="p-note">I will study your market every night and report every morning. I will
          bring you the work already done. Nothing ships without your approval. You may end this
          arrangement at any time, effective immediately, no questions asked. <b>— I only ask for the
          nights.</b></div>
          <div className="sigs">
            <div className="sig"><div className="line">Mello</div><div className="who">Mello · Co-founder</div></div>
            <div className="sig">
              <div className="line"><input value={name} onChange={e => setName(e.target.value)} placeholder="Type your name to sign" autoComplete="name" /></div>
              <div className="who">You · Founder</div>
            </div>
          </div>
          <button className="hirebtn" disabled={name.trim().length < 2} onClick={hire}>
            {hired ? '✓ Signed. Mello starts tonight.' : 'Countersign & hire Mello'}
          </button>
          <div className="p-fine">No card to start · your first brief is free · effective tonight</div>
        </div>
      </div>

      {/* AFTER — one promise, then quiet. */}
      <footer className="after">
        <p>{hired ? `Welcome aboard${name.trim() ? ', ' + name.trim().split(' ')[0] : ''} — your first brief arrives tomorrow morning.` : 'Your first brief arrives tomorrow morning.'}</p>
        <div className="after-links">
          <a href="/home#pricing">How Mello works &amp; pricing</a>
          <span>·</span>
          <a href="/login">Log in</a>
        </div>
        <div className="copyright">© {new Date().getFullYear()} Selfmade</div>
      </footer>

      <style>{`
        html,body{background:#faf9f4}
        .lp{background:#faf9f4;color:#171d18;min-height:100vh;font-family:'Inter',-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}

        /* ── nav ── */
        .nav{position:fixed;top:0;left:0;right:0;z-index:40;display:flex;align-items:center;justify-content:space-between;padding:22px clamp(20px,4vw,44px);background:linear-gradient(#faf9f4 62%,rgba(250,249,244,0))}
        .nav-logo{font-size:19px;font-weight:850;letter-spacing:-.03em;color:#171d18;text-decoration:none}
        .nav-right{display:flex;align-items:center;gap:22px}
        .nav-link{font-size:13.5px;font-weight:600;color:#68756b;text-decoration:none;transition:color .2s}
        .nav-link:hover{color:#171d18}
        .nav-cta{background:#17251c;color:#dffe95;border-radius:100px;padding:10px 20px;font-size:13.5px;font-weight:750;text-decoration:none;transition:transform .15s}
        .nav-cta:hover{transform:scale(1.03)}

        /* ── type system ── */
        h1,h2{font-family:'Instrument Serif',Georgia,serif;font-weight:400;letter-spacing:-.015em;text-wrap:balance;margin:0}
        .eyebrow,.n-time,.m-time{font:700 11px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.24em;text-transform:uppercase;color:#8a927f}

        /* ── day: hero ── */
        .hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:120px 24px 80px}
        .hero h1{font-size:clamp(56px,10.5vw,132px);line-height:.98;margin-top:26px;color:#171d18}
        .hero-sub{margin-top:34px;max-width:52ch;font-size:clamp(16px,1.8vw,19px);line-height:1.7;color:#4c5347;font-weight:500}
        .hero-cta{display:flex;align-items:center;gap:26px;margin-top:44px;flex-wrap:wrap;justify-content:center}
        .btn-forest{background:#17251c;color:#dffe95;border-radius:100px;padding:18px 42px;font-size:15.5px;font-weight:800;text-decoration:none;letter-spacing:-.01em;transition:transform .15s,box-shadow .15s}
        .btn-forest:hover{transform:translateY(-2px);box-shadow:0 18px 44px -14px rgba(23,37,28,.45)}
        .quiet-link{font-size:14px;font-weight:650;color:#68756b;text-decoration:none;border-bottom:1px solid #d8ddd2;padding-bottom:2px;transition:color .2s,border-color .2s}
        .quiet-link:hover{color:#171d18;border-color:#171d18}
        .fine{margin-top:26px;font-size:12.5px;color:#8a927f;font-weight:600}

        /* ── night ── */
        .night{background:#0c120d;color:#eef2ec;min-height:92vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:120px 24px}
        .night h2{font-size:clamp(42px,7vw,88px);line-height:1.02;color:#f2f5ef;margin-top:24px}
        .night .n-time{color:#5d675c}
        .n-sub{margin-top:30px;max-width:54ch;font-size:clamp(15px,1.7vw,18px);line-height:1.75;color:#9aa598;font-weight:500}
        .n-sub b{color:#eef2ec;font-variant-numeric:tabular-nums;font-weight:750}
        .workline{margin-top:42px;font:600 13px/1 ui-monospace,'SF Mono',Menlo,monospace;color:#5d675c;letter-spacing:.02em}
        .workline .cur{display:inline-block;width:7px;height:13px;background:#dffe95;vertical-align:-2px;margin-left:4px;animation:blink 1.1s step-start infinite}
        @keyframes blink{50%{opacity:0}}

        /* ── morning: the product ── */
        .morning{display:flex;flex-direction:column;align-items:center;text-align:center;padding:150px 24px 130px}
        .morning h2{font-size:clamp(38px,6.4vw,80px);line-height:1.04;margin-top:24px;color:#171d18}
        .m-sub{margin-top:28px;max-width:50ch;font-size:clamp(15px,1.7vw,18px);line-height:1.7;color:#4c5347;font-weight:500}
        .brief{margin-top:64px;width:min(660px,100%);border:1px solid #e6e4da;border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 40px 90px -50px rgba(23,29,24,.35);text-align:left;pointer-events:none}
        .b-term{background:#17251c;color:#b9c7b4;font:600 12px/1.6 ui-monospace,'SF Mono',Menlo,monospace;padding:13px 20px;letter-spacing:.01em}
        .b-term b{color:#dffe95;font-weight:700}
        .b-body{padding:18px;display:flex;flex-direction:column;gap:12px}
        .b-card{border:1px solid #ecebe2;border-radius:12px;padding:16px 18px;background:#fff}
        .b-chip{display:inline-block;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#68756b;background:#eef0ea;border-radius:5px;padding:4px 8px}
        .b-chip--done{color:#3f6a1e;background:#eef7d6}
        .b-title{font-size:16.5px;font-weight:750;letter-spacing:-.015em;color:#171d18;margin-top:9px;line-height:1.3}
        .b-why{font-size:13px;color:#68756b;line-height:1.55;margin-top:5px}
        .b-btn{display:inline-block;margin-top:12px;background:#17251c;color:#dffe95;border-radius:100px;padding:9px 17px;font-size:12.5px;font-weight:800}
        .b-btn--ghost{background:#fff;color:#171d18;border:1.5px solid #e0e5db}
        .b-caption{margin-top:22px;font-size:12.5px;color:#8a927f;font-weight:600}

        /* ── how: three beats ── */
        .how{max-width:880px;margin:0 auto;padding:40px 24px 140px;display:flex;flex-direction:column}
        .how-row{display:grid;grid-template-columns:90px 170px 1fr;gap:26px;align-items:baseline;padding:38px 0;border-top:1px solid #e6e4da}
        @media(max-width:640px){.how-row{grid-template-columns:56px 1fr;gap:14px}.how-d{grid-column:2}}
        .how-num{font-family:'Instrument Serif',Georgia,serif;font-size:44px;color:#c9cfc2;line-height:1}
        .how-t{font-size:17px;font-weight:800;letter-spacing:-.02em;color:#171d18}
        .how-d{font-size:15.5px;line-height:1.7;color:#4c5347;font-weight:500;max-width:52ch}

        /* ── the turn ── */
        .turn{display:flex;align-items:center;justify-content:center;text-align:center;padding:40px 24px 150px}
        .turn p{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(30px,4.6vw,52px);line-height:1.18;color:#171d18;max-width:24ch;text-wrap:balance}
        .turn-sub{display:block;font-family:'Inter',sans-serif;font-size:clamp(14px,1.5vw,16.5px);font-weight:500;color:#68756b;margin-top:20px;line-height:1.65}

        /* ── the agreement (kept) ── */
        .stage{display:flex;align-items:center;justify-content:center;padding:60px 20px 120px}
        .paper{background:#fff;color:#191d17;width:100%;max-width:560px;border-radius:8px;padding:54px 56px 44px;box-shadow:0 60px 130px -40px rgba(23,29,24,.4),0 0 0 1px #ecebe2;position:relative}
        @media(max-width:560px){.paper{padding:38px 26px 32px}}
        .paper:before{content:'';position:absolute;top:0;left:0;right:0;height:5px;border-radius:8px 8px 0 0;background:#dffe95}
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
        .hirebtn{display:flex;width:100%;justify-content:center;align-items:center;gap:10px;margin-top:36px;background:#17251c;color:#dffe95;border:none;border-radius:100px;padding:17px 20px;font:800 16px/1 'Inter',sans-serif;letter-spacing:-.01em;cursor:pointer;transition:transform .15s,box-shadow .15s}
        .hirebtn:hover{transform:translateY(-2px);box-shadow:0 16px 40px -12px rgba(23,37,28,.4)}
        .hirebtn:disabled{opacity:.45;cursor:default;transform:none;box-shadow:none}
        .p-fine{text-align:center;font-size:11.5px;color:#8a927f;margin-top:16px}

        /* ── after ── */
        .after{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:12px;padding:0 24px 90px}
        .after p{font-size:15px;color:#4c5347;font-weight:600}
        .after-links{display:flex;gap:12px;align-items:center;font-size:13px;color:#c9cfc2}
        .after-links a{color:#68756b;font-weight:650;text-decoration:none;border-bottom:1px solid #e0e5db;padding-bottom:1px;transition:color .2s}
        .after-links a:hover{color:#171d18}
        .copyright{font-size:11.5px;color:#b6bcae;margin-top:14px}

        /* reveal — pure enhancement: content is ALWAYS visible; .in replays a gentle rise. */
        .rv{opacity:1;transform:none}
        .rv.in{animation:riseIn .9s cubic-bezier(0,0,.2,1) both}
        .rv.in.d2{animation-delay:.15s}.rv.in.d3{animation-delay:.3s}
        @keyframes riseIn{from{opacity:.001;transform:translateY(26px)}to{opacity:1;transform:none}}
        @media (prefers-reduced-motion: reduce){.rv.in{animation:none}}
      `}</style>
    </div>
  )
}
