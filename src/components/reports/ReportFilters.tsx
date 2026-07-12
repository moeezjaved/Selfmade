'use client'
/**
 * Motion-style report filters. "+ Add filter" opens a searchable field picker (Dimensions /
 * Performance / AI Tags); pick a field → operator + value → add. Active filters render as removable
 * chips. Owned by GeneratedReport, which passes the filters to /api/reports/generate.
 */
import { useState } from 'react'
import { FILTER_FIELDS, FILTER_FIELD_BY_KEY, opsForType, AD_STATUSES, type FilterOp, type ReportFilter } from '@/lib/reports/templates'

const OP_LABEL: Record<FilterOp, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '=': '=', between: 'is between', contains: 'contains', is: 'is', is_not: 'is not', after: 'after', before: 'before' }
const GROUPS = ['Dimensions', 'Performance', 'AI Tags']
// Metric keys whose values are money — used to show a currency suffix on the numeric input.
const MONEY = new Set(['spend', 'revenue', 'cpa', 'cpc', 'cpm', 'aov'])
const isMoney = (key: string) => MONEY.has(key) || /^(cost_per_|cpa_|revenue_|cpcc_)/.test(key)

function chipLabel(f: ReportFilter): string {
  const fld = FILTER_FIELD_BY_KEY[f.field]
  if (f.op === 'between') { const [lo, hi] = String(f.value).split(':'); return `${fld?.label || f.field} is ${lo}–${hi}` }
  return `${fld?.label || f.field} ${OP_LABEL[f.op] || f.op} ${f.value}`
}

export default function ReportFilters({ filters, onChange, currency = 'PKR' }: { filters: ReportFilter[]; onChange: (f: ReportFilter[]) => void; currency?: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [field, setField] = useState<string | null>(null)     // chosen field key (step 2)
  const [op, setOp] = useState<FilterOp>('>')
  const [value, setValue] = useState('')
  const [value2, setValue2] = useState('')                    // upper bound for "is between"

  const fld = field ? FILTER_FIELD_BY_KEY[field] : null
  const reset = () => { setField(null); setQ(''); setValue(''); setValue2(''); setOpen(false) }
  const pick = (key: string) => { const f = FILTER_FIELD_BY_KEY[key]; setField(key); setOp(opsForType(f.type)[0]); setValue(f.type === 'enum' ? (f.options?.[0] || '') : ''); setValue2('') }
  const add = () => {
    if (!fld) return
    if (op === 'between') {
      if (value === '' || value2 === '' || isNaN(Number(value)) || isNaN(Number(value2))) return
      onChange([...filters, { field: fld.key, op, value: `${Number(value)}:${Number(value2)}` }]); reset(); return
    }
    if (fld.type === 'number' && (value === '' || isNaN(Number(value)))) return
    if (fld.type !== 'enum' && !String(value).trim()) return
    onChange([...filters, { field: fld.key, op, value: fld.type === 'number' ? Number(value) : value }])
    reset()
  }
  const remove = (i: number) => onChange(filters.filter((_, idx) => idx !== i))

  const matches = FILTER_FIELDS.filter(f => !q || f.label.toLowerCase().includes(q.toLowerCase()))

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {filters.map((f, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 100, background: '#eef4ec', border: '1px solid rgba(0,0,0,0.06)', fontSize: 12, fontWeight: 700, color: '#2a4a2a' }}>
          {chipLabel(f)}
          <button onClick={() => remove(i)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#8aaa8a', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
        </span>
      ))}
      <div style={{ position: 'relative' }}>
        <button onClick={() => { setOpen(o => !o); setField(null) }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 100, border: '1px solid rgba(0,0,0,0.14)', background: '#fff', color: '#3a5a3a', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16M7 12h10M10 19h4" strokeLinecap="round" /></svg> Add filter
        </button>
        {open && (
          <>
            <div onClick={reset} style={{ position: 'fixed', inset: 0, zIndex: 29 }} />
            <div style={{ position: 'absolute', left: 0, top: '112%', zIndex: 30, background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, boxShadow: '0 14px 44px rgba(0,0,0,0.18)', width: 300 }}>
              {!field ? (
                <>
                  <div style={{ padding: 10, borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" autoFocus
                      style={{ width: '100%', padding: '8px 11px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.12)', fontFamily: 'inherit', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                  <div style={{ maxHeight: 340, overflowY: 'auto', padding: 6 }}>
                    {GROUPS.map(g => {
                      const items = matches.filter(f => f.group === g)
                      if (!items.length) return null
                      return (
                        <div key={g}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#9ab09a', textTransform: 'uppercase', letterSpacing: '.05em', padding: '8px 10px 4px' }}>{g}</div>
                          {items.map(f => (
                            <button key={f.key} onClick={() => pick(f.key)} style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#1a3a1a', fontFamily: 'inherit' }}
                              onMouseEnter={e => e.currentTarget.style.background = '#f0f7ee'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>{f.label}</button>
                          ))}
                        </div>
                      )
                    })}
                    {!matches.length && <div style={{ padding: 12, fontSize: 12.5, color: '#9ab09a' }}>No fields match.</div>}
                  </div>
                </>
              ) : (
                <div style={{ padding: 12 }}>
                  <button onClick={() => setField(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#7a9a7a', fontSize: 12, fontWeight: 700, padding: 0, marginBottom: 10 }}>← {fld!.label}</button>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={op} onChange={e => setOp(e.target.value as FilterOp)} style={{ ...sel, width: fld!.type === 'number' ? 96 : 110, flexShrink: 0 }}>
                      {opsForType(fld!.type).map(o => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
                    </select>
                    {fld!.type === 'enum' ? (
                      <select value={value} onChange={e => setValue(e.target.value)} style={{ ...sel, flex: 1 }}>
                        {(fld!.options || []).map(o => <option key={o} value={o}>{o.replace(/^\w/, c => c.toUpperCase())}</option>)}
                      </select>
                    ) : fld!.type === 'date' ? (
                      <input type="date" value={value} onChange={e => setValue(e.target.value)} style={{ ...sel, flex: 1 }} />
                    ) : op === 'between' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
                        <NumInput value={value} onChange={setValue} onEnter={add} suffix={isMoney(fld!.key) ? currency : undefined} autoFocus />
                        <span style={{ fontSize: 12, color: '#7a9a7a' }}>–</span>
                        <NumInput value={value2} onChange={setValue2} onEnter={add} suffix={isMoney(fld!.key) ? currency : undefined} />
                      </div>
                    ) : fld!.type === 'number' ? (
                      <NumInput value={value} onChange={setValue} onEnter={add} suffix={isMoney(fld!.key) ? currency : undefined} autoFocus />
                    ) : (
                      <input type="text" value={value} onChange={e => setValue(e.target.value)} autoFocus
                        onKeyDown={e => e.key === 'Enter' && add()} placeholder={fld!.type === 'tag' ? 'e.g. Testimonial' : 'Value'} style={{ ...sel, flex: 1 }} />
                    )}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                    <button onClick={add} style={{ padding: '8px 16px', borderRadius: 100, border: 'none', background: '#1a3a1a', color: '#dffe95', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Add filter</button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const sel: React.CSSProperties = { padding: '8px 10px', borderRadius: 9, border: '1px solid rgba(0,0,0,0.14)', fontFamily: 'inherit', fontSize: 12.5, color: '#1a3a1a', background: '#fff', outline: 'none', boxSizing: 'border-box' }

// Numeric input with an optional trailing currency suffix (PKR for money metrics).
function NumInput({ value, onChange, onEnter, suffix, autoFocus }: { value: string; onChange: (v: string) => void; onEnter: () => void; suffix?: string; autoFocus?: boolean }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <input type="number" value={value} onChange={e => onChange(e.target.value)} autoFocus={autoFocus} onKeyDown={e => e.key === 'Enter' && onEnter()}
        placeholder="0" style={{ ...sel, width: '100%', paddingRight: suffix ? 44 : 10 }} />
      {suffix && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, color: '#9ab09a', pointerEvents: 'none' }}>{suffix}</span>}
    </div>
  )
}
