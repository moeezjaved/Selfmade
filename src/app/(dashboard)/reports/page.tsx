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

  useEffect(() => { loadReports() }, [dateRange])

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
            <button key={r} onClick={() => setDateRange(r)} style={{ padding: '7px 14px', borderRadius: 100, border: 'none', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, cursor: 'pointer', background: dateRange === r ? '#dffe95' : 'rgba(255,255,255,0.06)', color: dateRange === r ? '#10211f' : 'rgba(255,255,255,0.5)' }}>
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
            <button key={b.key} onClick={() => setSortKey(b.key)} style={{ padding: '5px 12px', borderRadius: 100, border: 'none', fontFamily: 'inherit', fontWeight: 700, fontSize: 11, cursor: 'pointer', background: sortKey === b.key ? '#dffe95' : 'rgba(255,255,255,0.06)', color: sortKey === b.key ? '#10211f' : 'rgba(255,255,255,0.5)', transition: 'all .15s' }}>
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

            {/* Best Creatives */}
            <ReportCard
              title="🎨 Best Creatives"
              subtitle="Top ads by performance"
              sectionKey="creatives"
              expanded={expanded}
              toggle={toggle}
              currency={data.currency}
              sortKey={sortKey}
              items={sorted(data.creatives).map((c: any) => ({
                label: c.name,
                roas: c.roas, spend: c.spend, revenue: c.revenue,
                conversions: c.conversions, ctr: c.ctr, cpa: c.cpa,
              }))}
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
