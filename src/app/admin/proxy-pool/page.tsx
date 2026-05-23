'use client'

/**
 * Admin Proxy Pool dashboard.
 *
 * Adds/removes proxy IPs in the pool. Shows per-IP health (latency, error
 * rate, crawl volume) and surfaces alerts when:
 *   - Any IP gets slow (p95 > 3s) — "add more IPs"
 *   - Any IP looks flagged (>5% errors) — "swap this IP"
 *   - Fewer than 2 IPs are enabled — "single point of failure"
 *
 * Polls /api/admin/proxy-pool every 30s.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

interface Proxy {
  id: string
  label: string
  provider: string
  host: string
  port: number
  country: string | null
  isp: string | null
  enabled: boolean
  disabled_at: string | null
  disabled_reason: string | null
  added_at: string
  last_used_at: string | null
  notes: string | null
  crawls_24h: number
  errors_24h: number
  crawls_1h: number
  errors_1h: number
  error_rate_1h: number
  p50_latency_ms: number
  p95_latency_ms: number
  bytes_24h: number
  status: 'healthy' | 'slow' | 'flagged' | 'disabled'
}

interface PoolData {
  proxies: Proxy[]
  summary: { total: number; enabled: number; disabled: number; total_crawls_24h: number; total_errors_24h: number }
  alerts: Array<{ level: 'warn' | 'crit'; message: string }>
}

const STATUS_COLOR: Record<Proxy['status'], string> = {
  healthy: '#10b981',
  slow: '#f59e0b',
  flagged: '#ef4444',
  disabled: '#6b7280',
}
const STATUS_LABEL: Record<Proxy['status'], string> = {
  healthy: '🟢 Healthy',
  slow: '🟡 Slow',
  flagged: '🔴 Flagged',
  disabled: '⚫ Disabled',
}

export default function ProxyPoolPage() {
  const [data, setData] = useState<PoolData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/proxy-pool', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setData(j)
      setErr(null)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(fetchData, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  async function addProxy(form: FormData) {
    setAdding(true)
    try {
      const body = Object.fromEntries(form.entries())
      const r = await fetch('/api/admin/proxy-pool', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      await fetchData()
    } catch (e: any) {
      alert(`Add failed: ${e.message}`)
    } finally {
      setAdding(false)
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    const reason = enabled ? null : prompt('Reason for disabling?', 'manually disabled')
    await fetch('/api/admin/proxy-pool', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, enabled, disabled_reason: reason }),
    })
    fetchData()
  }

  async function deleteProxy(id: string, label: string) {
    if (!confirm(`Delete proxy "${label}"? This cannot be undone.`)) return
    await fetch(`/api/admin/proxy-pool?id=${id}`, { method: 'DELETE' })
    fetchData()
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>🔀 Proxy Pool</h1>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href="/admin/health" style={{ color: '#3b82f6', fontSize: 14 }}>← Health Dashboard</Link>
          <button onClick={fetchData} style={btn}>Refresh</button>
        </div>
      </div>

      {err && <div style={{ ...card, background: '#fee', borderColor: '#fcc', color: '#900' }}>Error: {err}</div>}

      {/* Alerts banner */}
      {data && data.alerts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {data.alerts.map((a, i) => (
            <div key={i} style={{
              padding: 12,
              marginBottom: 8,
              borderRadius: 6,
              background: a.level === 'crit' ? '#fee2e2' : '#fef3c7',
              color: a.level === 'crit' ? '#991b1b' : '#92400e',
              border: `1px solid ${a.level === 'crit' ? '#fca5a5' : '#fcd34d'}`,
              fontSize: 14,
            }}>
              {a.level === 'crit' ? '🔴' : '🟡'} {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Summary cards */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <Kpi label="Total IPs" value={data.summary.total} />
          <Kpi label="Enabled" value={data.summary.enabled} color="#10b981" />
          <Kpi label="Crawls 24h" value={data.summary.total_crawls_24h} />
          <Kpi label="Errors 24h" value={data.summary.total_errors_24h} color={data.summary.total_errors_24h > 0 ? '#ef4444' : '#10b981'} />
        </div>
      )}

      {/* Add new proxy */}
      <details style={{ ...card, marginBottom: 24 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 12 }}>➕ Add new proxy</summary>
        <form
          onSubmit={(e) => { e.preventDefault(); addProxy(new FormData(e.currentTarget)) }}
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 12 }}
        >
          <Field name="label" label="Label" placeholder="PC-comcast-1" required />
          <Field name="provider" label="Provider" defaultValue="proxycheap" />
          <Field name="host" label="Host (IP)" placeholder="48.45.152.95" required />
          <Field name="port" label="Port" placeholder="41968" required />
          <Field name="username" label="Username" required />
          <Field name="password" label="Password" type="password" required />
          <Field name="country" label="Country" placeholder="US" />
          <Field name="isp" label="ISP" placeholder="Comcast" />
          <div style={{ gridColumn: 'span 2' }}>
            <Field name="notes" label="Notes (optional)" placeholder="e.g. Chicago, IL" />
          </div>
          <button type="submit" disabled={adding} style={{ ...btn, gridColumn: 'span 2', background: '#10b981', color: '#fff', borderColor: '#10b981' }}>
            {adding ? 'Adding…' : 'Add to pool'}
          </button>
        </form>
      </details>

      {/* Proxy list */}
      {loading && <div style={card}>Loading…</div>}
      {data && data.proxies.length === 0 && (
        <div style={{ ...card, textAlign: 'center', color: '#666' }}>
          No proxies yet. Add one above. While the pool is empty, the worker uses IPRoyal env vars as fallback.
        </div>
      )}
      {data && data.proxies.length > 0 && (
        <div style={card}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={th}>Status</th>
                <th style={th}>Label</th>
                <th style={th}>Host</th>
                <th style={th}>ISP / Country</th>
                <th style={{ ...th, textAlign: 'right' }}>Crawls 24h</th>
                <th style={{ ...th, textAlign: 'right' }}>Errors 1h</th>
                <th style={{ ...th, textAlign: 'right' }}>p50 / p95</th>
                <th style={{ ...th, textAlign: 'right' }}>Bytes 24h</th>
                <th style={th}>Last used</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.proxies.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ ...td, color: STATUS_COLOR[p.status], fontWeight: 600 }}>{STATUS_LABEL[p.status]}</td>
                  <td style={td}><div style={{ fontWeight: 600 }}>{p.label}</div><div style={{ color: '#888', fontSize: 11 }}>{p.provider}</div></td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{p.host}:{p.port}</td>
                  <td style={td}>{p.isp || '—'}{p.country ? ` / ${p.country}` : ''}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{p.crawls_24h}</td>
                  <td style={{ ...td, textAlign: 'right', color: p.error_rate_1h > 5 ? '#ef4444' : 'inherit' }}>
                    {p.errors_1h}{p.error_rate_1h > 0 ? ` (${p.error_rate_1h}%)` : ''}
                  </td>
                  <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>
                    {p.p50_latency_ms}/{p.p95_latency_ms}<span style={{ color: '#888' }}>ms</span>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>{(p.bytes_24h / 1_048_576).toFixed(1)} MB</td>
                  <td style={{ ...td, color: '#666', fontSize: 11 }}>{p.last_used_at ? new Date(p.last_used_at).toLocaleString() : '—'}</td>
                  <td style={td}>
                    <button onClick={() => toggleEnabled(p.id, !p.enabled)} style={{ ...btnSm, marginRight: 4 }}>
                      {p.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => deleteProxy(p.id, p.label)} style={{ ...btnSm, color: '#ef4444' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 24, fontSize: 12, color: '#666', lineHeight: 1.5 }}>
        <strong>Behavior:</strong> Worker picks a proxy round-robin from this pool when <code>USE_PROXY_POOL=true</code> is set in worker env.
        If the pool is empty or the env flag is off, it falls back to legacy IPRoyal (<code>WORKER_PROXY_*</code> env vars).
        Disabled rows drop out of rotation within 60s (cache refresh).
      </div>
    </div>
  )
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }
const th: React.CSSProperties = { padding: '8px 10px', fontWeight: 600, color: '#444', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }
const td: React.CSSProperties = { padding: '10px' }
const btn: React.CSSProperties = { padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13 }
const btnSm: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 12 }

function Kpi({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color ?? '#111', marginTop: 4 }}>{value}</div>
    </div>
  )
}

function Field({ name, label, ...rest }: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{label}</div>
      <input
        name={name}
        {...rest}
        style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
      />
    </label>
  )
}
