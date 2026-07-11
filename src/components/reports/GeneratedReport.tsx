'use client'
/**
 * GeneratedReport — the Motion-style report view.
 * Runs a template against /api/reports/generate and renders it with full controls:
 * Group by, date range, add/remove metric columns, card ⇄ table view, sort, Net Results row,
 * AI analysis (Mello), and Save / Share. onSave persists via the reports page (Stage 3).
 */
import { useState, useEffect, useCallback } from 'react'
import { METRICS, GROUP_BY, TEMPLATE_BY_KEY, type MetricKey, type GroupByKey, type ReportFilter } from '@/lib/reports/templates'
import ShareMenu from './ShareMenu'
import ReportFilters from './ReportFilters'

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
  // Creative-level reports (grouped by creative or an AI tag) default to the big Cards view, like Motion.
  const initGroup = ic.groupBy || tpl?.groupBy || 'creative'
  const creativeGroup = initGroup === 'creative' || !!GROUP_BY.find(g => g.key === initGroup)?.ai
  const [view, setView] = useState<'card' | 'table'>(ic.view || (creativeGroup ? 'card' : 'table'))
  const [filters, setFilters] = useState<ReportFilter[]>((ic as any).filters || [])
  const [aiTags, setAiTags] = useState<boolean>(!!(ic as any).aiTags)
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
      if (filters.length) p.set('filters', JSON.stringify(filters))
      if (aiTags) p.set('aiTags', '1')
      const res = await fetch(`/api/reports/generate?${p}`)
      const json = await res.json()
      if (json.error && !json.rows?.length) setError(json.error === 'no_account' ? 'Connect a Meta ad account to build this report.' : json.error)
      setData(json)
      setAiText('') // stale once controls change
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [templateKey, dateRange, groupBy, sort, dir, metrics, filters, aiTags])

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
    const ok = await onSave({ id: savedId, name, templateKey, config: { groupBy, dateRange, metrics, sort, dir, view, filters, aiTags } })
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

  const groupLabel = GROUP_BY.find(g => g.key === groupBy)?.label || 'Creative'

  return (
    <div style={{ minHeight: '100vh', background: '#eef1e8', fontFamily: FONT, padding: '28px 30px 60px' }}>
     <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        <button onClick={onBack} title="Back" style={{ width: 40, height: 40, borderRadius: 12, border: '1px solid rgba(26,58,26,.14)', background: '#fff', color: '#1a3a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#dffe95,#b6e86a)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 20 }}>{tpl.emoji}</div>
        <div style={{ flex: 1, minWidth: 200, paddingTop: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ fontSize: 23, fontWeight: 800, color: '#0e1b12', letterSpacing: '-.02em', border: 'none', background: 'transparent', outline: 'none', fontFamily: 'inherit', padding: 0, minWidth: 0, width: Math.max(8, name.length + 1) + 'ch', maxWidth: '100%' }} />
            {savedId && <span style={{ fontSize: 11.5, fontWeight: 600, color: '#7c8577', background: '#fff', border: '1px solid rgba(26,58,26,.12)', padding: '3px 9px', borderRadius: 999 }}>Saved</span>}
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 500, color: '#6f7a68', marginTop: 3 }}>{tpl.description}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <button onClick={runAI} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#dffe95', color: '#0e1b12', border: 'none', fontFamily: FONT, fontSize: 13.5, fontWeight: 700, padding: '10px 16px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 5px 14px -6px rgba(223,254,149,.9)' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="#0e1b12"><path d="M10 1.5l1.7 4.6 4.8 1.7-4.8 1.7L10 14.1 8.3 9.5 3.5 7.8l4.8-1.7z" /><circle cx="16" cy="15" r="1.5" /></svg>
            Analyze
          </button>
          {onSave && <button onClick={doSave} disabled={saving} style={{ background: saved ? '#2f8f2f' : '#fff', color: saved ? '#fff' : '#1a3a1a', border: '1px solid rgba(26,58,26,.14)', fontFamily: FONT, fontSize: 13.5, fontWeight: 600, padding: '10px 16px', borderRadius: 11, cursor: 'pointer' }}>{saving ? 'Saving…' : saved ? 'Saved ✓' : savedId ? 'Update' : 'Save'}</button>}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShareOpen(o => !o)} disabled={!rows.length} style={{ background: '#0e1b12', color: '#f4f7ef', border: 'none', fontFamily: FONT, fontSize: 13.5, fontWeight: 700, padding: '10px 18px', borderRadius: 11, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}>Share report</button>
            {shareOpen && rows.length > 0 && (<><div onClick={() => setShareOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 39 }} /><ShareMenu payload={sharePayload} onClose={() => setShareOpen(false)} /></>)}
          </div>
        </div>
      </div>

      {/* AI analysis panel */}
      {aiOpen && (
        <div style={{ background: 'linear-gradient(135deg,#faf5ff,#f3e8ff)', border: '1px solid #e9d5ff', borderRadius: 16, padding: '16px 20px', marginBottom: 16, position: 'relative' }}>
          <button onClick={() => setAiOpen(false)} style={{ position: 'absolute', top: 12, right: 14, border: 'none', background: 'transparent', cursor: 'pointer', color: '#a855f7', fontSize: 14 }}>✕</button>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#7c3aed', marginBottom: 8 }}>✨ Mello's analysis</div>
          {aiLoading ? <div style={{ color: '#9333ea', fontSize: 13 }}>Reading your data…</div>
            : <div style={{ fontSize: 13.5, color: '#3b0764', lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: mdLite(aiText) }} />}
        </div>
      )}

      {/* Controls: Group by · Period · AI tags · Add filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <label style={pill}>
          Group by <span style={{ color: '#0e1b12', fontWeight: 700 }}>{groupLabel}</span>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value as GroupByKey)} style={pillSelect}>
            <optgroup label="Standard">{GROUP_BY.filter(g => !g.ai).map(g => <option key={g.key} value={g.key}>{g.label}</option>)}</optgroup>
            <optgroup label="✨ AI tags">{GROUP_BY.filter(g => g.ai).map(g => <option key={g.key} value={g.key}>{g.label}</option>)}</optgroup>
          </select>
          <Chevron />
        </label>
        <label style={pill}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1a3a1a" strokeWidth="1.8"><rect x="3" y="4" width="18" height="17" rx="2.5" /><path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" /></svg>
          Last {dateRange.replace('last_', '').replace('d', ' days')}
          <select value={dateRange} onChange={e => setDateRange(e.target.value)} style={pillSelect}>
            {DATE_RANGES.map(d => <option key={d.key} value={d.key}>Last {d.label}</option>)}
          </select>
          <Chevron />
        </label>
        <button onClick={() => setAiTags(v => !v)} title="Tag creatives with AI (Visual format, Hook, Audience…)"
          style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 11, padding: '9px 13px', fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: aiTags ? 'none' : '1px solid rgba(124,58,237,.3)', background: aiTags ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#faf5ff', color: aiTags ? '#fff' : '#7c3aed' }}>✨ AI tags</button>
        <ReportFilters filters={filters} onChange={setFilters} />
      </div>

      {/* AI tagging progress */}
      {!loading && data?.tagRemaining > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, background: 'linear-gradient(135deg,#faf5ff,#f3e8ff)', border: '1px solid #e9d5ff', borderRadius: 12, padding: '10px 16px' }}>
          <div style={{ fontSize: 12.5, color: '#6b21a8' }}>✨ AI tagged your top creatives. <b>{data.tagRemaining}</b> more not yet tagged.</div>
          <button onClick={load} style={{ padding: '6px 13px', borderRadius: 100, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: FONT, flexShrink: 0 }}>Tag {Math.min(30, data.tagRemaining)} more</button>
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
      ) : (
        <>
          {/* Visualization panel — metric toolbar + card grid */}
          <div style={panelStyle}>
            <div style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: view === 'card' ? 18 : 0, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setAddOpen(o => !o)} style={toolBtn}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 1v10M1 6h10" strokeLinecap="round" /></svg> Add metric
                  </button>
                  {addOpen && (
                    <div style={{ position: 'absolute', left: 0, top: '112%', zIndex: 30, background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.15)', padding: 8, width: 220, maxHeight: 320, overflowY: 'auto' }}>
                      {availableToAdd.map(m => (
                        <button key={m} onClick={() => addMetric(m)} style={{ width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12.5, color: '#1a3a1a', fontFamily: FONT, display: 'flex', justifyContent: 'space-between' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f4f6f0'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          {METRICS[m].label}{METRICS[m].video && <span style={{ fontSize: 9, color: '#8aaa8a' }}>🎬</span>}
                        </button>
                      ))}
                      {!availableToAdd.length && <div style={{ padding: 10, fontSize: 12, color: '#9ab09a' }}>All metrics added.</div>}
                    </div>
                  )}
                </div>
                {/* numbered metric chips */}
                {metrics.map((m: MetricKey, i: number) => (
                  <span key={m} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#eef4dc', border: '1px solid rgba(26,58,26,.1)', borderRadius: 999, padding: '6px 10px 6px 7px', fontSize: 12.5, fontWeight: 700, color: '#243d17' }}>
                    <span style={{ width: 17, height: 17, borderRadius: '50%', background: '#c8e58a', color: '#243d17', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                    <span onClick={() => toggleSort(m)} style={{ cursor: 'pointer' }}>{METRICS[m].label}</span>
                    {metrics.length > 1 && <span onClick={() => removeMetric(m)} title="Remove" style={{ cursor: 'pointer', color: '#6a7a52', marginLeft: -1 }}>✕</span>}
                  </span>
                ))}
                <div style={{ flex: 1 }} />
                {/* view toggle: cards / table-only */}
                <div style={{ display: 'flex', gap: 3, background: '#f4f6f0', border: '1px solid rgba(26,58,26,.1)', borderRadius: 10, padding: 3 }}>
                  {([['card', 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'], ['table', 'M4 6h16M4 12h16M4 18h16']] as const).map(([v, d]) => (
                    <button key={v} onClick={() => setView(v)} title={v === 'card' ? 'Cards' : 'Table only'} style={{ width: 30, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: view === v ? '#0e1b12' : 'transparent' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={view === v ? '#dffe95' : '#7c8577'} strokeWidth="2" strokeLinecap="round"><path d={d} /></svg>
                    </button>
                  ))}
                </div>
              </div>
              {view === 'card' && <CardsGrid rows={rows} metrics={metrics} sort={sort} currency={currency} />}
            </div>
          </div>

          {/* Table panel */}
          <TablePanel rows={rows} metrics={metrics} sort={sort} dir={dir} currency={currency} net={net} groupLabel={groupLabel}
            onSort={toggleSort} count={data?.count} />
        </>
      )}

      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .rp-scroll::-webkit-scrollbar{height:9px;width:9px}
        .rp-scroll::-webkit-scrollbar-thumb{background:rgba(26,58,26,.16);border-radius:8px}
        .rp-row:hover{background:#fafcf5}
        .rp-card:hover{box-shadow:0 10px 24px -16px rgba(14,27,18,.5)}
      `}</style>
     </div>
    </div>
  )
}

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const pill: React.CSSProperties = { position: 'relative', display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid rgba(26,58,26,.14)', borderRadius: 11, padding: '9px 13px', fontSize: 13, fontWeight: 600, color: '#3a4636', cursor: 'pointer', fontFamily: FONT }
const pillSelect: React.CSSProperties = { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', fontFamily: FONT }
const panelStyle: React.CSSProperties = { background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 20, boxShadow: '0 12px 30px -22px rgba(14,27,18,.4)', marginBottom: 20 }
const toolBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, background: '#f4f6f0', border: '1px solid rgba(26,58,26,.1)', borderRadius: 10, padding: '7px 13px', fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: '#3a4636', cursor: 'pointer' }
const Chevron = () => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#7c8577" strokeWidth="1.7"><path d="M2 4l4 4 4-4" strokeLinecap="round" /></svg>

// Soft lime-green heat fill for a cell, strength 0..1 (matches the design's heatmap).
const heat = (strength: number) => strength <= 0.001 ? 'transparent' : `rgba(140,200,74,${(0.14 + strength * 0.5).toFixed(2)})`
// Metrics that get a heatmap fill (higher = better, and not Spend which stays plain).
const heatable = (m: MetricKey) => METRICS[m].goodHigh && m !== 'spend'
// Net Results shows an average (not a sum) for rate/cost metrics.
const isAvg = (m: MetricKey) => ['percent', 'ratio', 'seconds'].includes(METRICS[m].format) || ['cpm', 'cpc', 'cpa'].includes(m)

function TablePanel({ rows, metrics, sort, dir, currency, net, groupLabel, onSort, count }: any) {
  const colMax: Record<string, number> = {}
  for (const m of metrics as MetricKey[]) colMax[m] = Math.max(...rows.map((r: any) => r.metrics[m] || 0), 0.0001)
  return (
    <div style={panelStyle}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid rgba(26,58,26,.08)' }}>
        <span style={toolBtn}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 21V9" strokeLinecap="round" /></svg>
          Custom <Chevron />
        </span>
        <span style={{ ...toolBtn, background: '#fff', border: '1px solid rgba(26,58,26,.12)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" /></svg>
          Table settings
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#7c8577' }}>{count || rows.length} ad {(count || rows.length) === 1 ? 'group' : 'groups'}</span>
      </div>

      <div className="rp-scroll" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr style={{ background: '#fafcf5', borderBottom: '1px solid rgba(26,58,26,.08)' }}>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 250, paddingLeft: 18 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}>
                  <span style={{ width: 16, height: 16, borderRadius: 5, background: '#0e1b12', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="#dffe95" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                  {(groupLabel || 'Creative').toUpperCase()}
                </span>
              </th>
              {metrics.map((m: MetricKey) => (
                <th key={m} style={{ ...thStyle, paddingRight: m === metrics[metrics.length - 1] ? 18 : 14 }} onClick={() => onSort(m)}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: sort === m ? '#0e1b12' : '#8a9182' }}>
                    {METRICS[m].label.toUpperCase()}{sort === m && <span style={{ fontSize: 9 }}>{dir === 'desc' ? '▼' : '▲'}</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={r.key + i} className="rp-row" style={{ borderBottom: '1px solid rgba(26,58,26,.06)', transition: 'background .12s' }}>
                <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <span style={{ width: 16, height: 16, borderRadius: 5, border: '1.6px solid #6fb03a', background: '#dffe95', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="#1a3a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                    <Thumb src={r.thumbnail} format={r.format} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0e1b12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 500, color: '#9aa196' }}>{r.adCount} {r.adCount === 1 ? 'ad' : 'ads'}</div>
                      <TagPills tags={r.tags} max={3} />
                    </div>
                  </div>
                </td>
                {metrics.map((m: MetricKey) => {
                  const val = r.metrics[m] || 0
                  const showHeat = heatable(m)
                  return (
                    <td key={m} style={{ ...tdStyle, paddingRight: m === metrics[metrics.length - 1] ? 18 : 14 }}>
                      {showHeat ? (
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#243d17', background: heat(val / colMax[m]), padding: '4px 9px', borderRadius: 7, fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(val, m, currency)}</span>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#3a4636', fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(val, m, currency)}</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: '#0e1b12' }}>
              <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 18 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 800, color: '#f4f7ef' }}>
                  Net Results
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a9182" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" strokeLinecap="round" /></svg>
                </span>
              </td>
              {metrics.map((m: MetricKey) => (
                <td key={m} style={{ ...tdStyle, paddingRight: m === metrics[metrics.length - 1] ? 18 : 14, fontSize: 13, fontWeight: 700, color: isAvg(m) ? '#dffe95' : '#f4f7ef', fontVariantNumeric: 'tabular-nums' }}>
                  {isAvg(m) ? 'Avg ' : ''}{fmtMetric(net[m] || 0, m, currency)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function CardsGrid({ rows, metrics, sort, currency }: any) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px,100%),1fr))', gap: 16 }}>
      {rows.map((r: any, i: number) => (
        <div key={r.key + i} className="rp-card" style={{ border: '1px solid rgba(26,58,26,.1)', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
          {/* creative preview 16:10 */}
          <div style={{ position: 'relative', aspectRatio: '16 / 10', background: '#0e1b12', overflow: 'hidden' }}>
            {r.thumbnail
              ? <img src={r.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.visibility = 'hidden' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: '#c6d2ba' }}>{r.format === 'video' ? '🎬' : r.format === 'carousel' ? '🎠' : '🖼️'}</div>}
            {r.format === 'video' && <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 44, height: 44, borderRadius: 100, background: 'rgba(14,27,18,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 17, paddingLeft: 3 }}>▶</span>}
            <span style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(14,27,18,.82)', color: '#f4f7ef', fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 8, backdropFilter: 'blur(4px)' }}>{r.adCount} {r.adCount === 1 ? 'ad' : 'ads'}</span>
          </div>
          {/* body */}
          <div style={{ padding: '13px 14px 14px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0e1b12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
            <TagPills tags={r.tags} max={3} />
            <div style={{ marginTop: 11 }}>
              {metrics.map((m: MetricKey, idx: number) => (
                <div key={m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: idx === 0 ? '0 0 8px' : '8px 0 0', borderTop: idx === 0 ? 'none' : '1px solid rgba(26,58,26,.07)' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: '#7c8577' }}>{METRICS[m].label}</span>
                  <span style={{ fontSize: 13, fontWeight: idx === 0 ? 700 : 800, color: metricColor(m, r.metrics[m]) || '#243d17', fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(r.metrics[m], m, currency)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// AI creative-tag pills, colour-coded by dimension. Skips empty / Unknown / None / Other values.
const PILL_DIMS: [string, string, string][] = [
  ['visual_format', '#fff7ed', '#c2410c'],
  ['hook_tactic', '#eff6ff', '#1d4ed8'],
  ['messaging_theme', '#f0fdf4', '#15803d'],
  ['offer_type', '#fdf2f8', '#be185d'],
  ['intended_audience', '#f0fdfa', '#0f766e'],
  ['headline_tactic', '#faf5ff', '#7c3aed'],
]
function TagPills({ tags, max = 3 }: { tags: any; max?: number }) {
  if (!tags) return null
  const shown = PILL_DIMS
    .map(([k, bg, fg]) => ({ v: tags[k] as string, bg, fg }))
    .filter(x => x.v && !['Unknown', 'None', 'Other', ''].includes(x.v))
    .slice(0, max)
  if (!shown.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {shown.map((p, i) => (
        <span key={i} style={{ fontSize: 10, fontWeight: 700, background: p.bg, color: p.fg, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap' }}>{p.v}</span>
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

const thStyle: React.CSSProperties = { padding: '11px 14px', textAlign: 'right', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: '#8a9182', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '11px 14px', textAlign: 'right', whiteSpace: 'nowrap' }

// Minimal markdown → HTML for the AI panel (bold + line breaks + bullets only; no untrusted HTML).
function mdLite(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*]\s+(.*)$/gm, '• $1')
    .replace(/\n/g, '<br/>')
}
