'use client'
/**
 * Logo intro (handoff moment #1). The italic "S" draws on like a signature, a lime rounded square
 * stamps in behind it, then "selfmade" rises letter-by-letter. Full-screen boot splash — shown once
 * per session on login → dashboard. Auto-dismisses after the sequence; honors prefers-reduced-motion.
 */
import { useEffect, useState } from 'react'

const WORD = 'selfmade'.split('')
const KEYFRAMES = `
@keyframes li-draw { from{stroke-dashoffset:240;} to{stroke-dashoffset:0;} }
@keyframes li-strokeFade { 0%{opacity:1;} 100%{opacity:0;} }
@keyframes li-fillIn { 0%{opacity:0;} 100%{opacity:1;} }
@keyframes li-stamp { 0%{transform:scale(.82);opacity:0;} 55%{opacity:1;} 100%{transform:scale(1);opacity:1;} }
@keyframes li-glow { 0%{opacity:0;transform:translateY(-50%) scale(.7);} 100%{opacity:.5;transform:translateY(-50%) scale(1);} }
@keyframes li-rise { 0%{opacity:0;transform:translateY(14px);} 100%{opacity:1;transform:translateY(0);} }
@keyframes li-fadeout { to { opacity:0; visibility:hidden; } }
@media (prefers-reduced-motion: reduce){ .li-anim{animation:none !important;} .li-draw-path{stroke-dashoffset:0 !important;} }
`
const S_PATH = 'M66,30 C66,21 50,18 42,24 C33,30 34,42 48,47 C62,52 65,61 59,70 C53,79 38,80 30,72'

export default function LogoIntro({ onDone }: { onDone?: () => void }) {
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => { setGone(true); onDone?.() }, 2600)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div aria-hidden style={{
      position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, sans-serif', background: 'radial-gradient(120% 120% at 50% 40%, #14251a 0%, #0e1b12 70%)',
      animation: gone ? 'li-fadeout .4s ease forwards' : undefined, pointerEvents: gone ? 'none' : 'auto',
    }}>
      <style>{KEYFRAMES}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, position: 'relative' }}>
        <div className="li-anim" style={{ position: 'absolute', left: -10, top: '50%', width: 230, height: 230, transform: 'translateY(-50%)', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,90,44,.85) 0%, rgba(255,90,44,0) 70%)', filter: 'blur(30px)', opacity: 0.5, animation: 'li-glow .5s ease .9s both', zIndex: 0 }} />
        <div style={{ position: 'relative', width: 96, height: 96, flex: '0 0 auto', zIndex: 1 }}>
          <div className="li-anim" style={{ position: 'absolute', inset: 0, borderRadius: 21, background: '#ff5a2c', boxShadow: '0 10px 30px -8px rgba(255,90,44,.55)', transformOrigin: 'center', animation: 'li-stamp .45s cubic-bezier(.34,1.56,.64,1) .9s both' }} />
          <svg viewBox="0 0 96 96" width={96} height={96} fill="none" style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
            <path className="li-anim li-draw-path" d={S_PATH} stroke="#ff5a2c" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={240} strokeDashoffset={240} style={{ opacity: 0, animation: 'li-draw .85s ease-in-out .15s both, li-strokeFade .18s linear .95s both' }} />
            <path className="li-anim" d={S_PATH} stroke="#0e1b12" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 1, animation: 'li-fillIn .25s ease .95s both' }} />
          </svg>
        </div>
        <div style={{ display: 'flex', zIndex: 1 }}>
          {WORD.map((c, i) => (
            <span key={i} className="li-anim" style={{ fontSize: 56, fontWeight: 800, letterSpacing: '-.03em', color: '#fff', display: 'inline-block', animation: 'li-rise .4s cubic-bezier(.2,.85,.3,1) both', animationDelay: `${(1.3 + i * 0.04).toFixed(2)}s` }}>{c}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
