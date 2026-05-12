'use client'
/**
 * Admin Token Pool dashboard.
 *
 * Lists every connected meta_account, lets the admin toggle which ones are
 * available to the indexer pool, shows live cooldown status, and offers a
 * one-click "test" button that hits Meta's /me to verify a token is healthy.
 */
import { useEffect, useState } from 'react'

interface Account {
  id: string
  user_id: string
  account_name: string
  account_id: string
  is_indexer_pool: boolean
  cooldown_until: string | null
  last_used_at: string | null
  total_calls: number
  calls_today: number
  status: string
  is_cooling: boolean
  cooldown_remaining_min: number
  created_at: string
}

interface PoolSummary {
  total: number
  cooling: number
  available: number
  est_calls_per_hour: number
}

export default function TokenPoolPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [summary, setSummary] = useState<PoolSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({})

  const load = async () => {
    setLoading(true)
    const res = await fetch('/api/admin/tokens')
    const data = await res.json()
    setAccounts(data.accounts || [])
    setSummary(data.pool_summary || null)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const togglePool = async (id: string, on: boolean) => {
    await fetch('/api/admin/tokens', { method: 'PATCH', body: JSON.stringify({ id, is_indexer_pool: on }) })
    load()
  }

  const clearCool = async (id: string) => {
    await fetch('/api/admin/tokens', { method: 'PATCH', body: JSON.stringify({ id, clear_cooldown: true }) })
    load()
  }

  const test = async (id: string) => {
    setTesting(id)
    const res = await fetch('/api/admin/tokens', { method: 'POST', body: JSON.stringify({ id }) })
    const data = await res.json()
    setTestResult(prev => ({ ...prev, [id]: { ok: data.ok, msg: data.ok ? `✅ ${data.name}` : `❌ ${data.error}` } }))
    setTesting(null)
  }

  if (loading) return <div style={{ padding: 40, color: '#888' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', margin: 0 }}>Token Pool</h1>
        <p style={{ fontSize: 13, color: '#666', marginTop: 6 }}>
          Connect multiple Meta accounts to scale indexer throughput. Each pooled token contributes ~200 calls/hour to the shared budget.
          On <code>#613</code> rate-limit errors, the indexer auto-rotates to the next available token and parks the limited one for 65 min.
        </p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 24 }}>
          <Card label="Pool size" value={summary.total} hint="connected accounts in pool" />
          <Card label="Available now" value={summary.available} hint="ready to receive calls" tone={summary.available > 0 ? 'good' : 'warn'} />
          <Card label="Cooling" value={summary.cooling} hint="parked after rate limit" tone={summary.cooling > 0 ? 'warn' : 'neutral'} />
          <Card label="Est. capacity" value={`${summary.est_calls_per_hour.toLocaleString()}/hr`} hint="@ 200 calls/token/hour" />
        </div>
      )}

      {summary && summary.total === 0 && (
        <div style={{ padding: 16, background: '#fef9c3', border: '1px solid #fde047', borderRadius: 10, marginBottom: 18, fontSize: 13, color: '#854d0e' }}>
          ⚠️ No tokens in pool. Indexer is using the legacy single-token path.
          To scale to 1000+ brands, ask 3-5 trusted users (team / family / partners) to connect their Meta account at <code>/settings/integrations</code>,
          then toggle them into the pool below.
        </div>
      )}

      {/* Accounts table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e5e5', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
              <Th>Account</Th>
              <Th>Pool</Th>
              <Th>Status</Th>
              <Th>Last used</Th>
              <Th>Lifetime calls</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: '#888' }}>No connected accounts yet.</td></tr>
            )}
            {accounts.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{a.account_name}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{a.account_id}</div>
                </Td>
                <Td>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={a.is_indexer_pool} onChange={e => togglePool(a.id, e.target.checked)} />
                    <span style={{ fontSize: 12, color: a.is_indexer_pool ? '#16a34a' : '#888' }}>
                      {a.is_indexer_pool ? 'In pool' : 'Off'}
                    </span>
                  </label>
                </Td>
                <Td>
                  {a.is_cooling ? (
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 9px', borderRadius: 100, fontSize: 11, fontWeight: 600 }}>
                      ⏸ Cooling — {a.cooldown_remaining_min}m left
                    </span>
                  ) : a.is_indexer_pool ? (
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 9px', borderRadius: 100, fontSize: 11, fontWeight: 600 }}>
                      ✓ Available
                    </span>
                  ) : (
                    <span style={{ color: '#999', fontSize: 11 }}>—</span>
                  )}
                </Td>
                <Td style={{ color: '#666', fontSize: 12 }}>
                  {a.last_used_at ? timeAgo(a.last_used_at) : 'never'}
                </Td>
                <Td style={{ color: '#666' }}>{(a.total_calls || 0).toLocaleString()}</Td>
                <Td>
                  <button onClick={() => test(a.id)} disabled={testing === a.id}
                    style={{ padding: '4px 10px', fontSize: 11, border: '1px solid #d4d4d4', background: '#fff', borderRadius: 6, cursor: 'pointer', marginRight: 6 }}>
                    {testing === a.id ? '…' : 'Test'}
                  </button>
                  {a.is_cooling && (
                    <button onClick={() => clearCool(a.id)}
                      style={{ padding: '4px 10px', fontSize: 11, border: '1px solid #d4d4d4', background: '#fff', borderRadius: 6, cursor: 'pointer' }}>
                      Clear cooldown
                    </button>
                  )}
                  {testResult[a.id] && (
                    <div style={{ marginTop: 6, fontSize: 11, color: testResult[a.id].ok ? '#16a34a' : '#dc2626' }}>
                      {testResult[a.id].msg}
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
const Td = (p: any) => <td style={{ padding: '12px 14px', ...p.style }}>{p.children}</td>

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
