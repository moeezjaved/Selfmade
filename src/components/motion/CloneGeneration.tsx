'use client'
/**
 * Clone-generation wait animation (handoff moment #2 — the money moment). Shown while an ad is being
 * cloned (~15–40s). A ghost ad-card "develops": image shimmer → lime gradient fill → headline bars
 * type on → CTA pops with a spark burst → card lifts + dissolves, looping on one 4.5s clock. A JS
 * status line cycles every 2.2s. Honors prefers-reduced-motion. Drop inside the clone modal body.
 */
import { useEffect, useState } from 'react'

const STATUSES = ['Studying the hook', 'Placing your product', 'Writing the copy', 'Polishing the design']
const BURST = [
  { s: 7, c: '#dffe95', tx: '2px', ty: '-30px' }, { s: 5, c: '#c7f06e', tx: '24px', ty: '-18px' },
  { s: 7, c: '#dffe95', tx: '31px', ty: '6px' }, { s: 5, c: '#fff', tx: '20px', ty: '26px' },
  { s: 7, c: '#dffe95', tx: '-4px', ty: '32px' }, { s: 5, c: '#c7f06e', tx: '-24px', ty: '22px' },
  { s: 7, c: '#dffe95', tx: '-32px', ty: '2px' }, { s: 5, c: '#fff', tx: '-22px', ty: '-20px' },
]

const KEYFRAMES = `
@keyframes sm-shimmer { 0%,3%{transform:translateX(-160%) skewX(-14deg);opacity:0;} 6%{opacity:.95;} 16%{transform:translateX(160%) skewX(-14deg);opacity:.95;} 20%,100%{transform:translateX(160%) skewX(-14deg);opacity:0;} }
@keyframes sm-imgfill { 0%,10%{opacity:0;transform:scale(1.04);} 28%{opacity:1;transform:scale(1);} 90%{opacity:1;transform:scale(1);} 96%,100%{opacity:0;transform:scale(1);} }
@keyframes sm-bar1 { 0%,32%{transform:scaleX(0);opacity:0;} 38%{opacity:1;} 44%{transform:scaleX(1);opacity:1;} 90%{transform:scaleX(1);opacity:1;} 96%,100%{transform:scaleX(1);opacity:0;} }
@keyframes sm-bar2 { 0%,44%{transform:scaleX(0);opacity:0;} 50%{opacity:1;} 56%{transform:scaleX(1);opacity:1;} 90%{transform:scaleX(1);opacity:1;} 96%,100%{transform:scaleX(1);opacity:0;} }
@keyframes sm-cta { 0%,58%{transform:scale(0);opacity:0;} 66%{transform:scale(1.16);opacity:1;} 71%{transform:scale(1);} 90%{transform:scale(1);opacity:1;} 96%,100%{transform:scale(1);opacity:0;} }
@keyframes sm-burst { 0%,66%{transform:translate(-50%,-50%) scale(0) rotate(45deg);opacity:0;} 71%{opacity:1;} 84%{transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(1) rotate(45deg);opacity:0;} 100%{opacity:0;} }
@keyframes sm-lift { 0%,76%{transform:translateY(0);} 85%{transform:translateY(-7px);} 91%{transform:translateY(-7px);} 100%{transform:translateY(0);} }
@keyframes sm-dissolve { 0%{opacity:0;transform:scale(.965);} 4%{opacity:1;transform:scale(1);} 90%{opacity:1;transform:scale(1);} 97%{opacity:0;transform:scale(1.03);} 100%{opacity:0;} }
@keyframes sm-glow { 0%,10%{opacity:.18;} 30%{opacity:.55;} 88%{opacity:.5;} 97%,100%{opacity:0;} }
@keyframes sm-indet { 0%{left:-42%;} 100%{left:108%;} }
@keyframes sm-blink { 0%,80%,100%{opacity:.22;transform:translateY(0);} 40%{opacity:1;transform:translateY(-2px);} }
@media (prefers-reduced-motion: reduce){ .sm-anim{animation:none !important;} .sm-glow{opacity:.4 !important;} .sm-dots span{animation:none !important;opacity:.7 !important;} }
`

export default function CloneGeneration({ helper = 'This usually takes 15–40 seconds · you can keep browsing' }: { helper?: string }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => { const t = setInterval(() => setIdx(i => (i + 1) % 4), 2200); return () => clearInterval(t) }, [])
  return (
    <div style={{ fontFamily: 'Inter, sans-serif' }}>
      <style>{KEYFRAMES}</style>
      {/* indeterminate bar */}
      <div style={{ height: 3, background: '#e7e9e4', position: 'relative', overflow: 'hidden', borderRadius: 3 }}>
        <div className="sm-anim" style={{ position: 'absolute', top: 0, height: '100%', width: '42%', borderRadius: 3, background: 'linear-gradient(90deg, rgba(223,254,149,0) 0%, #dffe95 50%, rgba(223,254,149,0) 100%)', animation: 'sm-indet 1.5s cubic-bezier(.65,0,.35,1) infinite' }} />
      </div>
      {/* stage */}
      <div style={{ padding: '34px 22px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        <div className="sm-anim sm-glow" style={{ position: 'absolute', width: 260, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(223,254,149,.9) 0%, rgba(223,254,149,0) 70%)', filter: 'blur(38px)', animation: 'sm-glow 4.5s linear infinite', zIndex: 0 }} />
        <div className="sm-anim" style={{ position: 'relative', zIndex: 1, animation: 'sm-dissolve 4.5s linear infinite' }}>
          <div className="sm-anim" style={{ width: 300, maxWidth: '78vw', aspectRatio: '300 / 380', background: '#fff', borderRadius: 16, boxShadow: '0 18px 40px -14px rgba(14,27,18,.28), 0 0 0 1px rgba(14,27,18,.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'sm-lift 4.5s linear infinite' }}>
            <div style={{ height: '60%', position: 'relative', overflow: 'hidden', background: 'repeating-linear-gradient(135deg,#eef0ec 0 12px,#e7e9e4 12px 24px)' }}>
              <div className="sm-anim" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(150deg,#dffe95 0%,#8fd66a 45%,#1a3a1a 115%)', animation: 'sm-imgfill 4.5s linear infinite' }} />
              <div className="sm-anim" style={{ position: 'absolute', top: '-20%', left: 0, width: '55%', height: '140%', background: 'linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.75) 50%,rgba(255,255,255,0) 100%)', animation: 'sm-shimmer 4.5s linear infinite' }} />
            </div>
            <div style={{ flex: 1, padding: '20px 18px 18px', display: 'flex', flexDirection: 'column' }}>
              <div className="sm-anim" style={{ height: 13, width: '88%', borderRadius: 7, background: '#1a3a1a', transformOrigin: 'left', animation: 'sm-bar1 4.5s linear infinite' }} />
              <div className="sm-anim" style={{ height: 11, width: '62%', borderRadius: 6, background: '#cdd0ca', marginTop: 11, transformOrigin: 'left', animation: 'sm-bar2 4.5s linear infinite' }} />
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ position: 'relative' }}>
                  <div className="sm-anim" style={{ background: '#dffe95', color: '#0e1b12', fontSize: 13, fontWeight: 700, padding: '10px 20px', borderRadius: 999, boxShadow: '0 6px 16px -4px rgba(223,254,149,.7)', transformOrigin: 'center', animation: 'sm-cta 4.5s linear infinite' }}>Shop now</div>
                  {BURST.map((b, i) => (
                    <span key={i} className="sm-anim" style={{ position: 'absolute', top: '50%', left: '50%', width: b.s, height: b.s, borderRadius: 2, background: b.c, ['--tx' as string]: b.tx, ['--ty' as string]: b.ty, animation: 'sm-burst 4.5s linear infinite' } as React.CSSProperties} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* status cycle */}
      <div style={{ height: 22, position: 'relative', margin: '12px 22px 6px' }}>
        {STATUSES.map((text, i) => (
          <div key={i} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, transition: 'opacity .5s ease', opacity: i === idx ? 1 : 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: '#5f665b' }}>{text}</span>
            <span className="sm-dots" style={{ display: 'inline-flex', gap: 3, marginBottom: 1 }}>
              {[0, 0.18, 0.36].map(d => <span key={d} className="sm-anim" style={{ width: 4, height: 4, borderRadius: '50%', background: '#8fbf3d', display: 'inline-block', animation: `sm-blink 1.3s ease-in-out ${d}s infinite` }} />)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', padding: '2px 22px 22px', fontSize: 11.5, fontWeight: 500, color: '#a8aea2' }}>{helper}</div>
    </div>
  )
}
