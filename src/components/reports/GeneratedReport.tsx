'use client'
/**
 * GeneratedReport — the Motion-style report view.
 * Runs a template against /api/reports/generate and renders it with full controls:
 * Group by, date range, add/remove metric columns, card ⇄ table view, sort, Net Results row,
 * AI analysis (Mello), and Save / Share. onSave persists via the reports page (Stage 3).
 */
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { METRICS, GROUP_BY, TEMPLATE_BY_KEY, BUILTIN_PRESETS, type MetricKey, type GroupByKey, type ReportFilter, type ColumnPreset } from '@/lib/reports/templates'
import ShareMenu from './ShareMenu'
import ReportFilters from './ReportFilters'
import MetricPicker from './MetricPicker'

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
  // Table settings + AI-tag columns (Motion's Table settings / AI tags toolbar).
  const [tagCols, setTagCols] = useState<string[]>((ic as any).tagCols || [])
  const [heatOn, setHeatOn] = useState<boolean>((ic as any).heatOn !== false)
  const [perPage, setPerPage] = useState<number>((ic as any).perPage || 20)
  const [showTags, setShowTags] = useState<boolean>((ic as any).showTags !== false)
  const [showLaunch, setShowLaunch] = useState<boolean>(!!(ic as any).showLaunch)
  const [showStatus, setShowStatus] = useState<boolean>(!!(ic as any).showStatus)
  const needsTagData = aiTags || tagCols.some(c => c !== 'asset_type')
  // Column presets (Custom dropdown + KPI picker). User presets persist in localStorage.
  const [showPicker, setShowPicker] = useState(false)
  const [userPresets, setUserPresets] = useState<ColumnPreset[]>([])
  useEffect(() => { try { const s = localStorage.getItem('selfmade_report_presets'); if (s) setUserPresets(JSON.parse(s)) } catch {} }, [])
  const applyPreset = (p: ColumnPreset) => { setMetrics(p.metrics); setTagCols(p.tagCols || []) }
  const savePreset = (nm: string, m: MetricKey[], t: string[]) => {
    setUserPresets(prev => { const next = [...prev.filter(x => x.name !== nm), { name: nm, metrics: m, tagCols: t }]; try { localStorage.setItem('selfmade_report_presets', JSON.stringify(next)) } catch {} ; return next })
    setMetrics(m); setTagCols(t)
  }
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
  const [askMode, setAskMode] = useState(false)
  const [askText, setAskText] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const p = new URLSearchParams({ template: templateKey, dateRange, groupBy, sort, dir, metrics: metrics.join(',') })
      if (filters.length) p.set('filters', JSON.stringify(filters))
      if (needsTagData) p.set('aiTags', '1')
      const res = await fetch(`/api/reports/generate?${p}`)
      const json = await res.json()
      if (json.error && !json.rows?.length) setError(json.error === 'no_account' ? 'Connect a Meta ad account to build this report.' : json.error)
      setData(json)
      setAiText('') // stale once controls change
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [templateKey, dateRange, groupBy, sort, dir, metrics, filters, needsTagData])

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

  const runAI = async (mode = 'analyze', question = '') => {
    setAiOpen(true); setAskMode(mode === 'ask' && !question); if (mode === 'ask' && !question) return
    setAiLoading(true); setAiText('')
    try {
      const res = await fetch('/api/reports/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey, metrics, rows: rows.slice(0, 15), netResults: net, currency, groupBy, mode, question }),
      })
      const json = await res.json()
      setAiText(json.analysis || json.error || 'No analysis available.')
    } catch (e: any) { setAiText('Analysis failed: ' + e.message) }
    finally { setAiLoading(false) }
  }

  const doSave = async () => {
    if (!onSave) return
    setSaving(true)
    const ok = await onSave({ id: savedId, name, templateKey, config: { groupBy, dateRange, metrics, sort, dir, view, filters, aiTags, tagCols, heatOn, perPage, showTags, showLaunch, showStatus } })
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
          <button onClick={() => runAI('analyze')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#dffe95', color: '#0e1b12', border: 'none', fontFamily: FONT, fontSize: 13.5, fontWeight: 700, padding: '10px 16px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 5px 14px -6px rgba(223,254,149,.9)' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="#0e1b12"><path d="M10 1.5l1.7 4.6 4.8 1.7-4.8 1.7L10 14.1 8.3 9.5 3.5 7.8l4.8-1.7z" /><circle cx="16" cy="15" r="1.5" /></svg>
            Analyze
          </button>
          {onSave && <button onClick={doSave} disabled={saving} style={{ background: saved ? '#2f8f2f' : '#fff', color: saved ? '#fff' : '#1a3a1a', border: '1px solid rgba(26,58,26,.14)', fontFamily: FONT, fontSize: 13.5, fontWeight: 600, padding: '10px 16px', borderRadius: 11, cursor: 'pointer' }}>{saving ? 'Saving…' : saved ? 'Saved ✓' : savedId ? 'Update' : 'Save'}</button>}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShareOpen(o => !o)} disabled={!rows.length} style={{ background: '#0e1b12', color: '#f4f7ef', border: 'none', fontFamily: FONT, fontSize: 13.5, fontWeight: 700, padding: '10px 18px', borderRadius: 11, cursor: rows.length ? 'pointer' : 'not-allowed', opacity: rows.length ? 1 : 0.5 }}>Share report</button>
            {shareOpen && rows.length > 0 && (<><div onClick={() => setShareOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 39 }} /><ShareMenu payload={sharePayload} savedId={savedId} onClose={() => setShareOpen(false)} /></>)}
          </div>
        </div>
      </div>

      {/* AI analysis panel */}
      {aiOpen && (
        <div style={{ background: 'linear-gradient(135deg,#faf5ff,#f3e8ff)', border: '1px solid #e9d5ff', borderRadius: 16, padding: '16px 20px', marginBottom: 16, position: 'relative' }}>
          <button onClick={() => setAiOpen(false)} style={{ position: 'absolute', top: 12, right: 14, border: 'none', background: 'transparent', cursor: 'pointer', color: '#a855f7', fontSize: 14 }}>✕</button>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#7c3aed', marginBottom: 8 }}>✨ Ask Mello</div>
          {askMode && (
            <div style={{ display: 'flex', gap: 8, marginBottom: aiText || aiLoading ? 14 : 0 }}>
              <input value={askText} onChange={e => setAskText(e.target.value)} autoFocus placeholder="Ask anything about this report…"
                onKeyDown={e => { if (e.key === 'Enter' && askText.trim()) runAI('ask', askText.trim()) }}
                style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid #e9d5ff', background: '#fff', fontFamily: FONT, fontSize: 13.5, color: '#3b0764', outline: 'none' }} />
              <button onClick={() => askText.trim() && runAI('ask', askText.trim())} style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Ask</button>
            </div>
          )}
          {aiLoading ? <div style={{ color: '#9333ea', fontSize: 13 }}>Reading your data…</div>
            : aiText ? <div style={{ fontSize: 13.5, color: '#3b0764', lineHeight: 1.65 }} dangerouslySetInnerHTML={{ __html: mdLite(aiText) }} /> : null}
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

      {/* Mello quick-prompt chips */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          {[
            { key: 'ask', label: 'Ask me anything', icon: '💬' },
            { key: 'brief', label: 'Write a brief from top performers', icon: '📝' },
            { key: 'working', label: "What's working and what's not", icon: '📊' },
            { key: 'themes', label: 'What themes are in my ads?', icon: '🏷️' },
            { key: 'analyze', label: 'Analyze this report', icon: '✨' },
          ].map(c => (
            <button key={c.key} onClick={() => runAI(c.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 999, border: '1px solid rgba(26,58,26,.12)', background: c.key === 'analyze' ? 'linear-gradient(135deg,#faf5ff,#f3e8ff)' : '#fff', color: '#3a4636', fontFamily: FONT, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = c.key === 'analyze' ? '#f3e8ff' : '#f4f6f0'}
              onMouseLeave={e => e.currentTarget.style.background = c.key === 'analyze' ? 'linear-gradient(135deg,#faf5ff,#f3e8ff)' : '#fff'}>
              <span style={{ fontSize: 13 }}>{c.icon}</span>{c.label}
            </button>
          ))}
        </div>
      )}

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
              {view === 'card' && <CardsGrid rows={rows} metrics={metrics} sort={sort} currency={currency} onSee={setGroupBy} />}
            </div>
          </div>

          {/* Table panel */}
          <TablePanel rows={rows} metrics={metrics} sort={sort} dir={dir} currency={currency} net={net} groupLabel={groupLabel}
            onSort={toggleSort} count={data?.count}
            tagCols={tagCols} onToggleTagCol={(c: string) => setTagCols(cols => cols.includes(c) ? cols.filter(x => x !== c) : [...cols, c])}
            settings={{ heatOn, perPage, showTags, showLaunch, showStatus }}
            setHeatOn={setHeatOn} setPerPage={setPerPage} setShowTags={setShowTags} setShowLaunch={setShowLaunch} setShowStatus={setShowStatus}
            presets={[...BUILTIN_PRESETS, ...userPresets]} onApplyPreset={applyPreset} onCustomize={() => setShowPicker(true)} onSee={setGroupBy} />
        </>
      )}

      {showPicker && (
        <MetricPicker metrics={metrics} tagCols={tagCols}
          onApply={(m, t) => { setMetrics(m); setTagCols(t) }}
          onSavePreset={savePreset} onClose={() => setShowPicker(false)} />
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

// AI-tag column definitions (Motion's "AI tags" menu). asset_type maps to the derived format.
const AI_TAG_COLS: { key: string; label: string; group: string }[] = [
  { key: 'asset_type', label: 'Asset Type', group: 'Visual' },
  { key: 'visual_format', label: 'Visual Format', group: 'Visual' },
  { key: 'intended_audience', label: 'Intended Audience', group: 'Persona' },
  { key: 'messaging_theme', label: 'Messaging theme', group: 'Messaging' },
  { key: 'offer_type', label: 'Offer Type', group: 'Messaging' },
  { key: 'seasonality', label: 'Seasonality', group: 'Messaging' },
  { key: 'hook_tactic', label: 'Hook Tactic', group: 'Hook' },
  { key: 'headline_tactic', label: 'Headline Tactic', group: 'Hook' },
]
const AI_TAG_LABEL: Record<string, string> = Object.fromEntries(AI_TAG_COLS.map(c => [c.key, c.label]))
const AI_TAG_COLOR: Record<string, [string, string]> = {
  asset_type: ['#eef4dc', '#41611b'], visual_format: ['#fff7ed', '#c2410c'], hook_tactic: ['#eff6ff', '#1d4ed8'],
  messaging_theme: ['#f0fdf4', '#15803d'], offer_type: ['#fdf2f8', '#be185d'], intended_audience: ['#f0fdfa', '#0f766e'],
  headline_tactic: ['#faf5ff', '#7c3aed'], seasonality: ['#fffbeb', '#b45309'],
}
const cap1 = (s: string) => (s || '').charAt(0).toUpperCase() + (s || '').slice(1)
const STATUS_COLOR: Record<string, [string, string]> = { active: ['#f0fdf4', '#15803d'], paused: ['#f4f6f0', '#7c8577'], archived: ['#faf5f0', '#9a7b5a'] }

function TablePanel({ rows, metrics, sort, dir, currency, net, groupLabel, onSort, count, tagCols, onToggleTagCol, settings, setHeatOn, setPerPage, setShowTags, setShowLaunch, setShowStatus, presets, onApplyPreset, onCustomize, onSee }: any) {
  const [menu, setMenu] = useState<string | null>(null)
  const colMax: Record<string, number> = {}
  for (const m of metrics as MetricKey[]) colMax[m] = Math.max(...rows.map((r: any) => r.metrics[m] || 0), 0.0001)

  // Dimension columns rendered before the metrics: launch date, status, then AI-tag columns.
  const dimCols: { key: string; label: string }[] = []
  if (settings.showLaunch) dimCols.push({ key: '__launch', label: 'Launch date' })
  if (settings.showStatus) dimCols.push({ key: '__status', label: 'Status' })
  for (const c of tagCols) dimCols.push({ key: c, label: AI_TAG_LABEL[c] || c })

  const visibleRows = settings.perPage >= 9999 ? rows : rows.slice(0, settings.perPage)

  // Row selection — Net Results recomputes over the selected groups (default: all selected).
  const [sel, setSel] = useState<Set<string>>(() => new Set(rows.map((r: any) => r.key)))
  useEffect(() => { setSel(new Set(rows.map((r: any) => r.key))) }, [rows])
  const allSel = rows.length > 0 && sel.size === rows.length
  const toggleAll = () => setSel(allSel ? new Set() : new Set(rows.map((r: any) => r.key)))
  const toggleRow = (k: string) => setSel(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const selRows = rows.filter((r: any) => sel.has(r.key))
  const computedNet: Record<string, number> = {}
  for (const m of metrics as MetricKey[]) {
    if (isAvg(m)) { const vals = selRows.map((r: any) => r.metrics[m]).filter((v: number) => v > 0); computedNet[m] = vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0 }
    else computedNet[m] = selRows.reduce((s: number, r: any) => s + (r.metrics[m] || 0), 0)
  }

  const dimCell = (r: any, key: string) => {
    if (key === '__launch') return <span style={{ fontSize: 12.5, color: r.launchDate ? '#3a4636' : '#b5c5b5' }}>{r.launchDate || '—'}</span>
    if (key === '__status') { const [bg, fg] = STATUS_COLOR[r.status] || STATUS_COLOR.paused; return <span style={{ fontSize: 11, fontWeight: 700, background: bg, color: fg, padding: '3px 9px', borderRadius: 6 }}>{cap1(r.status || 'paused')}</span> }
    const val = key === 'asset_type' ? cap1(r.format) : (r.tags?.[key] || '')
    if (!val || ['Unknown', 'None', 'Other'].includes(val)) return <span style={{ fontSize: 12, color: '#c2ccc0' }}>—</span>
    const [bg, fg] = AI_TAG_COLOR[key] || ['#f4f6f0', '#3a4636']
    return <span style={{ fontSize: 11, fontWeight: 700, background: bg, color: fg, padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap' }}>{val}</span>
  }

  return (
    <div style={panelStyle}>
      {/* toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid rgba(26,58,26,.08)', position: 'relative' }}>
        {menu && <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />}

        {/* Custom (presets) */}
        <div style={{ position: 'relative', zIndex: 20 }}>
          <button style={{ ...toolBtn, background: menu === 'custom' ? '#eaeee2' : '#f4f6f0' }} onClick={() => setMenu(menu === 'custom' ? null : 'custom')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 21V9" strokeLinecap="round" /></svg>
            Custom <Chevron />
          </button>
          {menu === 'custom' && (
            <div style={{ ...menuBox, width: 220 }}>
              {(presets || []).map((p: any) => (
                <button key={p.name} onClick={() => { onApplyPreset(p); setMenu(null) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#0e1b12', fontFamily: FONT }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f4f6f0'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ flex: 1 }}>{p.name}</span>{p.builtin && <span style={{ fontSize: 9, fontWeight: 700, color: '#9aa196' }}>PRESET</span>}
                </button>
              ))}
              <div style={{ height: 1, background: 'rgba(26,58,26,.08)', margin: '6px 4px' }} />
              <button onClick={() => { onCustomize(); setMenu(null) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#2d7a2d', fontFamily: FONT }}
                onMouseEnter={e => e.currentTarget.style.background = '#f0f7ee'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>⚙ Customize columns</button>
            </div>
          )}
        </div>

        {/* Table settings */}
        <div style={{ position: 'relative', zIndex: 20 }}>
          <button style={{ ...toolBtn, background: menu === 'settings' ? '#eaeee2' : '#f4f6f0' }} onClick={() => setMenu(menu === 'settings' ? null : 'settings')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" /></svg>
            Table settings <Chevron />
          </button>
          {menu === 'settings' && (
            <div style={menuBox}>
              <SettingRow label="Color formatting">
                <Toggle on={settings.heatOn} onClick={() => setHeatOn(!settings.heatOn)} />
              </SettingRow>
              <SettingRow label="Results per page">
                <select value={settings.perPage} onChange={e => setPerPage(Number(e.target.value))} style={miniSelect}>
                  {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
                  <option value={9999}>All</option>
                </select>
              </SettingRow>
              <SettingRow label="Show tags"><Toggle on={settings.showTags} onClick={() => setShowTags(!settings.showTags)} /></SettingRow>
              <SettingRow label="Show active status"><Toggle on={settings.showStatus} onClick={() => setShowStatus(!settings.showStatus)} /></SettingRow>
              <SettingRow label="Show launch date"><Toggle on={settings.showLaunch} onClick={() => setShowLaunch(!settings.showLaunch)} /></SettingRow>
            </div>
          )}
        </div>

        {/* AI tags */}
        <div style={{ position: 'relative', zIndex: 20 }}>
          <button style={{ ...toolBtn, background: '#fff', border: '1px solid rgba(26,58,26,.12)' }} onClick={() => setMenu(menu === 'aitags' ? null : 'aitags')}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill="#7c3aed"><path d="M10 1.5l1.7 4.6 4.8 1.7-4.8 1.7L10 14.1 8.3 9.5 3.5 7.8l4.8-1.7z" /></svg>
            AI tags <Chevron />
          </button>
          {menu === 'aitags' && (
            <div style={{ ...menuBox, width: 230 }}>
              {['Visual', 'Persona', 'Messaging', 'Hook'].map(grp => (
                <div key={grp}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: '#9aa196', padding: '8px 10px 4px', textTransform: 'uppercase' }}>{grp}</div>
                  {AI_TAG_COLS.filter(c => c.group === grp).map(c => {
                    const on = tagCols.includes(c.key)
                    return (
                      <button key={c.key} onClick={() => onToggleTagCol(c.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: 'none', background: on ? '#f0f7ee' : 'transparent', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#0e1b12', fontFamily: FONT }}
                        onMouseEnter={e => { if (!on) e.currentTarget.style.background = '#f4f6f0' }} onMouseLeave={e => { if (!on) e.currentTarget.style.background = 'transparent' }}>
                        <span style={{ flex: 1 }}>{c.label}</span>
                        {on && <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="#2d7a2d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#7c8577' }}>{sel.size} ad {sel.size === 1 ? 'group' : 'groups'} selected</span>
      </div>

      <div className="rp-scroll" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
          <thead>
            <tr style={{ background: '#fafcf5', borderBottom: '1px solid rgba(26,58,26,.08)' }}>
              <th style={{ ...thStyle, textAlign: 'left', minWidth: 240, paddingLeft: 18 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 11 }}>
                  <button onClick={toggleAll} title={allSel ? 'Deselect all' : 'Select all'} style={{ width: 16, height: 16, borderRadius: 5, border: allSel ? 'none' : '1.6px solid #9aa196', background: allSel ? '#0e1b12' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>{allSel && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="#dffe95" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</button>
                  {(groupLabel || 'Creative').toUpperCase()}
                </span>
              </th>
              {dimCols.map(dc => <th key={dc.key} style={{ ...thStyle, textAlign: 'left' }}>{dc.label.toUpperCase()}</th>)}
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
            {visibleRows.map((r: any, i: number) => (
              <tr key={r.key + i} className="rp-row" style={{ borderBottom: '1px solid rgba(26,58,26,.06)', transition: 'background .12s' }}>
                <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <button onClick={() => toggleRow(r.key)} style={{ width: 16, height: 16, borderRadius: 5, border: sel.has(r.key) ? '1.6px solid #6fb03a' : '1.6px solid #c2ccc0', background: sel.has(r.key) ? '#dffe95' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', padding: 0 }}>{sel.has(r.key) && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="#1a3a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</button>
                    <Thumb src={r.thumbnail} format={r.format} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0e1b12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 500, color: '#9aa196' }}>{r.adCount} {r.adCount === 1 ? 'ad' : 'ads'}</div>
                      {settings.showTags && <TagPills tags={r.tags} max={3} rows={rows} onSee={onSee} />}
                    </div>
                  </div>
                </td>
                {dimCols.map(dc => <td key={dc.key} style={{ ...tdStyle, textAlign: 'left' }}>{dimCell(r, dc.key)}</td>)}
                {metrics.map((m: MetricKey) => {
                  const val = r.metrics[m] || 0
                  const showHeat = settings.heatOn && heatable(m)
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
              {dimCols.map(dc => <td key={dc.key} style={{ ...tdStyle, textAlign: 'left', color: '#5f6b5a' }}>—</td>)}
              {metrics.map((m: MetricKey) => (
                <td key={m} style={{ ...tdStyle, paddingRight: m === metrics[metrics.length - 1] ? 18 : 14, fontSize: 13, fontWeight: 700, color: isAvg(m) ? '#dffe95' : '#f4f7ef', fontVariantNumeric: 'tabular-nums' }}>
                  {isAvg(m) ? 'Avg ' : ''}{fmtMetric(computedNet[m] || 0, m, currency)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

const menuBox: React.CSSProperties = { position: 'absolute', left: 0, top: '112%', zIndex: 21, background: '#fff', border: '1px solid rgba(26,58,26,.12)', borderRadius: 12, boxShadow: '0 14px 40px rgba(0,0,0,.16)', padding: 8, width: 260 }
const miniSelect: React.CSSProperties = { padding: '4px 8px', borderRadius: 7, border: '1px solid rgba(26,58,26,.14)', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#0e1b12', background: '#fff', cursor: 'pointer' }
function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', fontSize: 13, fontWeight: 600, color: '#3a4636' }}>{label}{children}</div>
}
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button onClick={onClick} style={{ width: 34, height: 20, borderRadius: 999, border: 'none', cursor: 'pointer', background: on ? '#6fb03a' : '#d4d9cd', position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
    <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
  </button>
}

function CardsGrid({ rows, metrics, sort, currency, onSee }: any) {
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
            <TagPills tags={r.tags} max={3} rows={rows} onSee={onSee} />
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
  ['seasonality', '#fffbeb', '#b45309'],
]
const DIM_LABEL: Record<string, string> = { visual_format: 'Visual Format', hook_tactic: 'Hook Tactic', messaging_theme: 'Messaging Theme', offer_type: 'Offer Type', intended_audience: 'Intended Audience', headline_tactic: 'Headline Tactic', seasonality: 'Seasonality' }
// Short descriptions for the controlled-vocab tag values (shown in the hover tooltip).
const TAG_DESC: Record<string, string> = {
  Testimonial: "Customer's personal story", UGC: 'User-generated, native-feeling content', Unboxing: 'Product reveal / first impressions',
  Demo: 'Shows the product in use', 'Product Showcase': 'Hero shots of the product', 'Feature Callout': 'Highlights a specific feature',
  Lifestyle: 'Product woven into daily life', Montage: 'Fast-cut sequence of clips', 'Cinematic B-Roll': 'Polished, film-style footage',
  Greenscreen: 'Creator over a keyed background', 'Talking Head': 'Person speaking to camera', Comparison: 'Us-vs-them / before-after',
  'Before & After': 'Transformation reveal', 'Text-Heavy': 'Copy-led, minimal imagery', 'Founder Story': 'Founder speaks to the brand',
  'Problem/Solution': 'Names a pain, offers the fix', 'Social Proof': 'Reviews, ratings, popularity', 'Benefit-Led': 'Leads with the payoff',
  Emotional: 'Appeals to feeling', Educational: 'Teaches something useful', 'Offer/Discount': 'Price / promo is the hook',
  FOMO: 'Scarcity / urgency', Question: 'Opens with a question', 'Bold Claim': 'Big, attention-grabbing claim',
  'Problem Callout': 'Calls out the viewer’s problem', 'Pattern Interrupt': 'Unexpected opening', POV: 'First-person point of view',
  Discount: 'Money off', BOGO: 'Buy one get one', 'Free Shipping': 'No delivery cost', Bundle: 'Multi-item deal', 'No Offer': 'No explicit promo',
  Evergreen: 'Runs year-round', Holiday: 'Holiday-season angle', 'Black Friday': 'BFCM promo', Summer: 'Summer seasonal angle',
}

function TagPills({ tags, max = 3, rows, onSee }: { tags: any; max?: number; rows?: any[]; onSee?: (dim: string) => void }) {
  const [hover, setHover] = useState<{ k: string; v: string; x: number; y: number; below: boolean } | null>(null)
  if (!tags) return null
  const shown = PILL_DIMS
    .map(([k, bg, fg]) => ({ k, v: tags[k] as string, bg, fg }))
    .filter(x => x.v && !['Unknown', 'None', 'Other', ''].includes(x.v))
    .slice(0, max)
  if (!shown.length) return null

  const enter = (e: React.MouseEvent, k: string, v: string) => {
    if (!rows) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const below = r.top < 260
    setHover({ k, v, x: r.left, y: below ? r.bottom + 6 : r.top - 6, below })
  }
  const sib = hover ? (rows || []).filter(r => r.tags?.[hover.k] === hover.v) : []
  const thumbs = sib.map(r => r.thumbnail).filter(Boolean).slice(0, 5)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {shown.map((p, i) => (
        <span key={i} onMouseEnter={e => enter(e, p.k, p.v)} onMouseLeave={() => setHover(null)}
          style={{ fontSize: 10, fontWeight: 700, background: p.bg, color: p.fg, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', cursor: rows ? 'help' : 'inherit' }}>{p.v}</span>
      ))}
      {hover && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', left: Math.min(hover.x, window.innerWidth - 280), top: hover.y, transform: hover.below ? 'none' : 'translateY(-100%)', zIndex: 4000, width: 260, background: '#0e1b12', color: '#f4f7ef', borderRadius: 12, padding: 14, boxShadow: '0 16px 40px rgba(0,0,0,.4)', pointerEvents: 'none', fontFamily: FONT }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9aa196', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{DIM_LABEL[hover.k] || hover.k}</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#dffe95', marginBottom: 2 }}>{hover.v}</div>
          {TAG_DESC[hover.v] && <div style={{ fontSize: 12, color: '#c9d2bf', marginBottom: 10 }}>{TAG_DESC[hover.v]}</div>}
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9aa196', marginBottom: thumbs.length ? 8 : 0, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 8 }}>{sib.length} {sib.length === 1 ? 'creative' : 'creatives'} with this tag</div>
          {thumbs.length > 0 && (
            <div style={{ display: 'flex', gap: 5 }}>
              {thumbs.map((t, j) => <img key={j} src={t as string} alt="" style={{ width: 44, height: 44, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />)}
            </div>
          )}
        </div>, document.body)}
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
