'use client'
/**
 * GeneratedReport — the Motion-style report view.
 * Runs a template against /api/reports/generate and renders it with full controls:
 * Group by, date range, add/remove metric columns, card ⇄ table view, sort, Net Results row,
 * AI analysis (Mello), and Save / Share. onSave persists via the reports page (Stage 3).
 */
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { promptText } from '@/components/ConfirmDialog'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import { METRICS, GROUP_BY, TEMPLATE_BY_KEY, BUILTIN_PRESETS, FILTER_FIELD_BY_KEY, type MetricKey, type GroupByKey, type ReportFilter, type ColumnPreset } from '@/lib/reports/templates'
import ShareMenu from './ShareMenu'
import ReportFilters from './ReportFilters'
import MetricPicker from './MetricPicker'
import AdDetailDrawer from './AdDetailDrawer'

// Merge the connected account's custom-conversion columns (cc_<id> count / cpcc_<id> cost) into the
// shared METRICS registry so every label/format lookup + the Add-metric picker pick them up. Stale
// keys from a previously-viewed account are cleared first so columns never bleed across accounts.
function registerCustomMetrics(list?: { key: string; label: string; format: string; goodHigh: boolean }[]) {
  const M = METRICS as Record<string, any>
  for (const k of Object.keys(M)) if (/^(cc|ccv|cpcc)_/.test(k)) delete M[k]
  for (const cm of (list || [])) M[cm.key] = cm
}

// Meta thumbnail_url is hotlink-protected (403 without an fb referer) — proxy through weserv like
// every other image surface so report creatives actually render. R2/data URLs pass through.
const cdn = (u?: string | null, w = 400) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? (u || '') : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=${w}&q=75&output=webp`

function fmtMetric(v: number, key: MetricKey, currency: string): string {
  const m = METRICS[key]; const n = Number(v) || 0
  switch (m.format) {
    case 'currency': return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
    case 'percent': return n.toFixed(2) + '%'
    case 'ratio': return n.toFixed(2) + 'x'
    case 'seconds': return n.toFixed(1) + 's'
    case 'score': return String(Math.round(n))
    default: return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)
  }
}
// Colour a value good/bad relative to the column's direction (only for headline rate metrics).
function metricColor(key: MetricKey, v: number): string | undefined {
  if (key === 'roas') return v >= 2 ? '#2d7a2d' : v >= 1 ? '#b8860b' : '#c0392b'
  return undefined
}

const DATE_RANGES = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This week' }, { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' }, { key: 'last_month', label: 'Last month' },
  { key: 'last_7d', label: 'Last 7 days' }, { key: 'last_14d', label: 'Last 14 days' },
  { key: 'last_30d', label: 'Last 30 days' }, { key: 'last_90d', label: 'Last 90 days' }, { key: 'last_365d', label: 'Last 365 days' },
]
const DR_LABEL: Record<string, string> = Object.fromEntries(DATE_RANGES.map(d => [d.key, d.label]))

export default function GeneratedReport({ templateKey, onBack, onSave, onDelete, initialName, savedId, initialConfig }: {
  templateKey: string
  onBack: () => void
  onSave?: (payload: { id?: string; name: string; templateKey: string; config: any }) => Promise<boolean>
  onDelete?: (id: string) => Promise<void>
  initialName?: string
  savedId?: string
  initialConfig?: { groupBy?: GroupByKey; dateRange?: string; metrics?: MetricKey[]; sort?: MetricKey; dir?: 'asc' | 'desc'; view?: 'card' | 'bar' | 'line' | 'sprint' }
}) {
  const tpl = TEMPLATE_BY_KEY[templateKey]
  const ic = initialConfig || {}
  const [groupBy, setGroupBy] = useState<GroupByKey>(ic.groupBy || tpl?.groupBy || 'creative')
  const [dateRange, setDateRange] = useState(ic.dateRange || 'last_14d')
  const [metrics, setMetrics] = useState<MetricKey[]>(ic.metrics?.length ? ic.metrics : (tpl?.metrics || ['spend', 'roas']))
  const [sort, setSort] = useState<MetricKey>(ic.sort || tpl?.sort || 'spend')
  const [dir, setDir] = useState<'asc' | 'desc'>(ic.dir || tpl?.sortDir || 'desc')
  // Top visualization mode (the table always shows below). card | bar | line.
  const [view, setView] = useState<'card' | 'bar' | 'line' | 'sprint'>((['bar', 'line', 'sprint'].includes(ic.view as string) ? ic.view : 'card') as any)
  const [filters, setFilters] = useState<ReportFilter[]>((ic as any).filters || [])
  // Default AI tags ON for creative/ad reports so the colorful tag pills show like Motion (cheap + cached).
  const [aiTags, setAiTags] = useState<boolean>((ic as any).aiTags ?? (tpl?.groupBy === 'creative' || tpl?.groupBy === 'ad'))
  // Table settings + AI-tag columns (Motion's Table settings / AI tags toolbar).
  const [tagCols, setTagCols] = useState<string[]>((ic as any).tagCols || [])
  const [colorMode, setColorMode] = useState<'none' | 'green' | 'red' | 'gradient'>((ic as any).colorMode || ((ic as any).heatOn === false ? 'none' : 'green'))
  const [attribution, setAttribution] = useState<string>((ic as any).attribution || 'default')
  const [perPage, setPerPage] = useState<number>((ic as any).perPage || 20)
  const [showTags, setShowTags] = useState<boolean>((ic as any).showTags !== false)
  const [showLaunch, setShowLaunch] = useState<boolean>(!!(ic as any).showLaunch)
  const [showStatus, setShowStatus] = useState<boolean>(!!(ic as any).showStatus)
  const [cardAspect, setCardAspect] = useState<string>((ic as any).cardAspect || '4 / 5')  // 9:16 | 4:5 | 1:1 creative tile size
  const needsTagData = aiTags || tagCols.some(c => c !== 'asset_type') || filters.some(f => FILTER_FIELD_BY_KEY[f.field]?.type === 'tag')
  // Column presets (Custom dropdown + KPI picker). User presets persist in localStorage.
  const [showPicker, setShowPicker] = useState(false)
  const [detailAd, setDetailAd] = useState<{ id: string; name?: string } | null>(null)
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
  const [folder, setFolder] = useState<string>((ic as any).folder || '')
  const [saveDialog, setSaveDialog] = useState(false)
  const [folderInput, setFolderInput] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [knownFolders, setKnownFolders] = useState<string[]>([])
  const [shareOpen, setShareOpen] = useState(false)

  // AI
  const [aiOpen, setAiOpen] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [askMode, setAskMode] = useState(false)
  const [askText, setAskText] = useState('')
  const [syncedAt, setSyncedAt] = useState<number>(() => Date.now())

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const p = new URLSearchParams({ template: templateKey, dateRange, groupBy, sort, dir, metrics: metrics.join(',') })
      if (filters.length) p.set('filters', JSON.stringify(filters))
      if (needsTagData) p.set('aiTags', '1')
      if (attribution && attribution !== 'default') p.set('attribution', attribution)
      const res = await fetch(`/api/reports/generate?${p}`)
      const json = await res.json()
      registerCustomMetrics(json.customMetrics)
      if (json.error && !json.rows?.length) setError(json.error === 'no_account' ? 'Connect a Meta ad account to build this report.' : json.error)
      setData(json)
      setSyncedAt(Date.now())
      setAiText('') // stale once controls change
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [templateKey, dateRange, groupBy, sort, dir, metrics, filters, needsTagData, attribution])

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

  const doSave = async (overrideName?: string, overrideFolder?: string) => {
    if (!onSave) return
    const finalName = (overrideName ?? name).trim() || todayName()
    const finalFolder = (overrideFolder ?? folder).trim()
    setName(finalName); setFolder(finalFolder)
    setSaving(true)
    const ok = await onSave({ id: savedId, name: finalName, templateKey, config: { groupBy, dateRange, metrics, sort, dir, view, filters, aiTags, tagCols, colorMode, attribution, perPage, showTags, showLaunch, showStatus, cardAspect, folder: finalFolder || undefined } })
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2500) }
  }
  // Save-dialog flow: existing reports update in place; new ones prompt for a name (defaulting to
  // today's date) + an optional folder, offering the folders already used across saved reports.
  const openSave = () => {
    if (savedId) { doSave(); return }
    setNameInput(name && name !== (tpl?.title || 'Untitled report') ? name : todayName())
    setFolderInput(folder)
    fetch('/api/reports/saved').then(r => r.json()).then(j => {
      const fs = Array.from(new Set([...(j.reports || []), ...(j.shared || [])].map((r: any) => r.config?.folder).filter(Boolean))) as string[]
      setKnownFolders(fs)
    }).catch(() => {})
    setSaveDialog(true)
  }
  const confirmSave = async () => { setSaveDialog(false); await doSave(nameInput, folderInput) }

  // Snapshot payload for the Share menu — the CURRENT data, frozen.
  const sharePayload = () => ({
    name, templateKey, emoji: tpl?.emoji, description: tpl?.description,
    groupBy, dateRange, metrics, currency, rows, netResults: net,
  })

  const availableToAdd = (Object.keys(METRICS) as MetricKey[]).filter(m => !metrics.includes(m))

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
          {/* Last synced — click to re-sync live from Meta */}
          <button onClick={() => load()} title="Sync now (fetch the latest from Meta)" disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', border: 'none', cursor: loading ? 'default' : 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#7c8577' }}>
            {agoLabel(syncedAt)}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c8577" strokeWidth="2" style={loading ? { animation: 'spin 1s linear infinite' } : undefined}><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button onClick={() => runAI('analyze')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#dffe95', color: '#0e1b12', border: 'none', fontFamily: FONT, fontSize: 13.5, fontWeight: 700, padding: '10px 16px', borderRadius: 11, cursor: 'pointer', boxShadow: '0 5px 14px -6px rgba(223,254,149,.9)' }}>
            <svg width="15" height="15" viewBox="0 0 20 20" fill="#0e1b12"><path d="M10 1.5l1.7 4.6 4.8 1.7-4.8 1.7L10 14.1 8.3 9.5 3.5 7.8l4.8-1.7z" /><circle cx="16" cy="15" r="1.5" /></svg>
            Analyze
          </button>
          {onSave && <button onClick={openSave} disabled={saving} style={{ background: saved ? '#2f8f2f' : '#fff', color: saved ? '#fff' : '#1a3a1a', border: '1px solid rgba(26,58,26,.14)', fontFamily: FONT, fontSize: 13.5, fontWeight: 600, padding: '10px 16px', borderRadius: 11, cursor: 'pointer' }}>{saving ? 'Saving…' : saved ? 'Saved ✓' : savedId ? 'Update' : 'Save'}</button>}
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
          {DR_LABEL[dateRange] || dateRange}
          <select value={dateRange} onChange={e => setDateRange(e.target.value)} style={pillSelect}>
            {DATE_RANGES.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <Chevron />
        </label>
        <button onClick={() => setAiTags(v => !v)} title="Tag creatives with AI (Visual format, Hook, Audience…)"
          style={{ display: 'flex', alignItems: 'center', gap: 6, borderRadius: 11, padding: '9px 13px', fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: aiTags ? 'none' : '1px solid rgba(124,58,237,.3)', background: aiTags ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#faf5ff', color: aiTags ? '#fff' : '#7c3aed' }}>✨ AI tags</button>
        <ReportFilters filters={filters} onChange={setFilters} currency={currency} />
      </div>

      {/* Mello quick-prompt chips */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
          {[
            { key: 'ask', label: 'Ask me anything', icon: '💬' },
            { key: 'brief', label: 'Write a brief from top performers', icon: '📝' },
            { key: 'testing', label: 'Give me a testing plan', icon: '🧪' },
            { key: 'patterns', label: 'Spot patterns in winners', icon: '🔍' },
            { key: 'working', label: "What's working and what's not", icon: '📊' },
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
                  <button onClick={() => setAddOpen(o => !o)} className="mds-int" style={toolBtn}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 1v10M1 6h10" strokeLinecap="round" /></svg> Add metric
                  </button>
                  {addOpen && (
                    <div style={{ position: 'absolute', left: 0, top: '112%', zIndex: 30, background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, boxShadow: 'var(--mds-popover-shadow)', padding: 8, width: 320, maxHeight: 320, overflowY: 'auto' }}>
                      {availableToAdd.map(m => (
                        <button key={m} onClick={() => addMetric(m)} className="mds-menu-item" style={{ width: '100%', textAlign: 'left', height: 32, padding: '0 8px', borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#171717', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          {METRICS[m].label}{METRICS[m].video && <span style={{ fontSize: 9, color: '#8f8f8f' }}>🎬</span>}
                        </button>
                      ))}
                      {!availableToAdd.length && <div style={{ padding: 10, fontSize: 12, color: '#6f6f6f' }}>All metrics added.</div>}
                    </div>
                  )}
                </div>
                {/* numbered metric chips — Motion geometry: 32px tall / 10px radius / white / 1px border,
                    with a 16×16 4px-radius order badge whose pastel colour cycles per slot position. */}
                {metrics.map((m: MetricKey, i: number) => (
                  <span key={m} className="mds-int" style={{ display: 'flex', alignItems: 'center', gap: 7, height: 32, background: '#fff', border: '1px solid rgba(0,0,0,0.09)', borderRadius: 10, padding: '0 8px', fontSize: 14, fontWeight: 500, color: '#171717' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, background: METRIC_BADGES[i % METRIC_BADGES.length], color: '#171717', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                    <span onClick={() => toggleSort(m)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>{METRICS[m]?.label || m}</span>
                    {metrics.length > 1 && <span className="mds-x" onClick={() => removeMetric(m)} title="Remove" style={{ cursor: 'pointer', color: '#8f8f8f', marginLeft: -1, padding: '0 2px' }}>✕</span>}
                  </span>
                ))}
                {/* Save the current metric/tag columns as a reusable preset (Motion's floating ＋ Save). */}
                <button onClick={async () => { const n = await promptText({ title: 'Save these columns as a preset', placeholder: 'Preset name' }); if (n) savePreset(n, metrics, tagCols) }}
                  title="Save these columns as a preset"
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#dffe95', border: 'none', borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 800, color: '#0e1b12', cursor: 'pointer', fontFamily: FONT }}
                  onMouseEnter={e => e.currentTarget.style.background = '#eaffb0'} onMouseLeave={e => e.currentTarget.style.background = '#dffe95'}>
                  ＋ Save
                </button>
                <div style={{ flex: 1 }} />
                {/* view toggle: cards / bar / line / sprint (time-series). The table always shows below. */}
                <div style={{ display: 'flex', gap: 3, background: '#f4f6f0', border: '1px solid rgba(26,58,26,.1)', borderRadius: 10, padding: 3 }}>
                  {([['card', 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'], ['bar', 'M4 20V10M10 20V4M16 20v-7M22 20H2'], ['line', 'M3 17l6-6 4 4 8-8'], ['sprint', 'M3 12h4l3 8 4-16 3 8h4']] as const).map(([v, d]) => (
                    <button key={v} onClick={() => setView(v)} title={v === 'card' ? 'Cards' : v === 'bar' ? 'Bar chart' : v === 'line' ? 'Line chart' : 'Sprint (over time)'} style={{ width: 30, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: view === v ? '#0e1b12' : 'transparent' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={view === v ? '#dffe95' : '#7c8577'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
                    </button>
                  ))}
                </div>
              </div>
              {view === 'card' ? <CardsGrid rows={rows} metrics={metrics} sort={sort} currency={currency} aspect={cardAspect} onSee={setGroupBy} onOpenAd={(id: string, nm?: string) => setDetailAd({ id, name: nm })} />
                : view === 'sprint' ? <SprintView templateKey={templateKey} dateRange={dateRange} groupBy={groupBy} sort={sort} metrics={metrics} currency={currency} />
                : <ChartView rows={rows} metrics={metrics} sort={sort} currency={currency} type={view} />}
            </div>
          </div>

          {/* Table panel — always shown below the cards (Motion stacks both). */}
          <TablePanel rows={rows} metrics={metrics} sort={sort} dir={dir} currency={currency} net={net} groupLabel={groupLabel}
            onSort={toggleSort} count={data?.count}
            tagCols={tagCols} onToggleTagCol={(c: string) => setTagCols(cols => cols.includes(c) ? cols.filter(x => x !== c) : [...cols, c])}
            settings={{ colorMode, attribution, perPage, showTags, showLaunch, showStatus, cardAspect }}
            setColorMode={setColorMode} setAttribution={setAttribution} setPerPage={setPerPage} setShowTags={setShowTags} setShowLaunch={setShowLaunch} setShowStatus={setShowStatus} setCardAspect={setCardAspect}
            presets={[...BUILTIN_PRESETS, ...userPresets]} onApplyPreset={applyPreset} onCustomize={() => setShowPicker(true)} onSee={setGroupBy}
            onOpenAd={(id: string, nm?: string) => setDetailAd({ id, name: nm })} />
        </>
      )}

      {showPicker && (
        <MetricPicker metrics={metrics} tagCols={tagCols}
          onApply={(m, t) => { setMetrics(m); setTagCols(t) }}
          onSavePreset={savePreset} onClose={() => setShowPicker(false)} />
      )}

      {detailAd && <AdDetailDrawer adId={detailAd.id} name={detailAd.name} dateRange={dateRange} onClose={() => setDetailAd(null)} />}

      {saveDialog && (
        <div onClick={() => setSaveDialog(false)} style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(14,27,18,.32)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 380, background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 24px 60px rgba(0,0,0,.28)', fontFamily: FONT }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#0e1b12', marginBottom: 16 }}>Save report</div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#6f6f6f', marginBottom: 6 }}>Report name</label>
            <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && confirmSave()}
              style={{ width: '100%', height: 38, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,.14)', fontFamily: FONT, fontSize: 14, color: '#171717', outline: 'none', boxSizing: 'border-box', marginBottom: 14 }} />
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#6f6f6f', marginBottom: 6 }}>Folder <span style={{ fontWeight: 400, color: '#9aa196' }}>(optional)</span></label>
            <input list="rp-folders" value={folderInput} onChange={e => setFolderInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && confirmSave()} placeholder="e.g. Weekly, Q3, Client A"
              style={{ width: '100%', height: 38, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(0,0,0,.14)', fontFamily: FONT, fontSize: 14, color: '#171717', outline: 'none', boxSizing: 'border-box' }} />
            <datalist id="rp-folders">{knownFolders.map(f => <option key={f} value={f} />)}</datalist>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setSaveDialog(false)} style={{ height: 36, padding: '0 16px', borderRadius: 10, border: '1px solid rgba(0,0,0,.12)', background: '#fff', color: '#3a4636', fontFamily: FONT, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmSave} style={{ height: 36, padding: '0 18px', borderRadius: 10, border: 'none', background: '#0e1b12', color: '#dffe95', fontFamily: FONT, fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        .rp-scroll::-webkit-scrollbar{height:9px;width:9px}
        .rp-scroll::-webkit-scrollbar-thumb{background:rgba(26,58,26,.16);border-radius:8px}
        .rp-row:hover{background:#fafcf5}
        .rp-card:hover{box-shadow:0 10px 24px -16px rgba(14,27,18,.5)}
        .rp-card:hover .rp-card-open{opacity:1}
      `}</style>
     </div>
    </div>
  )
}

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
// Default saved-report name = today's date, e.g. "Jul 12, 2026".
function todayName(): string {
  return new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
// Relative "synced X ago" label.
function agoLabel(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 10) return 'Synced just now'
  if (s < 60) return `Synced ${s}s ago`
  if (s < 3600) return `Synced ${Math.floor(s / 60)}m ago`
  if (s < 86400) return `Synced ${Math.floor(s / 3600)}h ago`
  return `Synced ${Math.floor(s / 86400)}d ago`
}
const pill: React.CSSProperties = { position: 'relative', display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid rgba(26,58,26,.14)', borderRadius: 11, padding: '9px 13px', fontSize: 13, fontWeight: 600, color: '#3a4636', cursor: 'pointer', fontFamily: FONT }
const pillSelect: React.CSSProperties = { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', fontFamily: FONT }
const panelStyle: React.CSSProperties = { background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 20, boxShadow: '0 12px 30px -22px rgba(14,27,18,.4)', marginBottom: 20 }
const toolBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, height: 32, background: '#f4f6f0', border: '1px solid rgba(26,58,26,.1)', borderRadius: 10, padding: '0 12px', fontFamily: FONT, fontSize: 14, fontWeight: 500, color: '#3a4636', cursor: 'pointer' }
const Chevron = () => <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#7c8577" strokeWidth="1.7"><path d="M2 4l4 4 4-4" strokeLinecap="round" /></svg>

// Soft lime-green heat fill for a cell, strength 0..1 (matches the design's heatmap).
const heat = (strength: number) => strength <= 0.001 ? 'transparent' : `rgba(140,200,74,${(0.14 + strength * 0.5).toFixed(2)})`
// Conditional cell fill by color-formatting mode: green (high=good), red (high=intense red),
// gradient (red→amber→green across the column range), or none.
const cellBg = (mode: string, strength: number) => {
  const s = Math.max(0, Math.min(1, strength))
  if (mode === 'none' || s <= 0.001) return 'transparent'
  if (mode === 'red') return `rgb(${Math.round(255 - 49 * s)},${Math.round(229 - 71 * s)},${Math.round(229 - 78 * s)})`   // error-4 → error-7 ramp
  if (mode === 'gradient') { const hue = s * 120; return `hsla(${hue},62%,60%,${(0.18 + s * 0.32).toFixed(2)})` }
  // Motion green conditional ramp: mid rgb(206,243,218) → best rgb(173,235,194).
  return `rgb(${Math.round(206 - 33 * s)},${Math.round(243 - 8 * s)},${Math.round(218 - 24 * s)})`
}
// Metrics that get a heatmap fill (higher = better, and not Spend which stays plain).
const heatable = (m: MetricKey) => METRICS[m].goodHigh && m !== 'spend'
// Net Results shows an average (not a sum) for rate/cost metrics.
const isAvg = (m: MetricKey) => ['percent', 'ratio', 'seconds', 'score'].includes(METRICS[m].format) || ['cpm', 'cpc', 'cpa'].includes(m)

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

function TablePanel({ rows, metrics, sort, dir, currency, net, groupLabel, onSort, count, tagCols, onToggleTagCol, settings, setColorMode, setAttribution, setPerPage, setShowTags, setShowLaunch, setShowStatus, setCardAspect, presets, onApplyPreset, onCustomize, onSee, onOpenAd }: any) {
  const [menu, setMenu] = useState<string | null>(null)
  const [presetQ, setPresetQ] = useState('')
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
          <button className="mds-int" style={{ ...toolBtn, background: menu === 'custom' ? '#eaeee2' : '#f4f6f0' }} onClick={() => setMenu(menu === 'custom' ? null : 'custom')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2.5" /><path d="M3 9h18M9 21V9" strokeLinecap="round" /></svg>
            Custom <Chevron />
          </button>
          {menu === 'custom' && (
            <div style={{ ...menuBox, width: 220 }}>
              <input autoFocus value={presetQ} onChange={e => setPresetQ(e.target.value)} placeholder="Search presets…"
                style={{ width: '100%', padding: '7px 10px', marginBottom: 6, borderRadius: 8, border: '1px solid rgba(26,58,26,.14)', fontFamily: FONT, fontSize: 12.5, outline: 'none', boxSizing: 'border-box' }} />
              {(presets || []).filter((p: any) => !presetQ || p.name.toLowerCase().includes(presetQ.toLowerCase())).map((p: any) => (
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
          <button className="mds-int" style={{ ...toolBtn, background: menu === 'settings' ? '#eaeee2' : '#f4f6f0' }} onClick={() => setMenu(menu === 'settings' ? null : 'settings')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" /></svg>
            Table settings <Chevron />
          </button>
          {menu === 'settings' && (
            <div style={menuBox}>
              <SettingRow label="Attribution window">
                <select value={settings.attribution} onChange={e => setAttribution(e.target.value)} style={{ ...miniSelect, minWidth: 128 }}>
                  <option value="default">Default (account)</option>
                  <option value="1d_click:none">1-day click</option>
                  <option value="7d_click:none">7-day click</option>
                  <option value="28d_click:none">28-day click</option>
                  <option value="1d_click:1d_view">1d click · 1d view</option>
                  <option value="7d_click:1d_view">7d click · 1d view</option>
                  <option value="28d_click:1d_view">28d click · 1d view</option>
                </select>
              </SettingRow>
              <SettingRow label="Color formatting">
                <div style={{ display: 'flex', gap: 5 }}>
                  {([['none', '#e6e9e0', 'None'], ['green', '#8cc84a', 'Green'], ['red', '#e8837a', 'Red'], ['gradient', 'linear-gradient(90deg,#e8837a,#f0d878,#8cc84a)', 'Gradient']] as const).map(([mode, bg, title]) => (
                    <button key={mode} title={title} onClick={() => setColorMode(mode)} style={{ width: 26, height: 20, borderRadius: 6, cursor: 'pointer', background: bg, border: settings.colorMode === mode ? '2px solid #0e1b12' : '1px solid rgba(26,58,26,.18)' }} />
                  ))}
                </div>
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
              <div style={{ padding: '8px 10px', borderTop: '1px solid rgba(26,58,26,.06)', marginTop: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#3a4636', marginBottom: 8 }}>Creative aspect ratio</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  {([['9 / 16', '9:16'], ['4 / 5', '4:5'], ['1 / 1', '1:1']] as const).map(([val, lbl]) => {
                    const on = settings.cardAspect === val
                    return (
                      <button key={val} onClick={() => setCardAspect(val)} style={{ width: 53, height: val === '9 / 16' ? 76 : 60, borderRadius: 2, border: on ? '1.5px solid #171717' : '1px solid #8f8f8f', background: on ? '#e8e8e8' : '#f3f3f3', cursor: 'pointer', fontFamily: FONT, fontSize: 11, fontWeight: 600, color: '#171717', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'background-color .075s ease-in-out' }}>
                        <span style={{ width: val === '9 / 16' ? 14 : val === '4 / 5' ? 20 : 22, aspectRatio: val, background: '#8f8f8f', borderRadius: 2 }} />
                        {lbl}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* AI tags */}
        <div style={{ position: 'relative', zIndex: 20 }}>
          <button className="mds-int" style={{ ...toolBtn, background: '#fff', border: '1px solid rgba(26,58,26,.12)' }} onClick={() => setMenu(menu === 'aitags' ? null : 'aitags')}>
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
              <tr key={r.key + i} className="rp-row" style={{ height: 56, borderBottom: '1px solid rgba(26,58,26,.06)', transition: 'background .12s' }}>
                <td style={{ ...tdStyle, textAlign: 'left', paddingLeft: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <button onClick={() => toggleRow(r.key)} style={{ width: 16, height: 16, borderRadius: 5, border: sel.has(r.key) ? '1.6px solid #6fb03a' : '1.6px solid #c2ccc0', background: sel.has(r.key) ? '#dffe95' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', padding: 0 }}>{sel.has(r.key) && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.2 2.3L9.5 3.5" stroke="#1a3a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}</button>
                    <span onClick={() => r.adId && onOpenAd?.(r.adId, r.name)} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, cursor: r.adId ? 'pointer' : 'default' }}>
                    <Thumb src={r.thumbnail} format={r.format} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0e1b12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 240 }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 500, color: '#9aa196' }}>{r.adCount} {r.adCount === 1 ? 'ad' : 'ads'}</div>
                      {settings.showTags && <TagPills tags={r.tags} max={3} rows={rows} onSee={onSee} />}
                    </div>
                    </span>
                  </div>
                </td>
                {dimCols.map(dc => <td key={dc.key} style={{ ...tdStyle, textAlign: 'left' }}>{dimCell(r, dc.key)}</td>)}
                {metrics.map((m: MetricKey) => {
                  const val = r.metrics[m] || 0
                  const showHeat = settings.colorMode !== 'none' && heatable(m)
                  const d = r.delta?.[m]
                  return (
                    <td key={m} style={{ ...tdStyle, paddingRight: m === metrics[metrics.length - 1] ? 18 : 14 }}>
                      {showHeat ? (
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#243d17', background: cellBg(settings.colorMode, val / colMax[m]), padding: '4px 9px', borderRadius: 7, fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(val, m, currency)}</span>
                      ) : (
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#3a4636', fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(val, m, currency)}</span>
                      )}
                      {d !== undefined && Math.abs(d) >= 0.5 && (
                        <div style={{ fontSize: 10.5, fontWeight: 700, marginTop: 2, color: (METRICS[m].goodHigh ? d > 0 : d < 0) ? '#2d7a2d' : '#c0392b' }}>{d > 0 ? '▲' : '▼'} {Math.abs(d).toFixed(0)}%</div>
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
const chartSel: React.CSSProperties = { padding: '6px 10px', borderRadius: 9, border: '1px solid rgba(26,58,26,.14)', fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: '#0e1b12', background: '#fff', cursor: 'pointer' }
// Metric order-badge palette — Motion cycles a small ordered pastel set by slot position: violet,
// salmon, teal, then more. Mapped to the metric INDEX (not identity); these exactly match the
// metric-selection checkbox fills.
const METRIC_BADGES = ['rgb(184,172,255)', 'rgb(255,158,148)', 'rgb(110,212,176)', 'rgb(150,200,255)', 'rgb(255,178,214)', 'rgb(240,224,140)']
function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', fontSize: 13, fontWeight: 600, color: '#3a4636' }}>{label}{children}</div>
}
// Dark monochrome switch (Motion's report display toggles): track gray-3 off → gray-12 on, white knob.
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return <button onClick={onClick} style={{ width: 34, height: 20, borderRadius: 999, border: 'none', cursor: 'pointer', background: on ? '#171717' : '#f3f3f3', position: 'relative', transition: 'background-color .075s ease-in-out', flexShrink: 0 }}>
    <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left .12s ease-in-out', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
  </button>
}

function CardsGrid({ rows, metrics, sort, currency, aspect = '4 / 5', onSee, onOpenAd }: any) {
  // Wider tiles for taller aspect ratios so 9:16 doesn't get absurdly narrow.
  const minW = aspect === '9 / 16' ? 220 : aspect === '1 / 1' ? 300 : 280
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(${minW}px,100%),1fr))`, gap: 12 }}>
      {rows.map((r: any, i: number) => (
        <div key={r.key + i} className="rp-card" onClick={() => r.adId && onOpenAd?.(r.adId, r.name)} style={{ border: '1px solid rgba(26,58,26,.1)', borderRadius: 16, overflow: 'hidden', background: '#fff', cursor: r.adId ? 'pointer' : 'default' }}>
          {/* creative preview — aspect set by the card display setting (9:16 / 4:5 / 1:1) */}
          <div style={{ position: 'relative', aspectRatio: aspect, background: '#0e1b12', overflow: 'hidden' }}>
            {r.thumbnail
              ? <img src={cdn(r.thumbnail, 500)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.visibility = 'hidden' }} />
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, color: '#c6d2ba' }}>{r.format === 'video' ? '🎬' : r.format === 'carousel' ? '🎠' : '🖼️'}</div>}
            {r.format === 'video' && <span style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 44, height: 44, borderRadius: 100, background: 'rgba(14,27,18,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 17, paddingLeft: 3 }}>▶</span>}
            <span style={{ position: 'absolute', left: 10, bottom: 10, background: 'rgba(14,27,18,.82)', color: '#f4f7ef', fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 8, backdropFilter: 'blur(4px)' }}>{r.adCount} {r.adCount === 1 ? 'ad' : 'ads'}</span>
            {/* click-to-view — revealed on hover */}
            {r.adId && (
              <div className="rp-card-open" style={{ position: 'absolute', inset: 0, background: 'rgba(14,27,18,.42)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0, transition: 'opacity .15s' }}>
                <span style={{ width: 46, height: 46, borderRadius: '50%', background: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0e1b12" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
                </span>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fff' }}>View details</span>
              </div>
            )}
          </div>
          {/* body */}
          <div style={{ padding: '13px 14px 14px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0e1b12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
            <TagPills tags={r.tags} max={3} rows={rows} onSee={onSee} />
            <div style={{ marginTop: 11 }}>
              {metrics.map((m: MetricKey, idx: number) => (
                <div key={m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 28, borderTop: idx === 0 ? 'none' : '1px solid rgba(26,58,26,.07)' }}>
                  <span style={{ fontSize: 14, fontWeight: 400, color: '#6f6f6f' }}>{METRICS[m]?.label || m}</span>
                  <span style={{ fontSize: 14, fontWeight: idx === 0 ? 700 : 600, color: metricColor(m, r.metrics[m]) || '#171717', fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(r.metrics[m], m, currency)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Compact axis-tick formatter for a given metric's format.
const axisFmt = (m: MetricKey) => (v: any) => { const f = METRICS[m]?.format; return f === 'currency' ? (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)) : f === 'percent' ? v + '%' : f === 'ratio' ? v + 'x' : f === 'score' ? String(Math.round(v)) : new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v) }

// Bar/line chart of the report. Bar view is a grouped, DUAL-AXIS comparison (Motion type B): a primary
// metric on the left axis + an optional secondary metric on the right, one bar each per segment, with a
// representative creative thumbnail under each column. Line view plots the single primary metric.
function ChartView({ rows, metrics, sort, currency, type }: any) {
  const [metric, setMetric] = useState<MetricKey>(sort)
  const [metric2, setMetric2] = useState<MetricKey | ''>(() => (metrics as MetricKey[]).find((m: MetricKey) => m !== sort && METRICS[m]?.format !== METRICS[sort as MetricKey]?.format) || '')
  const short = (s: string) => s.length > 14 ? s.slice(0, 13) + '…' : s
  const dual = type === 'bar' && !!metric2 && metric2 !== metric
  const data = [...rows].sort((a, b) => (b.metrics[metric] || 0) - (a.metrics[metric] || 0)).slice(0, 16)
    .map((r: any) => ({ name: short(r.name), full: r.name, thumb: r.thumbnail || '', value: r.metrics[metric] || 0, value2: metric2 ? (r.metrics[metric2] || 0) : 0 }))
  const tickFmt = axisFmt(metric), tickFmt2 = metric2 ? axisFmt(metric2 as MetricKey) : tickFmt
  const hasThumbs = data.some((d: any) => d.thumb)
  // X-axis tick that shows the segment name and, when available, its creative thumbnail beneath.
  const ThumbTick = (props: any) => {
    const { x, y, payload } = props; const d = data.find((r: any) => r.name === payload.value)
    return (
      <g transform={`translate(${x},${y})`}>
        {d?.thumb && <image href={cdn(d.thumb, 60)} x={-15} y={6} width={30} height={30} preserveAspectRatio="xMidYMid slice" clipPath="inset(0 round 5px)" />}
        <text x={0} y={d?.thumb ? 48 : 12} textAnchor="middle" fill="#7c8577" fontSize={10}>{payload.value}</text>
      </g>
    )
  }
  const xTickProps = hasThumbs ? { tick: <ThumbTick />, height: 72 } : { tick: { fontSize: 10, fill: '#7c8577' }, angle: -35, textAnchor: 'end' as const, height: 70 }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#7c8577' }}>Metric:</span>
        <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} style={chartSel}>
          {metrics.map((m: MetricKey) => <option key={m} value={m}>{METRICS[m]?.label || m}</option>)}
        </select>
        {type === 'bar' && (
          <>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#7c8577' }}>vs.</span>
            <select value={metric2} onChange={e => setMetric2(e.target.value as MetricKey)} style={chartSel}>
              <option value="">— none —</option>
              {metrics.filter((m: MetricKey) => m !== metric).map((m: MetricKey) => <option key={m} value={m}>{METRICS[m]?.label || m}</option>)}
            </select>
          </>
        )}
      </div>
      {dual && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 11.5, fontWeight: 700 }}>
          <span style={{ color: '#6fb03a' }}>▉ {METRICS[metric]?.label} (left)</span>
          <span style={{ color: '#3b82f6' }}>▉ {METRICS[metric2 as MetricKey]?.label} (right)</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={hasThumbs ? 380 : 360}>
        {type === 'bar' ? (
          <BarChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: hasThumbs ? 20 : 70 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1e8" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} {...xTickProps} />
            <YAxis yAxisId="left" tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#9aa196' }} axisLine={false} tickLine={false} width={48} />
            {dual && <YAxis yAxisId="right" orientation="right" tickFormatter={tickFmt2} tick={{ fontSize: 11, fill: '#9aa196' }} axisLine={false} tickLine={false} width={48} />}
            <RTooltip formatter={(v: any, k: any) => fmtMetric(v, k === 'value2' ? (metric2 as MetricKey) : metric, currency)} labelFormatter={(l: any, p: any) => p?.[0]?.payload?.full || l} />
            <Bar yAxisId="left" dataKey="value" name={METRICS[metric]?.label} radius={[5, 5, 0, 0]} maxBarSize={dual ? 22 : 44}>
              {!dual && data.map((d: any, i: number) => <Cell key={i} fill={metricColor(metric, d.value) || '#6fb03a'} />)}
              {dual && data.map((d: any, i: number) => <Cell key={i} fill="#6fb03a" />)}
            </Bar>
            {dual && <Bar yAxisId="right" dataKey="value2" name={METRICS[metric2 as MetricKey]?.label} radius={[5, 5, 0, 0]} maxBarSize={22} fill="#3b82f6" />}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 70 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1e8" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#7c8577' }} axisLine={false} tickLine={false} angle={-35} textAnchor="end" interval={0} height={70} />
            <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#9aa196' }} axisLine={false} tickLine={false} width={48} />
            <RTooltip formatter={(v: any) => fmtMetric(v, metric, currency)} labelFormatter={(l: any, p: any) => p?.[0]?.payload?.full || l} />
            <Line type="monotone" dataKey="value" stroke="#2d7a2d" strokeWidth={2.5} dot={{ r: 3, fill: '#2d7a2d' }} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

// Sprint (time-series) view — a metric plotted over weekly/daily/monthly buckets, one line per top
// group, plus a bold "Overall" line, and a trend table classifying each group Scaling / Stable /
// Fatiguing. Fetches /api/reports/sprints on demand (its own bucketed pass over the connected account).
const SPRINT_COLORS = ['#2d7a2d', '#1d4ed8', '#c2410c', '#6d28d9', '#be185d', '#0e7490', '#b45309', '#0891b2']
function SprintView({ templateKey, dateRange, groupBy, sort, metrics, currency }: any) {
  const [metric, setMetric] = useState<MetricKey>(sort)
  const [increment, setIncrement] = useState<'weekly' | 'daily' | 'monthly'>('weekly')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true); setErr(''); setAiText('')
    const p = new URLSearchParams({ template: templateKey, dateRange, groupBy, metric, increment })
    fetch(`/api/reports/sprints?${p}`).then(r => r.json()).then(j => {
      if (!live) return
      if (j.error && !j.series?.length) setErr(j.error === 'no_account' ? 'Connect a Meta ad account.' : j.error)
      setData(j)
    }).catch(e => live && setErr(e.message)).finally(() => live && setLoading(false))
    return () => { live = false }
  }, [templateKey, dateRange, groupBy, metric, increment])

  const analyzeTrends = async () => {
    if (!data?.series?.length) return
    setAiLoading(true); setAiText('')
    try {
      const res = await fetch('/api/reports/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateKey, mode: 'sprints', groupBy, currency,
          metricLabel: data.metricLabel, increment: data.increment,
          sprints: (data.series || []).map((s: any) => ({ name: s.name, value: s.metricTotal, spend: s.totalSpend, trendPct: s.trendPct, trend: s.trendGood === null ? 'Stable' : s.trendGood ? 'Scaling' : 'Fatiguing' })),
        }),
      })
      const j = await res.json()
      setAiText(j.analysis || j.error || 'Could not analyze.')
    } catch (e: any) { setAiText(e.message) }
    finally { setAiLoading(false) }
  }

  const fmt = METRICS[metric]?.format || 'number'
  const tickFmt = (v: any) => fmt === 'currency' ? (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(Math.round(v))) : fmt === 'percent' ? v + '%' : fmt === 'ratio' ? v + 'x' : fmt === 'score' ? String(Math.round(v)) : new Intl.NumberFormat('en-US', { notation: 'compact' }).format(v)
  const dateLabel = (d: string) => { const [y, m, day] = d.split('-'); const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] || m; return increment === 'monthly' ? `${mo} ${String(y).slice(2)}` : `${mo} ${Number(day)}` }

  const series: any[] = data?.series || []
  const buckets: string[] = data?.buckets || []
  const lineSeries = series.slice(0, 6)   // keep the chart legible; the table lists all
  const chartData = buckets.map((d, i) => {
    const row: any = { date: dateLabel(d) }
    lineSeries.forEach((s, si) => { row[`s${si}`] = s.points?.[i]?.value ?? 0 })
    row.__all = data?.overall?.[i]?.value ?? 0
    return row
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: '#7c8577' }}>Metric:</span>
        <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)} style={{ padding: '6px 10px', borderRadius: 9, border: '1px solid rgba(26,58,26,.14)', fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: '#0e1b12', background: '#fff', cursor: 'pointer' }}>
          {metrics.map((m: MetricKey) => <option key={m} value={m}>{METRICS[m]?.label || m}</option>)}
        </select>
        <button onClick={analyzeTrends} disabled={aiLoading || !data?.series?.length} title="Mello reads the momentum trends"
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#0e1b12', border: 'none', borderRadius: 999, padding: '6px 13px', fontSize: 12, fontWeight: 800, color: '#dffe95', cursor: aiLoading ? 'default' : 'pointer', fontFamily: FONT, opacity: aiLoading || !data?.series?.length ? 0.6 : 1 }}>
          ✨ {aiLoading ? 'Reading trends…' : 'Analyze trends'}
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 3, background: '#f4f6f0', border: '1px solid rgba(26,58,26,.1)', borderRadius: 10, padding: 3 }}>
          {(['daily', 'weekly', 'monthly'] as const).map(inc => (
            <button key={inc} onClick={() => setIncrement(inc)} style={{ padding: '5px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 11.5, fontWeight: 700, textTransform: 'capitalize', color: increment === inc ? '#dffe95' : '#7c8577', background: increment === inc ? '#0e1b12' : 'transparent' }}>{inc}</button>
          ))}
        </div>
      </div>

      {(aiText || aiLoading) && (
        <div style={{ marginBottom: 14, background: 'linear-gradient(180deg,#f6faef,#fff)', border: '1px solid #e3ecd4', borderRadius: 12, padding: '13px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: aiText ? 8 : 0 }}>
            <span style={{ fontSize: 12.5 }}>✨</span>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: '#5a7a3a' }}>Mello · momentum read</span>
          </div>
          {aiLoading ? <div style={{ fontSize: 12.5, color: '#9aa196' }}>Reading the trends…</div>
            : <div style={{ fontSize: 13, lineHeight: 1.6, color: '#243d17', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: mdLite(aiText) }} />}
        </div>
      )}

      {loading ? <div style={{ padding: 60, textAlign: 'center', color: '#9aa196', fontSize: 13 }}>Building sprint…</div>
        : err ? <div style={{ padding: 40, textAlign: 'center', color: '#c0392b', fontSize: 13 }}>{err}</div>
        : !buckets.length ? <div style={{ padding: 40, textAlign: 'center', color: '#9aa196', fontSize: 13 }}>No time-series data in this range. Try a longer date range.</div>
        : (
          <>
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1e8" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10.5, fill: '#7c8577' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#9aa196' }} axisLine={false} tickLine={false} width={48} />
                <RTooltip formatter={(v: any, k: any) => [fmtMetric(v, metric, currency), k === '__all' ? 'Overall' : (lineSeries[Number(String(k).slice(1))]?.name || k)]} />
                <Line type="monotone" dataKey="__all" stroke="#0e1b12" strokeWidth={2.5} strokeDasharray="5 4" dot={false} />
                {lineSeries.map((s, si) => <Line key={si} type="monotone" dataKey={`s${si}`} stroke={SPRINT_COLORS[si % SPRINT_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />)}
              </LineChart>
            </ResponsiveContainer>

            {/* Trend table — every returned group with a momentum classification */}
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 12, padding: '4px 8px', fontSize: 9.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa196' }}>
                <span>{(GROUP_BY.find((g: any) => g.key === groupBy)?.label) || 'Group'}</span>
                <span style={{ textAlign: 'right' }}>Spend</span>
                <span style={{ textAlign: 'right' }}>{data?.metricLabel || METRICS[metric]?.label}</span>
                <span style={{ textAlign: 'right', minWidth: 96 }}>Trend</span>
              </div>
              {series.map((s, i) => {
                const good = s.trendGood
                const color = good === null ? '#9aa196' : good ? '#2d7a2d' : '#c0392b'
                const badge = good === null ? 'Stable' : good ? 'Scaling' : 'Fatiguing'
                const arrow = good === null ? '→' : (s.trendPct >= 0 ? '▲' : '▼')
                const dot = i < lineSeries.length ? SPRINT_COLORS[i % SPRINT_COLORS.length] : 'transparent'
                return (
                  <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 12, alignItems: 'center', padding: '7px 8px', borderRadius: 8, background: i % 2 ? 'transparent' : '#fafbf7', fontSize: 12.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: dot, flexShrink: 0, border: dot === 'transparent' ? '1px solid #dfe4d8' : 'none' }} />
                      {s.thumbnail && <img src={cdn(s.thumbnail, 60)} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} />}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#243d17', fontWeight: 600 }}>{s.name}</span>
                    </div>
                    <span style={{ textAlign: 'right', color: '#7c8577', fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(s.totalSpend, 'spend' as MetricKey, currency)}</span>
                    <span style={{ textAlign: 'right', color: '#0e1b12', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtMetric(s.metricTotal, metric, currency)}</span>
                    <span style={{ textAlign: 'right', minWidth: 96, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 5 }}>
                      <span style={{ color, fontWeight: 800, fontSize: 11 }}>{arrow} {good === null ? '' : Math.abs(s.trendPct).toFixed(0) + '%'}</span>
                      <span style={{ fontSize: 9.5, fontWeight: 800, color, background: good === null ? '#f0f2ec' : good ? '#eaf7e6' : '#fdecea', padding: '2px 7px', borderRadius: 999 }}>{badge}</span>
                    </span>
                  </div>
                )
              })}
              {data?.truncated > 0 && <div style={{ padding: '8px', fontSize: 11, color: '#9aa196', textAlign: 'center' }}>+{data.truncated} more groups not shown (top {series.length} by spend)</div>}
            </div>
          </>
        )}
    </div>
  )
}

// AI creative-tag pills, colour-coded by dimension. Skips empty / Unknown / None / Other values.
// [dimension, bg, fg, icon] — icon mirrors Motion's category glyphs on the pills.
const PILL_DIMS: [string, string, string, string][] = [
  ['visual_format', '#eff6ff', '#1d4ed8', '▦'],
  ['messaging_theme', '#f0fdf4', '#15803d', '💬'],
  ['intended_audience', '#fff7ed', '#c2410c', '👥'],
  ['hook_tactic', '#f5f3ff', '#6d28d9', '🪝'],
  ['offer_type', '#fdf2f8', '#be185d', '🏷'],
  ['headline_tactic', '#ecfeff', '#0e7490', '✍'],
  ['seasonality', '#fffbeb', '#b45309', '📅'],
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
    .map(([k, bg, fg, icon]) => ({ k, v: tags[k] as string, bg, fg, icon }))
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
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, background: p.bg, color: p.fg, padding: '2px 7px', borderRadius: 5, whiteSpace: 'nowrap', cursor: rows ? 'help' : 'inherit' }}>
          <span style={{ fontSize: 9, opacity: .8 }}>{p.icon}</span>{p.v}
        </span>
      ))}
      {hover && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', left: Math.min(hover.x, window.innerWidth - 280), top: hover.y, transform: hover.below ? 'none' : 'translateY(-100%)', zIndex: 4000, width: 260, background: '#0e1b12', color: '#f4f7ef', borderRadius: 12, padding: 14, boxShadow: '0 16px 40px rgba(0,0,0,.4)', pointerEvents: 'none', fontFamily: FONT }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#9aa196', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{DIM_LABEL[hover.k] || hover.k}</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#dffe95', marginBottom: 2 }}>{hover.v}</div>
          {TAG_DESC[hover.v] && <div style={{ fontSize: 12, color: '#c9d2bf', marginBottom: 10 }}>{TAG_DESC[hover.v]}</div>}
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9aa196', marginBottom: thumbs.length ? 8 : 0, borderTop: '1px solid rgba(255,255,255,.1)', paddingTop: 8 }}>{sib.length} {sib.length === 1 ? 'creative' : 'creatives'} with this tag</div>
          {thumbs.length > 0 && (
            <div style={{ display: 'flex', gap: 5 }}>
              {thumbs.map((t, j) => <img key={j} src={cdn(t as string, 96)} alt="" style={{ width: 44, height: 44, borderRadius: 7, objectFit: 'cover', flexShrink: 0 }} />)}
            </div>
          )}
        </div>, document.body)}
    </div>
  )
}

function Thumb({ src, format }: { src: string | null; format: string }) {
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null)
  const enter = (e: React.MouseEvent) => {
    if (!src) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPreview({ x: r.right + 10, y: r.top })
  }
  return (
    <div onMouseEnter={enter} onMouseLeave={() => setPreview(null)}
      style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#f3f3f3', border: '1px solid rgba(0,0,0,0.06)', position: 'relative' }}>
      {src ? <img src={cdn(src, 96)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{format === 'video' ? '🎬' : format === 'carousel' ? '🎠' : '🖼️'}</div>}
      {/* hover preview — a larger creative frame, portalled so it's never clipped */}
      {preview && src && typeof document !== 'undefined' && createPortal(
        <div style={{ position: 'fixed', left: Math.min(preview.x, window.innerWidth - 230), top: Math.min(preview.y, window.innerHeight - 300), zIndex: 4000, width: 216, borderRadius: 12, overflow: 'hidden', boxShadow: '0 18px 44px rgba(0,0,0,.32)', border: '1px solid rgba(0,0,0,.1)', background: '#0e1b12', pointerEvents: 'none' }}>
          <img src={cdn(src, 432)} alt="" style={{ width: '100%', display: 'block', maxHeight: 288, objectFit: 'cover' }} />
          {format === 'video' && <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(14,27,18,.75)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 100 }}>🎬 Video</div>}
        </div>, document.body)}
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '11px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', color: '#6f6f6f', whiteSpace: 'nowrap' }
const tdStyle: React.CSSProperties = { padding: '11px 14px', textAlign: 'right', whiteSpace: 'nowrap' }

// Minimal markdown → HTML for the AI panel (bold + line breaks + bullets only; no untrusted HTML).
function mdLite(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-*]\s+(.*)$/gm, '• $1')
    .replace(/\n/g, '<br/>')
}
