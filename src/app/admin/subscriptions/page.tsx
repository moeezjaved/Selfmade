'use client'
import { useEffect, useMemo, useState } from 'react'

type Row = { user_id: string; email: string; name: string; plan: string; status: string; cycle: string; plan_credits: number; topup_credits: number; credits_used: number; renews: string | null; last_active: string | null; joined: string | null }
const PLAN_COLORS: Record<string, string> = { free: '#94a3b8', starter: '#0ea5e9', pro: '#16a34a', business: '#7c3aed', enterprise: '#111' }
const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString() : '—'

export default function AdminSubscriptions() {
  const [rows, setRows] = useState<Row[]>([])
  const [byPlan, setByPlan] = useState<Record<string, number>>({})
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/subscriptions').then(r => r.json()).then(j => { setRows(j.rows || []); setByPlan(j.byPlan || {}) }).finally(() => setLoading(false))
  }, [])

  const shown = useMemo(() => rows.filter(r =>
    (!plan || r.plan === plan) && (!q || r.email.toLowerCase().includes(q.toLowerCase()) || r.name.toLowerCase().includes(q.toLowerCase()))
  ), [rows, q, plan])

  return (
    <div style={{ padding: 28, color: '#111' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Subscriptions</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 18 }}>Who’s on what plan, their credits, and activity.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {Object.entries(byPlan).sort().map(([p, n]) => (
          <button key={p} onClick={() => setPlan(plan === p ? '' : p)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: plan === p ? '#111' : '#fff', color: plan === p ? '#fff' : '#111', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: PLAN_COLORS[p] || '#999' }} />
            <span style={{ textTransform: 'capitalize' }}>{p}</span> <b>{n}</b>
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search email or name" style={{ marginLeft: 'auto', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, minWidth: 220 }} />
      </div>

      {loading ? <div style={{ color: '#9ca3af' }}>Loading…</div> : (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: '#f8fafc', textAlign: 'left' }}>
              {['User', 'Plan', 'Status', 'Plan cr', 'Top-up cr', 'Used', 'Renews', 'Last active', 'Joined'].map(h => <th key={h} style={{ padding: '10px 14px', fontWeight: 700, color: '#475569' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.user_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 14px' }}><div style={{ fontWeight: 600 }}>{r.email || r.user_id.slice(0, 8)}</div>{r.name && <div style={{ color: '#94a3b8', fontSize: 12 }}>{r.name}</div>}</td>
                  <td style={{ padding: '10px 14px' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: PLAN_COLORS[r.plan] || '#999' }} /><span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{r.plan}</span></span></td>
                  <td style={{ padding: '10px 14px', color: r.status === 'past_due' ? '#dc2626' : r.status === 'canceled' ? '#94a3b8' : '#16a34a', fontWeight: 600 }}>{r.status}</td>
                  <td style={{ padding: '10px 14px' }}>{r.plan_credits.toLocaleString()}</td>
                  <td style={{ padding: '10px 14px' }}>{r.topup_credits.toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: (r.credits_used || 0) > 0 ? '#0f172a' : '#94a3b8' }}>{(r.credits_used || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmt(r.renews)}</td>
                  <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmt(r.last_active)}</td>
                  <td style={{ padding: '10px 14px', color: '#64748b' }}>{fmt(r.joined)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#9ca3af' }}>No users match.</div>}
        </div>
      )}
    </div>
  )
}
