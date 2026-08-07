'use client'
/**
 * HqMockup — an animated "product screenshot" for the landing page: the Selfmade workspace as a real
 * app (departments in the rail + a Team channel where your AI employees post their work and you approve).
 * Pure CSS/React (no Remotion runtime) so it's sharp on retina, responsive, theme-agnostic and fast —
 * Remotion is for rendering downloadable videos, not a live hero. The chat streams in on scroll, once.
 */
import React, { useEffect, useRef, useState } from 'react'

const FOREST = '#12211a', LIME = '#dffe95', INK = '#17251c', SUB = '#8a927f'

type Msg = { who: string; role: string; text: string; chip?: string; you?: boolean; approve?: boolean; tone?: string }
const MSGS: Msg[] = [
  { who: 'Research', role: 'RESEARCH', text: 'Country Delight launched 9 new ads overnight — a real push, not rotation.', chip: '1,001 ads read' },
  { who: 'Creative', role: 'CREATIVE', text: 'Rebuilt the top 3 in your brand. Concept B is the strongest.', chip: '4 drafts ready' },
  { who: 'Media Buying', role: 'MEDIA BUYING', text: 'Ready to scale the blue ad — 3.1× return. Move budget onto it? est. +$320/week.', tone: 'ask' },
  { who: 'Finance', role: 'FINANCE', text: 'Worth it — margin holds at that spend.' },
  { who: 'Mello', role: 'MELLO', text: 'That’s the plan. Approve?', approve: true },
  { who: 'You', role: 'YOU', text: 'yes', you: true },
  { who: 'Media Buying', role: 'MEDIA BUYING', text: '✓ Done. It’s live. Full report in the morning.' },
]

const DEPTS = [
  { name: 'Research', status: 'on duty', dot: '#3f8f4f' },
  { name: 'Creative', status: '4 drafts', dot: '#c99a2e' },
  { name: 'Media Buying', status: 'asks first', dot: '#3f8f4f' },
  { name: 'Finance', status: 'tracking', dot: '#6b7a63' },
  { name: 'Customer', status: 'inbox clear', dot: '#3f8f4f' },
]

export default function HqMockup() {
  const ref = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { setOn(true); io.disconnect() } }), { rootMargin: '0px 0px -12% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className="hq-wrap">
      <div className={`hq${on ? ' on' : ''}`} role="img" aria-label="The Selfmade workspace — your AI departments reporting their work and you approving.">
        {/* rail */}
        <aside className="hq-rail">
          <div className="hq-brand"><span className="hq-logo">S</span> Selfmade</div>
          <div className="hq-ws">Acme <span className="hq-ws-c">▾</span></div>
          <div className="hq-sec">Departments</div>
          {DEPTS.map((d) => (
            <div className="hq-dept" key={d.name}>
              <span className="hq-dot" style={{ background: d.dot }} />
              <span className="hq-dept-n">{d.name}</span>
              <span className="hq-dept-s">{d.status}</span>
            </div>
          ))}
          <div className="hq-sec" style={{ marginTop: 14 }}>Workspace</div>
          <div className="hq-nav">📥 Inbox</div>
          <div className="hq-nav">🎯 Spy</div>
          <div className="hq-nav">🎬 Studio</div>
        </aside>

        {/* channel */}
        <section className="hq-main">
          <header className="hq-head">
            <div><span className="hq-hash">#</span> Team</div>
            <div className="hq-live"><span className="hq-live-dot" /> live</div>
          </header>
          <div className="hq-chat">
            {MSGS.map((m, i) => (
              <div className={`hq-msg${m.you ? ' me' : ''}`} key={i} style={{ ['--i' as any]: i }}>
                {!m.you && <span className="hq-av" data-r={m.role}>{m.who[0]}</span>}
                <div className={`hq-bub${m.you ? ' me' : ''}${m.tone === 'ask' ? ' ask' : ''}`}>
                  {!m.you && <div className="hq-role">{m.role}</div>}
                  <div className="hq-txt">{m.text}</div>
                  {m.chip && <span className="hq-chip">✓ See my work · {m.chip}</span>}
                  {m.approve && <span className="hq-approve">Approve →</span>}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="hq-cap">Your company, in one screen. Nothing ships without your yes.</div>

      <style dangerouslySetInnerHTML={{ __html: `
        .hq-wrap{position:relative;max-width:1040px;margin:16px auto 0;padding:36px 20px 0}
        /* Sila-style colorful gradient glow behind the product screenshot. */
        .hq-wrap::before{content:'';position:absolute;left:50%;top:0;transform:translateX(-50%);
          width:min(112%,1180px);height:100%;z-index:0;border-radius:36px;pointer-events:none;
          background:
            radial-gradient(60% 70% at 18% 12%, rgba(255,196,120,.55), transparent 60%),
            radial-gradient(60% 70% at 82% 8%, rgba(150,190,255,.6), transparent 60%),
            radial-gradient(70% 80% at 88% 92%, rgba(206,150,255,.55), transparent 62%),
            radial-gradient(70% 80% at 8% 90%, rgba(150,255,205,.5), transparent 62%),
            radial-gradient(90% 90% at 50% 50%, rgba(223,254,149,.35), transparent 70%);
          filter:blur(46px);opacity:.9}
        .hq{position:relative;z-index:1;display:grid;grid-template-columns:230px 1fr;background:#fff;border:1px solid rgba(17,37,28,.08);border-radius:18px;overflow:hidden;box-shadow:0 40px 90px -50px rgba(17,37,28,.5),0 2px 6px rgba(17,37,28,.04);min-height:430px;opacity:1}
        .hq.on{animation:hq-rise .7s cubic-bezier(0,0,.2,1) both}
        @keyframes hq-rise{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}

        .hq-rail{background:${FOREST};color:#cdd8cd;padding:16px 14px;display:flex;flex-direction:column;gap:3px}
        .hq-brand{display:flex;align-items:center;gap:8px;font-weight:800;color:#fff;font-size:15px;letter-spacing:-.01em}
        .hq-logo{width:22px;height:22px;border-radius:7px;background:${LIME};color:${FOREST};display:grid;place-items:center;font-weight:900;font-size:13px}
        .hq-ws{margin:12px 0 6px;background:rgba(255,255,255,.06);border-radius:9px;padding:8px 10px;font-weight:700;color:#fff;font-size:13px;display:flex;justify-content:space-between}
        .hq-ws-c{color:#8ea08c}
        .hq-sec{font:800 9.5px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#6f8070;margin:10px 6px 5px}
        .hq-dept{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}
        .hq-dept:hover{background:rgba(255,255,255,.05)}
        .hq-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
        .hq-dept-n{font-size:13px;color:#e7efe6;font-weight:600;flex:1}
        .hq-dept-s{font-size:10px;color:#7f9080;font-weight:600}
        .hq-nav{padding:6px 8px;border-radius:8px;font-size:13px;color:#cdd8cd}

        .hq-main{display:flex;flex-direction:column;background:#fbfcf9}
        .hq-head{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid rgba(17,37,28,.07);font-weight:800;color:${INK};font-size:15px}
        .hq-hash{color:#9aa79a}
        .hq-live{display:flex;align-items:center;gap:6px;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase;color:#3f8f4f}
        .hq-live-dot{width:7px;height:7px;border-radius:50%;background:#3f8f4f;animation:hq-pulse 2.2s ease-in-out infinite}
        @keyframes hq-pulse{0%,100%{opacity:.4}50%{opacity:1}}

        .hq-chat{padding:18px 20px;display:flex;flex-direction:column;gap:13px;flex:1}
        .hq-msg{display:flex;gap:11px;align-items:flex-start;opacity:1}
        .hq.on .hq-msg{animation:hq-msg-in .5s cubic-bezier(0,0,.2,1) both;animation-delay:calc(.55s + var(--i) * .55s)}
        @keyframes hq-msg-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .hq-msg.me{flex-direction:row-reverse}
        .hq-av{width:30px;height:30px;border-radius:9px;flex-shrink:0;display:grid;place-items:center;font-weight:800;font-size:13px;color:#fff;background:#5b6f57}
        .hq-av[data-r="RESEARCH"]{background:#3f7bd0}.hq-av[data-r="CREATIVE"]{background:#c07ad0}.hq-av[data-r="MEDIA BUYING"]{background:#2f9e6a}.hq-av[data-r="FINANCE"]{background:#c99a2e}.hq-av[data-r="MELLO"]{background:${INK}}
        .hq-bub{background:#fff;border:1px solid rgba(17,37,28,.08);border-radius:13px;padding:9px 13px;max-width:78%;box-shadow:0 1px 2px rgba(17,37,28,.03)}
        .hq-bub.ask{border-color:#cfe0a8;background:#fbfdf4}
        .hq-bub.me{background:${INK};color:${LIME};border:none;font-weight:800;padding:8px 16px}
        .hq-role{font:800 9px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;color:${SUB};margin-bottom:4px}
        .hq-txt{font-size:13.5px;line-height:1.45;color:${INK}}
        .hq-bub.me .hq-txt{color:${LIME}}
        .hq-chip{display:inline-flex;align-items:center;gap:5px;margin-top:8px;background:#eef4e4;color:#3b6d11;border-radius:7px;padding:3px 9px;font:700 10.5px/1.3 'Inter',sans-serif}
        .hq-approve{display:inline-block;margin-top:9px;background:${INK};color:${LIME};border-radius:100px;padding:6px 15px;font-size:12px;font-weight:800}
        .hq-cap{position:relative;z-index:1;text-align:center;font-size:13px;color:${SUB};margin-top:16px;font-weight:600}

        @media (max-width:760px){
          .hq{grid-template-columns:1fr}
          .hq-rail{display:none}
          .hq-bub{max-width:88%}
        }
        @media (prefers-reduced-motion:reduce){
          .hq,.hq.on .hq-msg{animation:none!important;opacity:1;transform:none}
        }
      ` }} />
    </div>
  )
}
