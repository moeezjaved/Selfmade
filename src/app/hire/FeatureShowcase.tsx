'use client'
/**
 * FeatureShowcase — Sila-style alternating feature blocks for the landing. Each block pairs copy with a
 * small ANIMATED mockup that shows the feature happening inside Selfmade, floating on a soft colorful
 * gradient. Pure CSS/React (no Remotion), reveals on scroll, reduced-motion safe, stacks on mobile.
 * Features: (1) run Facebook ads, (2) remake competitor ads into image+video, (3) the Company Brain,
 * (4) run the whole company from WhatsApp/Slack.
 */
import React, { useEffect, useRef, useState } from 'react'

const INK = '#17251c', LIME = '#dffe95', SUB = '#6f7a68'

function Block({ step, rev, eyebrow, title, desc, bullets, grad, children }: {
  step: string; rev?: boolean; eyebrow: string; title: string; desc: string; bullets: string[]; grad: string; children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { setOn(true); io.disconnect() } }), { rootMargin: '0px 0px -14% 0px' })
    io.observe(el); return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={`fs-row${rev ? ' rev' : ''}${on ? ' on' : ''}`}>
      <div className="fs-copy">
        <div className="fs-eyebrow"><span className="fs-step">{step}</span>{eyebrow}</div>
        <h3 className="fs-title">{title}</h3>
        <p className="fs-desc">{desc}</p>
        <ul className="fs-bul">{bullets.map((b) => <li key={b}><span className="fs-tick">✓</span>{b}</li>)}</ul>
      </div>
      <div className="fs-visual" style={{ background: grad }}>
        <div className="fs-card">{children}</div>
      </div>
    </div>
  )
}

export default function FeatureShowcase() {
  return (
    <section className="fs" id="work">
      <div className="fs-head">
        <div className="fs-h-eye">What your company does</div>
        <h2 className="fs-h-title">One founder. A company that never sleeps.</h2>
        {/* 5-second summary — the whole company in six verbs, before the detail. */}
        <div className="fs-glance">
          {['It remembers your company.', 'It watches your market.', 'It finds winning ideas.',
            'It makes the ads.', 'It runs your marketing.', 'It works from WhatsApp.'].map((g) => (
            <span className="fs-g" key={g}>{g}</span>
          ))}
        </div>
      </div>

      {/* 01 · REMEMBER — the brain (comes first: it's what makes them a company, not tools) */}
      <Block
        step="01"
        eyebrow="Remember"
        title="Tell it once. It remembers forever."
        desc="Tell it your product, your rules and your customers — or connect Slack, WhatsApp, email and your docs. It all becomes one company brain every department shares."
        bullets={['Shared across all departments', 'Decisions are written down', 'Gets smarter over time']}
        grad="radial-gradient(120% 120% at 10% 90%, #fff0d4, #ffe4ea 55%, #efe6ff)"
      >
        <div className="br-said">“Never discount below 15%.”<span className="br-who">— you, said once</span></div>
        <div className="br-fan">
          {['Research', 'Creative', 'Media Buying', 'Customer'].map((d, i) => (
            <div className="br-chip" key={d} style={{ ['--d' as any]: i }}><span className="br-t">✓</span>{d} remembers</div>
          ))}
        </div>
      </Block>

      {/* 02 · RESEARCH — never sleeps */}
      <Block
        step="02"
        rev
        eyebrow="Research"
        title="Research never sleeps."
        desc="While you sleep, your research department watches your market — competitors, ads, products, offers and trends — and tells you exactly what changed."
        bullets={['Tracks every rival’s ads', 'Alerts you the moment they move', 'Shows what’s working — and why']}
        grad="radial-gradient(120% 120% at 12% 12%, #e2e9ff, #eafff2 55%, #fff1dc)"
      >
        <div className="sp-head"><span className="sp-eye">👁</span> Watching 12 competitors <span className="sp-live">live</span></div>
        <div className="sp-alert">
          <div className="sp-brand"><span className="sp-av" />Country Delight</div>
          <div className="sp-line"><b>9 new ads</b> launched overnight — a real push.</div>
          <span className="sp-tag">new hook detected</span>
        </div>
        <div className="sp-cta">See their angle → <b>remake it</b></div>
      </Block>

      {/* 03 · CREATIVE — finds what works, makes it yours */}
      <Block
        step="03"
        eyebrow="Creative"
        title="It finds what works — then makes it yours."
        desc="It finds winning ads, understands why they work, then creates new images and videos for your brand — in minutes. No designer, no filming."
        bullets={['Image ads · $0.15', 'UGC-style video · $6', 'Their proven angle, your product']}
        grad="radial-gradient(120% 120% at 85% 0%, #ffe1ef, #efe4ff 52%, #e1ecff)"
      >
        <div className="rm">
          <div className="rm-side">
            <div className="rm-lab">Their ad</div>
            <div className="rm-box rm-them" />
          </div>
          <div className="rm-arrow">→</div>
          <div className="rm-side">
            <div className="rm-lab">Yours</div>
            <div className="rm-box rm-you"><span className="rm-badge">rebuilt</span></div>
          </div>
        </div>
        <div className="rm-status">Rebuilding in your brand… <b>done ✓</b></div>
      </Block>

      {/* 04 · ADVERTISING — runs your Facebook ads (give it the brief, not another ads manager) */}
      <Block
        step="04"
        rev
        eyebrow="Marketing"
        title="Your marketing department runs your ads."
        desc="Create campaigns, choose the creative, launch ads and monitor what happens — all with your approval. Not another ads manager to learn."
        bullets={['Builds campaigns + picks creative', 'Launches and monitors on Meta', 'Nothing spends without your yes']}
        grad="radial-gradient(120% 120% at 15% 10%, #d9f0e2, #e7f0ff 58%, #f1e8ff)"
      >
        <div className="ad-row">
          <div className="ad-thumb" />
          <div className="ad-meta"><b>picture ads</b><span>€20/day · ROAS 3.1×</span></div>
          <div className="ad-badge">winner</div>
        </div>
        <div className="ad-move">
          <span className="ad-move-t">Scale budget +20% <b>· est. +$320/wk</b></span>
        </div>
        <div className="ad-cta"><span className="ad-approve">Approve →</span><span className="ad-live">✓ Live on Meta</span></div>
      </Block>

      {/* 05 · COMMUNICATION — talk to your company from WhatsApp (ask it anything, it answers + acts) */}
      <Block
        step="05"
        eyebrow="Communication"
        title="Run the whole company from WhatsApp."
        desc="No dashboard to log into. Ask your company anything, right where you already are — it answers with the numbers, tells you what it found, and does the work when you say go."
        bullets={['WhatsApp · Slack · Email', 'Ask a question, get a real answer', 'Approve the work with one word']}
        grad="radial-gradient(120% 120% at 90% 90%, #d7ecff, #e2fbef 55%, #eef7d6)"
      >
        <div className="wa">
          <div className="wa-head"><span className="wa-dot" /> WhatsApp · Mello</div>
          <div className="wa-msg me">Mello, what happened last night?</div>
          <div className="wa-msg them">3 competitors launched new offers. I found <b>11 new winning ads</b>, made 4 creatives, and your best opportunity is ready for approval.</div>
          <div className="wa-msg me">approve</div>
          <div className="wa-msg them">✓ Launching now. Full brief in the morning.</div>
        </div>
      </Block>

      {/* 06 · COMPANY MEMORY — every conversation becomes company knowledge */}
      <Block
        step="06"
        rev
        eyebrow="Company memory"
        title="Your conversations become company knowledge."
        desc="Connect Slack, WhatsApp, email, customer support and your documents. Mello remembers what your company knows — so every department gets smarter over time."
        bullets={['Answers customers in your voice', 'Turns chats into company memory', 'Every department draws on it']}
        grad="radial-gradient(120% 120% at 88% 12%, #ffe6d9, #ffe0ef 52%, #e9e2ff)"
      >
        <div className="ci-msg them"><b>Aisha</b>Is the serum safe while pregnant? 🤰</div>
        <div className="ci-draft">
          <div className="ci-lab">Draft reply · your voice</div>
          <div className="ci-body">Hi Aisha! Yes — it’s pregnancy-safe. Want me to send your usual routine? 💛</div>
          <div className="ci-cta"><span className="ci-send">Send →</span><span className="ci-edit">Edit</span></div>
        </div>
      </Block>

      <style dangerouslySetInnerHTML={{ __html: `
        .fs{max-width:1080px;margin:40px auto 0;padding:0 20px;display:flex;flex-direction:column;gap:80px}
        .fs-head{text-align:center;max-width:640px;margin:0 auto}
        .fs-h-eye{font:800 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#9aa79a}
        .fs-h-title{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(30px,5vw,46px);line-height:1.04;color:${INK};margin:14px 0 0;letter-spacing:-.01em}
        /* 5-second summary — the whole company in six short verbs. */
        .fs-glance{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 10px;margin:24px auto 0;max-width:600px}
        .fs-g{font-size:13px;font-weight:650;color:#3d4a3f;background:#fff;border:1px solid rgba(17,37,28,.1);border-radius:100px;padding:7px 14px;box-shadow:0 2px 5px rgba(17,37,28,.03)}

        .fs-row{display:grid;grid-template-columns:1fr 1.05fr;gap:44px;align-items:center}
        .fs-row.rev .fs-copy{order:2}.fs-row.rev .fs-visual{order:1}
        .fs-copy{opacity:1}
        .fs-row.on .fs-copy{animation:fs-rise .6s cubic-bezier(0,0,.2,1) both}
        .fs-eyebrow{display:inline-flex;align-items:center;gap:10px;font:800 10.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#3b6d11}
        .fs-step{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:7px;background:${INK};color:${LIME};font-size:10px;font-weight:900;letter-spacing:0}
        .fs-title{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(26px,3.6vw,38px);line-height:1.06;color:${INK};margin:12px 0 12px;letter-spacing:-.01em}
        .fs-desc{font-size:15.5px;line-height:1.6;color:#4b5548;margin:0 0 16px;max-width:440px}
        .fs-bul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}
        .fs-bul li{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:600;color:${INK}}
        .fs-tick{width:18px;height:18px;border-radius:50%;background:#eaf3de;color:#3b6d11;display:grid;place-items:center;font-size:10px;font-weight:900;flex-shrink:0}

        .fs-visual{border-radius:22px;padding:34px;display:grid;place-items:center;min-height:300px;opacity:1}
        .fs-row.on .fs-visual{animation:fs-pop .7s cubic-bezier(.2,.7,.2,1) both;animation-delay:.08s}
        .fs-card{background:#fff;border-radius:16px;box-shadow:0 30px 70px -34px rgba(20,30,22,.5),0 2px 6px rgba(20,30,22,.05);padding:18px;width:100%;max-width:400px;display:flex;flex-direction:column;gap:12px}

        @keyframes fs-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        @keyframes fs-pop{from{opacity:0;transform:translateY(20px) scale(.985)}to{opacity:1;transform:none}}
        @keyframes fs-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

        /* 1 · ADS */
        .ad-row{display:flex;align-items:center;gap:11px}
        .ad-thumb{width:44px;height:44px;border-radius:9px;background:linear-gradient(135deg,#2f5bd0,#7a9cf0);flex-shrink:0}
        .ad-meta{flex:1;display:flex;flex-direction:column}.ad-meta b{font-size:14px;color:${INK}}.ad-meta span{font-size:12px;color:${SUB}}
        .ad-badge{font:800 9.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;color:#3b6d11;background:#eaf3de;border-radius:6px;padding:4px 8px}
        .ad-move{background:#f6f8f2;border:1px solid #e6ece0;border-radius:11px;padding:10px 12px}
        .ad-move-t{font-size:13px;color:${INK}}.ad-move-t b{color:#3b6d11}
        .ad-cta{display:flex;align-items:center;gap:12px}
        .ad-approve{background:${INK};color:${LIME};border-radius:100px;padding:8px 18px;font-size:12.5px;font-weight:800;opacity:1;transition:none}
        .fs-row.on .ad-approve{animation:ad-fade .5s ease forwards;animation-delay:1.5s}
        @keyframes ad-fade{to{opacity:.25;transform:scale(.96)}}
        .ad-live{font-size:13px;font-weight:800;color:#2f9e6a;opacity:1}
        .fs-row.on .ad-live{animation:fs-in .5s ease forwards;animation-delay:1.7s}

        /* 2 · REMAKE */
        .rm{display:flex;align-items:center;gap:12px;justify-content:center}
        .rm-side{display:flex;flex-direction:column;align-items:center;gap:7px}
        .rm-lab{font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${SUB}}
        .rm-box{width:104px;height:130px;border-radius:11px;position:relative}
        .rm-them{background:linear-gradient(135deg,#c9ccd6,#9aa0b0)}
        .rm-you{background:linear-gradient(135deg,#7a9856,#3f8f4f);opacity:1}
        .fs-row.on .rm-you{animation:fs-pop .6s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:1s}
        .rm-badge{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font:800 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;color:#1f3d17;background:${LIME};border-radius:6px;padding:3px 7px;white-space:nowrap}
        .rm-arrow{font-size:22px;color:#b6bcae;font-weight:800;opacity:1}
        .fs-row.on .rm-arrow{animation:fs-in .5s ease forwards;animation-delay:.7s}
        .rm-status{text-align:center;font-size:12.5px;color:${SUB}}.rm-status b{color:#2f9e6a}

        /* 3 · BRAIN */
        .br-said{background:#17251c;color:#eef5df;border-radius:12px;padding:13px 15px;font-size:14.5px;font-weight:600;line-height:1.4}
        .br-who{display:block;font:700 9.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8ea08c;margin-top:7px}
        .br-fan{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        .br-chip{display:flex;align-items:center;gap:7px;background:#f6f8f2;border:1px solid #e6ece0;border-radius:9px;padding:8px 10px;font-size:12.5px;font-weight:650;color:${INK};opacity:1}
        .fs-row.on .br-chip{animation:fs-in .45s ease forwards;animation-delay:calc(.8s + var(--d) * .22s)}
        .br-t{width:16px;height:16px;border-radius:50%;background:#eaf3de;color:#3b6d11;display:grid;place-items:center;font-size:9px;font-weight:900;flex-shrink:0}

        /* 4 · WHATSAPP */
        .wa{display:flex;flex-direction:column;gap:9px}
        .wa-head{display:flex;align-items:center;gap:7px;font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:${SUB};margin-bottom:2px}
        .wa-dot{width:8px;height:8px;border-radius:50%;background:#25d366}
        .wa-msg{max-width:86%;border-radius:13px;padding:9px 13px;font-size:13.5px;line-height:1.4;opacity:1}
        .fs-row.on .wa-msg{animation:fs-in .5s ease forwards}
        .wa-msg.them{background:#f2f4ef;color:${INK};align-self:flex-start;border-bottom-left-radius:5px}
        .wa-msg.them b{color:#2f9e6a}
        .wa-msg.me{background:#d9fdd3;color:#0b3d16;font-weight:800;align-self:flex-end;border-bottom-right-radius:5px}
        .fs-row.on .wa-msg:nth-child(2){animation-delay:.6s}
        .fs-row.on .wa-msg:nth-child(3){animation-delay:1.2s}
        .fs-row.on .wa-msg:nth-child(4){animation-delay:1.8s}
        .fs-row.on .wa-msg:nth-child(5){animation-delay:2.4s}

        /* 5 · SPY */
        .sp-head{display:flex;align-items:center;gap:7px;font:700 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;color:${SUB}}
        .sp-eye{font-size:14px}
        .sp-live{margin-left:auto;color:#c0392b;background:#fdecea;border-radius:6px;padding:3px 7px;font-size:9.5px;letter-spacing:.06em}
        .sp-alert{background:#f6f8f2;border:1px solid #e6ece0;border-radius:12px;padding:12px 13px;display:flex;flex-direction:column;gap:6px;opacity:1}
        .fs-row.on .sp-alert{animation:fs-pop .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:.7s}
        .sp-brand{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:800;color:${INK}}
        .sp-av{width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,#f0a63a,#e5732e);flex-shrink:0}
        .sp-line{font-size:13px;color:#4b5548}.sp-line b{color:${INK}}
        .sp-tag{align-self:flex-start;font:800 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;color:#8a4b00;background:#ffedcf;border-radius:6px;padding:4px 8px}
        .sp-cta{font-size:13px;color:${SUB};text-align:center}.sp-cta b{color:#3b6d11}

        /* 6 · CUSTOMER INBOX */
        .ci-msg{max-width:88%;border-radius:13px;padding:9px 13px;font-size:13.5px;line-height:1.4;background:#f2f4ef;color:${INK};align-self:flex-start;border-bottom-left-radius:5px}
        .ci-msg b{display:block;font:700 9.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${SUB};margin-bottom:4px}
        .ci-draft{border:1px dashed #cfe0a8;background:#fbfdf4;border-radius:13px;padding:11px 13px;opacity:1}
        .fs-row.on .ci-draft{animation:fs-pop .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:.9s}
        .ci-lab{font:800 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#3b6d11;margin-bottom:6px}
        .ci-body{font-size:13.5px;line-height:1.45;color:${INK}}
        .ci-cta{display:flex;align-items:center;gap:12px;margin-top:10px}
        .ci-send{background:${INK};color:${LIME};border-radius:100px;padding:7px 16px;font-size:12px;font-weight:800}
        .ci-edit{font-size:12.5px;font-weight:700;color:${SUB}}

        @media (max-width:820px){
          .fs{gap:56px}
          .fs-row{grid-template-columns:1fr;gap:22px}
          .fs-row.rev .fs-copy{order:1}.fs-row.rev .fs-visual{order:2}
          .fs-visual{min-height:0;padding:26px}
          .fs-desc{max-width:none}
        }
        @media (prefers-reduced-motion:reduce){
          .fs-copy,.fs-visual,.ad-live,.rm-you,.rm-arrow,.br-chip,.wa-msg,.sp-alert,.ci-draft{animation:none!important;opacity:1;transform:none}
          .ad-approve{animation:none!important;opacity:1}
        }
      ` }} />
    </section>
  )
}
