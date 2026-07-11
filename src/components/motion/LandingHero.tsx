'use client'
/**
 * Landing hero (handoff moment #6). A 6.5s loop telling the whole pitch: SPY (competitor card + radar
 * pulse) → SCAN (beam + DNA chips) → CLONE (card duplicates, product swaps in) → LAUNCH (rockets up,
 * metrics tick). 720×420 dark stage with a lime parallax dot-grid. Honors prefers-reduced-motion.
 */
import { useEffect, useState } from 'react'

const KEYFRAMES = `
@keyframes lh-grid{0%{transform:translate(0,0);}100%{transform:translate(-24px,-24px);}}
@keyframes lh-cardO{0%{opacity:0;transform:translateY(10px) scale(.95);}7%{opacity:1;transform:translateY(0) scale(1);}86%{opacity:1;transform:scale(1);}93%{opacity:0;transform:scale(.97);}100%{opacity:0;}}
@keyframes lh-ringGate{0%{opacity:1;}20%{opacity:1;}24%,100%{opacity:0;}}
@keyframes lh-ring{0%{transform:translate(-50%,-50%) scale(.4);opacity:.85;}100%{transform:translate(-50%,-50%) scale(1.7);opacity:0;}}
@keyframes lh-chipSpy{0%{opacity:0;transform:translateY(8px) scale(.8);}4%{opacity:1;transform:translateY(0) scale(1.1);}7%{transform:scale(1);}22%{opacity:1;}26%{opacity:0;transform:translateY(-4px);}100%{opacity:0;}}
@keyframes lh-scanGate{0%,23%{opacity:0;}24%{opacity:1;}45%{opacity:1;}47%,100%{opacity:0;}}
@keyframes lh-beam{0%{transform:translateY(-8px);opacity:0;}15%{opacity:1;}85%{opacity:1;}100%{transform:translateY(112px);opacity:0;}}
@keyframes lh-d1{0%,27%{opacity:0;transform:translateX(-10px) scale(.85);}32%{opacity:1;transform:translateX(0) scale(1);}66%{opacity:1;}70%{opacity:0;transform:translateX(6px);}100%{opacity:0;}}
@keyframes lh-d2{0%,30%{opacity:0;transform:translateX(-10px) scale(.85);}35%{opacity:1;transform:translateX(0) scale(1);}66%{opacity:1;}70%{opacity:0;transform:translateX(6px);}100%{opacity:0;}}
@keyframes lh-d3{0%,33%{opacity:0;transform:translateX(-10px) scale(.85);}38%{opacity:1;transform:translateX(0) scale(1);}66%{opacity:1;}70%{opacity:0;transform:translateX(6px);}100%{opacity:0;}}
@keyframes lh-chipClone{0%,47%{opacity:0;transform:translateY(8px) scale(.8);}51%{opacity:1;transform:scale(1.1);}54%{transform:scale(1);}67%{opacity:1;}70%{opacity:0;}100%{opacity:0;}}
@keyframes lh-ghost{0%,45%{opacity:0;transform:translateX(-320px) scale(.9);}50%{opacity:.3;transform:translateX(-130px) scale(.93);}57%{opacity:0;transform:translateX(-20px) scale(.99);}100%{opacity:0;}}
@keyframes lh-cardC{0%,44%{opacity:0;transform:translateX(-320px) scale(.9);}48%{opacity:1;}55%{opacity:1;transform:translateX(0) scale(1);}69%{transform:translateX(0) translateY(0) rotate(0deg) scale(1);}75%{transform:translateY(12px) rotate(-2deg) scale(1);}92%{transform:translateY(-360px) rotate(-9deg) scale(.78);opacity:1;}97%,100%{opacity:0;transform:translateY(-400px) rotate(-9deg) scale(.75);}}
@keyframes lh-cimg{0%,54%{opacity:0;}63%{opacity:1;}100%{opacity:1;}}
@keyframes lh-cbar{0%,57%{transform:scaleX(0);}66%{transform:scaleX(1);}100%{transform:scaleX(1);}}
@keyframes lh-exhaust{0%,74%{opacity:0;transform:translateX(-50%) scaleY(0);}79%{opacity:.9;transform:translateX(-50%) scaleY(1);}92%{opacity:0;transform:translateX(-50%) scaleY(1.5);}100%{opacity:0;}}
@keyframes lh-lp{0%,76%{opacity:0;transform:translate(-50%,-50%) scale(0);}80%{opacity:1;}92%{opacity:0;transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(1);}100%{opacity:0;}}
@keyframes lh-chipLaunch{0%,70%{opacity:0;transform:translateY(8px) scale(.8);}74%{opacity:1;transform:scale(1.1);}77%{transform:scale(1);}93%{opacity:1;}97%{opacity:0;}100%{opacity:0;}}
@keyframes lh-metrics{0%,69%{opacity:0;transform:translateY(10px);}74%{opacity:1;transform:translateY(0);}94%{opacity:1;}99%,100%{opacity:0;}}
@media (prefers-reduced-motion: reduce){.lh-anim{animation:none !important;opacity:1 !important;transform:none !important;}.lh-hide-static{display:none !important;}}
`
const chip = (a: string): React.CSSProperties => ({ position: 'absolute', background: '#dffe95', color: '#0e1b12', fontSize: 11, fontWeight: 800, letterSpacing: '.08em', padding: '5px 11px', borderRadius: 999, animation: a })
const dna = (top: number, a: string): React.CSSProperties => ({ position: 'absolute', left: 290, top, background: '#1a3a1a', color: '#dffe95', fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 7, animation: a })

export default function LandingHero() {
  const [m, setM] = useState({ roas: '0.0', ctr: '0.0' })
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setM({ roas: '3.2', ctr: '2.8' }); return }
    const iv = setInterval(() => {
      const t = (performance.now() / 6500) % 1
      const p = t >= 0.69 ? Math.min((t - 0.69) / 0.20, 1) : 0
      setM({ roas: (3.2 * p).toFixed(1), ctr: (2.8 * p).toFixed(1) })
    }, 70)
    return () => clearInterval(iv)
  }, [])
  return (
    <div style={{ position: 'relative', width: 720, height: 420, maxWidth: '100%', overflow: 'hidden', borderRadius: 20, background: 'radial-gradient(120% 130% at 50% -10%, #16281a 0%, #0e1b12 65%)', fontFamily: 'Inter, sans-serif' }}>
      <style>{KEYFRAMES}</style>
      <div className="lh-anim" style={{ position: 'absolute', inset: -24, backgroundImage: 'radial-gradient(rgba(223,254,149,.06) 1.4px, transparent 1.4px)', backgroundSize: '24px 24px', animation: 'lh-grid 3.5s linear infinite' }} />

      <div className="lh-anim" style={{ ...chip('lh-chipSpy 6.5s linear infinite'), left: 118, top: 70 }}>SPY</div>

      {/* original competitor card + radar ring */}
      <div className="lh-anim" style={{ position: 'absolute', left: 120, top: 112, animation: 'lh-cardO 6.5s linear infinite' }}>
        <div className="lh-anim" style={{ position: 'absolute', left: '50%', top: '50%', width: 150, height: 195, transform: 'translate(-50%,-50%)', animation: 'lh-ringGate 6.5s linear infinite' }}>
          <div className="lh-anim" style={{ position: 'absolute', left: '50%', top: '50%', width: 150, height: 150, borderRadius: '50%', border: '2px solid #dffe95', animation: 'lh-ring 1.5s ease-out infinite' }} />
        </div>
        <div style={{ position: 'relative', width: 150, height: 195, background: '#fff', borderRadius: 12, boxShadow: '0 14px 30px -12px rgba(0,0,0,.5)', overflow: 'hidden' }}>
          <div style={{ height: '56%', background: 'repeating-linear-gradient(135deg,#e6e8e3 0 10px,#dcded8 10px 20px)' }} />
          <div style={{ padding: 12 }}>
            <div style={{ height: 8, width: '82%', borderRadius: 5, background: '#1a3a1a' }} />
            <div style={{ height: 7, width: '58%', borderRadius: 4, background: '#c9ccc6', marginTop: 8 }} />
          </div>
          <div className="lh-anim" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '100%', animation: 'lh-scanGate 6.5s linear infinite' }}>
            <div className="lh-anim" style={{ position: 'absolute', left: 0, right: 0, height: 26, background: 'linear-gradient(180deg,rgba(223,254,149,0) 0%,rgba(223,254,149,.55) 50%,rgba(223,254,149,0) 100%)', boxShadow: '0 0 12px rgba(223,254,149,.6)', animation: 'lh-beam .9s ease-in-out infinite' }} />
          </div>
        </div>
      </div>

      <div className="lh-anim" style={dna(120, 'lh-d1 6.5s linear infinite')}>Hook · Problem</div>
      <div className="lh-anim" style={dna(158, 'lh-d2 6.5s linear infinite')}>Emotion · FOMO</div>
      <div className="lh-anim" style={dna(196, 'lh-d3 6.5s linear infinite')}>Angle · Before/After</div>

      <div className="lh-anim" style={{ ...chip('lh-chipClone 6.5s linear infinite'), left: 452, top: 70 }}>CLONE</div>
      <div className="lh-anim lh-hide-static" style={{ ...chip('lh-chipLaunch 6.5s linear infinite'), left: 452, top: 70 }}>LAUNCH</div>

      <div className="lh-anim lh-hide-static" style={{ position: 'absolute', left: 454, top: 112, width: 150, height: 195, borderRadius: 12, background: 'rgba(223,254,149,.18)', border: '2px solid rgba(223,254,149,.5)', animation: 'lh-ghost 6.5s linear infinite' }} />

      {/* clone card */}
      <div className="lh-anim" style={{ position: 'absolute', left: 454, top: 112, animation: 'lh-cardC 6.5s linear infinite', transformOrigin: 'center' }}>
        <div style={{ position: 'relative', width: 150, height: 195, background: '#fff', borderRadius: 12, boxShadow: '0 14px 34px -12px rgba(0,0,0,.55), 0 0 0 1.5px rgba(223,254,149,.4)', overflow: 'hidden' }}>
          <div style={{ height: '56%', position: 'relative', background: 'repeating-linear-gradient(135deg,#e6e8e3 0 10px,#dcded8 10px 20px)' }}>
            <div className="lh-anim" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(150deg,#dffe95 0%,#8fd66a 55%,#1a3a1a 120%)', animation: 'lh-cimg 6.5s linear infinite' }} />
          </div>
          <div style={{ padding: 12 }}>
            <div className="lh-anim" style={{ height: 8, width: '82%', borderRadius: 5, background: '#1a3a1a', transformOrigin: 'left', animation: 'lh-cbar 6.5s linear infinite' }} />
            <div className="lh-anim" style={{ height: 7, width: '58%', borderRadius: 4, background: '#c9ccc6', marginTop: 8, transformOrigin: 'left', animation: 'lh-cbar 6.5s linear infinite' }} />
          </div>
        </div>
        <div className="lh-anim lh-hide-static" style={{ position: 'absolute', left: '50%', top: '100%', width: 22, height: 120, background: 'linear-gradient(180deg,rgba(223,254,149,.85) 0%,rgba(223,254,149,0) 100%)', borderRadius: '0 0 40% 40%', filter: 'blur(3px)', transformOrigin: 'top', animation: 'lh-exhaust 6.5s linear infinite' }} />
        {[{ tx: '-18px', ty: '34px', c: '#dffe95' }, { tx: '16px', ty: '44px', c: '#8fbf3d' }, { tx: '2px', ty: '52px', c: '#fff' }].map((p, i) => (
          <span key={i} className="lh-anim lh-hide-static" style={{ position: 'absolute', left: '50%', top: '100%', width: 5, height: 5, borderRadius: 1, background: p.c, ['--tx' as string]: p.tx, ['--ty' as string]: p.ty, animation: 'lh-lp 6.5s linear infinite' } as React.CSSProperties} />
        ))}
      </div>

      {/* metrics */}
      <div className="lh-anim" style={{ position: 'absolute', left: 0, right: 0, bottom: 34, display: 'flex', justifyContent: 'center', gap: 14, animation: 'lh-metrics 6.5s linear infinite' }}>
        {[{ l: 'ROAS', v: `${m.roas}×` }, { l: 'CTR', v: `${m.ctr}%` }].map(x => (
          <div key={x.l} style={{ display: 'flex', alignItems: 'baseline', gap: 7, background: 'rgba(26,58,26,.55)', border: '1px solid rgba(223,254,149,.2)', padding: '9px 15px', borderRadius: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#9fb08f' }}>{x.l}</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>{x.v}</span>
            <span style={{ fontSize: 12, color: '#dffe95' }}>▲</span>
          </div>
        ))}
      </div>
    </div>
  )
}
