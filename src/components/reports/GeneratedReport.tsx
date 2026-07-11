'use client'
/**
 * GeneratedReport — the Motion-style report view.
 * Runs a template against /api/reports/generate and renders it with full controls:
 * Group by, date range, add/remove metric columns, card ⇄ table view, sort, Net Results row,
 * AI analysis (Mello), and Save / Share. onSave persists via the reports page (Stage 3).
 */
import { useState, useEffect, useCallback } from 'react'
import { METRICS, GROUP_BY, TEMPLATE_BY_KEY, type MetricKey, type GroupByKey } from '@/lib/reports/templates'
import ShareMenu from './ShareMenu'

const ALL_METRICS = Object.keys(METRICS) as MetricKey[]

function fmtMetric(v: number, key: MetricKey, currency: string): string {
  const m = METRICS[key]; const n = Number(v) || 0
  switch (m.format) {
    case 'currency': return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
    case 'percent': return n.toFixed(2) + '%'
    case 'ratio': return n.toFixed(2) + 'x'
    case 'seconds': return n.toFixed(1) + 's'
    default: return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
  }
}
// Colour a value good/bad relative to the column's direction (only for headline rate metrics).
function metricColor(key: MetricKey, v: number): string | undefined {
  if (key === 'roas') return v >= 2 ? '#2d7a2d' : v >= 1 ? '#b8860b' : '#c0392b'
  return undefined
}

const DATE_RANGES = [
  { key: 'last_7d', label: '7d' }, { key: 'last_14d', label: '14d' },
  { key: 'last_30d', label: '30d' }, { key: 'last_60d', label: '60d' }, { key: 'last_90d', label: '90d' },
]

export default function GeneratedReport({ templateKey, onBack, onSave, onDelete, initialName, savedId, initialConfig }: {
  templateKey: string
  onBack: () => void
  onSave?: (payload: { id?: string; name: string; templateKey: string; config: any }) => Promise<boolean>
  onDelete?: (id: string) => Promise<void>
  initialName?: string
  savedId?: string
  initialConfig?: { groupBy?: GroupByKey; dateRange?: string; metrics?: MetricKey[]; sort?: MetricKey; dir?: 'asc' | 'desc'; view?: 'card' | 'table' }
}) {
  const tpl = TEMPLATE_BY_KEY[templateKey]
  const ic = initialConfig || {}
  const [groupBy, setGroupBy] = useState<GroupByKey>(ic.groupBy || tpl?.groupBy || 'creative')
  const [dateRange, setDateRange] = useState(ic.dateRange || 'last_14d')
  const [metrics, setMetrics] = useState<MetricKey[]>(ic.metrics?.length ? ic.metrics : (tpl?.metrics || ['spend', 'roas']))
  const [sort, setSort] = useState<MetricKey>(ic.sort || tpl?.sort || 'spend')
  const [dir, setDir] = useState<'asc' | 'desc'>(ic.dir || tpl?.sortDir || 'desc')
  const [view, setView] = useState<'card' | 'table'>(ic.view || 'table')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState(initialName || tpl?.title || 'Untitled report')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  // AI
  const [aiOpen, setAiOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const p = new URLSearchParams({ template: templateKey, dateRange, groupBy, sort, dir, metrics: metrics.join(',') })
      const res = await fetch(`/api/reports/generate?${p}`)
      const json = await res.json()
      if (json.error && !json.rows?.length) setError(json.error === 'no_account' ? 'Connect a Meta ad account to build this report.' : json.error)
      setData(json)
      setAiText('') // stale once controls change
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [templateKey, dateRange, groupBy, sort, dir, metrics])

  useEffect(() => { load() }, [load])

  const currency = data?.currency || 'USD'
  const rows: any[] = data?.rows || []
  const net = data?.netResults || {}

  const toggleSort = (m: MetricKey) => {
    if (sort === m) setDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSort(m); setDir(METRICS[m].goodHigh ? 'desc' : 'asc') }
  }
  const removeMetric = (m: MetricKey) => { if (metrics.length > 1) setMetrics(metrics.filter(x => x !== m)) }
  const addMetric = (m: MetricKey) => { if (!metrics.includes(m)) setMetrics([...metrics, m]); setAddOpen(false) }

  const runAI = async () => {
    setAiOpen(true); setAiLoading(true); setAiText('')
    try {
      const res = await fetch('/api/reports/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey, metrics, rows: rows.slice(0, 15), netResults: net, currency, groupBy }),
      })
      const json = await res.json()
      setAiText(json.analysis || json.error || 'No analysis available.')
    } catch (e: any) { setAiText('Analysis failed: ' + e.message) }
    finally { setAiLoading(false) }
  }

  const doSave = async () => {
    if (!onSave) return
    setSaving(true)
    const ok = await onSave({ id: savedId, name, templateKey, config: { groupBy, dateRange, metrics, sort, dir, view } })
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }

  // Snapshot payload for the Share menu — the CURRENT data, frozen.
  const sharePayload = () => ({
    name, templateKey, emoji: tpl?.emoji, description: tpl?.description,
    groupBy, dateRange, metrics, currency, rows, netResults: net,
  })

  const availableToAdd = ALL_METRICS.filter(m => !metrics.includes(m))

  if (!tpl) return <div style={{ padding: 40 }}>Unknown report.</div>

  return (
    <div style={{ padding: 28, maxWidth: 1280, margin: '0 auto' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={onBack} style={{ border: '1px solid rgba(0,0,0,0.1)', background: '#fff', width: 34, height: 34, borderRadius: 10, cursor: 'pointer', fontSize: 16, color: '#3a5a3a', flexShrink: 0 }}>←</button>
          <div style={{ fontSize: 26, flexShrink: 0 }}>{tpl.emoji}</div>
          <div style={{ minWidth: 0 }}>
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ fontSize: 20, fontWeight: 900, color: '#1a3a1a', border: 'none', background: 'transparent', outline: 'none', fontFamily: 'inherit', width: '100%', padding: 0 }} />
            <div style={{ fontSize: 12, color: '#8aaa8a' }}>{tpl.description}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={runAI} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 15px', borderRadius: 100, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>✨ Analyze</button>
          {onSave && <button onClick={doSave} disabled={saving} style={{ padding: '8px 16px', borderRadius: 100, border: 'none', background: saved ? '#2d7a2d' : '#1a3a1a', color: '#dffe95', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{saving ? 'Saving…' : saved ? 'Saved ✓' : savedId ? 'Update' : 'Save'}</button>}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShareOpen(o => !o)} disabled={!rows.length} style={{ padding: '8px 16px', borderRadius: 100, border: 'none', background: '#0e1b12', color: '#fff', fontWeight: 800, fontSize: 12.5, cursor: rows.length ? 'pointer' : 'not-allowed', fontFamily: 'inherit', opacity: rows.length ? 1 : 0.5 }}>Share report</button>
            {shareOpen && rows.length > 0 && (
              <>
                <div onClick={() => setShareOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 39 }} />
                <ShareMenu payload={sharePayload} onClose={() => setShareOpen(false)} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* AI panel */}
      {aiOpen && (
        <div style={{ background: 'linear-gradient(135deg,#faf5ff,#f3e8ff)', border: '1px solid #e9d5ff', borderRadius: 16, padding: '16px 20px', marginBottom: 16, position: 'relative' }}>
          <button onClick={() => setAiOpen(false)} style={{ position: 'absolute', top: 12, right: 14, border: 'none', background: 'transparent', cursor: 'pointer', color: '#a855f7', fontSize: 14 }}>✕</button>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#7c3aed', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>✨ Mello's analysis</div>
          {aiLoading ? (
            <div style={{ color: '#9333ea', fontSize: 13 }}>Reading your data…</div>
          ) : (
            <div style={{ fontSize: 13.5, color: '#3b0764', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}
              dangerouslySetInnerHTML={{ __html: mdLite(aiText) }} />
          )}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap', background: '#fff', border: '1px solid rgba(0,0,0,0.06)', borderRadius: 14, padding: '10px 14px' }}>
        <Ctl label="Group by">
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupByKey)} style={selStyle}>
            <optgroup label="Standard">
              {GROUP_BY.filter(g => !g.ai).map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </optgroup>
            <optgroup label="✨ AI tags">
              {GROUP_BY.filter(g => g.ai).map(g => <option key={g.key} value={g.key}>✨ {g.label}</option>)}
            </optgroup>
          </select>
        </Ctl>
        <Ctl label="Period">
          <div style={{ display: 'flex', gap: 4 }}>
            {DATE_RANGES.map(d => (
              <button key={d.key} onClick={() => setDateRange(d.key)} style={{ padding: '5px 11px', borderRadius: 100, border: 'none', fontFamily: 'inherit', fontWeight: 700, fontSize: 11.5, cursor: 'pointer', background: dateRange === d.key ? '#1a3a1a' : '#f0f7ee', color: dateRange === d.key ? '#dffe95' : '#5a7a5a' }}>{d.label}</button>
            ))}
          </div>
        </Ctl>
        <div style={{ flex: 1 }} />
        {/* Add metric */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setAddOpen(o => !o)} style={{ padding: '7px 13px', borderRadius: 100, border: '1px dashed rgba(0,0,0,0.2)', background: '#fff', color: '#3a5a3a', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>＋ Metric</button>
          {addOpen && (
            <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 30, background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.15)', padding: 8, width: 220, maxHeight: 320, overflowY: 'auto' }}>
              {availableToAdd.map(m => (
                <button key={m} onClick={() => addMetric(m)} style={{ width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5, color: '#1a3a1a', fontFamily: 'inherit', display: 'flex', justifyContent: 'space-between' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f7ee'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {METRICS[m].label}{METRICS[m].video && <span style={{ fontSize: 9, color: '#8aaa8a' }}>🎬</span>}
                </button>
              ))}
              {!availableToAdd.length && <div style={{ padding: 10, fontSize: 12, color: '#9ab09a' }}>All metrics added.</div>}
            </div>
          )}
        </div>
        {/* View toggle */}
        <div style={{ display: 'flex', background: '#f0f7ee', borderRadius: 100, padding: 3 }}>
          {(['table', 'card'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '5px 12px', borderRadius: 100, border: 'none', fontFamily: 'inherit', fontWeight: 700, fontSize: 11.5, cursor: 'pointer', background: view === v ? '#1a3a1a' : 'transparent', color: view === v ? '#dffe95' : '#5a7a5a' }}>{v === 'table' ? '☰ Table' : '▦ Cards'}</button>
          ))}
        </div>
      </div>

      {/* AI tagging progress — grouping by an AI dimension tags the top ads first (cached), then more on demand. */}
      {data?.aiGrouped && !loading && data?.tagRemaining > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, background: 'linear-gradient(135deg,#faf5ff,#f3e8ff)', border: '1px solid #e9d5ff', borderRadius: 12, padding: '10px 16px' }}>
          <div style={{ fontSize: 12.5, color: '#6b21a8' }}>✨ AI tagged your top creatives. <b>{data.tagRemaining}</b> more not yet tagged — tag them to complete this report.</div>
          <button onClick={load} style={{ padding: '6px 13px', borderRadius: 100, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Tag {Math.min(30, data.tagRemaining)} more</button>
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <img src='/favicon.png' alt='' style={{ width: 42, height: 42, borderRadius: 11, animation: 'spin 1s linear infinite', margin: '0 auto 14px', display: 'block' }} />
          <div style={{ color: '#1a3a1a', fontWeight: 700 }}>Building your report…</div>
        </div>
      ) : error && !rows.length ? (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 16, padding: 24, color: '#c0392b' }}>{error}</div>
      ) : !rows.length ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#8aaa8a' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>{tpl.emoji}</div>
          <div style={{ fontWeight: 700, color: '#1a3a1a' }}>No matching ads in this period</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{tpl.onlyFormat === 'video' ? 'This report needs active video ads with spend.' : tpl.onlyFormat === 'image' ? 'This report needs active image ads with spend.' : 'Try a wider date range.'}</div>
        </div>
      ) : view === 'table' ? (
        <TableView rows={rows} metrics={metrics} sort={sort} dir={dir} currency={currency} net={net} groupBy={groupBy}
          onSort={toggleSort} onRemove={removeMetric} count={data?.count} />
      ) : (
        <CardView rows={rows} metrics={metrics} sort={sort} currency={currency} />
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

const selStyle: React.CSSProperties = { padding: '6px 10px', borderRadius: 100, border: '1px solid rgba(0,0,0,0.12)', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, color: '#1a3a1a', background: '#fff', cursor: 'pointer', outline: 'none' }

function Ctl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 10.5, fontWeight: 800, color: '#7a9a7a', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      {children}
    </div>
  )
}

function TableView({ rows, metrics, sort, dir, currency, net, groupBy, onSort, onRemove, count }: any) {
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ background: '#f6faf4', borderBottom: '1px solid rgba(0,0,0,0.07)' }}>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 240, position: 'sticky', left: 0, background: '#f6faf4' }}>{GROUP_BY.find((g: any) => g.key === groupBy)?.label || 'Item'}</th>
              {metrics.map((m: MetricKey) => (
                <th key={m} style={thStyle} onClick={() => onSort(m)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: sort === m ? '#1a3a1a' : '#7a9a7a' }}>
                    {METRICS[m].label}
                    {sort === m && <span style={{ fontSize: 9 }}>{dir === 'desc' ? '▼' : '▲'}</span>}
                    {metrics.length > 1 && <span onClick={(e) => { e.stopPropagation(); onRemove(m) }} title="Remove column" style={{ marginLeft: 2, color: '#c5c5c5', fontSize: 11, fontWeight: 400 }}>✕</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={r.key + i} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafcf9'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                <td style={{ ...tdStyle, textAlign: 'left', position: 'sticky', left: 0, background: 'inherit' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, color: '#b5c5b5', width: 18, flexShrink: 0 }}>{i + 1}</span>
                    <Thumb src={r.thumbnail} format={r.format} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1a3a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{r.name}</div>
                      {r.adCount > 1 && <div style={{ fontSize: 10, color: '#9ab09a' }}>{r.adCount} ads</div>}
                    </div>
                  </div>
                </td>
                {metrics.map((m: MetricKey) => (
                  <td key={m} style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums', fontWeight: sort === m ? 800 : 600, color: metricColor(m, r.metrics[m]) || '#2a3a2a' }}>
                    {fmtMetric(r.metrics[m], m, currency)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#1a3a1a', color: '#dffe95' }}>
              <td style={{ ...tdStyle, textAlign: 'left', fontWeight: 900, position: 'sticky', left: 0, background: '#1a3a1a' }}>Net results{count ? ` · ${count}` : ''}</td>
              {metrics.map((m: MetricKey) => (
                <td key={m} style={{ ...tdStyle, fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: '#dffe95' }}>{fmtMetric(net[m] || 0, m, currency)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function CardView({ rows, metrics, sort, currency }: any) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px,100%),1fr))', gap: 14 }}>
      {rows.map((r: any, i: number) => (
        <div key={r.key + i} style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
          <div style={{ height: 150, background: '#f0f7ee', position: 'relative', overflow: 'hidden' }}>
            {r.thumbnail
              ? <img src={r.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>{r.format === 'video' ? '🎬' : r.format === 'carousel' ? '🎠' : '🖼️'}</div>}
            <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100 }}>#{i + 1}</span>
            <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,255,255,0.9)', color: '#3a5a3a', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100, textTransform: 'capitalize' }}>{r.format}</span>
          </div>
          <div style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 10 }}>{r.name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {metrics.slice(0, 6).map((m: MetricKey) => (
                <div key={m} style={{ background: sort === m ? '#f0f7ee' : '#fafcf9', borderRadius: 9, padding: '7px 9px' }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: '#8aaa8a', textTransform: 'uppercase', letterSpacing: '.04em' }}>{METRICS[m].label}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: metricColor(m, r.metrics[m]) || '#1a3a1a', fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(r.metrics[m], m, currency)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function Thumb({ src, format }: { src: string | null; format: string }) {
  return (
    <div style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#f0f7ee', border: '1px solid rgba(0,0,0,0.06)' }}>
      {src ? <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{format === 'video' ? '🎬' : format === 'carousel' ? '🎠' : '🖼️'}</div>}
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '11px 14px', textAlign: 'right', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '11px 14px', textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap' }

// Minimal markdown → HTML for the AI panel (bold + line breaks + bullets only; no untrusted HTML).
function mdLite(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*]\s+(.*)$/gm, '• $1')
    .replace(/\n/g, '<br/>')
}
