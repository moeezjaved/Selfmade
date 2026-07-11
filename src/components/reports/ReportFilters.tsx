'use client'
/**
 * Report filter bar — Motion-style "+ Add filter" with metric/status conditions rendered as removable
 * chips (Spend < 200, Impressions > 150000, Ad status is Active). Owned by GeneratedReport, which
 * passes the filters to /api/reports/generate.
 */
import { useState } from 'react'
import { METRICS, FILTER_OPS, AD_STATUSES, type MetricKey, type FilterOp, type ReportFilter } from '@/lib/reports/templates'

const METRIC_KEYS = Object.keys(METRICS) as MetricKey[]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function label(f: ReportFilter): string {
  if (f.field === 'status') return `Ad status is ${cap(String(f.value))}`
  return `${METRICS[f.field as MetricKey]?.label || f.field} ${f.op} ${f.value}`
}

export default function ReportFilters({ filters, onChange }: {
  filters: ReportFilter[]
  onChange: (f: ReportFilter[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<string>('spend')
  const [op, setOp] = useState<FilterOp>('>')
  const [value, setValue] = useState('')

  const isStatus = field === 'status'
  const add = () => {
    if (isStatus) { onChange([...filters, { field: 'status', op: '=', value: value || 'active' }]); }
    else { if (value === '' || isNaN(Number(value))) return; onChange([...filters, { field: field as MetricKey, op, value: Number(value) }]) }
    setValue(''); setOpen(false)
  }
  const remove = (i: number) => onChange(filters.filter((_, idx) => idx !== i))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {filters.map((f, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 100, background: '#eef4ec', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, fontWeight: 700, color: '#2a4a2a' }}>
          {label(f)}
          <button onClick={() => remove(i)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#8aaa8a', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
        </span>
      ))}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 100, border: '1px solid rgba(0,0,0,0.14)', background: '#fff', color: '#3a5a3a', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>⊟</span> Add filter
        </button>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 29 }} />
            <div style={{ position: 'absolute', left: 0, top: '112%', zIndex: 30, background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, boxShadow: '0 14px 40px rgba(0,0,0,0.18)', padding: 12, width: 300 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#7a9a7a', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Add a filter</div>
              <select value={field} onChange={e => setField(e.target.value)} style={sel}>
                <option value="status">Ad status</option>
                <optgroup label="Metrics">
                  {METRIC_KEYS.map(m => <option key={m} value={m}>{METRICS[m].label}</option>)}
                </optgroup>
              </select>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {!isStatus && (
                  <select value={op} onChange={e => setOp(e.target.value as FilterOp)} style={{ ...sel, width: 80 }}>
                    {FILTER_OPS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {isStatus ? (
                  <select value={value || 'active'} onChange={e => setValue(e.target.value)} style={{ ...sel, flex: 1 }}>
                    {AD_STATUSES.map(s => <option key={s} value={s}>{cap(s)}</option>)}
                  </select>
                ) : (
                  <input type="number" value={value} onChange={e => setValue(e.target.value)} placeholder="Value" autoFocus
                    onKeyDown={e => e.key === 'Enter' && add()} style={{ ...sel, flex: 1 }} />
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button onClick={add} style={{ padding: '7px 15px', borderRadius: 100, border: 'none', background: '#1a3a1a', color: '#dffe95', fontWeight: 800, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Add filter</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const sel: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.14)', fontFamily: 'inherit', fontSize: 12.5, color: '#1a3a1a', background: '#fff', outline: 'none', boxSizing: 'border-box' }
