'use client'
/**
 * Ad-detail drawer (Motion-style). Opens when you click a creative in a report. Left = the ad creative
 * (video/image + copy + CTA). Right = tabs: Overview (spend/roas/launch/status + Ask Mello),
 * Performance (age×gender + placement bar charts, video-retention curve, metrics with presets),
 * Ad comments / Transcript / Notes. Data from /api/reports/ad/[adId].
 */
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid } from 'recharts'
import { BUILTIN_PRESETS, METRICS, type MetricKey } from '@/lib/reports/templates'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const cdn = (u?: string | null, w = 500) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? (u || '') : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=${w}&q=80&output=webp`
const money = (n: number, c: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: n >= 1000 ? 0 : 2 }).format(n || 0)
const compact = (n: number, c: string) => (n >= 1000 ? `${c} ${(n / 1000).toFixed(2)}K` : money(n, c))

const TABS = ['Overview', 'Performance', 'Ad comments', 'Transcript', 'Notes'] as const
type Tab = typeof TABS[number]

export default function AdDetailDrawer({ adId, name, dateRange = 'last_14d', onClose }: {
  adId: string; name?: string; dateRange?: string; onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('Overview')
  const [dr, setDr] = useState(dateRange)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/reports/ad/${adId}?dateRange=${dr}`).then(r => r.json()).then(setData).catch(() => setData({ error: 'Failed' })).finally(() => setLoading(false))
  }, [adId, dr])

  const c = data?.creative || {}
  const cur = data?.currency || 'USD'

  const copyLink = async () => { try { await navigator.clipboard.writeText(`${window.location.origin}/reports?ad=${adId}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {} }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(10,20,13,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, padding: '3vh 20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 1080, height: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 40px 90px -20px rgba(0,0,0,.5)' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid rgba(26,58,26,.08)' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#0e1b12', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || name || 'Ad'}</span>
            <span style={{ fontSize: 11, color: '#9aa196', flexShrink: 0 }}>{adId}</span>
          </div>
          <div style={{ position: 'relative' }}>
            <select value={dr} onChange={e => setDr(e.target.value)} style={{ appearance: 'none', padding: '8px 30px 8px 32px', borderRadius: 10, border: '1px solid rgba(26,58,26,.14)', background: '#fff', fontFamily: FONT, fontSize: 12.5, fontWeight: 600, color: '#0e1b12', cursor: 'pointer' }}>
              {[['last_7d', 'Last 7 days'], ['last_14d', 'Last 14 days'], ['last_30d', 'Last 30 days'], ['last_90d', 'Last 90 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <span style={{ position: 'absolute', left: 11, top: 9, pointerEvents: 'none' }}>📅</span>
          </div>
          <button onClick={copyLink} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: 'none', background: '#0e1b12', color: '#f4f7ef', fontFamily: FONT, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>🔗 {copied ? 'Copied' : 'Copy link'}</button>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: 'none', background: '#f4f6f0', color: '#7c8577', cursor: 'pointer', fontSize: 15 }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', flex: 1, minHeight: 0 }}>
          {/* Left — creative */}
          <div style={{ borderRight: '1px solid rgba(26,58,26,.08)', overflowY: 'auto', padding: 20, background: '#fafcf9' }}>
            <div style={{ background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#eef4dc', color: '#41611b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{(c.headline || c.name || 'A')[0]}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0e1b12' }}>Sponsored</div>
                </div>
              </div>
              {c.body && <div style={{ padding: '0 13px 11px', fontSize: 13, color: '#1a2a1a', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.body.slice(0, 300)}</div>}
              <div style={{ background: '#000', position: 'relative', aspectRatio: '4 / 5' }}>
                {c.videoUrl
                  ? <video src={c.videoUrl} poster={cdn(c.thumbnail)} controls playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
                  : (c.thumbnail || c.image)
                  ? <img src={cdn(c.thumbnail || c.image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#556', fontSize: 34 }}>🎬</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 13px' }}>
                <span style={{ fontSize: 12, color: '#7c8577' }}>{c.landing ? new URL(c.landing.startsWith('http') ? c.landing : 'https://' + c.landing).hostname : ''}</span>
                {c.cta && <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0e1b12', background: '#eef1e8', padding: '6px 12px', borderRadius: 8 }}>{c.cta.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (m: string) => m.toUpperCase())}</span>}
              </div>
            </div>
          </div>

          {/* Right — tabs */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ display: 'flex', gap: 4, padding: '10px 20px 0', borderBottom: '1px solid rgba(26,58,26,.08)' }}>
              {TABS.map(t => (
                <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: 600, color: tab === t ? '#0e1b12' : '#9aa196', borderBottom: tab === t ? '2px solid #0e1b12' : '2px solid transparent', marginBottom: -1 }}>{t}</button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
              {loading && tab !== 'Notes' && tab !== 'Transcript' && tab !== 'Ad comments' ? <div style={{ color: '#7c8577', padding: 30 }}>Loading…</div>
                : tab === 'Overview' ? (data?.error ? <div style={{ color: '#c0392b', padding: 30 }}>{data.error}</div> : <Overview data={data} cur={cur} adId={adId} name={c.name || name} />)
                : tab === 'Performance' ? <Performance data={data} cur={cur} />
                : tab === 'Notes' ? <NotesTab adId={adId} />
                : tab === 'Transcript' ? <TranscriptTab adId={adId} hasVideo={!!c.videoUrl || data?.hasVideo} />
                : tab === 'Ad comments' ? <CommentsTab adId={adId} />
                : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Overview({ data, cur, adId, name }: any) {
  const o = data.overview || {}
  const roasColor = o.roas >= 2 ? '#2d7a2d' : o.roas >= 1 ? '#b8860b' : '#c0392b'
  return (
    <div>
      <div style={{ background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 14, padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#7c8577' }}>Spend</span>
          {o.launchedRecently && <span style={{ fontSize: 10, fontWeight: 800, background: '#eef4dc', color: '#41611b', padding: '2px 8px', borderRadius: 100 }}>New</span>}
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: '#0e1b12' }}>{compact(o.spend, cur)}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 16, borderTop: '1px solid rgba(26,58,26,.07)', paddingTop: 14 }}>
          <div><div style={lbl}>ROAS</div><div style={{ fontSize: 18, fontWeight: 800, color: roasColor }}>{(o.roas || 0).toFixed(2)}</div></div>
          <div><div style={lbl}>Launch date</div><div style={{ fontSize: 15, fontWeight: 700, color: '#0e1b12' }}>{o.launchDate || '—'}</div></div>
          <div><div style={lbl}>Status</div><div style={{ fontSize: 15, fontWeight: 700, color: o.status === 'active' ? '#15803d' : '#7c8577', display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: o.status === 'active' ? '#22c55e' : '#9aa196' }} />{(o.status || 'paused').replace(/^\w/, (m: string) => m.toUpperCase())}</div></div>
        </div>
      </div>

      {/* Ask Mello — our creative-strategy CTA (Motion's "Runneth") */}
      <div style={{ background: 'linear-gradient(135deg,#f6ffe0,#eafcbf)', border: '1px solid #d6ee9a', borderRadius: 14, padding: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: 22, marginBottom: 6 }}>✨</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0e1b12' }}>Ask Mello about this creative</div>
        <div style={{ fontSize: 12.5, color: '#5a6b52', margin: '5px 0 14px', lineHeight: 1.5 }}>Analyze this ad, find what's working, and get next steps for your team.</div>
        <button onClick={() => window.location.href = `/mello?ad=${adId}`} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: '#0e1b12', color: '#dffe95', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: FONT }}>Analyze with Mello →</button>
      </div>
    </div>
  )
}

function Performance({ data, cur }: any) {
  const [metricSel, setMetricSel] = useState<'impressions' | 'spend' | 'purchases'>('impressions')
  const [preset, setPreset] = useState('Facebook Ecommerce')
  const ag = (data.ageGender || []).map((r: any) => ({ age: r.age, Male: r.male, Female: r.female }))
  const plc = (data.placement || []).map((r: any) => ({ name: `${r.platform} ${r.position}`.trim(), Impressions: r.impressions, Spend: r.spend }))
  const ret = data.retention || []
  const m = data.metrics || {}
  const presetMetrics = (BUILTIN_PRESETS.find(p => p.name === preset)?.metrics || []) as MetricKey[]
  const fmtM = (k: string) => {
    const met = METRICS[k as MetricKey]; const v = (m as any)[k] ?? 0
    if (k === 'revenue') return money(m.revenue, cur)
    if (!met) return String(v)
    if (met.format === 'currency') return money(v, cur)
    if (met.format === 'percent') return v.toFixed(2) + '%'
    if (met.format === 'ratio') return v.toFixed(2)
    return new Intl.NumberFormat('en-US').format(Math.round(v))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      {/* Gender & age */}
      <section>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0e1b12', marginBottom: 12 }}>Gender &amp; age breakdown</div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#5a6b52', marginBottom: 6 }}><Legend c="#7c4dff" l="Male" /><Legend c="#14b8a6" l="Female" /></div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={ag} margin={{ top: 16, right: 10, left: -10, bottom: 0 }}>
            <XAxis dataKey="age" tick={{ fontSize: 11, fill: '#7c8577' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9aa196' }} axisLine={false} tickLine={false} width={40} />
            <RTooltip formatter={(v: any) => new Intl.NumberFormat('en-US').format(v)} />
            <Bar dataKey="Male" fill="#7c4dff" radius={[4, 4, 0, 0]} maxBarSize={22} />
            <Bar dataKey="Female" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Placement */}
      {plc.length > 0 && (
        <section>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0e1b12', marginBottom: 12 }}>Placement breakdown</div>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#5a6b52', marginBottom: 6 }}><Legend c="#7c4dff" l="Impressions" /><Legend c="#14b8a6" l="Spend" /></div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={plc} margin={{ top: 16, right: 10, left: -10, bottom: 30 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#7c8577' }} axisLine={false} tickLine={false} angle={-20} textAnchor="end" interval={0} height={40} />
              <YAxis tick={{ fontSize: 11, fill: '#9aa196' }} axisLine={false} tickLine={false} width={40} />
              <RTooltip formatter={(v: any, n: any) => n === 'Spend' ? money(v, cur) : new Intl.NumberFormat('en-US').format(v)} />
              <Bar dataKey="Impressions" fill="#7c4dff" radius={[4, 4, 0, 0]} maxBarSize={20} />
              <Bar dataKey="Spend" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Video retention */}
      {ret.length > 0 && (
        <section>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0e1b12', marginBottom: 12 }}>Video analysis <span style={{ fontSize: 12, fontWeight: 500, color: '#9aa196' }}>· Audience retention</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={ret} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
              <defs><linearGradient id="ret" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c4dff" stopOpacity={0.4} /><stop offset="100%" stopColor="#7c4dff" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef1e8" vertical={false} />
              <XAxis dataKey={ret[0]?.seconds ? 'seconds' : 'pct'} tickFormatter={(v: any) => ret[0]?.seconds ? `0:${String(Math.round(v)).padStart(2, '0')}` : `${v}%`} tick={{ fontSize: 11, fill: '#7c8577' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v: any) => v + '%'} tick={{ fontSize: 11, fill: '#9aa196' }} axisLine={false} tickLine={false} width={44} />
              <RTooltip formatter={(v: any) => [v + '%', 'Retention']} />
              <Area type="monotone" dataKey="retention" stroke="#7c4dff" strokeWidth={2.5} fill="url(#ret)" />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      )}

      {/* Performance metrics + preset */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#0e1b12' }}>Performance metrics</span>
          <select value={preset} onChange={e => setPreset(e.target.value)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid rgba(26,58,26,.14)', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#0e1b12', background: '#fff', cursor: 'pointer' }}>
            {BUILTIN_PRESETS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div>
          {presetMetrics.map((k, i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 2px', borderTop: i === 0 ? 'none' : '1px solid rgba(26,58,26,.06)' }}>
              <span style={{ fontSize: 13.5, color: '#3a4636' }}>{METRICS[k]?.label || k}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0e1b12', fontVariantNumeric: 'tabular-nums' }}>{fmtM(k)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 2px', borderTop: '1px solid rgba(26,58,26,.06)' }}>
            <span style={{ fontSize: 13.5, color: '#3a4636' }}>AOV</span>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0e1b12' }}>{money(m.aov, cur)}</span>
          </div>
        </div>
      </section>
    </div>
  )
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`

function NotesTab({ adId }: { adId: string }) {
  const [notes, setNotes] = useState<any[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetch(`/api/reports/ad/${adId}/notes`).then(r => r.json()).then(j => setNotes(j.notes || [])).catch(() => {}).finally(() => setLoading(false)) }, [adId])
  const add = async () => {
    const t = text.trim(); if (!t) return
    setBusy(true)
    try { const r = await fetch(`/api/reports/ad/${adId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) }); const j = await r.json(); if (j.notes) { setNotes(j.notes); setText('') } }
    finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400 }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? <div style={{ color: '#7c8577', padding: 20 }}>Loading…</div>
          : notes.length === 0 ? (
            <div style={{ background: '#f4f6f0', borderRadius: 14, padding: '36px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>🗒️</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0e1b12' }}>No saved notes yet</div>
              <div style={{ fontSize: 12.5, color: '#7c8577', marginTop: 5, lineHeight: 1.5 }}>Save insights, opportunities, and learnings here for easy access later. Start typing to add a note.</div>
            </div>
          ) : notes.map(n => (
            <div key={n.id} style={{ background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
              <div style={{ fontSize: 13.5, color: '#1a2a1a', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{n.text}</div>
              <div style={{ fontSize: 11, color: '#9aa196', marginTop: 6 }}>{n.author} · {new Date(n.at).toLocaleDateString()}</div>
            </div>
          ))}
      </div>
      <div style={{ border: '1px solid rgba(26,58,26,.14)', borderRadius: 14, padding: 12, marginTop: 12 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Start writing a note…" rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add() }}
          style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', fontFamily: FONT, fontSize: 14, color: '#0e1b12', background: 'transparent', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
          <span title="Slack integration coming soon" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#9aa196', border: '1px solid rgba(26,58,26,.12)', borderRadius: 8, padding: '5px 10px', cursor: 'default' }}>💬 Connect to Slack</span>
          <button onClick={add} disabled={busy || !text.trim()} style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: text.trim() ? '#0e1b12' : '#e2e6dc', color: '#dffe95', cursor: text.trim() ? 'pointer' : 'default', fontSize: 15 }}>↑</button>
        </div>
      </div>
    </div>
  )
}

function TranscriptTab({ adId, hasVideo }: { adId: string; hasVideo: boolean }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [copiedAll, setCopiedAll] = useState(false)
  useEffect(() => { fetch(`/api/reports/ad/${adId}/transcript`).then(r => r.json()).then(setData).catch(() => setData({ error: 'failed' })).finally(() => setLoading(false)) }, [adId])
  const segs = data?.segments || []
  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: '#7c8577' }}><div style={{ fontSize: 22, marginBottom: 8 }}>✍️</div>Transcribing the video…<div style={{ fontSize: 12, color: '#9aa196', marginTop: 4 }}>First time takes a few seconds; cached after.</div></div>
  if (!segs.length) return <div style={{ padding: 40, textAlign: 'center', color: '#9aa196' }}><div style={{ fontSize: 30, marginBottom: 8 }}>📝</div><div style={{ fontSize: 14, fontWeight: 600, color: '#5a6b52' }}>No transcript</div><div style={{ fontSize: 12.5, marginTop: 4 }}>{hasVideo ? 'Couldn’t transcribe this video (no clear speech, or the source is unavailable).' : 'This is an image ad — nothing to transcribe.'}</div></div>
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#0e1b12' }}>Transcript</span>
        <span style={{ fontSize: 12, color: '#9aa196' }}>{data.lang || 'EN'} · {mmss(data.duration || 0)}
          <button onClick={() => { navigator.clipboard.writeText(segs.map((s: any) => s.text).join(' ')); setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500) }} style={{ marginLeft: 10, border: 'none', background: '#f4f6f0', borderRadius: 7, padding: '4px 9px', fontSize: 11, fontWeight: 700, color: '#3a4636', cursor: 'pointer' }}>{copiedAll ? 'Copied' : 'Copy all'}</button>
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {segs.map((s: any, i: number) => (
          <div key={i} className="tr-seg" style={{ display: 'flex', gap: 14, padding: '10px 12px', borderRadius: 10, alignItems: 'flex-start' }}
            onMouseEnter={e => e.currentTarget.style.background = '#f6faf4'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#9aa196', flexShrink: 0, fontVariantNumeric: 'tabular-nums', width: 42 }}>{mmss(s.start)}</span>
            <span style={{ fontSize: 13.5, color: '#1a2a1a', lineHeight: 1.55, flex: 1 }}>{s.text}</span>
            <button onClick={() => navigator.clipboard.writeText(s.text)} title="Copy line" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#c2ccc0', fontSize: 12, flexShrink: 0 }}>⧉</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function CommentsTab({ adId }: { adId: string }) {
  const [comments, setComments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetch(`/api/reports/ad/${adId}/comments`).then(r => r.json()).then(j => setComments(j.comments || [])).catch(() => {}).finally(() => setLoading(false)) }, [adId])
  if (loading) return <div style={{ padding: 30, color: '#7c8577', textAlign: 'center' }}>Loading comments…</div>
  if (!comments.length) return (
    <div style={{ background: '#f4f6f0', borderRadius: 14, padding: '36px 20px', textAlign: 'center' }}>
      <div style={{ fontSize: 26, marginBottom: 8 }}>💬</div>
      <div style={{ display: 'inline-block', fontSize: 10, fontWeight: 800, color: '#b45309', background: '#fffbeb', padding: '2px 9px', borderRadius: 100, marginBottom: 8 }}>COMING SOON</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#0e1b12' }}>Ad comments</div>
      <div style={{ fontSize: 12.5, color: '#7c8577', marginTop: 5, lineHeight: 1.5 }}>Reading the comments left on this ad’s post needs an extra Meta permission we’re requesting. Once approved, they’ll appear here automatically.</div>
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {comments.map(c => (
        <div key={c.id} style={{ background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0e1b12' }}>{c.author}</span>
            <span style={{ fontSize: 11, color: '#9aa196' }}>{c.likes ? `♥ ${c.likes}` : ''}</span>
          </div>
          <div style={{ fontSize: 13.5, color: '#1a2a1a', lineHeight: 1.5 }}>{c.message}</div>
        </div>
      ))}
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: '#9aa196', marginBottom: 3 }
function Legend({ c, l }: { c: string; l: string }) { return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{l}</span> }
