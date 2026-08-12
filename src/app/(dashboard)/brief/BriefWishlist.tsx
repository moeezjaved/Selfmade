'use client'
/**
 * BRIEF WISHLIST — a small "what else do you want to see here?" button on the brief.
 * Opens a one-line ask; the answer is written into Mello's memory (kind 'preference',
 * source 'brief_wishlist') so it both shapes future briefs and tells us what to build.
 */
import { useState } from 'react'
import { Plus, Check } from 'lucide-react'

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', FOREST = '#141d15'

export default function BriefWishlist() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const t = text.trim(); if (!t) return
    setBusy(true)
    try {
      await fetch('/api/interview/notebook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: [{ content: `Wants to see in the morning brief: ${t}`, kind: 'preference' }], source: 'brief_wishlist' }) })
      setSent(true)
    } catch { setSent(true) } finally { setBusy(false) }
  }

  if (sent) return (
    <div style={{ marginTop: 22, fontSize: 13, color: MUTED, display: 'flex', alignItems: 'center', gap: 7 }}>
      <Check size={15} color="#ef4a1e" /> Noted — Mello will factor that into your brief. Thanks.
    </div>
  )

  return (
    <div style={{ marginTop: 22 }}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1.5px dashed ${LINE}`, color: MUTED, borderRadius: 100, padding: '9px 16px', fontSize: 12.5, fontWeight: 750, cursor: 'pointer', fontFamily: 'inherit' }}>
          <Plus size={14} /> What else do you want to see in your brief?
        </button>
      ) : (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, maxWidth: 520 }}>
          <div style={{ fontSize: 13, fontWeight: 750, color: INK, marginBottom: 8 }}>What would make this brief more useful?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} autoFocus
              placeholder="e.g. show my ad spend, weekly winners, TikTok trends…"
              style={{ flex: 1, border: `1.5px solid ${LINE}`, borderRadius: 10, padding: '10px 13px', fontSize: 13, color: INK, outline: 'none', fontFamily: 'inherit' }} />
            <button onClick={submit} disabled={busy || !text.trim()} style={{ background: FOREST, color: '#ff5a2c', border: 'none', borderRadius: 10, padding: '0 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
