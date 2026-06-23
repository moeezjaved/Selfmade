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
  XAxis, YAxis, Tooltip, CartesianGrid,
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
  topHooks: { label: string; count: number }[]
  topAngles: { label: string; count: number }[]
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

  if (loading) return <div style={{ padding: 32, color: '#6b7280' }}>Loading Brand Spy…</div>
  if (err || !d) return <div style={{ padding: 32, color: '#b91c1c' }}>Couldn’t load: {err}</div>

  const s = d.summary
  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Link href="/discovery/brand-spy" style={{ fontSize: 13, color: '#2075ff', textDecoration: 'none' }}>← All spied brands</Link>
        <Link href={`/discovery/brand/${pageId}`} style={{ fontSize: 13, color: '#2075ff', textDecoration: 'none' }}>View all ads →</Link>
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

      {/* Format mix + AI hooks/angles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={card}>
          <div style={label}>Creative Format Mix</div>
          <Bars rows={d.formatMix.map((f) => ({ label: f.format, count: f.count }))} />
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
