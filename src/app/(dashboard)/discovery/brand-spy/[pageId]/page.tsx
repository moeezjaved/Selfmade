'use client'
/**
 * Brand Spy — per-brand competitor dashboard. Reads /api/discovery/brand-spy/<pageId>
 * (aggregated from discovery_ads_index) and renders format mix, launch trend, active-ad
 * trend, and top AI hooks/angles. All powered by data the crawler already collects.
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

type Spy = {
  brand: { pageId: string; name: string }
  summary: { total: number; active: number; inactive: number; activePct: number; videoPct: number; imagePct: number; firstSeen: string | null }
  formatMix: { format: string; count: number; pct: number }[]
  launchesByMonth: { month: string; count: number }[]
  activeTrend: { week: string; active: number }[]
  creativeTests: { date: string; launched: number; running: number; survival: number }[]
  longestRunning: { adId: string; days: number; hook: string; snapshot_url: string | null }[]
  topHooks: { label: string; count: number }[]
  topAngles: { label: string; count: number }[]
}

const FMT_COLORS: Record<string, string> = { Video: '#2075ff', Image: '#10b981', 'Carousel/DCO': '#f59e0b' }

function Stat({ k, v, sub }: { k: string; v: string | number; sub?: string }) {
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#111', marginTop: 4 }}>{v}</div>
      {sub && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Bars({ rows, max }: { rows: { label: string; count: number }[]; max?: number }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.count))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No data yet</div>}
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 130, fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
          <div style={{ flex: 1, height: 16, background: '#f3f4f6', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${(r.count / top) * 100}%`, height: '100%', background: '#2075ff', borderRadius: 6 }} />
          </div>
          <div style={{ width: 44, textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#111' }}>{r.count}</div>
        </div>
      ))}
    </div>
  )
}

export default function BrandSpyDetail() {
  const { pageId } = useParams<{ pageId: string }>()
  const [d, setD] = useState<Spy | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

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
      <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 18 }}>Spying since first crawl{s.firstSeen ? ` · earliest ad ${new Date(s.firstSeen).toLocaleDateString()}` : ''}</div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <Stat k="Total ads" v={s.total.toLocaleString()} />
        <Stat k="Active ads" v={s.active.toLocaleString()} sub={`${s.activePct}% of total`} />
        <Stat k="Video" v={`${s.videoPct}%`} sub="of creative mix" />
        <Stat k="Image" v={`${s.imagePct}%`} sub="of creative mix" />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
        <div style={card}>
          <div style={label}>Ad Launch Trends <span style={{ textTransform: 'none', fontWeight: 500 }}>— new ads / month</span></div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.launchesByMonth} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="count" stroke="#ff7a00" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={card}>
          <div style={label}>Active Ad Trends <span style={{ textTransform: 'none', fontWeight: 500 }}>— ads live / week (last 26w)</span></div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={d.activeTrend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="spyArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff7a00" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#ff7a00" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={3} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
              <Tooltip />
              <Area type="monotone" dataKey="active" stroke="#ff7a00" strokeWidth={2} fill="url(#spyArea)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Creative Tests — automated competitor A/B-test detection */}
      <div style={{ ...card, marginBottom: 18 }}>
        <div style={label}>Creative Tests <span style={{ textTransform: 'none', fontWeight: 500 }}>— ads launched together; survival = still-running / launched (high = a winning test)</span></div>
        {d.creativeTests.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No multi-ad launch batches detected yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {d.creativeTests.map((t) => {
            const color = t.survival >= 60 ? '#10b981' : t.survival >= 30 ? '#f59e0b' : '#ef4444'
            return (
              <div key={t.date} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#374151' }}>{new Date(t.date).toLocaleDateString()}</div>
                <div style={{ height: 18, background: '#f3f4f6', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${t.survival}%`, height: '100%', background: color, borderRadius: 6 }} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#111' }}>{t.running}/{t.launched} live <span style={{ color, fontWeight: 800 }}>{t.survival}%</span></div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Longest-running ads — the brand's proven winners */}
      <div style={{ ...card, marginBottom: 18 }}>
        <div style={label}>Longest-Running Ads <span style={{ textTransform: 'none', fontWeight: 500 }}>— run-duration ≈ profitability; these are their proven winners</span></div>
        {d.longestRunning.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No active ads yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {d.longestRunning.map((a) => (
            <a key={a.adId} href={a.snapshot_url || '#'} target="_blank" rel="noreferrer"
               style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6', textDecoration: 'none', color: 'inherit' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#10b981' }}>{a.days}d live</span>
              <span style={{ fontSize: 13, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.hook || '(no ad text)'}</span>
            </a>
          ))}
        </div>
      </div>

      {/* Media Mix donut + AI hooks/angles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={card}>
          <div style={label}>Media Mix</div>
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={d.formatMix} dataKey="count" nameKey="format" cx="50%" cy="50%" innerRadius={42} outerRadius={66} paddingAngle={2}>
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
        <div style={card}>
          <div style={label}>Top Hooks <span style={{ textTransform: 'none', fontWeight: 500 }}>(AI)</span></div>
          <Bars rows={d.topHooks} />
        </div>
        <div style={card}>
          <div style={label}>Top Angles <span style={{ textTransform: 'none', fontWeight: 500 }}>(AI)</span></div>
          <Bars rows={d.topAngles} />
        </div>
      </div>

      <div style={{ marginTop: 18, padding: 12, background: 'rgba(223,254,149,0.18)', border: `1px solid ${ACCENT}`, borderRadius: 10, fontSize: 12, color: '#3f6212' }}>
        ◆ Trends are reconstructed from every ad’s live window in our index — so you see history from before you started watching, computed from real captured snapshots.
      </div>
    </div>
  )
}
