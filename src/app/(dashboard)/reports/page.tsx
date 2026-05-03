'use client'
import { useState, useEffect } from 'react'

const fmt = (n: number, currency = 'PKR') =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

const roasColor = (r: number) => r >= 2 ? '#86efac' : r >= 1 ? '#fbbf24' : '#f87171'
const roasBg = (r: number) => r >= 2 ? 'rgba(134,239,172,0.12)' : r >= 1 ? 'rgba(251,191,36,0.12)' : 'rgba(248,113,113,0.12)'

type SortKey = 'roas' | 'spend' | 'revenue' | 'conversions' | 'ctr' | 'cpa' | 'cpm'

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState('last_7d')
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('roas')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [caData, setCaData] = useState<any[]>([])
  const [caCurrency, setCaCurrency] = useState('USD')
  const [caLoading, setCaLoading] = useState(false)
  const [caExpanded, setCaExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => { loadReports(); loadCreativeAudience() }, [dateRange])

  const loadReports = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/reports?dateRange=${dateRange}`)
      const json = await res.json()
      if (json.error) setError(json.error)
      else setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadCreativeAudience = async () => {
    setCaLoading(true)
    try {
      const res = await fetch(`/api/insights/creative-audience?dateRange=${dateRange}`)
      const json = await res.json()
      setCaData(json.creatives || [])
      if (json.currency) setCaCurrency(json.currency)
      const exp: Record<string, boolean> = {}
      ;(json.creatives || []).slice(0, 3).forEach((c: any) => { exp[c.creative_id] = true })
      setCaExpanded(exp)
    } catch {}
    finally { setCaLoading(false) }
  }

  const toggle = (key: string) => setExpanded(p => ({ ...p, [key]: !p[key] }))

  const sorted = (arr: any[]) => [...(arr || [])].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0))

  const sortBtns: { key: SortKey, label: string }[] = [
    { key: 'roas', label: 'ROAS' },
    { key: 'revenue', label: 'Revenue' },
    { key: 'conversions', label: 'Conversions' },
    { key: 'spend', label: 'Spend' },
    { key: 'ctr', label: 'CTR' },
    { key: 'cpa', label: 'CPA' },
  ]

  return (
    <div style={{ padding: 28, maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1a3a1a' }}>Reports</div>
          <div style={{ fontSize: 13, color: '#7a9a7a', marginTop: 2 }}>Deep insights from your Meta Ads</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['last_3d', 'last_7d', 'last_14d', 'last_30d'].map(r => (
            <button key={r} onClick={() => setDateRange(r)} style={{ padding: '7px 14px', borderRadius: 100, border: '1px solid rgba(0,0,0,0.1)', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, cursor: 'pointer', background: dateRange === r ? '#1a3a1a' : '#f0f7ee', color: dateRange === r ? '#dffe95' : '#5a7a5a' }}>
              {r.replace('last_', '').replace('d', 'd')}
            </button>
          ))}
        </div>
      </div>

      {/* Sort Filter Bar */}
      {data && !loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, background: '#ffffff', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '10px 16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#7a9a7a', textTransform: 'uppercase', letterSpacing: '.06em', marginRight: 4 }}>Sort by:</span>
          {sortBtns.map(b => (
            <button key={b.key} onClick={() => setSortKey(b.key)} style={{ padding: '5px 12px', borderRadius: 100, border: '1px solid rgba(0,0,0,0.1)', fontFamily: 'inherit', fontWeight: 700, fontSize: 11, cursor: 'pointer', background: sortKey === b.key ? '#1a3a1a' : '#f0f7ee', color: sortKey === b.key ? '#dffe95' : '#5a7a5a', transition: 'all .15s' }}>
              {b.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <img src='/favicon.png' alt='' style={{ width: 44, height: 44, borderRadius: 11, animation: 'spin 1s linear infinite', margin: '0 auto 16px', display: 'block' }} />
          <div style={{ color: '#1a3a1a', fontWeight: 700 }}>Loading your reports...</div>
        </div>
      ) : error ? (
        <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 16, padding: 24, color: '#c0392b' }}>{error}</div>
      ) : data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Overview KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            {[
              { label: 'Total Spend', value: fmt(data.overview?.spend || 0, data.currency), color: '#c0392b' },
              { label: 'Total Revenue', value: fmt(data.overview?.revenue || 0, data.currency), color: '#2d7a2d' },
              { label: 'Blended ROAS', value: (data.overview?.roas || 0).toFixed(2) + 'x', color: roasColor(data.overview?.roas || 0) },
              { label: 'Conversions', value: String(data.overview?.conversions || 0), color: '#2563eb' },
            ].map(k => (
              <div key={k.label} style={{ background: '#ffffff', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: '16px 20px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#7a9a7a', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* 2-column grid for smaller sections */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* Best Creatives with thumbnails */}
            <CreativesCard
              creatives={sorted(data.creatives)}
              currency={data.currency}
              sortKey={sortKey}
              expanded={expanded['creatives']}
              toggle={() => toggle('creatives')}
            />

            {/* Placement */}
            <ReportCard
              title="📍 Placement"
              subtitle="Where ads perform best"
              sectionKey="placement"
              expanded={expanded}
              toggle={toggle}
              currency={data.currency}
              sortKey={sortKey}
              items={sorted(data.placement).map((r: any) => ({
                label: r.placement,
                roas: r.roas, spend: r.spend, revenue: r.revenue,
                conversions: r.conversions, ctr: r.ctr, cpa: r.cpa,
              }))}
            />

            {/* Age */}
            <ReportCard
              title="👥 Age Groups"
              subtitle="Which age buys most"
              sectionKey="age"
              expanded={expanded}
              toggle={toggle}
              currency={data.currency}
              sortKey={sortKey}
              items={sorted(data.age).map((r: any) => ({
                label: r.age_range,
                roas: r.roas, spend: r.spend, revenue: r.revenue,
                conversions: r.conversions, ctr: r.ctr, cpa: r.cpa,
              }))}
            />

            {/* Gender */}
            <ReportCard
              title="⚧ Gender"
              subtitle="Performance by gender"
              sectionKey="gender"
              expanded={expanded}
              toggle={toggle}
              currency={data.currency}
              sortKey={sortKey}
              items={sorted(data.gender).map((r: any) => ({
                label: r.gender === 'male' ? '👨 Male' : r.gender === 'female' ? '👩 Female' : 'Unknown',
                roas: r.roas, spend: r.spend, revenue: r.revenue,
                conversions: r.conversions, ctr: r.ctr, cpa: r.cpa,
              }))}
            />

            {/* ── Creative × Audience Intelligence ── */}
            <div style={{ gridColumn: 'span 2' }}>
              <CreativeAudienceSection
                creatives={caData}
                currency={caCurrency}
                loading={caLoading}
                expanded={caExpanded}
                toggle={(id: string) => setCaExpanded(p => ({ ...p, [id]: !p[id] }))}
              />
            </div>

            {/* Device */}
            <ReportCard
              title="📱 Device"
              subtitle="Mobile vs Desktop"
              sectionKey="device"
              expanded={expanded}
              toggle={toggle}
              currency={data.currency}
              sortKey={sortKey}
              items={sorted(data.device).map((r: any) => ({
                label: r.device,
                roas: r.roas, spend: r.spend, revenue: r.revenue,
                conversions: r.conversions, ctr: r.ctr, cpa: r.cpa,
              }))}
            />

            {/* Geographic */}
            <ReportCard
              title="🌍 Regions"
              subtitle="Top performing locations"
              sectionKey="geographic"
              expanded={expanded}
              toggle={toggle}
              currency={data.currency}
              sortKey={sortKey}
              items={sorted(data.geographic).map((r: any) => ({
                label: r.region,
                roas: r.roas, spend: r.spend, revenue: r.revenue,
                conversions: r.conversions, ctr: r.ctr, cpa: r.cpa,
              }))}
            />

          </div>

          {/* Full width sections */}
          <ReportCard
            title="🕐 Time of Day"
            subtitle="Best hours for conversions"
            sectionKey="hourly"
            expanded={expanded}
            toggle={toggle}
            currency={data.currency}
            sortKey={sortKey}
            fullWidth
            items={sorted(data.hourly).map((r: any) => ({
              label: r.hour,
              roas: r.roas, spend: r.spend, revenue: r.revenue,
              conversions: r.conversions, ctr: r.ctr, cpa: r.cpa,
            }))}
          />

          <ReportCard
            title="📅 Day of Week"
            subtitle="Best days for conversions"
            sectionKey="daily"
            expanded={expanded}
            toggle={toggle}
            currency={data.currency}
            sortKey={sortKey}
            fullWidth
            items={sorted(data.daily).map((r: any) => ({
              label: r.day,
              roas: r.roas, spend: r.spend, revenue: r.revenue,
              conversions: r.conversions, ctr: r.ctr, cpa: r.cpa,
            }))}
          />

        </div>
      )}

      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

interface ReportItem {
  label: string
  roas: number
  spend: number
  revenue: number
  conversions: number
  ctr: number
  cpa: number
}

function CreativesCard({ creatives, currency, sortKey, expanded, toggle }: {
  creatives: any[], currency: string, sortKey: string, expanded: boolean, toggle: () => void
}) {
  const fmt = (n: number) => new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  const shown = expanded ? creatives : creatives.slice(0, 3)

  return (
    <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1a3a1a' }}>🎨 Best Creatives</div>
          <div style={{ fontSize: 11, color: '#8aaa8a', marginTop: 1 }}>Top ads by performance</div>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#8aaa8a', background: '#f0f7ee', padding: '3px 10px', borderRadius: 100 }}>{creatives.length} ads</div>
      </div>

      {shown.map((c: any, i: number) => (
        <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Thumbnail */}
          <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#f0f7ee', border: '1px solid rgba(0,0,0,0.08)', position: 'relative' }}>
            {c.thumbnail_url ? (
              <a href={c.preview_url || c.thumbnail_url} target="_blank" rel="noopener noreferrer" style={{display:'block',width:'100%',height:'100%'}}>
                <img src={c.thumbnail_url} alt={c.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e:any) => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }}
                />
                <div style={{ width: '100%', height: '100%', display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🎨</div>
              </a>
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🎨</div>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: '#8aaa8a' }}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#1a3a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ fontSize: 11, color: '#8aaa8a' }}>Spent: {fmt(c.spend)}</span>
              <span style={{ fontSize: 11, color: '#8aaa8a' }}>Conv: {c.conversions}</span>
              <span style={{ fontSize: 11, color: '#8aaa8a' }}>CTR: {c.ctr.toFixed(2)}%</span>
            </div>
            {/* Progress bar */}
            <div style={{ height: 3, background: 'rgba(0,0,0,0.06)', borderRadius: 100, marginTop: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, (c.roas / Math.max(...creatives.map((x:any)=>x.roas),1)) * 100)}%`, background: c.roas >= 2 ? '#2d7a2d' : c.roas >= 1 ? '#b8860b' : '#c0392b', borderRadius: 100 }} />
            </div>
          </div>

          {/* ROAS + Preview */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: c.roas >= 2 ? '#2d7a2d' : c.roas >= 1 ? '#b8860b' : '#c0392b', background: c.roas >= 2 ? 'rgba(45,122,45,0.08)' : 'rgba(184,134,11,0.08)', padding: '3px 10px', borderRadius: 100 }}>
              {c.roas.toFixed(2)}x
            </span>
            {c.preview_url ? (
              <a href={c.preview_url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, fontWeight: 700, color: '#1a3a1a', background: '#dffe95', padding: '4px 12px', borderRadius: 100, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                👁 View Ad
              </a>
            ) : null}
          </div>
        </div>
      ))}

      {creatives.length > 3 && (
        <button onClick={toggle} style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.02)', border: 'none', borderTop: '1px solid rgba(0,0,0,0.04)', color: '#1a3a1a', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
          {expanded ? '▲ Show Less' : `▼ Show ${creatives.length - 3} More`}
        </button>
      )}
    </div>
  )
}

const GENDER_COLOR: Record<string, string> = { Male: '#3b82f6', Female: '#ec4899', Unknown: '#9ca3af' }
const PLATFORM_EMOJI: Record<string, string> = { Facebook: '👥', Instagram: '📸', 'Audience Network': '🌐', Messenger: '💬' }

function CreativeAudienceSection({ creatives, currency, loading, expanded, toggle }: {
  creatives: any[], currency: string, loading: boolean,
  expanded: Record<string, boolean>, toggle: (id: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const fmtN = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  const visible = showAll ? creatives : creatives.slice(0, 2)

  return (
    <div style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1a3a1a' }}>🎯 Creative × Audience Intelligence</div>
          <div style={{ fontSize: 11, color: '#8aaa8a', marginTop: 1 }}>Which audiences Meta serves each creative to — click any row to expand</div>
        </div>
        {!loading && creatives.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: '#8aaa8a', background: '#f0f7ee', padding: '3px 10px', borderRadius: 100 }}>{creatives.length} creatives</div>}
      </div>

      {loading ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: '#8aaa8a', fontSize: 12 }}>⏳ Analysing audience breakdowns…</div>
      ) : creatives.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: '#8aaa8a', fontSize: 12 }}>No creative data yet — needs active campaigns with spend.</div>
      ) : (
        <>
          {visible.map((c: any, idx: number) => (
            <div key={c.creative_id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              {/* Collapsed row */}
              <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 12, padding: '12px 20px', alignItems: 'center', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fafcfa')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
                onClick={() => toggle(c.creative_id)}>
                <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', background: '#f0f7ee', border: '1px solid #e8f0e8', flexShrink: 0 }}>
                  {c.thumbnail_url
                    ? <img src={c.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} />
                    : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🎨</div>}
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: 5, marginBottom: 3, flexWrap: 'wrap' }}>
                    {c.topAgeGender[0] && (
                      <span style={{ fontSize: 10, background: '#fff7ed', color: '#c2410c', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                        👤 {c.topAgeGender[0].age} {c.topAgeGender[0].gender} · {c.topAgeGender[0].pct}%
                      </span>
                    )}
                    {c.topPlacements[0] && (
                      <span style={{ fontSize: 10, background: '#f0fdf4', color: '#15803d', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                        {PLATFORM_EMOJI[c.topPlacements[0].platform] || '📱'} {c.topPlacements[0].platform} · {c.topPlacements[0].pct}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#1a3a1a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.primary_text ? c.primary_text.slice(0, 90) + (c.primary_text.length > 90 ? '…' : '') : c.headline || '(no copy)'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#1a3a1a' }}>{fmtN(c.total_spend)}</div>
                    <div style={{ fontSize: 10, color: '#8aaa8a' }}>spent</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: c.conversions > 0 ? '#2e7d32' : '#9ca3af' }}>{c.conversions > 0 ? c.conversions : '—'}</div>
                    <div style={{ fontSize: 10, color: '#8aaa8a' }}>conv</div>
                  </div>
                  {c.preview_url && (
                    <a href={c.preview_url} target="_blank" rel="noopener noreferrer" onClick={(e: any) => e.stopPropagation()}
                      style={{ background: '#dffe95', color: '#1a3a1a', padding: '4px 8px', borderRadius: 7, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>👁</a>
                  )}
                  <span style={{ fontSize: 10, color: '#bbb' }}>{expanded[c.creative_id] ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded detail */}
              {expanded[c.creative_id] && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid #f0f5f0' }}>
                  {/* Left: Who */}
                  <div style={{ padding: '14px 20px', borderRight: '1px solid #f0f5f0' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1a3a1a', marginBottom: 10 }}>👤 Audience breakdown</div>
                    {c.genderSplit.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                        {c.genderSplit.map((g: any) => (
                          <div key={g.gender} style={{ flex: 1, background: (GENDER_COLOR[g.gender] || '#9ca3af') + '18', border: `1px solid ${(GENDER_COLOR[g.gender] || '#9ca3af')}28`, borderRadius: 7, padding: '6px 8px', textAlign: 'center' }}>
                            <div style={{ fontSize: 14, fontWeight: 900, color: GENDER_COLOR[g.gender] || '#6b7280' }}>{g.pct}%</div>
                            <div style={{ fontSize: 10, color: '#6b7280' }}>{g.gender}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {c.topAgeGender.length > 0 ? c.topAgeGender.map((seg: any, i: number) => {
                      const col = seg.gender === 'male' ? '#3b82f6' : seg.gender === 'female' ? '#ec4899' : '#9ca3af'
                      return (
                        <div key={i} style={{ marginBottom: 7 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ fontSize: 11, color: '#374151', fontWeight: 600 }}>
                              {seg.age} · <span style={{ color: col }}>{seg.gender === 'male' ? 'Male' : seg.gender === 'female' ? 'Female' : 'Other'}</span>
                            </span>
                            <span style={{ fontSize: 10, color: '#6b7280' }}>{seg.pct}% · {fmtN(seg.spend)}</span>
                          </div>
                          <div style={{ height: 5, background: '#f3f4f6', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${seg.pct}%`, background: col, borderRadius: 3 }} />
                          </div>
                        </div>
                      )
                    }) : <div style={{ fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>Needs more spend</div>}
                  </div>

                  {/* Right: Placements + Why */}
                  <div style={{ padding: '14px 20px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#1a3a1a', marginBottom: 10 }}>📍 Placements</div>
                    {c.topPlacements.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                        {c.topPlacements.map((p: any, i: number) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: '#f8fbf7', border: '1px solid #e8f0e8', borderRadius: 7 }}>
                            <span style={{ fontSize: 12 }}>{PLATFORM_EMOJI[p.platform] || '📱'}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#1a3a1a' }}>{p.platform}</span>
                            <span style={{ fontSize: 10, color: '#6b7280' }}>{p.position}</span>
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#4caf50', marginLeft: 2 }}>{p.pct}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {c.why && (
                      <div style={{ background: '#f0f7ee', border: '1px solid #c8e6c0', borderRadius: 9, padding: '9px 12px' }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#2e7d32', marginBottom: 3 }}>✨ Why this audience</div>
                        <div style={{ fontSize: 12, color: '#1a3a1a', lineHeight: 1.55 }}>{c.why}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {creatives.length > 2 && (
            <button onClick={() => setShowAll(s => !s)}
              style={{ width: '100%', padding: '11px', background: 'rgba(0,0,0,0.02)', border: 'none', borderTop: '1px solid rgba(0,0,0,0.04)', color: '#1a3a1a', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
              {showAll ? '▲ Show Less' : `▼ Show ${creatives.length - 2} More Creatives`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function ReportCard({ title, subtitle, sectionKey, expanded, toggle, currency, sortKey, items, fullWidth }: {
  title: string, subtitle: string, sectionKey: string,
  expanded: Record<string, boolean>, toggle: (k: string) => void,
  currency: string, sortKey: SortKey, items: ReportItem[], fullWidth?: boolean
}) {
  const isExpanded = expanded[sectionKey]
  const preview = items.slice(0, 3)
  const rest = items.slice(3)
  const shown = isExpanded ? items : preview

  const metricVal = (item: ReportItem) => {
    switch (sortKey) {
      case 'roas': return item.roas.toFixed(2) + 'x'
      case 'spend': return fmt(item.spend, currency)
      case 'revenue': return fmt(item.revenue, currency)
      case 'conversions': return String(item.conversions)
      case 'ctr': return item.ctr.toFixed(2) + '%'
      case 'cpa': return fmt(item.cpa, currency)
      default: return item.roas.toFixed(2) + 'x'
    }
  }

  const metricColor = (item: ReportItem) => {
    if (sortKey === 'roas') return roasColor(item.roas)
    if (sortKey === 'cpa') return item.cpa > 0 ? '#fbbf24' : 'rgba(255,255,255,0.5)'
    return '#dffe95'
  }

  const maxVal = Math.max(...items.map(i => {
    if (sortKey === 'roas') return i.roas
    if (sortKey === 'spend') return i.spend
    if (sortKey === 'revenue') return i.revenue
    if (sortKey === 'conversions') return i.conversions
    if (sortKey === 'ctr') return i.ctr
    if (sortKey === 'cpa') return i.cpa
    return i.roas
  }), 1)

  if (!items.length) return null

  return (
    <div style={{ background: '#ffffff', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 20, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1a3a1a' }}>{title}</div>
          <div style={{ fontSize: 11, color: '#8aaa8a', marginTop: 1 }}>{subtitle}</div>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#8aaa8a', background: '#f8fcf6', padding: '3px 10px', borderRadius: 100 }}>
          {items.length} items
        </div>
      </div>

      {/* Items */}
      <div style={{ padding: '8px 0' }}>
        {shown.map((item, i) => {
          const val = sortKey === 'roas' ? item.roas : sortKey === 'spend' ? item.spend : sortKey === 'revenue' ? item.revenue : sortKey === 'conversions' ? item.conversions : sortKey === 'ctr' ? item.ctr : item.cpa
          const barWidth = Math.min(100, (val / maxVal) * 100)

          return (
            <div key={i} style={{ padding: '10px 20px', borderBottom: i < shown.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1a3a1a', flex: 1, marginRight: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {i === 0 && <span style={{ marginRight: 6 }}>🥇</span>}
                  {i === 1 && <span style={{ marginRight: 6 }}>🥈</span>}
                  {i === 2 && <span style={{ marginRight: 6 }}>🥉</span>}
                  {item.label}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#7a9a7a' }}>{fmt(item.spend, currency)} spent</span>
                  <span style={{ fontSize: 13, fontWeight: 900, color: metricColor(item), background: roasBg(item.roas), padding: '2px 10px', borderRadius: 100 }}>
                    {metricVal(item)}
                  </span>
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ height: 4, background: '#f8fcf6', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: barWidth + '%', background: roasColor(item.roas), borderRadius: 100, transition: 'width .3s' }} />
              </div>
              {/* Sub metrics */}
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                <span style={{ fontSize: 10, color: '#8aaa8a' }}>Revenue: {fmt(item.revenue, currency)}</span>
                <span style={{ fontSize: 10, color: '#8aaa8a' }}>Conv: {item.conversions}</span>
                <span style={{ fontSize: 10, color: '#8aaa8a' }}>CTR: {item.ctr.toFixed(2)}%</span>
                <span style={{ fontSize: 10, color: '#8aaa8a' }}>CPA: {fmt(item.cpa, currency)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Show More */}
      {rest.length > 0 && (
        <button onClick={() => toggle(sectionKey)} style={{ width: '100%', padding: '12px', background: 'rgba(255,255,255,0.02)', border: 'none', borderTop: '1px solid rgba(255,255,255,0.04)', color: '#1a3a1a', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
          {isExpanded ? '▲ Show Less' : `▼ Show ${rest.length} More`}
        </button>
      )}
    </div>
  )
}
