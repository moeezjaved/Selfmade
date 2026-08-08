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
import React, { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import HqMockup from './HqMockup'
import FeatureGrid from './FeatureGrid'
import FeatureShowcase from './FeatureShowcase'

export default function HireStory() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [hired, setHired] = useState(false)
  const [today, setToday] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))
    const host = root.current
    if (!host) return
    // Content is ALWAYS visible by default — no JS, a hydration hiccup, or a slow observer can
    // ever blank the page. We ONLY animate elements below the fold at load: they get 'in' as they
    // scroll into view from the bottom edge, so the rise reads as motion, never a snap. Anything
    // already on screen stays put — the hero never flashes visible→hidden→rise, which is exactly
    // what read as "broken" before.
    const vh = window.innerHeight
    const io = new IntersectionObserver(
      es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }),
      { rootMargin: '0px 0px -6% 0px' },
    )
    host.querySelectorAll<HTMLElement>('.rv').forEach(el => {
      if (el.getBoundingClientRect().top >= vh * 0.9) io.observe(el)
    })
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
        {/* Headline animates in word-by-word on load (blur + rise), Sila-style. Words are spans with a
            staggered --wi index; kept visible-by-default via the `.rv` engine so extensions can't blank it. */}
        <h1 className="rv d2" aria-label="The One-Person Company.">
          {['The', 'One‑Person', 'Company.'].map((w, i) => (
            <React.Fragment key={i}>
              <span className="hw" style={{ ['--wi' as any]: i }} aria-hidden="true">{w}</span>
              {i === 1 ? <br /> : ' '}
            </React.Fragment>
          ))}
        </h1>
        <p className="hero-neg rv d2">No employees. No agency. No freelancers.</p>
        <p className="hero-sub rv d3">Your AI company runs the work behind your brand. You make the calls.</p>

        <div className="hero-cta rv d3">
          <a href="#agreement" className="btn-forest">Hire the team</a>
          <a href="#work" className="quiet-link">See the work ↓</a>
        </div>
        <div className="fine rv d3">$49/month · the whole company · starts tonight · no card to start</div>
      </header>

      {/* Animated product mockup — the workspace as a real app (proof of "The One-Person Company"). */}
      <HqMockup />

      {/* Feature showcase — alternating blocks, each with an animated mockup of the feature working. */}
      <FeatureShowcase />

      {/* Feature grid — Sila-style compact cards for the rest of the suite. */}
      <FeatureGrid />

      {/* Old serif narrative sections (cold-open, night, morning, control, teach, why, turn)
          removed — the story is now told by the animated HqMockup + FeatureShowcase + FeatureGrid above,
          which match the new theme and keep the page short. The Employment Agreement stays. */}

      {/* The turn into the ceremony — restates the category one last time before the signature. */}
      <section className="why">
        <p className="rv">You&rsquo;re not buying software.<br />You&rsquo;re hiring a company.</p>
        <div className="why-sub rv d2">One founder. One company. No marketing department required.</div>
      </section>

      {/* THE AGREEMENT — the conversion is a signature. Employment terms, not a co-founder deal —
          the ridiculous 24/7 / never-on-vacation clauses are the screenshot. */}
      <div className="stage" id="agreement">
        <div className="paper rv">
          <div className="p-eyebrow">Employment agreement · for your signature</div>
          <div className="p-title">Employment Agreement</div>
          <div className="p-date">{today ? `Prepared ${today}` : 'Prepared this morning'}</div>
          {[
            ['Employee', 'Mello & your marketing team'],
            ['Reports to', 'You'],
            ['Working hours', '24/7 — nights included'],
            ['Vacation', 'Never'],
            ['Performance review', 'Every morning'],
            ['Training', '3,127,442 ads · 611,000 brands'],
            ['Notice period', 'None — end it any time'],
            ['Salary', '$49 / month'],
            ['Starts', 'Tonight'],
          ].map(([k, v]) => (
            <div className="p-row" key={k}><span>{k}</span><b>{v}</b></div>
          ))}
          <div className="p-note">I will study your market every night and report every morning. I will
          bring you the work already done. Nothing ships without your approval. Let me go at any time,
          effective immediately, no questions asked. <b>— I only ask for the nights.</b></div>
          <div className="sigs">
            <div className="sig"><div className="line">Mello</div><div className="who">Mello · Your marketing manager</div></div>
            <div className="sig">
              <div className="line"><input value={name} onChange={e => setName(e.target.value)} placeholder="Type your name to sign" autoComplete="name" /></div>
              <div className="who">You · Employer</div>
            </div>
          </div>
          <button className="hirebtn" disabled={name.trim().length < 2} onClick={hire}>
            {hired ? '✓ Signed. Your team starts tonight.' : 'Sign & put the team to work'}
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
        /* Shorter hero (no 100vh fill) so the product mockup peeks ~30-40% below the fold, Sila-style. */
        .hero{min-height:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:104px 24px 26px}
        .hero h1{font-size:clamp(44px,8.4vw,104px);line-height:1;margin-top:22px;color:#171d18}
        /* Headline animates in word-by-word on load (blur + rise), like Sila. Pure CSS → reliable. */
        .hero h1 .hw{display:inline-block;animation:hw-in .72s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(.06s + var(--wi) * .12s)}
        @keyframes hw-in{from{opacity:0;filter:blur(10px);transform:translateY(16px)}to{opacity:1;filter:blur(0);transform:none}}
        .hero-neg{margin-top:20px;font-size:clamp(15px,1.95vw,20px);font-weight:750;letter-spacing:-.012em;color:#1f2a20}
        .hero-sub{margin-top:22px;max-width:54ch;font-size:clamp(16px,1.8vw,19px);line-height:1.7;color:#4c5347;font-weight:500}
        .hero-cta{display:flex;align-items:center;gap:26px;margin-top:40px;flex-wrap:wrap;justify-content:center}
        .btn-forest{background:#17251c;color:#dffe95;border-radius:100px;padding:18px 42px;font-size:15.5px;font-weight:800;text-decoration:none;letter-spacing:-.01em;transition:transform .15s,box-shadow .15s}
        .btn-forest:hover{transform:translateY(-2px);box-shadow:0 18px 44px -14px rgba(23,37,28,.45)}
        .quiet-link{font-size:14px;font-weight:650;color:#68756b;text-decoration:none;border-bottom:1px solid #d8ddd2;padding-bottom:2px;transition:color .2s,border-color .2s}
        .quiet-link:hover{color:#171d18;border-color:#171d18}
        .fine{margin-top:24px;font-size:12.5px;color:#8a927f;font-weight:600}
        /* four tiny credibility numbers under the headline */
        .stats{display:flex;flex-wrap:wrap;justify-content:center;gap:clamp(22px,5vw,56px);margin-top:34px}
        .stat{text-align:center}
        .stat-n{font:800 clamp(23px,3vw,31px)/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:-.02em;color:#171d18;font-variant-numeric:tabular-nums}
        .stat-l{font:650 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8a927f;margin-top:9px}
        /* the org chart — the visual proof that this is a company */
        .org{margin-top:64px;width:min(920px,100%)}
        .org-you{display:inline-block;font:800 11px/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.18em;color:#171d18;background:#fff;border:1px solid #e6e4da;border-radius:100px;padding:10px 18px}
        .org-stem{width:1px;height:26px;background:#d8ddd2;margin:0 auto}
        .org-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
        @media(max-width:720px){.org-row{grid-template-columns:1fr 1fr}}
        @media(max-width:420px){.org-row{grid-template-columns:1fr}}
        .dept{background:#fff;border:1px solid #e6e4da;border-radius:14px;padding:16px 16px 14px;text-align:left}
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
        .nl-t{color:#5d675c;flex-shrink:0}
        .nl-d{color:#dffe95;flex-shrink:0;width:104px}
        .nl-l{color:#9aa598;font-weight:500}
        @media(max-width:520px){.nl{flex-wrap:wrap}.nl-d{width:auto}}
        .workline{margin-top:20px;font:600 13px/1 ui-monospace,'SF Mono',Menlo,monospace;color:#5d675c;letter-spacing:.02em}
        .workline .cur{display:inline-block;width:7px;height:13px;background:#dffe95;vertical-align:-2px;margin-left:6px;animation:blink 1.1s step-start infinite}
        /* the morning payoff — the emotional close of the night */
        .nl-morning{display:flex;gap:14px;align-items:baseline;margin-top:14px;padding-top:16px;border-top:1px solid rgba(238,242,236,.14);font:600 13px/1.5 ui-monospace,'SF Mono',Menlo,monospace}
        .nl-morning .nl-t{color:#dffe95}
        .nl-wake{color:#eef2ec;font-weight:600}
        .nl-wake b{color:#dffe95;font-weight:800}
        @media(max-width:520px){.nl-morning{flex-wrap:wrap}}
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
        .tick{color:#3f8f4f;font-weight:900;margin-right:6px}

        /* 5 · relay — one decision travels down the company, top to bottom */
        .relay{position:relative;margin-top:54px;width:min(560px,100%);display:flex;flex-direction:column;gap:14px;text-align:left}
        .relay-spine{position:absolute;left:19px;top:20px;bottom:40px;width:2px;background:linear-gradient(#d8ddd2,#d8ddd2);z-index:0}
        .relay-step{position:relative;z-index:1;display:flex;gap:16px;align-items:flex-start}
        .relay-node{flex-shrink:0;width:40px;height:40px;border-radius:50%;background:#fff;border:2px solid #d8ddd2;color:#68756b;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center}
        .relay-step--mello .relay-node{background:#17251c;border-color:#17251c;color:#dffe95;font-size:11px;letter-spacing:1px}
        .relay-card{flex:1;background:#fff;border:1px solid #e6e4da;border-radius:14px;padding:14px 18px}
        .relay-step--mello .relay-card{background:#17251c;border-color:#17251c}
        .relay-dept{font:700 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8a927f}
        .relay-step--mello .relay-dept{color:#9fb98a}
        .relay-line{font-size:14.5px;font-weight:600;letter-spacing:-.01em;color:#171d18;line-height:1.5;margin-top:7px}
        .relay-step--mello .relay-line{color:#f2f5ef}
        .relay-approve{margin-top:12px}

        /* 6 · the ask — approval card */
        .ask{margin-top:54px;width:min(520px,100%)}
        .ask-msg{background:#fff;border:1px solid #e6e4da;border-radius:16px;padding:22px 24px;text-align:left;box-shadow:0 30px 70px -45px rgba(23,29,24,.3)}
        .ask-from{font:700 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#8a927f}
        .ask-body{font-size:16px;font-weight:600;letter-spacing:-.01em;color:#171d18;line-height:1.5;margin-top:10px}
        .ask-outcome{display:inline-flex;align-items:baseline;gap:8px;margin-top:14px;background:#eef7d6;border:1px solid #dcecb5;border-radius:8px;padding:8px 12px;font:800 15px/1 'Inter',sans-serif;color:#2f5312;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
        .ask-outcome-k{font:700 9.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#5f7a3a}
        .ask-actions{display:flex;gap:10px;margin-top:16px}
        .ask-note{font-size:12.5px;color:#8a927f;font-weight:600;margin-top:18px;text-align:center}

        /* 7 · teach the company */
        .teach{margin-top:54px;width:min(560px,100%);display:flex;flex-direction:column;gap:14px}
        .tch-you{margin-left:auto;width:fit-content;max-width:88%;background:#17251c;color:#f2f5ef;border-radius:16px 16px 4px 16px;padding:12px 18px;font-size:14.5px;font-weight:600;text-align:left}
        .tch-team{margin-right:auto;width:fit-content;max-width:88%;background:#fff;border:1px solid #e6e4da;border-radius:16px 16px 16px 4px;padding:11px 16px;font-size:13.5px;font-weight:600;color:#4c5347;margin-top:8px;text-align:left}

        /* 8 · the channels — the differentiator, shown with real logos */
        .channels{margin-top:44px;display:flex;flex-wrap:wrap;justify-content:center;gap:14px}
        .channel{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e6e4da;border-radius:100px;padding:12px 22px 12px 16px;box-shadow:0 18px 40px -30px rgba(23,29,24,.4)}
        .channel-logo{display:flex;align-items:center;justify-content:center;width:34px;height:34px}
        .channel-logo--mail{opacity:.9}
        .channel-name{font-size:16px;font-weight:800;letter-spacing:-.02em;color:#171d18}
        @media(max-width:480px){.channel{padding:10px 18px 10px 14px}.channel-name{font-size:14.5px}}

        /* 8 · the chat — WhatsApp/Slack */
        .chat{margin-top:34px;width:min(480px,100%);background:#fff;border:1px solid #e6e4da;border-radius:18px;overflow:hidden;box-shadow:0 40px 90px -50px rgba(23,29,24,.35);text-align:left;pointer-events:none}
        .chat-head{display:flex;align-items:center;gap:9px;background:#17251c;color:#f2f5ef;font-size:13.5px;font-weight:750;padding:13px 18px}
        .chat-dot{width:8px;height:8px;border-radius:50%;background:#dffe95;animation:pulse 2.4s ease-in-out infinite}
        .chat-body{padding:16px;display:flex;flex-direction:column;gap:9px;background:#f7f6f0}
        .cb{max-width:86%;border-radius:14px;padding:10px 14px;font-size:13.5px;line-height:1.5;color:#171d18}
        .cb b{display:block;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8a927f;margin-bottom:5px}
        .cb.them{background:#fff;border:1px solid #ecebe2;border-bottom-left-radius:4px;margin-right:auto}
        .cb.you{background:#dffe95;color:#17251c;font-weight:800;border-bottom-right-radius:4px;margin-left:auto}

        /* 9 · why different — a statement, then one honest line each */
        .why{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:150px 24px 60px}
        .why p{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(32px,5.2vw,64px);line-height:1.12;color:#171d18;max-width:22ch;text-wrap:balance;margin:0}
        .why-sub{margin-top:22px;font-size:clamp(14.5px,1.6vw,17px);font-weight:600;color:#68756b}
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

        /* ── reveal ──
           DEFAULT is fully visible: no JS, a hydration re-render, or a slow observer can EVER blank
           the page (this app's root layout occasionally re-hydrates the whole tree — visible-by-default
           is the only safe base). JS only adds .in to elements that start BELOW the fold, as they
           scroll in from the bottom edge — so the rise reads as motion and the old visible→snap-hidden
           →rise flash (what looked "broken") never happens on screen. */
        .rv{opacity:1;transform:none}
        .rv.in{animation:riseIn .65s cubic-bezier(0,0,.2,1) both;will-change:transform,opacity}
        .rv.in.d2{animation-delay:.08s}.rv.in.d3{animation-delay:.16s}
        @keyframes riseIn{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
        /* Containers of staggered children show instantly (no block slide) so the block and its items
           never double up their motion — the children carry the single, clean rise. */
        .rv.in.org,.rv.in.nightlog,.rv.in.brain,.rv.in.relay,.rv.in.teach,.rv.in.chat{animation:none}
        .rv.in .dept,.rv.in .nl,.rv.in .brain-chip,.rv.in .relay-step,.rv.in .tch,.rv.in .cb{animation:riseIn .55s cubic-bezier(0,0,.2,1) both;will-change:transform,opacity}
        /* Mobile: scroll-triggered reveals jank when many staggered children animate at once on a
           weaker GPU. Lighten it — shorter, smaller rise, and fire the children TOGETHER (no per-item
           delay cascade during the scroll) so each section settles in one smooth beat. */
        @media (max-width:640px){
          .rv.in,.rv.in .dept,.rv.in .nl,.rv.in .brain-chip,.rv.in .relay-step,.rv.in .tch,.rv.in .cb{animation-duration:.42s;animation-delay:0s!important}
          @keyframes riseIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        }
        @media (prefers-reduced-motion: reduce){
          .rv.in,.rv.in .dept,.rv.in .nl,.rv.in .brain-chip,.rv.in .relay-step,.rv.in .tch,.rv.in .cb{animation:none!important}
        }
      `}</style>
    </div>
  )
}
