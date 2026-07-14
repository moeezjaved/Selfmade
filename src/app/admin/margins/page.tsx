'use client'
/**
 * Admin margins dashboard — per-action realized margin (revenue vs logged actual
 * cost). Red row = below the 50% floor → bump that action's credits in pricing.
 */
import { useEffect, useState } from 'react'

interface Margin {
  action: string; uses: number; credits_spent: number
  revenue_usd: number; actual_cost_usd: number; margin_pct: number | null; below_floor: boolean
}

export default function MarginsPage() {
  const [rows, setRows] = useState<Margin[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { (async () => {
    const r = await fetch('/api/admin/margins'); const d = await r.json()
    setRows(d.margins || []); setLoading(false)
  })() }, [])

  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid #e5e7eb' }
  const td: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f1f5f9' }

  return (
    <div style={{ padding: 28, maxWidth: 820 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Margins</h1>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>Realized margin per action (credits × $0.01 revenue vs logged model cost). Video is intentionally low-margin (cost-plus loss-leader); captions/subscriptions carry the profit.</p>
      {loading ? <div style={{ color: '#9ca3af' }}>Loading…</div>
        : rows.length === 0 ? <div style={{ color: '#9ca3af' }}>No metered actions yet.</div>
        : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
          <thead><tr>
            <th style={th}>Action</th><th style={th}>Uses</th><th style={th}>Revenue</th>
            <th style={th}>Cost</th><th style={th}>Margin</th>
          </tr></thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.action} style={{ background: m.below_floor ? '#fef2f2' : '#fff' }}>
                <td style={{ ...td, fontWeight: 600 }}>{m.action}</td>
                <td style={td}>{m.uses}</td>
                <td style={td}>${m.revenue_usd.toFixed(2)}</td>
                <td style={td}>${m.actual_cost_usd.toFixed(2)}</td>
                <td style={{ ...td, fontWeight: 700, color: m.below_floor ? '#b91c1c' : m.margin_pct != null && m.margin_pct >= 50 ? '#15803d' : '#6b7280' }}>
                  {m.margin_pct != null ? `${m.margin_pct}%` : '—'}{m.below_floor && ' ⚠'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
