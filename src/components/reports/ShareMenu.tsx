'use client'
/**
 * Motion-style Share dropdown for a report. Two tabs:
 *  • Share once     — a public link to a frozen snapshot of the current data + an optional note.
 *  • Share with partner — email the snapshot to a partner/client so they can view it without an account.
 * Both POST the CURRENT rows/netResults to /api/reports/share, which stores the snapshot in R2.
 */
import { useState } from 'react'

export default function ShareMenu({ payload, onClose, savedId }: {
  payload: () => any            // returns the current snapshot payload (name, template, metrics, rows, net, …)
  onClose: () => void
  savedId?: string              // when set, partner-share sends a real collaboration invite (not just a snapshot)
}) {
  const [tab, setTab] = useState<'once' | 'partner'>('once')
  const [note, setNote] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState('')
  const [err, setErr] = useState('')

  const post = async (mode: 'once' | 'partner') => {
    setBusy(true); setErr(''); setSent('')
    try {
      // Partner + a saved report → real collaboration invite (they accept into their workspace).
      if (mode === 'partner' && savedId) {
        const res = await fetch('/api/reports/collab', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ savedReportId: savedId, partnerEmail: email }),
        })
        const j = await res.json()
        if (!res.ok) { setErr(j.error || 'Something went wrong.'); return }
        if (j.link) setLink(j.link)
        setSent(j.emailed ? `Invitation sent to ${email} ✓` : 'Invite created — copy the link to share.')
        return
      }
      const res = await fetch('/api/reports/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), mode, note, partnerEmail: email }),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error || 'Something went wrong.'); return }
      if (mode === 'once') {
        setLink(j.shareUrl)
        try { await navigator.clipboard.writeText(j.shareUrl); setCopied(true) } catch {}
      } else {
        setLink(j.shareUrl)
        setSent(j.emailed ? `Invitation sent to ${email} ✓` : (j.warning || 'Link ready — copy it to share.'))
      }
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 40, width: 360, background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 16, boxShadow: '0 18px 50px rgba(0,0,0,0.22)', overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.07)', padding: '4px 10px 0' }}>
        {([['once', 'Share once'], ['partner', 'Share with partner']] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setTab(k); setErr(''); setSent(''); setLink('') }}
            style={{ padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
              color: tab === k ? '#141d15' : '#9ab09a', borderBottom: tab === k ? '2px solid #141d15' : '2px solid transparent', marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {tab === 'once' ? (
          <>
            <div style={{ fontSize: 12.5, color: '#6b6a58', lineHeight: 1.5, marginBottom: 10 }}>Share a link with your report’s current data. Snapshots won’t update over time.</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={'E.g. "The ROAS is looking great for our unboxing campaign"'}
              rows={3} style={taStyle} />
            {link ? (
              <div style={{ marginTop: 10 }}>
                {/* Confirmation — tell the user the snapshot is filed on the Snapshots page. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#f4f0e6', border: '1px solid #cfe6c4', borderRadius: 10, padding: '8px 11px', marginBottom: 8 }}>
                  <span style={{ fontSize: 14 }}>📸</span>
                  <span style={{ fontSize: 12.5, color: '#2d5a2d', fontWeight: 600, flex: 1 }}>Snapshot created</span>
                  <a href="/snapshots" style={{ fontSize: 12, fontWeight: 700, color: '#2d7a2d', textDecoration: 'none' }}>View in Snapshots →</a>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input readOnly value={link} style={{ ...inStyle, flex: 1, fontSize: 11.5, color: '#3a5a3a' }} onFocus={e => e.currentTarget.select()} />
                  <button onClick={() => { navigator.clipboard.writeText(link); setCopied(true) }} style={btnPrimary}>{copied ? 'Copied ✓' : 'Copy'}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button onClick={() => post('once')} disabled={busy} style={btnPrimary}>{busy ? 'Creating…' : 'Share'}</button>
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: '#6b6a58', lineHeight: 1.5, marginBottom: 10 }}>
              {savedId
                ? 'Invite a client or partner to collaborate. They accept into their own workspace and see this report update live.'
                : 'A snapshot link will be emailed. Tip: Save this report first to invite a partner who sees live updates.'}
            </div>
            <label style={lblStyle}>Partner email address</label>
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="partner@example.com" type="email" style={inStyle} />
            {!savedId && <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (optional)" rows={2} style={{ ...taStyle, marginTop: 8 }} />}
            {sent && <div style={{ marginTop: 10, fontSize: 12.5, color: '#2d7a2d', fontWeight: 600 }}>{sent}{link && <><br /><a href={link} target="_blank" rel="noopener noreferrer" style={{ color: '#3a5a3a', fontSize: 11.5 }}>{link}</a></>}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <button onClick={onClose} style={btnGhost}>Cancel</button>
              <button onClick={() => post('partner')} disabled={busy || !email} style={{ ...btnPrimary, opacity: (busy || !email) ? 0.5 : 1 }}>{busy ? 'Sending…' : 'Send invitation'}</button>
            </div>
          </>
        )}
        {err && <div style={{ marginTop: 10, fontSize: 12, color: '#c0392b' }}>{err}</div>}
      </div>
    </div>
  )
}

const taStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontFamily: 'inherit', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', color: '#141d15' }
const inStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.12)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box', color: '#141d15' }
const lblStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#6b6a58', marginBottom: 5 }
const btnPrimary: React.CSSProperties = { padding: '8px 16px', borderRadius: 100, border: 'none', background: '#141d15', color: '#ff5a2c', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }
const btnGhost: React.CSSProperties = { padding: '8px 14px', borderRadius: 100, border: '1px solid rgba(0,0,0,0.12)', background: '#fff', color: '#6b6a58', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }
