'use client'
/**
 * App-level confirmation & text-prompt — replaces the browser's native window.confirm()/prompt()
 * everywhere (which render a "www.tryselfmade.ai says…" popup that looks like a scam and breaks the
 * app's visual stack).
 *
 * Mount <ConfirmHost/> once (in AppShell, next to UpsellModalHost). From any client code:
 *   if (!(await confirmAction({ title: 'Delete this?', body: '…', danger: true }))) return
 *   const name = await promptText({ title: 'Preset name?', placeholder: 'My preset' }); if (!name) return
 * confirmAction returns Promise<boolean>; promptText returns Promise<string|null> (null on cancel).
 */
import { useEffect, useRef, useState } from 'react'

const EVT = 'selfmade:confirm'
const INK = '#17251c', SUB = '#6b7280'

export interface ConfirmOpts {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean   // red confirm button (default true — most confirms are destructive/spend)
  input?: boolean          // when true, render a text field and resolve with the string
  placeholder?: string
  defaultValue?: string
}
type Payload = ConfirmOpts & { resolve: (v: any) => void }

export function confirmAction(opts: ConfirmOpts): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { ...opts, resolve } }))
  })
}

// Text-input dialog. Resolves with the trimmed string, or null on cancel / empty.
export function promptText(opts: Omit<ConfirmOpts, 'danger'>): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { ...opts, input: true, danger: false, resolve } }))
  })
}

export default function ConfirmHost() {
  const [p, setP] = useState<Payload | null>(null)
  const [val, setVal] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as Payload
      setVal(d.defaultValue || '')
      setP(d)
    }
    window.addEventListener(EVT, h)
    return () => window.removeEventListener(EVT, h)
  }, [])
  useEffect(() => { if (p?.input) setTimeout(() => inputRef.current?.focus(), 40) }, [p])
  if (!p) return null
  const isInput = !!p.input
  const close = (v: boolean) => {
    try { p.resolve(isInput ? (v ? (val.trim() || null) : null) : v) } catch { /* noop */ }
    setP(null); setVal('')
  }
  const danger = p.danger !== false
  return (
    <div onClick={() => close(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,12,0.55)', zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'cf-fade .18s ease both' }}>
      <style>{`@keyframes cf-fade{from{opacity:0}to{opacity:1}}@keyframes cf-pop{0%{opacity:0;transform:translateY(14px) scale(.97)}100%{opacity:1;transform:none}}.cf-card{animation:cf-pop .28s cubic-bezier(.2,.7,.2,1) both}`}</style>
      <div className="cf-card" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: '24px 24px 20px', width: 'min(430px,96vw)', boxShadow: '0 30px 80px rgba(0,0,0,0.35)' }}>
        <div style={{ fontSize: 16.5, fontWeight: 800, color: INK, letterSpacing: '-.01em' }}>{p.title}</div>
        {p.body && <div style={{ fontSize: 13.5, color: SUB, marginTop: 8, lineHeight: 1.6 }}>{p.body}</div>}
        {isInput && (
          <input ref={inputRef} value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') close(true); if (e.key === 'Escape') close(false) }}
            placeholder={p.placeholder || ''}
            style={{ width: '100%', marginTop: 14, padding: '11px 13px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 14, color: INK, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button onClick={() => close(false)} style={{ background: '#fff', color: INK, border: '1.5px solid #e2e8f0', borderRadius: 100, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>{p.cancelLabel || 'Cancel'}</button>
          <button onClick={() => close(true)} disabled={isInput && !val.trim()} style={{ background: danger ? '#c0392b' : '#17251c', color: danger ? '#fff' : '#dffe95', border: 'none', borderRadius: 100, padding: '9px 20px', fontSize: 13.5, fontWeight: 800, cursor: (isInput && !val.trim()) ? 'not-allowed' : 'pointer', opacity: (isInput && !val.trim()) ? 0.5 : 1, fontFamily: 'inherit' }}>{p.confirmLabel || (isInput ? 'Save' : 'Confirm')}</button>
        </div>
      </div>
    </div>
  )
}
