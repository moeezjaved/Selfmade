'use client'
/**
 * Brand Spy — per-brand competitor dashboard, Foreplay-style tabs (Overview / Creative Tests
 * / Hooks / Timeline / Landing Pages) over a persistent summary panel. All from data the
 * crawler already collects (discovery_ads_index).
 */
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'

const ACCENT = '#dffe95'
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, padding: 18 }
const label: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 12 }
const FMT_COLORS: Record<string, string> = { Video: '#2075ff', Image: '#10b981', 'Carousel/DCO': '#f59e0b' }

type Spy = {
  brand: { pageId: string; name: string }
  summary: { total: number; active: number; inactive: number; ownCount?: number; affiliateCount?: number; activePct: number; videoPct: number; imagePct: number; firstSeen: string | null; dataAsOf: string | null }
  formatMix: { format: string; count: number; pct: number }[]
  launchesByMonth: { month: string; count: number }[]
  activeTrend: { week: string; active: number }[]
  creativeTests: { date: string; launched: number; running: number; survival: number }[]
  longestRunning: { adId: string; days: number; hook: string; snapshot_url: string | null }[]
  topHooks: { label: string; count: number }[]
  topAngles: { label: string; count: number }[]
  landingPages: { url: string; host: string; active: number; inactive: number; total: number; fullUrl: string }[]
  hooks: { text: string; count: number; days: number; adId: string; snapshot_url: string | null; active: boolean }[]
}

function Stat({ k, v, sub }: { k: string; v: string | number; sub?: string }) {
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#111', marginTop: 4 }}>{v}</div>
      {sub && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

const MediaMix = ({ d }: { d: Spy }) => (
  <div style={card}>
    <div style={label}>Media Mix</div>
    <ResponsiveContainer width="100%" height={180}>
      <PieChart>
        <Pie data={d.formatMix} dataKey="count" nameKey="format" cx="50%" cy="50%" innerRadius={48} outerRadius={74} paddingAngle={2}>
          {d.formatMix.map((f) => <Cell key={f.format} fill={FMT_COLORS[f.format] || '#9ca3af'} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {d.formatMix.map((f) => (
        <div key={f.format} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: FMT_COLORS[f.format] || '#9ca3af' }} />
          <span style={{ flex: 1, color: '#374151' }}>{f.format}</span>
          <b style={{ color: '#111' }}>{f.count}</b><span style={{ color: '#9ca3af', width: 36, textAlign: 'right' }}>{f.pct}%</span>
        </div>
      ))}
    </div>
  </div>
)

const LongestRunning = ({ d }: { d: Spy }) => (
  <div style={card}>
    <div style={label}>Longest-Running Ads <span style={{ textTransform: 'none', fontWeight: 500 }}>— their proven winners</span></div>
    {d.longestRunning.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No active ads yet.</div>}
    {d.longestRunning.map((a) => (
      <a key={a.adId} href={a.snapshot_url || '#'} target="_blank" rel="noreferrer" style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #f3f4f6', textDecoration: 'none', color: 'inherit' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#10b981' }}>{a.days}d live</span>
        <span style={{ fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.hook || '(no ad text)'}</span>
      </a>
    ))}
  </div>
)

// Hooks tab — Foreplay-style list: thumbnail, the opening line, run-time, sorted longest-running.
function Hooks({ d }: { d: Spy }) {
  const [q, setQ] = useState('')
  const rows = d.hooks.filter((h) => !q || h.text.toLowerCase().includes(q.toLowerCase()))
  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 12 }}>
        <div style={label}>Hooks <span style={{ textTransform: 'none', fontWeight: 500 }}>— opening lines, sorted by longest-running</span></div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hooks…" style={{ width: 220, padding: '7px 10px', border: '1px solid #e6e6e6', borderRadius: 8, fontSize: 13 }} />
      </div>
      {rows.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No hooks captured yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((h) => (
          <div key={h.text} style={{ display: 'grid', gridTemplateColumns: '46px 1fr 90px 110px', gap: 12, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f3f4f6' }}>
            {h.snapshot_url
              ? <img src={h.snapshot_url} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8, background: '#f3f4f6' }} />
              : <div style={{ width: 46, height: 46, borderRadius: 8, background: '#f3f4f6' }} />}
            <div style={{ fontSize: 14, color: '#111', lineHeight: 1.35 }}>“{h.text}”{h.count > 1 && <span style={{ color: '#9ca3af', fontWeight: 600 }}> · {h.count} ads</span>}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: h.active ? '#16a34a' : '#9ca3af' }}>{h.active ? '● ' : ''}{h.days}d</div>
            <a href={h.snapshot_url || '#'} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: '#111', textAlign: 'center', background: '#f3f4f6', borderRadius: 8, padding: '7px 0', textDecoration: 'none' }}>Ad Details</a>
          </div>
        ))}
      </div>
    </div>
  )
}

// Landing Pages tab — Foreplay-style: ranked destination list (active/inactive) + live preview.
function LandingPages({ d }: { d: Spy }) {
  const [sel, setSel] = useState(d.landingPages[0] || null)
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [copied, setCopied] = useState(false)
  if (d.landingPages.length === 0) {
    return <div style={{ ...card, textAlign: 'center', padding: 40, color: '#9ca3af' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: '#374151', marginBottom: 6 }}>No destination URLs captured yet</div>
      These fill in as the crawler captures each ad’s link. Re-spy or wait for the next crawl pass.
    </div>
  }
  const shotW = device === 'desktop' ? 1280 : 390
  const shot = sel ? `https://s.wordpress.com/mshots/v1/${encodeURIComponent(sel.fullUrl)}?w=${shotW}` : ''
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 12 }}>
      <div style={{ ...card, padding: 8, maxHeight: 620, overflowY: 'auto' }}>
        {d.landingPages.map((p) => {
          const on = sel?.url === p.url
          return (
            <button key={p.url} onClick={() => setSel(p)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: on ? '1px solid #cde87a' : '1px solid transparent', background: on ? 'rgba(223,254,149,0.25)' : 'transparent', borderRadius: 10, cursor: 'pointer', marginBottom: 2 }}>
              <div style={{ fontSize: 13, color: '#2075ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔗 {p.url}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}><span style={{ color: '#16a34a', fontWeight: 700 }}>● {p.active} Active</span> · {p.inactive} Inactive</div>
            </button>
          )
        })}
      </div>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel?.fullUrl}</div>
          <button onClick={() => { if (sel) { navigator.clipboard.writeText(sel.fullUrl); setCopied(true); setTimeout(() => setCopied(false), 1200) } }} style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: '1px solid #e6e6e6', background: '#fff', cursor: 'pointer' }}>{copied ? 'Copied ✓' : 'Copy URL'}</button>
          {(['mobile', 'desktop'] as const).map((dv) => (
            <button key={dv} onClick={() => setDevice(dv)} style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: '1px solid #e6e6e6', background: device === dv ? 'rgba(223,254,149,0.5)' : '#fff', cursor: 'pointer', textTransform: 'capitalize' }}>{dv}</button>
          ))}
          <a href={sel?.fullUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#2075ff', textDecoration: 'none' }}>Open ↗</a>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', background: '#f8f9fa', borderRadius: 10, padding: 12, minHeight: 460 }}>
          {shot && <img key={shot} src={shot} alt="landing page preview" style={{ width: device === 'desktop' ? '100%' : 360, borderRadius: 8, border: '1px solid #e6e6e6', alignSelf: 'flex-start' }} />}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 8, textAlign: 'center' }}>Live preview rendered on demand — may take a few seconds the first time.</div>
      </div>
    </div>
  )
}

const TABS = [['overview', 'Overview'], ['tests', 'Creative Tests'], ['hooks', 'Hooks'], ['timeline', 'Timeline'], ['landing', 'Landing Pages']] as const

export default function BrandSpyDetail() {
  const { pageId } = useParams<{ pageId: string }>()
  const [d, setD] = useState<Spy | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<typeof TABS[number][0]>('overview')

  useEffect(() => {
    if (!pageId) return
    setLoading(true)
    fetch(`/api/discovery/brand-spy/${pageId}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setD).catch((e) => setErr(String(e))).finally(() => setLoading(false))
  }, [pageId])

  const exportCsv = () => {
    if (!d) return
    const esc = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`
    const rows = ['Section,Item,Value,Extra']
    d.formatMix.forEach((f) => rows.push(['Media Mix', f.format, f.count, `${f.pct}%`].map(esc).join(',')))
    d.creativeTests.forEach((t) => rows.push(['Creative Test', t.date, `${t.running}/${t.launched} live`, `${t.survival}% survival`].map(esc).join(',')))
    d.longestRunning.forEach((a) => rows.push(['Longest Running', a.hook, `${a.days}d live`, a.snapshot_url || ''].map(esc).join(',')))
    d.topHooks.forEach((h) => rows.push(['Top Hook', h.label, h.count, ''].map(esc).join(',')))
    d.topAngles.forEach((h) => rows.push(['Top Angle', h.label, h.count, ''].map(esc).join(',')))
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `brand-spy-${(d.brand.name || pageId).replace(/[^a-z0-9]+/gi, '-')}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div style={{ padding: 32, color: '#6b7280' }}>Loading Brand Spy…</div>
  if (err || !d) return <div style={{ padding: 32, color: '#b91c1c' }}>Couldn’t load: {err}</div>
  const s = d.summary

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Link href="/discovery/brand-spy" style={{ fontSize: 13, color: '#2075ff', textDecoration: 'none' }}>← All spied brands</Link>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <button onClick={exportCsv} style={{ fontSize: 13, fontWeight: 700, color: '#111', background: 'rgba(223,254,149,0.6)', border: '1px solid #cde87a', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>⬇ Export CSV</button>
          <Link href={`/discovery/brand/${pageId}`} style={{ fontSize: 13, color: '#2075ff', textDecoration: 'none' }}>View all ads →</Link>
        </div>
      </div>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111', margin: '4px 0 2px' }}>{d.brand.name}</h1>
      <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 18 }}>
        {s.firstSeen ? `Earliest ad ${new Date(s.firstSeen).toLocaleDateString()}` : 'Spying since first crawl'}
        {s.dataAsOf ? <span> · <span style={{ color: '#16a34a', fontWeight: 600 }}>data as of {new Date(s.dataAsOf).toLocaleString()}</span></span> : null}
      </div>

      {/* Persistent summary panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        <Stat k="Total ads" v={s.total.toLocaleString()} sub={s.affiliateCount ? `${(s.ownCount ?? 0).toLocaleString()} own + ${s.affiliateCount.toLocaleString()} affiliate` : undefined} />
        <Stat k="Active" v={s.active.toLocaleString()} sub={`${s.activePct}% live`} />
        <Stat k="Inactive" v={s.inactive.toLocaleString()} sub="taken down" />
        <Stat k="Video / Image" v={`${s.videoPct}% / ${s.imagePct}%`} sub="creative mix" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', color: tab === id ? '#111' : '#6b7280', background: tab === id ? 'rgba(223,254,149,0.5)' : '#f3f4f6' }}>{lbl}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <MediaMix d={d} />
          <LongestRunning d={d} />
        </div>
      )}

      {tab === 'timeline' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={card}>
              <div style={label}>Ad Launch Trends <span style={{ textTransform: 'none', fontWeight: 500 }}>— new ads / month</span></div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={d.launchesByMonth} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} /><YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} /><Tooltip /><Line type="monotone" dataKey="count" stroke="#ff7a00" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <div style={label}>Active Ad Trends <span style={{ textTransform: 'none', fontWeight: 500 }}>— ads live / week (last 26w)</span></div>
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={d.activeTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <defs><linearGradient id="spyArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff7a00" stopOpacity={0.35} /><stop offset="100%" stopColor="#ff7a00" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={3} /><YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="active" stroke="#ff7a00" strokeWidth={2} fill="url(#spyArea)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ marginTop: 14, padding: 12, background: 'rgba(223,254,149,0.18)', border: `1px solid ${ACCENT}`, borderRadius: 10, fontSize: 12, color: '#3f6212' }}>◆ Trends reconstructed from every ad’s live window in our index — history from before you started watching, from real snapshots.</div>
        </div>
      )}

      {tab === 'tests' && (
        <div style={card}>
          <div style={label}>Creative Tests <span style={{ textTransform: 'none', fontWeight: 500 }}>— ads launched together; survival = still-running / launched (high = a winning test)</span></div>
          {d.creativeTests.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No multi-ad launch batches detected yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {d.creativeTests.map((t) => {
              const color = t.survival >= 60 ? '#10b981' : t.survival >= 30 ? '#f59e0b' : '#ef4444'
              return (
                <div key={t.date} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 130px', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 13, color: '#374151' }}>{new Date(t.date).toLocaleDateString()}</div>
                  <div style={{ height: 18, background: '#f3f4f6', borderRadius: 6, overflow: 'hidden' }}><div style={{ width: `${t.survival}%`, height: '100%', background: color, borderRadius: 6 }} /></div>
                  <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#111' }}>{t.running}/{t.launched} live <span style={{ color, fontWeight: 800 }}>{t.survival}%</span></div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'hooks' && <Hooks d={d} />}

      {tab === 'landing' && <LandingPages d={d} />}
    </div>
  )
}
