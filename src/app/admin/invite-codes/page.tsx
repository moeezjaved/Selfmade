'use client'
import { useEffect, useState } from 'react'

interface InviteCode {
  id: string
  code: string
  trial_days: number
  max_uses: number
  used_count: number
  expires_at: string | null
  note: string | null
  created_at: string
}

export default function InviteCodesPage() {
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [trialDays, setTrialDays] = useState(30)
  const [maxUses, setMaxUses] = useState(1)
  const [note, setNote] = useState('')
  const [expiresDays, setExpiresDays] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const fetchCodes = async () => {
    setLoading(true)
    const res = await fetch('/api/admin/invite-codes')
    const { codes } = await res.json()
    setCodes(codes || [])
    setLoading(false)
  }

  useEffect(() => { fetchCodes() }, [])

  const generate = async () => {
    setGenerating(true)
    const res = await fetch('/api/admin/invite-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trial_days: trialDays,
        max_uses: maxUses,
        note,
        expires_days: expiresDays ? parseInt(expiresDays) : undefined,
      }),
    })
    const { code, error } = await res.json()
    if (error) { alert(error); setGenerating(false); return }
    setCodes(prev => [code, ...prev])
    setNote('')
    setGenerating(false)
  }

  const deleteCode = async (id: string) => {
    if (!confirm('Delete this invite code?')) return
    await fetch('/api/admin/invite-codes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setCodes(prev => prev.filter(c => c.id !== id))
  }

  const copy = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopied(code)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 4 }}>Invite Codes</h1>
      <p style={{ fontSize: 13, color: '#888', marginBottom: 28 }}>Generate codes to give friends free access</p>

      {/* Generate form */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, marginBottom: 28 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 16 }}>Generate New Code</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>Trial Days</label>
            <input
              type="number"
              value={trialDays}
              onChange={e => setTrialDays(parseInt(e.target.value) || 30)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>Max Uses</label>
            <input
              type="number"
              value={maxUses}
              onChange={e => setMaxUses(parseInt(e.target.value) || 1)}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>Expires in Days (optional)</label>
            <input
              type="number"
              value={expiresDays}
              onChange={e => setExpiresDays(e.target.value)}
              placeholder="never"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#888', display: 'block', marginBottom: 4 }}>Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. John Smith"
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <button
          onClick={generate}
          disabled={generating}
          style={{ background: '#0f0f0f', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
        >
          {generating ? 'Generating…' : '+ Generate Code'}
        </button>
      </div>

      {/* Codes table */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f0f0f0', fontSize: 13, fontWeight: 700, color: '#111' }}>
          {codes.length} code{codes.length !== 1 ? 's' : ''}
        </div>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#aaa', fontSize: 13 }}>Loading…</div>
        ) : codes.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#aaa', fontSize: 13 }}>No codes yet — generate your first one above</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa' }}>
                {['Code', 'Trial Days', 'Uses', 'Note', 'Expires', 'Created', ''].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #f0f0f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {codes.map(c => {
                const isExhausted = c.used_count >= c.max_uses
                const isExpired = c.expires_at && new Date(c.expires_at) < new Date()
                const status = isExhausted ? 'exhausted' : isExpired ? 'expired' : 'active'
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <code style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", fontWeight: 700, fontSize: 14, color: status === 'active' ? '#111' : '#aaa', letterSpacing: '.05em' }}>{c.code}</code>
                        <button
                          onClick={() => copy(c.code)}
                          style={{ background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', color: copied === c.code ? '#16a34a' : '#666', fontFamily: 'inherit' }}
                        >
                          {copied === c.code ? '✓ Copied' : 'Copy'}
                        </button>
                        {status !== 'active' && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 100, background: status === 'exhausted' ? '#f0f0f0' : '#fef2f2', color: status === 'exhausted' ? '#888' : '#dc2626', textTransform: 'uppercase' }}>
                            {status}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#555' }}>{c.trial_days}d</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontWeight: 600, color: c.used_count > 0 ? '#2563eb' : '#555' }}>{c.used_count}</span>
                      <span style={{ color: '#aaa' }}>/{c.max_uses}</span>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#888', fontSize: 12 }}>{c.note || '—'}</td>
                    <td style={{ padding: '12px 16px', color: '#888', fontSize: 12 }}>
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '∞ Never'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#aaa', fontSize: 12 }}>
                      {new Date(c.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <button
                        onClick={() => deleteCode(c.id)}
                        style={{ background: 'none', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: '#dc2626', fontFamily: 'inherit' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
