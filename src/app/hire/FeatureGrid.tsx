'use client'
/**
 * FeatureGrid — the "Everything your marketing company does" section: six compact DEPARTMENT cards
 * (Research, Creative, Marketing, Customer, Intelligence, Strategy) that recap the whole company at a
 * glance and reinforce the company metaphor. Each is a colorful gradient panel with a tiny mockup on
 * top, then a department label, a one-line outcome and an "Explore →" that funnels to the signature.
 * Reveals on scroll, visible-by-default (opacity:1) so extensions can't blank it, 3→2→1 columns.
 */
import React, { useEffect, useRef, useState } from 'react'

const INK = '#17251c'

type Feat = { eyebrow: string; title: string; desc: string; href: string; grad: string; mock: React.ReactNode }

const FEATS: Feat[] = [
  {
    eyebrow: 'Research Department', title: 'Wake up to one report.',
    desc: 'Your whole company, in one morning read — what changed overnight and what needs your call.',
    href: '#agreement', grad: 'linear-gradient(135deg,#fef0d3,#ffd9e6 55%,#e4dcff)',
    mock: (
      <div className="mk-brief">
        <div className="mk-b-time">7:00 AM · the brief</div>
        <div className="mk-b-row"><span className="mk-b-dot" />4 new ads ready to approve</div>
        <div className="mk-b-row"><span className="mk-b-dot" />2 rivals moved overnight</div>
      </div>
    ),
  },
  {
    eyebrow: 'Creative Department', title: 'Make winning ads.',
    desc: 'Proven angles rebuilt as your images and videos — ready to launch, no designer needed.',
    href: '#agreement', grad: 'linear-gradient(135deg,#ffe1ef,#efe4ff 52%,#e1ecff)',
    mock: (
      <div className="mk-lib">
        <div className="mk-l-bar">✨ 4 creatives made</div>
        <div className="mk-l-grid"><span /><span /><span /><span /><span /><span /></div>
      </div>
    ),
  },
  {
    eyebrow: 'Marketing Department', title: 'Run your campaigns.',
    desc: 'Campaigns built, launched and watched on Meta — every spend with your approval.',
    href: '#agreement', grad: 'linear-gradient(135deg,#d9f0e2,#e7f0ff 58%,#f1e8ff)',
    mock: (
      <div className="mk-camp">
        <div className="mk-camp-row"><span className="mk-camp-thumb" /><div className="mk-camp-meta"><b>Campaign #24</b><span>ROAS 3.1× · scaling</span></div><span className="mk-camp-badge">live</span></div>
        <div className="mk-camp-cta"><span className="mk-camp-approve">Approve →</span></div>
      </div>
    ),
  },
  {
    eyebrow: 'Customer Department', title: 'Answer your inbox.',
    desc: 'Every WhatsApp, Instagram and email answered in your voice — nothing goes cold.',
    href: '#agreement', grad: 'linear-gradient(135deg,#ffe6d9,#ffe0ef 52%,#e9e2ff)',
    mock: (
      <div className="mk-chat">
        <div className="mk-ch them">Is this safe for sensitive skin?</div>
        <div className="mk-ch me">Yes! Gentle enough for daily use 💛</div>
        <div className="mk-ch-lab">✓ replied in your voice</div>
      </div>
    ),
  },
  {
    eyebrow: 'Intelligence', title: 'Know what competitors do.',
    desc: 'Every rival’s ads, offers and moves — tracked all night and explained in plain words.',
    href: '#agreement', grad: 'linear-gradient(135deg,#e2e9ff,#eafff2 55%,#fff1dc)',
    mock: (
      <div className="mk-spy">
        <div className="mk-spy-head">👁 Watching 12 competitors</div>
        <div className="mk-spy-row"><span className="mk-spy-av" />Country Delight <span className="mk-spy-tag">9 new ads</span></div>
        <div className="mk-spy-row"><span className="mk-spy-av alt" />Yoga Bar <span className="mk-spy-tag">new offer</span></div>
      </div>
    ),
  },
  {
    eyebrow: 'Strategy', title: 'Know what to do next.',
    desc: 'The one move worth making today — decided from what’s actually working in your market.',
    href: '#agreement', grad: 'linear-gradient(135deg,#fff0d4,#ffe4ea 55%,#e2e9ff)',
    mock: (
      <div className="mk-next">
        <div className="mk-next-lab">Do this next</div>
        <div className="mk-next-row"><span className="mk-next-n">1</span>Scale the blue ad — +$320/wk</div>
        <div className="mk-next-row"><span className="mk-next-n">2</span>Test the rival’s new hook</div>
      </div>
    ),
  },
]

function Card({ f, i }: { f: Feat; i: number }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { setOn(true); io.disconnect() } }), { rootMargin: '0px 0px -10% 0px' })
    io.observe(el); return () => io.disconnect()
  }, [])
  return (
    <a ref={ref} href={f.href} className={`fg-card${on ? ' on' : ''}`} style={{ ['--d' as any]: i }}>
      <div className="fg-visual" style={{ background: f.grad }}>
        <div className="fg-mock">{f.mock}</div>
      </div>
      <div className="fg-eye">{f.eyebrow}</div>
      <div className="fg-title">{f.title}</div>
      <div className="fg-desc">{f.desc}</div>
      <div className="fg-explore">Explore <span className="fg-arw">→</span></div>
    </a>
  )
}

export default function FeatureGrid() {
  return (
    <section className="fg">
      <div className="fg-head">
        <div className="fg-h-eye">Your departments</div>
        <h2 className="fg-h-title">Everything your marketing company does.</h2>
        <p className="fg-h-sub">Selfmade gives one founder the departments of a much bigger company — research,
        creative, marketing, customer support and strategy, all working together, around the clock.</p>
      </div>

      <div className="fg-grid">
        {FEATS.map((f, i) => <Card f={f} i={i} key={f.title} />)}
      </div>

      <div className="fg-close">And it all reports back to you.</div>

      <style dangerouslySetInnerHTML={{ __html: `
        .fg{max-width:1120px;margin:96px auto 0;padding:0 20px}
        .fg-head{text-align:center;max-width:680px;margin:0 auto}
        .fg-h-eye{font:800 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#9aa79a}
        .fg-h-title{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(30px,5vw,46px);line-height:1.04;color:${INK};margin:14px 0 0;letter-spacing:-.01em}
        .fg-h-sub{margin:14px auto 0;max-width:56ch;font-size:15.5px;line-height:1.6;color:#4c5347}

        .fg-close{text-align:center;margin-top:40px;font-family:'Instrument Serif',Georgia,serif;font-size:clamp(22px,3.2vw,32px);color:${INK};letter-spacing:-.01em}
        .fg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:44px}
        .fg-card{display:block;text-decoration:none;background:#fff;border:1px solid rgba(17,37,28,.08);border-radius:20px;
          padding:14px 14px 22px;box-shadow:0 24px 60px -46px rgba(17,37,28,.5);opacity:1;
          animation:fg-rise .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--d) * .06s);
          transition:transform .3s ease,box-shadow .3s ease}
        .fg-card:hover{transform:translateY(-5px);box-shadow:0 34px 70px -42px rgba(17,37,28,.55)}
        @keyframes fg-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}

        .fg-visual{border-radius:14px;height:172px;display:grid;place-items:center;padding:20px;overflow:hidden}
        .fg-mock{width:100%;max-width:230px;background:#fff;border-radius:12px;box-shadow:0 16px 36px -22px rgba(17,37,28,.5);padding:13px;font-family:'Inter',system-ui,sans-serif}

        .fg-eye{font:800 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#3b6d11;margin:16px 4px 0}
        .fg-title{font:800 19px/1.15 'Inter',system-ui,sans-serif;color:${INK};letter-spacing:-.01em;margin:8px 4px 0}
        .fg-desc{font-size:13.5px;line-height:1.55;color:#5a6154;margin:8px 4px 0}
        .fg-explore{margin:14px 4px 0;font-size:13px;font-weight:800;color:${INK};display:inline-flex;align-items:center;gap:6px}
        .fg-arw{transition:transform .25s ease}
        .fg-card:hover .fg-arw{transform:translateX(4px)}

        /* mini-mockups */
        .mk-brief .mk-b-time{font:700 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#9aa79a}
        .mk-b-row{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:600;color:${INK};margin-top:9px}
        .mk-b-dot{width:7px;height:7px;border-radius:50%;background:#3f8f4f;flex-shrink:0}

        .mk-lib .mk-l-bar{font-size:11px;font-weight:700;color:#4b5548;background:#f2f4ef;border-radius:8px;padding:6px 9px}
        .mk-l-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:9px}
        .mk-l-grid span{height:34px;border-radius:6px;background:linear-gradient(135deg,#cfe0f5,#e6d9f5)}
        .mk-l-grid span:nth-child(2){background:linear-gradient(135deg,#f5d9e6,#f0e2cf)}
        .mk-l-grid span:nth-child(5){background:linear-gradient(135deg,#d9f0e0,#cfe0f5)}

        .mk-camp{display:flex;flex-direction:column;gap:11px}
        .mk-camp-row{display:flex;align-items:center;gap:9px}
        .mk-camp-thumb{width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,#2f5bd0,#7a9cf0);flex-shrink:0}
        .mk-camp-meta{flex:1;display:flex;flex-direction:column}.mk-camp-meta b{font-size:12.5px;color:${INK}}.mk-camp-meta span{font-size:11px;color:#6f7a68}
        .mk-camp-badge{font:800 8.5px/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:#3b6d11;background:#eaf3de;border-radius:5px;padding:4px 7px}
        .mk-camp-approve{display:inline-block;background:${INK};color:#dffe95;border-radius:100px;padding:6px 14px;font-size:11.5px;font-weight:800}

        .mk-chat{display:flex;flex-direction:column;gap:7px}
        .mk-ch{max-width:88%;font-size:12px;line-height:1.35;border-radius:11px;padding:8px 11px}
        .mk-ch.them{background:#f2f4ef;color:${INK};align-self:flex-start;border-bottom-left-radius:4px}
        .mk-ch.me{background:#d9fdd3;color:#0b3d16;font-weight:700;align-self:flex-end;border-bottom-right-radius:4px}
        .mk-ch-lab{font:700 9px/1 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;color:#3b6d11;margin-top:2px}

        .mk-spy .mk-spy-head{font:700 10.5px/1 ui-monospace,monospace;letter-spacing:.04em;color:#4b5548;margin-bottom:9px}
        .mk-spy-row{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:${INK};margin-top:7px}
        .mk-spy-av{width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,#f0a63a,#e5732e);flex-shrink:0}
        .mk-spy-av.alt{background:linear-gradient(135deg,#3f7bd0,#7a5bd0)}
        .mk-spy-tag{margin-left:auto;font:800 8px/1 ui-monospace,monospace;letter-spacing:.04em;text-transform:uppercase;color:#8a4b00;background:#ffedcf;border-radius:5px;padding:3px 6px}

        .mk-next .mk-next-lab{font:800 9px/1 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#3b6d11}
        .mk-next-row{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:${INK};margin-top:9px}
        .mk-next-n{width:16px;height:16px;border-radius:5px;background:#17251c;color:#dffe95;display:grid;place-items:center;font:800 9px/1 'Inter',sans-serif;flex-shrink:0}

        @media (max-width:900px){ .fg-grid{grid-template-columns:repeat(2,1fr)} }
        @media (max-width:560px){ .fg{margin-top:72px} .fg-grid{grid-template-columns:1fr;gap:14px} .fg-visual{height:158px} }
        @media (prefers-reduced-motion:reduce){ .fg-card{animation:none!important;opacity:1;transform:none} }
      ` }} />
    </section>
  )
}
