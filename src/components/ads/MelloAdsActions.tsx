'use client'
/**
 * MelloAdsActions — the "run your ads by typing" surface. Type a request → Mello plans it → a confirm
 * card appears (what changes · € impact) → Approve → it executes on the real Meta account. Nothing
 * writes without the card + Approve; launches land PAUSED. Reused in Your Ads (command bar) and as the
 * creative→Facebook bridge (pass `attach` to launch/attach a specific creative).
 */
import { useState } from 'react'

type Card = { title: string; summary: string; lines?: string[]; confirmLabel: string; currency: string; action: any }
type Attach = { creativeUrl: string; brandName?: string; website?: string }

const ORANGE = '#ef4a1e'

export default function MelloAdsActions({ attach, placeholder = 'Tell Mello what to do — “scale ROY 1 to €80/day”, “pause the retargeting campaign”…', autoFocus, onDone }: {
  attach?: Attach; placeholder?: string; autoFocus?: boolean; onDone?: () => void
}) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState<Card | null>(null)
  const [clarify, setClarify] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const plan = async () => {
    if (!msg.trim() || busy) return
    setBusy(true); setError(null); setCard(null); setClarify(null); setDone(null)
    try {
      const r = await fetch('/api/ads/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'plan', message: msg.trim(), attach }) })
      const d = await r.json()
      if (d.card) setCard(d.card)
      else if (d.clarify) setClarify(d.clarify)
      else setError(d.error || 'Couldn’t read that — try rephrasing.')
    } catch { setError('Something went wrong — try again.') } finally { setBusy(false) }
  }

  const approve = async () => {
    if (!card || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/ads/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'execute', action: card.action }) })
      const d = await r.json()
      if (d.ok) { setDone(d.message); setCard(null); setMsg(''); onDone?.() }
      else setError(d.error || 'Meta rejected that.')
    } catch { setError('Something went wrong — try again.') } finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={msg} autoFocus={autoFocus} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && plan()} placeholder={placeholder}
          style={{ flex: 1, padding: '13px 16px', fontSize: 14.5, borderRadius: 100, border: '1px solid #e3ded2', background: '#fff', color: '#1a1410', outline: 'none' }} />
        <button onClick={plan} disabled={busy || !msg.trim()} style={{ background: msg.trim() ? ORANGE : '#e3ded2', color: '#fff', border: 'none', borderRadius: 100, padding: '13px 22px', fontSize: 14.5, fontWeight: 800, cursor: msg.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>{busy && !card ? 'Thinking…' : 'Ask Mello'}</button>
      </div>

      {clarify && <div style={{ fontSize: 13.5, color: '#8a5a1a', background: '#fdf4e7', border: '1px solid #f3e2c5', borderRadius: 12, padding: '11px 14px' }}>{clarify}</div>}
      {error && <div style={{ fontSize: 13.5, color: '#b42318', background: '#fef3f2', border: '1px solid #fecdca', borderRadius: 12, padding: '11px 14px' }}>{error}</div>}
      {done && <div style={{ fontSize: 13.5, color: '#15803d', background: '#f0f9f2', border: '1px solid #bbe6c6', borderRadius: 12, padding: '11px 14px' }}>✅ {done}</div>}

      {card && (
        <div style={{ border: `1px solid ${ORANGE}33`, borderRadius: 14, background: '#fff', padding: 16, boxShadow: '0 18px 44px -28px rgba(239,74,30,.4)' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 4 }}>{card.title}</div>
          <div style={{ fontSize: 13.5, color: '#555', marginBottom: card.lines?.length ? 10 : 14 }}>{card.summary}</div>
          {card.lines && card.lines.length > 0 && (
            <ul style={{ margin: '0 0 14px', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {card.lines.map((l, i) => <li key={i} style={{ fontSize: 12.5, color: '#555', lineHeight: 1.5 }}>{l}</li>)}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={approve} disabled={busy} style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>{busy ? 'Working…' : card.confirmLabel}</button>
            <button onClick={() => setCard(null)} disabled={busy} style={{ background: 'none', border: '1px solid #e3ded2', borderRadius: 100, padding: '10px 16px', fontSize: 14, fontWeight: 600, color: '#555', cursor: 'pointer' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
