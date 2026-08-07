'use client'
/**
 * App-level confirmation — replaces the browser's native window.confirm() everywhere (which renders a
 * "www.tryselfmade.ai says…" popup that looks like a scam and breaks the app's visual stack).
 *
 * Mount <ConfirmHost/> once (in AppShell, next to UpsellModalHost). From any client code:
 *   if (!(await confirmAction({ title: 'Delete this?', body: '…', danger: true }))) return
 * Returns a Promise<boolean> — true if the user confirms, false on cancel / backdrop.
 */
import { useEffect, useState } from 'react'

const EVT = 'selfmade:confirm'
const INK = '#17251c', SUB = '#6b7280'

export interface ConfirmOpts {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean   // red confirm button (default true — most confirms are destructive/spend)
}
type Payload = ConfirmOpts & { resolve: (v: boolean) => void }

export function confirmAction(opts: ConfirmOpts): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { ...opts, resolve } }))
  })
}

export default function ConfirmHost() {
  const [p, setP] = useState<Payload | null>(null)
  useEffect(() => {
    const h = (e: Event) => setP((e as CustomEvent).detail as Payload)
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])
  if (!p) return null
  const close = (v: boolean) => { try { p.resolve(v) } catch { /* noop */ } setP(null) }
  const danger = p.danger !== false
  return (
    <div onClick={() => close(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,12,0.55)', zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'cf-fade .18s ease both' }}>
      <style>{`@keyframes cf-fade{from{opacity:0}to{opacity:1}}@keyframes cf-pop{0%{opacity:0;transform:translateY(14px) scale(.97)}100%{opacity:1;transform:none}}.cf-card{animation:cf-pop .28s cubic-bezier(.2,.7,.2,1) both}`}</style>
      <div className="cf-card" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '24px 24px 20px', width: 'min(430px,96vw)', boxShadow: '0 30px 80px rgba(0,0,0,0.35)' }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: INK, letterSpacing: '-.01em' }}>{p.title}</div>
        {p.body && <div style={{ fontSize: 13.5, color: SUB, marginTop: 8, lineHeight: 1.6 }}>{p.body}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button onClick={() => close(false)} style={{ background: '#fff', color: INK, border: '1.5px solid #e2e8f0', borderRadius: 100, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{p.cancelLabel || 'Cancel'}</button>
          <button onClick={() => close(true)} style={{ background: danger ? '#c0392b' : '#17251c', color: danger ? '#fff' : '#dffe95', border: 'none', borderRadius: 100, padding: '9px 20px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>{p.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
