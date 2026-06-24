'use client'
/**
 * Admin → Credit Pricing. Set the credit cost of every front-end action that spends credits, without
 * a deploy (model prices move). 1 credit = 1¢, so the $ value shown is credits ÷ 100. Backed by the
 * credit_pricing table via /api/admin/credit-pricing.
 */
import { useEffect, useState, useCallback } from 'react'

interface Row {
  action_type: string
  label: string | null
  credits: number
  est_cost_usd: number | null
  is_active: boolean | null
}

const CENTS_PER_CREDIT = 1   // 1 credit = 1¢
const dollars = (credits: number) => (credits * CENTS_PER_CREDIT / 100)

export default function CreditPricingPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [adding, setAdding] = useState({ action_type: '', label: '', credits: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/credit-pricing')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'failed')
      setRows(d.pricing || [])
    } catch (e) { setError(e instanceof Error ? e.message : 'failed to load') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const patch = (action_type: string, field: keyof Row, value: any) =>
    setRows(prev => prev.map(r => r.action_type === action_type ? { ...r, [field]: value } : r))

  const save = async (row: Row) => {
    setSaving(row.action_type); setError(null)
    try {
      const r = await fetch('/api/admin/credit-pricing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_type: row.action_type, label: row.label, credits: Number(row.credits), est_cost_usd: row.est_cost_usd, is_active: row.is_active }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'failed')
      setSavedAt(row.action_type); setTimeout(() => setSavedAt(null), 1500)
    } catch (e) { setError(e instanceof Error ? e.message : 'save failed') }
    finally { setSaving(null) }
  }

  const addNew = async () => {
    if (!adding.action_type.trim() || adding.credits < 0) return
    setSaving('__new__')
    try {
      const r = await fetch('/api/admin/credit-pricing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_type: adding.action_type.trim(), label: adding.label.trim() || adding.action_type.trim(), credits: Number(adding.credits), is_active: true }),
      })
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'failed') }
      setAdding({ action_type: '', label: '', credits: 0 }); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'add failed') }
    finally { setSaving(null) }
  }

  const inputStyle: React.CSSProperties = { width: 90, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }
  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e5e7eb' }
  const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 13, color: '#111', verticalAlign: 'middle' }

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 4 }}>Credit Pricing</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
        Set the credit cost of each action. <strong>1 credit = 1¢</strong> (100 credits = $1), so the price shown is credits ÷ 100.
      </p>

      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {loading ? <div style={{ color: '#9ca3af', fontSize: 14 }}>Loading…</div> : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Action</th><th style={th}>Label</th><th style={th}>Credits</th>
              <th style={th}>Price</th><th style={th}>Est. cost (USD)</th><th style={th}>Margin</th>
              <th style={th}>Active</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {rows.map(row => {
                const price = dollars(row.credits)
                const cost = row.est_cost_usd ?? null
                const margin = cost != null && cost > 0 ? `${Math.round(((price - cost) / price) * 100)}%` : '—'
                return (
                  <tr key={row.action_type}>
                    <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, color: '#374151' }}>{row.action_type}</td>
                    <td style={td}><input value={row.label ?? ''} onChange={e => patch(row.action_type, 'label', e.target.value)} style={{ ...inputStyle, width: 180 }} /></td>
                    <td style={td}><input type="number" min={0} value={row.credits} onChange={e => patch(row.action_type, 'credits', Number(e.target.value))} style={inputStyle} /></td>
                    <td style={{ ...td, fontWeight: 700, color: '#1a3a1a' }}>${price.toFixed(2)}</td>
                    <td style={td}><input type="number" min={0} step="0.0001" value={row.est_cost_usd ?? ''} onChange={e => patch(row.action_type, 'est_cost_usd', e.target.value === '' ? null : Number(e.target.value))} style={inputStyle} placeholder="—" /></td>
                    <td style={{ ...td, color: margin !== '—' && parseInt(margin) < 0 ? '#dc2626' : '#059669', fontWeight: 700 }}>{margin}</td>
                    <td style={td}>
                      <input type="checkbox" checked={row.is_active ?? true} onChange={e => patch(row.action_type, 'is_active', e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                    </td>
                    <td style={td}>
                      <button onClick={() => save(row)} disabled={saving === row.action_type}
                        style={{ padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                          background: savedAt === row.action_type ? '#dcfce7' : '#1a3a1a', color: savedAt === row.action_type ? '#166534' : '#dffe95' }}>
                        {saving === row.action_type ? '…' : savedAt === row.action_type ? '✓ Saved' : 'Save'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {/* Add new */}
              <tr style={{ background: '#f9fafb' }}>
                <td style={td}><input value={adding.action_type} onChange={e => setAdding(a => ({ ...a, action_type: e.target.value }))} placeholder="new_action_type" style={{ ...inputStyle, width: 150, fontFamily: 'monospace' }} /></td>
                <td style={td}><input value={adding.label} onChange={e => setAdding(a => ({ ...a, label: e.target.value }))} placeholder="Label" style={{ ...inputStyle, width: 180 }} /></td>
                <td style={td}><input type="number" min={0} value={adding.credits} onChange={e => setAdding(a => ({ ...a, credits: Number(e.target.value) }))} style={inputStyle} /></td>
                <td style={{ ...td, fontWeight: 700, color: '#1a3a1a' }}>${dollars(adding.credits).toFixed(2)}</td>
                <td style={td} colSpan={3}></td>
                <td style={td}><button onClick={addNew} disabled={saving === '__new__' || !adding.action_type.trim()} style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #1a3a1a', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', background: '#fff', color: '#1a3a1a' }}>+ Add</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
