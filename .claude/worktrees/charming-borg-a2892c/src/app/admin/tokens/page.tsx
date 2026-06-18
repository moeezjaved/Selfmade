'use client'
/**
 * Admin Token Pool dashboard — operates on the isolated indexer_tokens table.
 *
 * This page exists ONLY for crawler infrastructure. It never reads/writes
 * meta_accounts (which is for end-user OAuth state).
 *
 * Workflow:
 * 1. Co-worker generates a Facebook user token via Graph API Explorer
 * 2. They paste the token into the "Add Token" form here (label + raw token)
 * 3. Backend validates token via /me, exchanges short→long lived (60 days)
 * 4. Indexer auto-rotates across all active tokens, parking any that hit #613
 */
import { useEffect, useState } from 'react'

interface PoolToken {
  id: string
  label: string
  fb_user_id: string | null
  fb_user_name: string | null
  expires_at: string | null
  cooldown_until: string | null
  last_used_at: string | null
  total_calls: number
  is_active: boolean
  is_cooling: boolean
  cooldown_remaining_min: number
  days_until_expiry: number | null
  expires_soon: boolean
  created_at: string
}

interface Summary {
  total: number
  cooling: number
  available: number
  expiring_soon: number
  est_calls_per_hour: number
}

export default function TokenPoolPage() {
  const [tokens, setTokens] = useState<PoolToken[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newToken, setNewToken] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({})

  const load = async () => {
    setLoading(true)
    const res = await fetch('/api/admin/tokens')
    const data = await res.json()
    setTokens(data.accounts || [])
    setSummary(data.pool_summary || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const submitNew = async () => {
    setAddError(null)
    if (!newLabel.trim() || !newToken.trim()) {
      setAddError('Label and token are both required')
      return
    }
    setAdding(true)
    const res = await fetch('/api/admin/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel.trim(), raw_token: newToken.trim() }),
    })
    const data = await res.json()
    setAdding(false)
    if (!res.ok || data.error) {
      setAddError(data.error || 'Failed to add token')
      return
    }
    setNewLabel('')
    setNewToken('')
    setShowForm(false)
    load()
  }

  const toggleActive = async (id: string, on: boolean) => {
    await fetch('/api/admin/tokens', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: on }),
    })
    load()
  }

  const clearCool = async (id: string) => {
    await fetch('/api/admin/tokens', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, clear_cooldown: true }),
    })
    load()
  }

  const removeTok = async (id: string) => {
    if (!confirm('Remove this token from the pool? This cannot be undone.')) return
    await fetch(`/api/admin/tokens?id=${id}`, { method: 'DELETE' })
    load()
  }

  const testTok = async (id: string) => {
    setTesting(id)
    const res = await fetch('/api/admin/tokens/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const data = await res.json()
    setTestResult(prev => ({ ...prev, [id]: { ok: data.ok, msg: data.ok ? `✅ ${data.name}` : `❌ ${data.error}` } }))
    setTesting(null)
  }

  if (loading) return <div style={{ padding: 40, color: '#888' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', margin: 0 }}>Crawler Token Pool</h1>
          <p style={{ fontSize: 13, color: '#666', marginTop: 6, maxWidth: 720, lineHeight: 1.6 }}>
            Isolated infrastructure for the Meta Ads Library indexer. Pasted tokens are validated, exchanged to long-lived (60-day) tokens, and rotated by the crawler. Hitting <code>#613</code> rate limits parks a token for 65 min and switches to the next available.
            <br/>
            <strong>Not connected to user OAuth or paying-customer Meta accounts.</strong>
          </p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          style={{ background: '#111', color: '#fff', border: 'none', padding: '9px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
          {showForm ? 'Cancel' : '+ Add Token'}
        </button>
      </div>

      {/* Add token form */}
      {showForm && (
        <div style={{ background: '#fafafa', border: '1px solid #e5e5e5', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111', margin: '0 0 12px' }}>Add a token to the pool</h3>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12, color: '#854d0e', lineHeight: 1.5 }}>
            Have your contributor go to <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" style={{ color: '#854d0e', textDecoration: 'underline' }}>developers.facebook.com/tools/explorer</a> →
            top-right select your Meta App → click <strong>Get User Access Token</strong> →
            check <strong>ads_read</strong> + <strong>public_profile</strong> → Generate → copy the token (starts with <code>EAA</code>) → send it to you securely.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block', marginBottom: 4 }}>Label (only you see this)</label>
              <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder='e.g. "Tahir alt FB" or "My personal"'
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #d4d4d4', borderRadius: 7, fontSize: 13, fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 600, display: 'block', marginBottom: 4 }}>Raw token (starts with EAA)</label>
              <textarea value={newToken} onChange={e => setNewToken(e.target.value)} placeholder="EAAB..." rows={3}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #d4d4d4', borderRadius: 7, fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }} />
            </div>
            {addError && (
              <div style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 7, padding: '8px 12px', fontSize: 12, color: '#b91c1c' }}>
                {addError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submitNew} disabled={adding}
                style={{ background: adding ? '#888' : '#16a34a', color: '#fff', border: 'none', padding: '9px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: adding ? 'not-allowed' : 'pointer' }}>
                {adding ? 'Validating…' : 'Add to pool'}
              </button>
              <button onClick={() => { setShowForm(false); setAddError(null); setNewLabel(''); setNewToken('') }}
                style={{ background: 'none', color: '#666', border: '1px solid #d4d4d4', padding: '9px 18px', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          <Card label="Active tokens" value={summary.total} hint="in pool" />
          <Card label="Available now" value={summary.available} hint="ready to receive calls" tone={summary.available > 0 ? 'good' : 'warn'} />
          <Card label="Cooling" value={summary.cooling} hint="parked after rate limit" tone={summary.cooling > 0 ? 'warn' : 'neutral'} />
          <Card label="Expiring ≤ 7d" value={summary.expiring_soon} hint="renew soon" tone={summary.expiring_soon > 0 ? 'warn' : 'neutral'} />
        </div>
      )}

      {summary && summary.total === 0 && (
        <div style={{ padding: 16, background: '#fef9c3', border: '1px solid #fde047', borderRadius: 10, marginBottom: 18, fontSize: 13, color: '#854d0e' }}>
          ⚠️ No tokens in pool. The indexer is using the legacy single-token path and is at high risk of #613 rate limits.
          Click <strong>+ Add Token</strong> above to add your first one.
        </div>
      )}

      {/* Tokens table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
              <Th>Label</Th>
              <Th>Status</Th>
              <Th>Expires in</Th>
              <Th>Last used</Th>
              <Th>Calls</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: '#888' }}>No tokens yet — click "+ Add Token" to get started.</td></tr>
            )}
            {tokens.map(t => (
              <tr key={t.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{t.label}</div>
                  {t.fb_user_name && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>FB: {t.fb_user_name}</div>}
                </Td>
                <Td>
                  {!t.is_active ? (
                    <span style={{ background: '#f5f5f5', color: '#666', padding: '3px 9px', borderRadius: 100, fontSize: 11, fontWeight: 600 }}>⏸ Disabled</span>
                  ) : t.is_cooling ? (
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 9px', borderRadius: 100, fontSize: 11, fontWeight: 600 }}>
                      ⏸ Cooling — {t.cooldown_remaining_min}m
                    </span>
                  ) : (
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 9px', borderRadius: 100, fontSize: 11, fontWeight: 600 }}>✓ Available</span>
                  )}
                </Td>
                <Td>
                  {t.days_until_expiry === null ? (
                    <span style={{ color: '#999' }}>unknown</span>
                  ) : t.days_until_expiry < 0 ? (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>expired</span>
                  ) : t.expires_soon ? (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>{t.days_until_expiry}d</span>
                  ) : (
                    <span style={{ color: '#666' }}>{t.days_until_expiry}d</span>
                  )}
                </Td>
                <Td style={{ color: '#666', fontSize: 12 }}>
                  {t.last_used_at ? timeAgo(t.last_used_at) : 'never'}
                </Td>
                <Td style={{ color: '#666' }}>{(t.total_calls || 0).toLocaleString()}</Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => testTok(t.id)} disabled={testing === t.id}
                      style={{ padding: '4px 10px', fontSize: 11, border: '1px solid #d4d4d4', background: '#fff', borderRadius: 6, cursor: 'pointer' }}>
                      {testing === t.id ? '…' : 'Test'}
                    </button>
                    <button onClick={() => toggleActive(t.id, !t.is_active)}
                      style={{ padding: '4px 10px', fontSize: 11, border: '1px solid #d4d4d4', background: '#fff', borderRadius: 6, cursor: 'pointer' }}>
                      {t.is_active ? 'Disable' : 'Enable'}
                    </button>
                    {t.is_cooling && (
                      <button onClick={() => clearCool(t.id)}
                        style={{ padding: '4px 10px', fontSize: 11, border: '1px solid #d4d4d4', background: '#fff', borderRadius: 6, cursor: 'pointer' }}>
                        Clear cooldown
                      </button>
                    )}
                    <button onClick={() => removeTok(t.id)}
                      style={{ padding: '4px 10px', fontSize: 11, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 6, cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                  {testResult[t.id] && (
                    <div style={{ marginTop: 6, fontSize: 11, color: testResult[t.id].ok ? '#16a34a' : '#dc2626' }}>
                      {testResult[t.id].msg}
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Card({ label, value, hint, tone = 'neutral' }: { label: string; value: any; hint?: string; tone?: 'good' | 'warn' | 'neutral' }) {
  const colors = { good: '#16a34a', warn: '#d97706', neutral: '#111' }
  return (
    <div style={{ background: '#fff', padding: 16, borderRadius: 10, border: '1px solid #e5e5e5' }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: colors[tone] }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

const Th = (p: any) => <th style={{ textAlign: 'left', padding: '11px 14px', fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{p.children}</th>
const Td = (p: any) => <td style={{ padding: '12px 14px', verticalAlign: 'top', ...p.style }}>{p.children}</td>

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
