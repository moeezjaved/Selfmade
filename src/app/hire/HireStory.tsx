'use client'
/**
 * The landing, retold — "you hired a marketing department."
 *
 * Same design system as HireKeynote (Instrument Serif voice, Inter UI, mono machine, paper/forest/
 * lime, .rv reveals) — ONLY the communication changed. Hyper-style rhythm: every section is ONE
 * question, ONE headline, ONE sentence, ONE visual proof. No feature lists. No AI vocabulary —
 * departments, employees, "the team learned", "the team asked".
 *
 * The story: 1 What is this? → 2 What happens while I sleep? → 3 They report back → 4 How do they
 * know my business? (Company Brain) → 5 How do they work together? → 6 How do I control them? →
 * 7 Can they learn? (Teach the company) → 8 Where do they live? (WhatsApp/Slack) → 9 Why different →
 * the Turn → the Co-founder Agreement (KEPT byte-identical — the conversion is the countersignature).
 *
 * Previewed at /story; swaps to / only when approved.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function HireStory() {
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
          <a href="#agreement" className="nav-cta">Hire the team</a>
        </div>
      </nav>

      {/* ── 1 · WHAT IS THIS? — you hired a marketing department. ── */}
      <header className="hero">
        <div className="eyebrow rv">Introducing Selfmade</div>
        <h1 className="rv d2">You just hired a<br />marketing department.</h1>
        <p className="hero-sub rv d3">Research. Creative. Media buying. Customer care. A whole team, run by
        Mello — your marketing co&#8209;founder. They do the work. You make the decisions.</p>
        <div className="hero-cta rv d3">
          <a href="#agreement" className="btn-forest">Hire the team</a>
          <a href="#night" className="quiet-link">Watch a day of work ↓</a>
        </div>
        <div className="fine rv d3">$49/month · the whole department · starts tonight · no card to start</div>

        {/* the org chart — you at the top, departments reporting to you */}
        <div className="org rv d3" aria-hidden="true">
          <div className="org-you">YOU · FOUNDER &amp; CEO</div>
          <div className="org-stem" />
          <div className="org-row">
            {[
              ['Research', 'watches every competitor ad', 'on duty'],
              ['Creative', 'makes your image, video & UGC ads', '4 drafts ready'],
              ['Media Buying', 'runs & tunes your campaigns', 'asks before spending'],
              ['Customer', 'answers every DM, reply ready', 'inbox clear'],
            ].map(([t, d, s], i) => (
              <div className="dept" key={t} style={{ animationDelay: `${0.15 * i}s` }}>
                <div className="dept-name"><span className="dot" />{t}</div>
                <div className="dept-duty">{d}</div>
                <div className="dept-status">{s}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── 2 · WHAT HAPPENS WHILE I SLEEP? — your departments work. ── */}
      <section className="night" id="night">
        <div className="n-time rv">3:47 AM · the office is open</div>
        <h2 className="rv d2">While you sleep,<br />your departments work.</h2>
        <p className="n-sub rv d3">The team has studied <b>3,127,442</b> winning ads across <b>611,000</b> brands.
        Every night they put that education to work on your business.</p>
        <div className="nightlog rv d3">
          {[
            ['02:14', 'Research', 'read 1,001 new ads across your market'],
            ['03:02', 'Creative', 'drafted 4 ads from what’s winning'],
            ['04:40', 'Customer', 'sorted the inbox — 3 replies ready for you'],
            ['06:15', 'Media Buying', 'found one campaign worth scaling'],
          ].map(([t, dept, line], i) => (
            <div className="nl" key={t} style={{ animationDelay: `${0.35 + i * 0.5}s` }}>
              <span className="nl-t">{t}</span><span className="nl-d">{dept}</span><span className="nl-l">{line}</span>
            </div>
          ))}
          <div className="workline">still working<span className="cur" /></div>
        </div>
      </section>

      {/* ── 3 · THEY REPORT BACK — the morning brief (the product, shown not described). ── */}
      <section className="morning">
        <div className="m-time rv">7:00 AM · the brief</div>
        <h2 className="rv d2">Every morning,<br />they report to you.</h2>
        <p className="m-sub rv d3">One brief: what happened, what they made, and what needs your yes.</p>

        <div className="brief rv d3" aria-hidden="true">
          <div className="b-term">&gt; the team read <b>1,001 ads</b>&nbsp;&nbsp;·&nbsp;&nbsp;drafted <b>4 creatives</b>&nbsp;&nbsp;·&nbsp;&nbsp;last worked 1h ago</div>
          <div className="b-body">
            <div className="b-card">
              <span className="b-chip b-chip--done">Creative department</span>
              <div className="b-title">We finished 4 new ads — this one is the strongest.</div>
              <div className="b-why">Built from what&rsquo;s winning in your market this week. Nothing goes live until you say so.</div>
              <span className="b-btn">Review &amp; approve →</span>
            </div>
            <div className="b-card">
              <span className="b-chip">Research department</span>
              <div className="b-title">Country Delight launched 12 new ads overnight.</div>
              <div className="b-why">A real push, not rotation — 12 in 48h. Here&rsquo;s their angle before it compounds.</div>
              <span className="b-btn b-btn--ghost">Open the brand file →</span>
            </div>
          </div>
        </div>
        <div className="b-caption rv">A representative morning brief. Yours is built from your own market — and nothing ships without your approval.</div>
      </section>

      {/* ── 4 · HOW DO THEY KNOW MY BUSINESS? — the Company Brain. ── */}
      <section className="beat">
        <div className="beat-eyebrow rv">The company brain</div>
        <h2 className="rv d2">Tell the company once.<br />It remembers forever.</h2>
        <p className="beat-sub rv d3">Your product, your customers, your rules — everything you say becomes
        company memory that every department shares.</p>
        <div className="brain rv d3" aria-hidden="true">
          <div className="brain-note">
            <div className="brain-quote">&ldquo;Our buyer is new moms. We never discount below 15%.&rdquo;</div>
            <div className="brain-who">— you, said once</div>
          </div>
          <div className="brain-arrow">↓</div>
          <div className="brain-row">
            {['Research', 'Creative', 'Media Buying', 'Customer'].map((d, i) => (
              <div className="brain-chip" key={d} style={{ animationDelay: `${0.2 + i * 0.12}s` }}><span className="tick">✓</span>{d} remembers</div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5 · HOW DO THEY WORK TOGETHER? — like a real team. ── */}
      <section className="beat beat--tint">
        <div className="beat-eyebrow rv">One company</div>
        <h2 className="rv d2">They work together,<br />like a real team.</h2>
        <p className="beat-sub rv d3">Research finds the angle. Creative turns it into an ad. Media Buying gets
        it ready to run. It lands on your desk as one finished piece of work.</p>
        <div className="handoff rv d3" aria-hidden="true">
          {[
            ['Research', 'found the angle', '“Discipline over motivation” is winning in your niche.'],
            ['Creative', 'made the ad', 'Drafted it in your brand — image + a 15s video.'],
            ['Media Buying', 'prepared the launch', 'Budget set, audience set. Waiting on you.'],
          ].map(([t, s, d], i) => (
            <div className="ho" key={t} style={{ animationDelay: `${0.15 * i}s` }}>
              <div className="ho-head"><span className="ho-num">{i + 1}</span><b>{t}</b><span className="ho-sub">{s}</span></div>
              <div className="ho-d">{d}</div>
              {i < 2 && <div className="ho-arrow">→</div>}
            </div>
          ))}
        </div>
      </section>

      {/* ── 6 · HOW DO I CONTROL THEM? — they ask before acting. ── */}
      <section className="beat">
        <div className="beat-eyebrow rv">Your desk</div>
        <h2 className="rv d2">Nothing happens<br />without your yes.</h2>
        <p className="beat-sub rv d3">Money, publishing, big changes — the team always asks first.
        Approve, edit, or kill in one tap.</p>
        <div className="ask rv d3" aria-hidden="true">
          <div className="ask-msg">
            <div className="ask-from">Media Buying</div>
            <div className="ask-body">The blue ad is winning — 3.1x return. I&rsquo;d like to move budget onto it. OK?</div>
            <div className="ask-actions"><span className="b-btn">Approve →</span><span className="b-btn b-btn--ghost">Not yet</span></div>
          </div>
          <div className="ask-note">The team can prepare everything. Only you can say go.</div>
        </div>
      </section>

      {/* ── 7 · CAN THEY LEARN? — teach the company. ── */}
      <section className="beat beat--tint">
        <div className="beat-eyebrow rv">Teach the company</div>
        <h2 className="rv d2">Train them like employees.<br />In plain English.</h2>
        <p className="beat-sub rv d3">Say it once — the whole company follows it from then on.</p>
        <div className="teach rv d3" aria-hidden="true">
          {[
            ['“Never discount below 15%.”', 'Done. The whole company follows it.'],
            ['“Always ask before raising budget.”', 'Done. Media Buying will always ask.'],
            ['“Use British English.”', 'Done. Creative remembers, forever.'],
          ].map(([you, team], i) => (
            <div className="tch" key={i} style={{ animationDelay: `${0.15 * i}s` }}>
              <div className="tch-you">{you}</div>
              <div className="tch-team"><span className="tick">✓</span>{team}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 8 · WHERE DO THEY LIVE? — WhatsApp & Slack. The software disappears. ── */}
      <section className="beat">
        <div className="beat-eyebrow rv">Where they live</div>
        <h2 className="rv d2">The whole company,<br />in your pocket.</h2>
        <p className="beat-sub rv d3">Your departments message you on WhatsApp or Slack — the brief, the
        questions, the approvals. The software disappears. The team appears.</p>
        <div className="chat rv d3" aria-hidden="true">
          <div className="chat-head"><span className="chat-dot" />Selfmade — your team</div>
          <div className="chat-body">
            <div className="cb them" style={{ animationDelay: '.2s' }}><b>Research</b>Gymshark launched 5 new ads. Their angle: &ldquo;discipline over motivation.&rdquo;</div>
            <div className="cb them" style={{ animationDelay: '.6s' }}><b>Creative</b>Made 3 ads from it in your brand. The first one looks strong. 🖼️</div>
            <div className="cb them" style={{ animationDelay: '1s' }}><b>Media Buying</b>Ready to run it. Reply YES to approve.</div>
            <div className="cb you" style={{ animationDelay: '1.5s' }}>YES</div>
            <div className="cb them" style={{ animationDelay: '1.9s' }}><b>Media Buying</b>✓ Done. It&rsquo;s live. Report in the morning.</div>
          </div>
        </div>
      </section>

      {/* ── 9 · WHY IS THIS DIFFERENT? — a company, not software. ── */}
      <section className="why">
        <p className="rv">You&rsquo;re not buying software.<br />You&rsquo;re hiring a company.</p>
        <div className="why-compare rv d2">
          <div><span className="why-k">Software</span> waits for you to log in.</div>
          <div><span className="why-k why-k--us">A team</span> works whether you show up or not.</div>
        </div>
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
        {/* Legal — required to be reachable from the homepage (payment providers + Meta). */}
        <div className="after-links legal-links">
          <a href="/privacy">Privacy</a>
          <span>·</span>
          <a href="/terms">Terms</a>
          <span>·</span>
          <a href="/refund">Refund Policy</a>
          <span>·</span>
          <a href="/contact">Contact</a>
        </div>
        <div className="copyright">© {new Date().getFullYear()} Selfmade · operated by Virgin Teez</div>
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
        .eyebrow,.n-time,.m-time,.beat-eyebrow{font:700 11px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.24em;text-transform:uppercase;color:#8a927f}

        /* ── 1 · hero ── */
        .hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:130px 24px 90px}
        .hero h1{font-size:clamp(48px,9vw,116px);line-height:1;margin-top:26px;color:#171d18}
        .hero-sub{margin-top:32px;max-width:54ch;font-size:clamp(16px,1.8vw,19px);line-height:1.7;color:#4c5347;font-weight:500}
        .hero-cta{display:flex;align-items:center;gap:26px;margin-top:40px;flex-wrap:wrap;justify-content:center}
        .btn-forest{background:#17251c;color:#dffe95;border-radius:100px;padding:18px 42px;font-size:15.5px;font-weight:800;text-decoration:none;letter-spacing:-.01em;transition:transform .15s,box-shadow .15s}
        .btn-forest:hover{transform:translateY(-2px);box-shadow:0 18px 44px -14px rgba(23,37,28,.45)}
        .quiet-link{font-size:14px;font-weight:650;color:#68756b;text-decoration:none;border-bottom:1px solid #d8ddd2;padding-bottom:2px;transition:color .2s,border-color .2s}
        .quiet-link:hover{color:#171d18;border-color:#171d18}
        .fine{margin-top:24px;font-size:12.5px;color:#8a927f;font-weight:600}
        /* the org chart — the visual proof that this is a company */
        .org{margin-top:64px;width:min(860px,100%)}
        .org-you{display:inline-block;font:800 11px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.18em;color:#171d18;background:#fff;border:1px solid #e6e4da;border-radius:100px;padding:10px 18px}
        .org-stem{width:1px;height:26px;background:#d8ddd2;margin:0 auto}
        .org-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
        @media(max-width:760px){.org-row{grid-template-columns:1fr 1fr}}
        @media(max-width:420px){.org-row{grid-template-columns:1fr}}
        .dept{background:#fff;border:1px solid #e6e4da;border-radius:14px;padding:16px 16px 14px;text-align:left}
        .rv.in .dept{animation:riseIn .8s cubic-bezier(0,0,.2,1) both}
        .dept-name{display:flex;align-items:center;gap:7px;font-size:13.5px;font-weight:800;letter-spacing:-.01em;color:#171d18}
        .dot{width:7px;height:7px;border-radius:50%;background:#3f8f4f;animation:pulse 2.4s ease-in-out infinite}
        @keyframes pulse{0%,100%{opacity:.45}50%{opacity:1}}
        .dept-duty{font-size:12.5px;color:#68756b;line-height:1.5;margin-top:6px}
        .dept-status{font:650 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;color:#3f6a1e;background:#eef7d6;border-radius:5px;padding:4px 7px;display:inline-block;margin-top:10px}

        /* ── 2 · night ── */
        .night{background:#0c120d;color:#eef2ec;min-height:92vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:120px 24px}
        .night h2{font-size:clamp(40px,6.6vw,84px);line-height:1.02;color:#f2f5ef;margin-top:24px}
        .night .n-time{color:#5d675c}
        .n-sub{margin-top:28px;max-width:54ch;font-size:clamp(15px,1.7vw,18px);line-height:1.75;color:#9aa598;font-weight:500}
        .n-sub b{color:#eef2ec;font-variant-numeric:tabular-nums;font-weight:750}
        .nightlog{margin-top:48px;width:min(560px,100%);text-align:left;font:600 13px/1.6 ui-monospace,'SF Mono',Menlo,monospace}
        .nl{display:flex;gap:14px;padding:9px 0;border-bottom:1px solid rgba(238,242,236,.07)}
        .rv.in .nl{animation:riseIn .7s cubic-bezier(0,0,.2,1) both}
        .nl-t{color:#5d675c;flex-shrink:0}
        .nl-d{color:#dffe95;flex-shrink:0;width:104px}
        .nl-l{color:#9aa598;font-weight:500}
        @media(max-width:520px){.nl{flex-wrap:wrap}.nl-d{width:auto}}
        .workline{margin-top:20px;font:600 13px/1 ui-monospace,'SF Mono',Menlo,monospace;color:#5d675c;letter-spacing:.02em}
        .workline .cur{display:inline-block;width:7px;height:13px;background:#dffe95;vertical-align:-2px;margin-left:6px;animation:blink 1.1s step-start infinite}
        @keyframes blink{50%{opacity:0}}

        /* ── 3 · morning: the brief ── */
        .morning{display:flex;flex-direction:column;align-items:center;text-align:center;padding:150px 24px 130px}
        .morning h2{font-size:clamp(36px,6vw,76px);line-height:1.04;margin-top:24px;color:#171d18}
        .m-sub{margin-top:26px;max-width:50ch;font-size:clamp(15px,1.7vw,18px);line-height:1.7;color:#4c5347;font-weight:500}
        .brief{margin-top:60px;width:min(660px,100%);border:1px solid #e6e4da;border-radius:16px;background:#fff;overflow:hidden;box-shadow:0 40px 90px -50px rgba(23,29,24,.35);text-align:left;pointer-events:none}
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

        /* ── beats 4-8: one question per screen — headline, one sentence, one visual ── */
        .beat{display:flex;flex-direction:column;align-items:center;text-align:center;padding:130px 24px}
        .beat--tint{background:#f4f3ec}
        .beat h2{font-size:clamp(34px,5.6vw,70px);line-height:1.05;margin-top:24px;color:#171d18}
        .beat-sub{margin-top:24px;max-width:52ch;font-size:clamp(15px,1.7vw,18px);line-height:1.7;color:#4c5347;font-weight:500}

        /* 4 · the company brain */
        .brain{margin-top:54px;width:min(620px,100%)}
        .brain-note{background:#fff;border:1px solid #e6e4da;border-radius:14px;padding:26px 28px;box-shadow:0 30px 70px -45px rgba(23,29,24,.3)}
        .brain-quote{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(20px,2.6vw,26px);line-height:1.35;color:#171d18}
        .brain-who{font:650 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#8a927f;margin-top:12px}
        .brain-arrow{font-size:22px;color:#c9cfc2;margin:16px 0}
        .brain-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
        @media(max-width:640px){.brain-row{grid-template-columns:1fr 1fr}}
        .brain-chip{background:#fff;border:1px solid #e6e4da;border-radius:100px;padding:11px 8px;font-size:12.5px;font-weight:700;color:#171d18}
        .rv.in .brain-chip{animation:riseIn .7s cubic-bezier(0,0,.2,1) both}
        .tick{color:#3f8f4f;font-weight:900;margin-right:6px}

        /* 5 · handoff — the team working together */
        .handoff{margin-top:54px;display:grid;grid-template-columns:repeat(3,1fr);gap:14px;width:min(880px,100%)}
        @media(max-width:760px){.handoff{grid-template-columns:1fr}}
        .ho{position:relative;background:#fff;border:1px solid #e6e4da;border-radius:14px;padding:20px;text-align:left}
        .rv.in .ho{animation:riseIn .8s cubic-bezier(0,0,.2,1) both}
        .ho-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
        .ho-num{width:22px;height:22px;border-radius:50%;background:#17251c;color:#dffe95;font-size:11.5px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}
        .ho-head b{font-size:14.5px;letter-spacing:-.01em}
        .ho-sub{font:650 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#8a927f}
        .ho-d{font-size:13.5px;color:#4c5347;line-height:1.6;margin-top:10px}
        .ho-arrow{position:absolute;right:-14px;top:50%;transform:translateY(-50%);color:#c9cfc2;font-size:18px;z-index:2}
        @media(max-width:760px){.ho-arrow{display:none}}

        /* 6 · the ask — approval card */
        .ask{margin-top:54px;width:min(520px,100%)}
        .ask-msg{background:#fff;border:1px solid #e6e4da;border-radius:16px;padding:22px 24px;text-align:left;box-shadow:0 30px 70px -45px rgba(23,29,24,.3)}
        .ask-from{font:700 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8a927f}
        .ask-body{font-size:16px;font-weight:600;letter-spacing:-.01em;color:#171d18;line-height:1.5;margin-top:10px}
        .ask-actions{display:flex;gap:10px;margin-top:16px}
        .ask-note{font-size:12.5px;color:#8a927f;font-weight:600;margin-top:18px;text-align:center}

        /* 7 · teach the company */
        .teach{margin-top:54px;width:min(560px,100%);display:flex;flex-direction:column;gap:14px}
        .rv.in .tch{animation:riseIn .8s cubic-bezier(0,0,.2,1) both}
        .tch-you{margin-left:auto;width:fit-content;max-width:88%;background:#17251c;color:#f2f5ef;border-radius:16px 16px 4px 16px;padding:12px 18px;font-size:14.5px;font-weight:600;text-align:left}
        .tch-team{margin-right:auto;width:fit-content;max-width:88%;background:#fff;border:1px solid #e6e4da;border-radius:16px 16px 16px 4px;padding:11px 16px;font-size:13.5px;font-weight:600;color:#4c5347;margin-top:8px;text-align:left}

        /* 8 · the chat — WhatsApp/Slack */
        .chat{margin-top:54px;width:min(480px,100%);background:#fff;border:1px solid #e6e4da;border-radius:18px;overflow:hidden;box-shadow:0 40px 90px -50px rgba(23,29,24,.35);text-align:left;pointer-events:none}
        .chat-head{display:flex;align-items:center;gap:9px;background:#17251c;color:#f2f5ef;font-size:13.5px;font-weight:750;padding:13px 18px}
        .chat-dot{width:8px;height:8px;border-radius:50%;background:#dffe95;animation:pulse 2.4s ease-in-out infinite}
        .chat-body{padding:16px;display:flex;flex-direction:column;gap:9px;background:#f7f6f0}
        .cb{max-width:86%;border-radius:14px;padding:10px 14px;font-size:13.5px;line-height:1.5;color:#171d18}
        .rv.in .cb{animation:riseIn .7s cubic-bezier(0,0,.2,1) both}
        .cb b{display:block;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8a927f;margin-bottom:5px}
        .cb.them{background:#fff;border:1px solid #ecebe2;border-bottom-left-radius:4px;margin-right:auto}
        .cb.you{background:#dffe95;color:#17251c;font-weight:800;border-bottom-right-radius:4px;margin-left:auto}

        /* 9 · why different — a statement, then one honest line each */
        .why{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:150px 24px 60px}
        .why p{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(32px,5.2vw,64px);line-height:1.12;color:#171d18;max-width:22ch;text-wrap:balance;margin:0}
        .why-compare{margin-top:34px;display:flex;flex-direction:column;gap:8px;font-size:clamp(14.5px,1.6vw,17px);color:#68756b;font-weight:550}
        .why-k{font-weight:800;color:#8a927f}
        .why-k--us{color:#171d18}

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
        .legal-links{margin-top:2px;font-size:12px}
        .legal-links a{font-weight:600}
        .copyright{font-size:11.5px;color:#b6bcae;margin-top:14px}

        /* reveal — pure enhancement: content is ALWAYS visible; .in replays a gentle rise. */
        .rv{opacity:1;transform:none}
        .rv.in{animation:riseIn .9s cubic-bezier(0,0,.2,1) both}
        .rv.in.d2{animation-delay:.15s}.rv.in.d3{animation-delay:.3s}
        @keyframes riseIn{from{opacity:.001;transform:translateY(26px)}to{opacity:1;transform:none}}
        /* Staggered children (dept cards, log lines, chips, bubbles): VISIBLE by default (no JS = no
           .in = everything shows). When the parent .rv enters, each child replays riseIn with its own
           inline animation-delay — fill-mode:both holds the hidden "from" frame during the delay, which
           is what creates the one-by-one typing feel without ever risking stuck-invisible content. */
        @media (prefers-reduced-motion: reduce){.rv.in{animation:none}.rv.in .dept,.rv.in .nl,.rv.in .brain-chip,.rv.in .ho,.rv.in .tch,.rv.in .cb{animation:none!important}}
      `}</style>
    </div>
  )
}
