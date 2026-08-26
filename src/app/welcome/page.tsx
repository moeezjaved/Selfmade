'use client'
/**
 * /welcome — the "hire Mello" employment agreement, shown once after signup BEFORE the workspace.
 * The founder types their name to sign; we record it (/api/agreement/accept) and send them into the
 * build/workspace. The workspace pages redirect here until this is signed. Not gated itself (no loop).
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const INK = '#141d15', SUB = '#6f7a6c', LINE = 'rgba(0,0,0,0.10)', ORANGE = '#ff5a2c', PAPER = '#faf9f5'

export default function WelcomePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const sign = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try { await fetch('/api/agreement/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) }) } catch { /* cookie/metadata best-effort */ }
    router.push('/ads-workspace')
  }

  const row = (k: string, v: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', borderBottom: `1px solid ${LINE}`, fontSize: 14 }}>
      <span style={{ color: SUB }}>{k}</span><b style={{ color: INK, textAlign: 'right' }}>{v}</b>
    </div>
  )

  return (
    <div style={{ minHeight: '100dvh', background: PAPER, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', fontFamily: "'Helvetica Neue', Helvetica, Arial, system-ui, sans-serif", color: INK }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>You’re not buying software.</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: ORANGE }}>You’re hiring a company.</div>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: '26px 28px', boxShadow: '0 30px 80px -34px rgba(0,0,0,.35)' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: ORANGE, marginBottom: 6 }}>Employment agreement · for your signature</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 2 }}>Employment Agreement</div>
          <div style={{ fontSize: 12.5, color: SUB, marginBottom: 16 }}>Prepared this morning</div>
          {row('Employee', 'Mello')}
          {row('Position', 'Your AI marketing company')}
          {row('Working hours', '24/7 — nights included')}
          {row('Reports to', 'You')}
          {row('Notice period', 'None — end it any time')}
          {row('Starts', 'Tonight')}
          <div style={{ fontSize: 13, color: SUB, lineHeight: 1.55, margin: '16px 0 18px' }}>
            I’ll study your market every night and report every morning. Nothing ships without your approval. Let me go any time, effective immediately, no questions asked. <b style={{ color: INK }}>— I only ask for the nights.</b>
          </div>
          <label style={{ fontSize: 12.5, fontWeight: 700, color: SUB }}>Type your name to sign</label>
          <input
            value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sign() }}
            placeholder="Your name" autoFocus
            style={{ width: '100%', marginTop: 8, padding: '13px 16px', fontSize: 18, fontStyle: 'italic', borderRadius: 12, border: `1.5px solid ${LINE}`, background: '#fff', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
          <button onClick={sign} disabled={!name.trim() || busy} style={{ marginTop: 14, width: '100%', background: !name.trim() || busy ? '#e7c4b8' : ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '14px 20px', fontSize: 15.5, fontWeight: 800, cursor: !name.trim() || busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Hiring your company…' : 'Hire your company →'}
          </button>
          <div style={{ fontSize: 12, color: SUB, textAlign: 'center', marginTop: 10 }}>No card to start · your first brief is free · effective tonight</div>
        </div>
      </div>
    </div>
  )
}
