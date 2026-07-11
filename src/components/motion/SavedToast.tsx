'use client'
/**
 * Save-success payoff (handoff moment #4). A dark-green "✓ Saved to Board" pill slides up with a lime
 * ring pulse + confetti burst around the check. Fire it imperatively from any save handler:
 *   import { showSavedToast } from '@/components/motion/SavedToast'; showSavedToast('Saved to Board')
 * Mount <SavedToastHost /> once (in the dashboard layout). Honors prefers-reduced-motion.
 */
import { useEffect, useState } from 'react'

export function showSavedToast(label = 'Saved to Board') {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sm:saved', { detail: { label } }))
}

const CONFETTI = [
  { tx: '0px', ty: '-22px', c: '#dffe95', d: '0s' }, { tx: '20px', ty: '-8px', c: '#1a3a1a', d: '.04s' },
  { tx: '15px', ty: '16px', c: '#dffe95', d: '.02s' }, { tx: '-16px', ty: '14px', c: '#fff', d: '.06s' },
  { tx: '-20px', ty: '-9px', c: '#8fbf3d', d: '0s' },
]
const KEYFRAMES = `
@keyframes sv-toast { 0%{opacity:0;transform:translate(-50%,12px);} 12%{opacity:1;transform:translate(-50%,0);} 84%{opacity:1;transform:translate(-50%,0);} 100%{opacity:0;transform:translate(-50%,-5px);} }
@keyframes sv-ring { 0%{transform:translate(-50%,-50%) scale(.3);opacity:.9;} 100%{transform:translate(-50%,-50%) scale(2.6);opacity:0;} }
@keyframes sv-confetti { 0%{transform:translate(-50%,-50%) scale(0);opacity:0;} 25%{opacity:1;} 100%{transform:translate(calc(-50% + var(--tx)),calc(-50% + var(--ty))) scale(1);opacity:0;} }
@keyframes sv-catch { 0%{transform:scale(1);} 35%{transform:scale(1.38);} 60%{transform:scale(.92);} 100%{transform:scale(1);} }
@media (prefers-reduced-motion: reduce){ .sv-anim{animation-duration:.01s !important;} .sv-confetti,.sv-ring{display:none !important;} }
`

export function SavedToastHost() {
  const [toast, setToast] = useState<{ label: string; key: number } | null>(null)
  useEffect(() => {
    const on = (e: Event) => setToast({ label: (e as CustomEvent).detail?.label || 'Saved to Board', key: Date.now() })
    window.addEventListener('sm:saved', on)
    return () => window.removeEventListener('sm:saved', on)
  }, [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 1700); return () => clearTimeout(t) }, [toast])
  if (!toast) return null
  return (
    <div key={toast.key} style={{ position: 'fixed', left: '50%', bottom: 34, zIndex: 9998, display: 'flex', alignItems: 'center', gap: 8, background: '#0e1b12', padding: '9px 16px 9px 12px', borderRadius: 999, boxShadow: '0 12px 30px -10px rgba(0,0,0,.5)', fontFamily: 'Inter, sans-serif', animation: 'sv-toast 1.6s ease both' }}>
      <style>{KEYFRAMES}</style>
      <span className="sv-anim" style={{ position: 'relative', width: 18, height: 18, borderRadius: '50%', background: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center', transformOrigin: 'center', animation: 'sv-catch .5s cubic-bezier(.34,1.56,.64,1) both' }}>
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none"><path d="M1.5 5.2l2.2 2.3L8.5 2.5" stroke="#0e1b12" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="sv-ring" style={{ position: 'absolute', top: '50%', left: '50%', width: 24, height: 24, borderRadius: '50%', border: '2px solid #dffe95', animation: 'sv-ring .6s ease-out both' }} />
        {CONFETTI.map((c, i) => (
          <span key={i} className="sv-confetti" style={{ position: 'absolute', top: '50%', left: '50%', width: 5, height: 5, borderRadius: 1, background: c.c, ['--tx' as string]: c.tx, ['--ty' as string]: c.ty, animation: `sv-confetti .6s ease-out ${c.d} both` } as React.CSSProperties} />
        ))}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#f6f7f5' }}>{toast.label}</span>
    </div>
  )
}
