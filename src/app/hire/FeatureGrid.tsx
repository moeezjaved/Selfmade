'use client'
/**
 * FeatureGrid — a Sila-style 3-up grid of compact feature cards for the rest of the suite (the big
 * four+two live in FeatureShowcase). Each card is a colorful gradient panel with a tiny mockup on top,
 * then a title, one-line description and an "Explore →" link. Reveals on scroll, visible-by-default
 * (opacity:1) so extensions can't blank it, reduced-motion safe, and collapses 3→2→1 columns.
 */
import React, { useEffect, useRef, useState } from 'react'

const INK = '#17251c'

type Feat = { eyebrow: string; title: string; desc: string; href: string; grad: string; mock: React.ReactNode }

const FEATS: Feat[] = [
  {
    eyebrow: 'The morning brief', title: 'Wake up to one report.',
    desc: 'Your company tells you what changed overnight and what actually matters — in a single morning read.',
    href: '#agreement', grad: 'linear-gradient(135deg,#fef0d3,#ffd9e6 55%,#e4dcff)',
    mock: (
      <div className="mk-brief">
        <div className="mk-b-time">7:00 AM · the brief</div>
        <div className="mk-b-row"><span className="mk-b-dot" />4 new ads ready to approve</div>
        <div className="mk-b-row"><span className="mk-b-dot" />2 rivals launched overnight</div>
      </div>
    ),
  },
  {
    eyebrow: 'The ad library', title: 'Search 3M+ winning ads.',
    desc: 'See every ad your market is running — and what’s actually working — then hand the winner to Creative.',
    href: '#agreement', grad: 'linear-gradient(135deg,#d7ecff,#e4e0ff 55%,#ffe3f1)',
    mock: (
      <div className="mk-lib">
        <div className="mk-l-bar">🔎 skincare · winners</div>
        <div className="mk-l-grid"><span /><span /><span /><span /><span /><span /></div>
      </div>
    ),
  },
  {
    eyebrow: 'Autopilot', title: 'A fresh ad, made daily.',
    desc: 'Keep your creative pipeline moving — a new ad produced every day, waiting in your brief to approve.',
    href: '#agreement', grad: 'linear-gradient(135deg,#e0f7e4,#d9f0ff 55%,#efe6ff)',
    mock: (
      <div className="mk-auto">
        <div className="mk-a-day">Mon</div><div className="mk-a-day">Tue</div>
        <div className="mk-a-day on">Wed<span className="mk-a-new">new</span></div>
        <div className="mk-a-day">Thu</div><div className="mk-a-day">Fri</div>
      </div>
    ),
  },
  {
    eyebrow: 'Creators', title: 'Find creators to film you.',
    desc: 'Discover real UGC creators for your product — reached out to and managed from first hello to shipped video.',
    href: '#agreement', grad: 'linear-gradient(135deg,#ffe6d9,#ffe0ef 55%,#e9e2ff)',
    mock: (
      <div className="mk-cre">
        {[0, 1, 2].map((i) => (
          <div className="mk-c-row" key={i}><span className="mk-c-av" /><span className="mk-c-h" /><span className="mk-c-chip">invite</span></div>
        ))}
      </div>
    ),
  },
  {
    eyebrow: 'Many brands', title: 'All your brands, one login.',
    desc: 'Manage multiple businesses from one company — each with its own brain, team and inbox.',
    href: '#agreement', grad: 'linear-gradient(135deg,#e9e2ff,#d7ecff 55%,#e0f7e4)',
    mock: (
      <div className="mk-br">
        <div className="mk-br-cur">Aura ▾</div>
        <div className="mk-br-item">Mars Men</div>
        <div className="mk-br-item">Fum</div>
        <div className="mk-br-add">+ New brand</div>
      </div>
    ),
  },
  {
    eyebrow: 'Playbooks', title: 'Learn from the best.',
    desc: 'Your AI studies what’s working in the market — teardowns of why top brands’ ads win, so your team builds on what sells.',
    href: '#agreement', grad: 'linear-gradient(135deg,#fff0d4,#ffe4ea 55%,#e2e9ff)',
    mock: (
      <div className="mk-pb">
        <div className="mk-pb-title">Why it works</div>
        <div className="mk-pb-line"><span className="mk-pb-n">1</span>Hook in the first 2s</div>
        <div className="mk-pb-line"><span className="mk-pb-n">2</span>Proof before the ask</div>
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
        <div className="fg-h-eye">And the rest of the suite</div>
        <h2 className="fg-h-title">Everything your marketing company does.</h2>
        <p className="fg-h-sub">One hire. The whole department — research, creative, media buying, customer care and more.</p>
      </div>

      <div className="fg-grid">
        {FEATS.map((f, i) => <Card f={f} i={i} key={f.title} />)}
      </div>

      <div className="fg-close">And it all reports back to you.</div>

      <style dangerouslySetInnerHTML={{ __html: `
        .fg{max-width:1120px;margin:96px auto 0;padding:0 20px}
        .fg-head{text-align:center;max-width:660px;margin:0 auto}
        .fg-h-eye{font:800 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#9aa79a}
        .fg-h-title{font-family:'Instrument Serif',Georgia,serif;font-size:clamp(30px,5vw,46px);line-height:1.04;color:${INK};margin:14px 0 0;letter-spacing:-.01em}
        .fg-h-sub{margin:14px auto 0;max-width:52ch;font-size:15.5px;line-height:1.6;color:#4c5347}

        .fg-close{text-align:center;margin-top:40px;font-family:'Instrument Serif',Georgia,serif;font-size:clamp(22px,3.2vw,32px);color:${INK};letter-spacing:-.01em}
        .fg-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:44px}
        .fg-card{display:block;text-decoration:none;background:#fff;border:1px solid rgba(17,37,28,.08);border-radius:20px;
          padding:14px 14px 22px;box-shadow:0 24px 60px -46px rgba(17,37,28,.5);opacity:1;
          animation:fg-rise .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--d) * .06s);
          transition:transform .3s ease,box-shadow .3s ease}
        .fg-card.on{}
        .fg-card:hover{transform:translateY(-5px);box-shadow:0 34px 70px -42px rgba(17,37,28,.55)}
        @keyframes fg-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}

        .fg-visual{border-radius:14px;height:172px;display:grid;place-items:center;padding:20px;overflow:hidden}
        .fg-mock{width:100%;max-width:230px;background:#fff;border-radius:12px;box-shadow:0 16px 36px -22px rgba(17,37,28,.5);padding:13px;font-family:'Inter',system-ui,sans-serif}

        .fg-eye{font:800 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#3b6d11;margin:16px 4px 0}
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

        .mk-auto{display:flex;gap:6px;align-items:flex-end}
        .mk-a-day{flex:1;text-align:center;font:700 10px/1 'Inter',sans-serif;color:#9aa79a;background:#f2f4ef;border-radius:7px;padding:12px 0}
        .mk-a-day.on{position:relative;color:#1f3d17;background:#dffe95}
        .mk-a-new{position:absolute;top:-8px;left:50%;transform:translateX(-50%);font:800 7px/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:#1f3d17;background:#fff;border:1px solid #cfe0a8;border-radius:5px;padding:2px 4px}

        .mk-cre{display:flex;flex-direction:column;gap:9px}
        .mk-c-row{display:flex;align-items:center;gap:8px}
        .mk-c-av{width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,#f0a63a,#e5732e);flex-shrink:0}
        .mk-c-row:nth-child(2) .mk-c-av{background:linear-gradient(135deg,#c07ad0,#7a5bd0)}
        .mk-c-row:nth-child(3) .mk-c-av{background:linear-gradient(135deg,#2f9e6a,#3f7bd0)}
        .mk-c-h{flex:1;height:8px;border-radius:5px;background:#eceef0}
        .mk-c-chip{font:800 8.5px/1 ui-monospace,monospace;letter-spacing:.05em;text-transform:uppercase;color:#3b6d11;background:#eaf3de;border-radius:5px;padding:4px 7px}

        .mk-br{display:flex;flex-direction:column;gap:6px}
        .mk-br-cur{font-size:12px;font-weight:800;color:#fff;background:#17251c;border-radius:8px;padding:7px 10px}
        .mk-br-item{font-size:12px;font-weight:600;color:${INK};background:#f2f4ef;border-radius:8px;padding:7px 10px}
        .mk-br-add{font-size:11.5px;font-weight:800;color:#3b6d11;background:#eaf3de;border-radius:8px;padding:7px 10px}

        .mk-pb .mk-pb-title{font:800 9px/1 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#9aa79a}
        .mk-pb-line{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:${INK};margin-top:9px}
        .mk-pb-n{width:16px;height:16px;border-radius:5px;background:#17251c;color:#dffe95;display:grid;place-items:center;font:800 9px/1 'Inter',sans-serif;flex-shrink:0}

        @media (max-width:900px){ .fg-grid{grid-template-columns:repeat(2,1fr)} }
        @media (max-width:560px){ .fg{margin-top:72px} .fg-grid{grid-template-columns:1fr;gap:14px} .fg-visual{height:158px} }
        @media (prefers-reduced-motion:reduce){ .fg-card{animation:none!important;opacity:1;transform:none} }
      ` }} />
    </section>
  )
}
