'use client'
import MetaGate from '@/components/MetaGate'
import AdsTabs from '@/components/ads/AdsTabs'
import { useState, useEffect } from 'react'
import { useIsMobile } from '@/lib/useIsMobile'
import { useSearchParams } from 'next/navigation'
import AccountSelector from '@/components/AccountSelector'
import CreateReportModal from '@/components/reports/CreateReportModal'
import GeneratedReport from '@/components/reports/GeneratedReport'
import ReportsNarrative from '@/components/reports/ReportsNarrative'
import LaunchReport from '@/components/reports/LaunchReport'
import { TEMPLATES } from '@/lib/reports/templates'

export const dynamic = 'force-dynamic'

// ── Theme (matches the app: cream page, ink text, forest/lime, soft-elevation cards) ──
const INK = '#141d15', MUTED = '#6f7d70', FAINT = '#9aa79a', LINE = '#e9ece7', FOREST = '#141d15', LIME = '#ff5a2c', GREEN = '#ef4a1e'
const SERIF = "'Instrument Serif', Georgia, serif"
// One card look everywhere — white on the cream page, separated by elevation, not a hairline border.
const CARD: React.CSSProperties = { background: '#fff', borderRadius: 18, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 12px 32px -20px rgba(17,24,17,.14)' }
// Semantic performance colors — brand orange for "good" (matches the app accent), amber okay, red bad.
const good = '#ef4a1e', warn = '#b7791f', bad = '#c0392b'

const fmt = (n: number, currency = 'PKR') =>
  new Intl.NumberFormat('en-PK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)

const roasColor = (r: number) => r >= 2 ? good : r >= 1 ? warn : bad
const roasBg = (r: number) => r >= 2 ? 'rgba(239,74,30,0.09)' : r >= 1 ? 'rgba(183,121,31,0.10)' : 'rgba(192,57,43,0.08)'

type SortKey = 'roas' | 'spend' | 'revenue' | 'conversions' | 'ctr' | 'cpa' | 'cpm'

function ReportsPage() {
  const isMobile = useIsMobile()   // collapse the 2-col analytics grids + tighten padding on phones
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
  const [showCreate, setShowCreate] = useState(false)
  const [activeReport, setActiveReport] = useState<{ templateKey: string; savedId?: string; name?: string; config?: any } | null>(null)
  // The ad account the report is scoped to. Reports MUST fetch the account the switcher actually shows
  // (the healthy connected one), never the server's org-wide "primary" — a stale/banned is_primary row
  // (e.g. the old banned ROY 1) otherwise wins and the report loads empty in the wrong currency.
  const [activeAccount, setActiveAccount] = useState<string>('')

  // Deep-links (reactive — fires on every URL change, so sidebar shortcuts work while already on /reports):
  // ?create=1 opens the picker; ?report=<id> opens a saved report; ?template=<key>&... a template/shared one.
  const searchParams = useSearchParams()
  useEffect(() => {
    const p = new URLSearchParams(searchParams?.toString() || '')
    if (p.get('create')) { setShowCreate(true); setActiveReport(null); return }
    setShowCreate(false)
    const rid = p.get('report')
    if (rid) {
      fetch('/api/reports/saved').then(r => r.json()).then(j => {
        const found = [...(j.reports || []), ...(j.shared || [])].find((x: any) => x.id === rid)
        if (found) setActiveReport({ templateKey: found.template_key, savedId: found.id, name: found.name, config: found.config })
      }).catch(() => {})
      return
    }
    const t = p.get('template')
    if (t) {
      const cfg: any = {}
      if (p.get('groupBy')) cfg.groupBy = p.get('groupBy')
      if (p.get('dateRange')) cfg.dateRange = p.get('dateRange')
      if (p.get('metrics')) cfg.metrics = p.get('metrics')!.split(',')
      if (p.get('sort')) cfg.sort = p.get('sort')
      if (p.get('dir')) cfg.dir = p.get('dir')
      if (p.get('view')) cfg.view = p.get('view')
      setActiveReport({ templateKey: t, config: cfg })
    } else {
      setActiveReport(null)   // plain /reports → default insights view
    }
  }, [searchParams])

  const saveReport = async (payload: { id?: string; name: string; templateKey: string; config: any }) => {
    try {
      const res = await fetch('/api/reports/saved', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      if (res.ok) window.dispatchEvent(new Event('reports:changed'))
      return res.ok
    } catch { return false }
  }

  useEffect(() => { loadReports(); loadCreativeAudience() }, [dateRange])

  const loadReports = async (accountOverride?: string) => {
    setLoading(true)
    setError('')
    try {
      const acct = accountOverride ?? activeAccount ?? new URLSearchParams(searchParams?.toString() || '').get('account')
      const res = await fetch(`/api/reports?dateRange=${dateRange}${acct ? `&account=${encodeURIComponent(acct)}` : ''}`)
      const json = await res.json()
      if (json.error) setError(json.error)
      else setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const loadCreativeAudience = async (accountOverride?: string) => {
    setCaLoading(true)
    try {
      // Scope Creative×Audience to the SAME account as the rest of the report so its
      // currency/figures match — the switcher's active account, not the org primary.
      const acct = accountOverride ?? activeAccount ?? new URLSearchParams(searchParams?.toString() || '').get('account')
      const res = await fetch(`/api/insights/creative-audience?dateRange=${dateRange}${acct ? `&account=${encodeURIComponent(acct)}` : ''}`)
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

  // A saved/template report takes over the whole page. New Launches uses the launch-tracking engine.
  if (activeReport && activeReport.templateKey === 'new_launches') {
    return (
      <LaunchReport
        key={activeReport.savedId || 'new_launches'}
        templateKey="new_launches"
        savedId={activeReport.savedId}
        initialName={activeReport.name}
        initialConfig={activeReport.config}
        onBack={() => { if (window.location.search) window.history.replaceState({}, '', '/reports'); setActiveReport(null) }}
        onSave={saveReport}
      />
    )
  }
  if (activeReport) {
    return (
      <GeneratedReport
        key={activeReport.savedId || `${activeReport.templateKey}:${activeReport.config?.groupBy || ''}`}
        templateKey={activeReport.templateKey}
        savedId={activeReport.savedId}
        initialName={activeReport.name}
        initialConfig={activeReport.config}
        onBack={() => { if (window.location.search) window.history.replaceState({}, '', '/reports'); setActiveReport(null) }}
        onSave={saveReport}
      />
    )
  }

  return (
    <div style={{ padding: isMobile ? '16px 12px' : 28, maxWidth: 1200, margin: '0 auto', overflowX: 'hidden' }}>
      {showCreate && <CreateReportModal onClose={() => setShowCreate(false)} onCreate={(k) => { setShowCreate(false); setActiveReport({ templateKey: k }) }} />}

      <AdsTabs />

      {/* Full-width report (no sidebar) — Mello's debrief (headlines + suggestions) on top, then every
          breakdown. This is the 'few days back' design (db1a59e), before the saved-reports sidebar. */}
      <div style={{ minWidth: 0 }}>

      {/* Header — editorial serif title, quiet controls */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 400, color: INK, letterSpacing: '-.01em', lineHeight: 1.05, margin: 0 }}>Reports</h1>
          <div style={{ fontSize: 13.5, color: MUTED, marginTop: 4 }}>Deep insights from your Meta ads.</div>
        </div>
        <div data-tour="ads-controls" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Which ad account this report is for. The selector RESOLVES the healthy connected account
              (and honors ?account= from the brief); we fetch the report for exactly that account so a
              stale/banned org-primary can never load an empty report in the wrong currency. */}
          <AccountSelector initialAccountId={new URLSearchParams(searchParams?.toString() || '').get('account')} onAccountChange={(id: string) => { setActiveAccount(id); loadReports(id); loadCreativeAudience(id) }} />
          <div style={{ display: 'flex', gap: 4, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: 3 }}>
            {['last_3d', 'last_7d', 'last_14d', 'last_30d'].map(r => (
              <button key={r} onClick={() => setDateRange(r)} style={{ padding: '6px 14px', borderRadius: 100, border: 'none', fontFamily: 'inherit', fontWeight: 750, fontSize: 12.5, cursor: 'pointer', background: dateRange === r ? '#ef4a1e' : 'transparent', color: dateRange === r ? '#fff' : MUTED, transition: 'all .12s' }}>
                {r.replace('last_', '')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <div className="selfmade-loading" style={{ width: 44, height: 44, borderRadius: 12, margin: '0 auto 16px' }} />
          <div style={{ color: '#141d15', fontWeight: 700 }}>Loading your reports...</div>
        </div>
      ) : error ? (
        <div style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 16, padding: 24, color: '#c0392b' }}>{error}</div>
      ) : data?.noAccountForBrand ? (
        <div style={{ ...CARD, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: INK, marginBottom: 8 }}>No ad account linked to this brand yet</div>
          <div style={{ fontSize: 13, color: MUTED, marginBottom: 16, maxWidth: 420, margin: '0 auto 16px' }}>Link this brand&apos;s Facebook ad account and its real spend, ROAS and results show up here — nothing from your other brands.</div>
          <a href="/connect/meta" style={{ display: 'inline-block', background: '#ff5a2c', color: '#fff', textDecoration: 'none', padding: '10px 24px', borderRadius: 100, fontSize: 14, fontWeight: 800 }}>Connect an ad account →</a>
        </div>
      ) : data && !data.noAccountForBrand && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Mello's debrief — the headlines on top ('What happened', 'How your account is performing')
              with Mello's read + suggestions. The 'few days back' design the founder asked for. */}
          <ReportsNarrative data={data} ca={caData} currency={data.currency} days={parseInt(dateRange.replace(/\D/g, ''), 10) || 7} />

          {/* Build a report — the template library. */}
          <TemplateLibrary onOpen={(k) => setActiveReport({ templateKey: k })} onMore={() => setShowCreate(true)} />

          {/* Full detail — every breakdown, always open (the classic report). */}
          <>
          {/* Editorial section header so the breakdowns read as a continuation of Mello's debrief. */}
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: LIME }}>The full breakdown</div>
            <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 400, color: INK, letterSpacing: '-.01em', lineHeight: 1.15, marginTop: 2 }}>Every number, sliced the way you want.</div>
          </div>
          {/* Sort Filter Bar (drill-downs only) */}
          <div style={{ ...CARD, display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: FAINT, textTransform: 'uppercase', letterSpacing: '.07em', marginRight: 4 }}>Sort by</span>
            {sortBtns.map(b => (
              <button key={b.key} onClick={() => setSortKey(b.key)} style={{ padding: '6px 13px', borderRadius: 100, border: `1px solid ${sortKey === b.key ? '#ef4a1e' : LINE}`, fontFamily: 'inherit', fontWeight: 750, fontSize: 12, cursor: 'pointer', background: sortKey === b.key ? '#ef4a1e' : '#fff', color: sortKey === b.key ? '#fff' : MUTED, transition: 'all .12s' }}>
                {b.label}
              </button>
            ))}
          </div>

          {/* 2-column grid for smaller sections */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>

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
          </>

        </div>
      )}
        </div>
    </div>
  )
}

// The visible report library — featured report types as premium cards. Click = generate that report.
const TILE_BG = ['#eef6e4', '#e7f0ee', '#f3eee6', '#e9eef5', '#f5ece9', '#eaf1ea']
function TemplateLibrary({ onOpen, onMore }: { onOpen: (k: string) => void; onMore: () => void }) {
  const featured = (TEMPLATES as any[]).filter((t) => t.featured).slice(0, 6)
  if (!featured.length) return null
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>Build a report</div>
        <button onClick={onMore} style={{ background: 'none', border: 'none', color: GREEN, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>All report types →</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px,100%), 1fr))', gap: 12 }}>
        {featured.map((t, i) => (
          <button key={t.key} onClick={() => onOpen(t.key)}
            style={{ ...CARD, textAlign: 'left', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '15px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, transition: 'transform .12s, box-shadow .12s' }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(17,24,17,.05), 0 18px 40px -22px rgba(17,24,17,.22)' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = CARD.boxShadow as string }}>
            <span style={{ width: 40, height: 40, borderRadius: 11, background: TILE_BG[i % TILE_BG.length], display: 'grid', placeItems: 'center', fontSize: 20, flexShrink: 0 }}>{t.emoji}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 750, color: INK, letterSpacing: '-.01em' }}>{t.title}</span>
              <span style={{ display: 'block', fontSize: 12, color: MUTED, lineHeight: 1.45, marginTop: 2 }}>{t.description}</span>
            </span>
          </button>
        ))}
      </div>
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
    <div style={{ ...CARD, overflow: 'hidden' }}>
      <div style={{ padding: '15px 20px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>Best Creatives</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>Top ads by performance</div>
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 750, color: FAINT, background: '#f5f8f2', padding: '3px 10px', borderRadius: 100 }}>{creatives.length} ads</div>
      </div>

      {shown.map((c: any, i: number) => (
        <div key={i} style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Thumbnail */}
          <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#f4f0e6', border: '1px solid rgba(0,0,0,0.08)', position: 'relative' }}>
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
              <span style={{ fontSize: 10.5, fontWeight: 750, color: '#9aa79a', fontVariantNumeric: 'tabular-nums' }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#141d15', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <span style={{ fontSize: 11, color: '#6f7d70' }}>Spent {fmt(c.spend)}</span>
              <span style={{ fontSize: 11, color: '#6f7d70' }}>Conv {c.conversions}</span>
              <span style={{ fontSize: 11, color: '#6f7d70' }}>CTR {c.ctr.toFixed(2)}%</span>
            </div>
            {/* Progress bar */}
            <div style={{ height: 5, background: '#eef1ec', borderRadius: 100, marginTop: 7, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, (c.roas / Math.max(...creatives.map((x:any)=>x.roas),1)) * 100)}%`, background: roasColor(c.roas), opacity: .9, borderRadius: 100 }} />
            </div>
          </div>

          {/* ROAS + Preview */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: roasColor(c.roas), background: roasBg(c.roas), padding: '3px 10px', borderRadius: 100 }}>
              {c.roas.toFixed(2)}x
            </span>
            {c.preview_url ? (
              <a href={c.preview_url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: '#ff5a2c', padding: '4px 12px', borderRadius: 100, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                👁 View Ad
              </a>
            ) : null}
          </div>
        </div>
      ))}

      {creatives.length > 3 && (
        <button onClick={toggle} style={{ width: '100%', padding: '12px', background: 'rgba(0,0,0,0.02)', border: 'none', borderTop: '1px solid rgba(0,0,0,0.04)', color: '#141d15', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
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
  const isMobile = useIsMobile()
  const fmtN = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  const visible = showAll ? creatives : creatives.slice(0, 2)

  return (
    <div style={{ ...CARD, overflow: 'hidden' }}>
      <div style={{ padding: '15px 20px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>Creative × Audience Intelligence</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>Which audiences Meta serves each creative to — click any row to expand</div>
        </div>
        {!loading && creatives.length > 0 && <div style={{ fontSize: 10.5, fontWeight: 750, color: FAINT, background: '#f5f8f2', padding: '3px 10px', borderRadius: 100 }}>{creatives.length} creatives</div>}
      </div>

      {loading ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: '#8b8a72', fontSize: 12 }}>⏳ Analysing audience breakdowns…</div>
      ) : creatives.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: '#8b8a72', fontSize: 12 }}>No creative data yet — needs active campaigns with spend.</div>
      ) : (
        <>
          {visible.map((c: any, idx: number) => (
            <div key={c.creative_id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              {/* Collapsed row */}
              <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 12, padding: '12px 20px', alignItems: 'center', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#fafcfa')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
                onClick={() => toggle(c.creative_id)}>
                <div style={{ width: 48, height: 48, borderRadius: 8, overflow: 'hidden', background: '#eef2ec', border: `1px solid ${LINE}`, flexShrink: 0 }}>
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
                      <span style={{ fontSize: 10, background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                        {PLATFORM_EMOJI[c.topPlacements[0].platform] || '📱'} {c.topPlacements[0].platform} · {c.topPlacements[0].pct}%
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#141d15', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.primary_text ? c.primary_text.slice(0, 90) + (c.primary_text.length > 90 ? '…' : '') : c.headline || '(no copy)'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexShrink: 0 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#141d15' }}>{fmtN(c.total_spend)}</div>
                    <div style={{ fontSize: 10, color: '#8b8a72' }}>spent</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: c.conversions > 0 ? good : '#9ca3af' }}>{c.conversions > 0 ? c.conversions : '—'}</div>
                    <div style={{ fontSize: 10, color: '#8b8a72' }}>conv</div>
                  </div>
                  {c.preview_url && (
                    <a href={c.preview_url} target="_blank" rel="noopener noreferrer" onClick={(e: any) => e.stopPropagation()}
                      style={{ background: '#ff5a2c', color: '#fff', padding: '4px 8px', borderRadius: 7, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>👁</a>
                  )}
                  <span style={{ fontSize: 10, color: '#bbb' }}>{expanded[c.creative_id] ? '▲' : '▼'}</span>
                </div>
              </div>

              {/* Expanded detail — spacious, legible, editorial (redesigned). */}
              {expanded[c.creative_id] && (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', borderTop: `1px solid ${LINE}`, background: '#fcfdfc' }}>
                  {/* Left: who it reached */}
                  <div style={{ padding: '20px 24px', borderRight: isMobile ? 'none' : `1px solid ${LINE}`, borderBottom: isMobile ? `1px solid ${LINE}` : 'none' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT, marginBottom: 14 }}>Who it reached</div>
                    {c.genderSplit.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                        {c.genderSplit.map((g: any) => (
                          <div key={g.gender} style={{ flex: 1, background: (GENDER_COLOR[g.gender] || '#9ca3af') + '10', border: `1px solid ${(GENDER_COLOR[g.gender] || '#9ca3af')}22`, borderRadius: 12, padding: '13px 8px', textAlign: 'center' }}>
                            <div style={{ fontFamily: SERIF, fontSize: 27, fontWeight: 400, color: GENDER_COLOR[g.gender] || '#6b7280', lineHeight: 1, letterSpacing: '-.01em' }}>{g.pct}%</div>
                            <div style={{ fontSize: 11.5, color: MUTED, marginTop: 5, fontWeight: 600 }}>{g.gender}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {c.topAgeGender.length > 0 ? c.topAgeGender.map((seg: any, i: number) => {
                      const col = seg.gender === 'male' ? '#3b82f6' : seg.gender === 'female' ? '#ec4899' : '#9ca3af'
                      return (
                        <div key={i} style={{ marginBottom: 13 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                            <span style={{ fontSize: 12.5, color: INK, fontWeight: 650 }}>
                              {seg.age} · <span style={{ color: col }}>{seg.gender === 'male' ? 'Male' : seg.gender === 'female' ? 'Female' : 'Other'}</span>
                            </span>
                            <span style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{seg.pct}% · {fmtN(seg.spend)}</span>
                          </div>
                          <div style={{ height: 7, background: '#eef1ec', borderRadius: 100, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${seg.pct}%`, background: col, opacity: .9, borderRadius: 100 }} />
                          </div>
                        </div>
                      )
                    }) : <div style={{ fontSize: 12, color: FAINT, fontStyle: 'italic' }}>Needs more spend to break down.</div>}
                  </div>

                  {/* Right: where it ran + why */}
                  <div style={{ padding: '20px 24px' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT, marginBottom: 14 }}>Where it ran</div>
                    {c.topPlacements.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: c.why ? 18 : 0 }}>
                        {c.topPlacements.map((p: any, i: number) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 15, width: 20, textAlign: 'center', flexShrink: 0 }}>{PLATFORM_EMOJI[p.platform] || '📱'}</span>
                            <span style={{ fontSize: 12.5, fontWeight: 650, color: INK, flexShrink: 0 }}>{p.platform}</span>
                            <span style={{ fontSize: 11.5, color: FAINT, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.position}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, minWidth: 96 }}>
                              <span style={{ flex: 1, height: 6, background: '#eef1ec', borderRadius: 100, overflow: 'hidden' }}>
                                <span style={{ display: 'block', height: '100%', width: `${p.pct}%`, background: LIME, borderRadius: 100 }} />
                              </span>
                              <span style={{ fontSize: 12, fontWeight: 800, color: LIME, fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}>{p.pct}%</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {c.why && (
                      <div style={{ background: '#fff7f3', border: '1px solid #f6d8cc', borderRadius: 12, padding: '13px 15px' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: LIME, marginBottom: 5 }}>✨ Why this audience</div>
                        <div style={{ fontSize: 13, color: INK, lineHeight: 1.6 }}>{c.why}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {creatives.length > 2 && (
            <button onClick={() => setShowAll(s => !s)}
              style={{ width: '100%', padding: '11px', background: 'rgba(0,0,0,0.02)', border: 'none', borderTop: '1px solid rgba(0,0,0,0.04)', color: '#141d15', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
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
  // Rows with ~no spend produce artifact ratios (€0 → "3562x ROAS") that dominate the top and blow out
  // the bar scale. Keep real rows (in their sorted order) first; sink no-spend rows to the bottom.
  const ordered = [...items].sort((a, b) => (a.spend < 1 ? 1 : 0) - (b.spend < 1 ? 1 : 0))
  const preview = ordered.slice(0, 3)
  const rest = ordered.slice(3)
  const shown = isExpanded ? ordered : preview

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
    return '#ff5a2c'
  }

  // Scale bars to the REAL rows only (a €0 → 3562x artifact would otherwise squash every real bar).
  const scaleRows = items.filter(i => i.spend >= 1)
  const maxVal = Math.max(...(scaleRows.length ? scaleRows : items).map(i => {
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
    <div style={{ ...CARD, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '15px 20px', borderBottom: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          {/* Uppercase eyebrow to match Mello's debrief sections (no emoji clutter). */}
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: FAINT }}>{title.replace(/^[^A-Za-z0-9]+/, '')}</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>{subtitle}</div>
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 750, color: FAINT, background: '#f5f8f2', padding: '3px 10px', borderRadius: 100 }}>
          {items.length} items
        </div>
      </div>

      {/* Items — editorial rows matching the debrief: muted rank, serif metric, thin ROAS-tinted bar.
          Zero-spend rows (whose ROAS is meaningless — €0 spent → "3562x") sink to the bottom, faded. */}
      <div style={{ padding: '4px 0' }}>
        {shown.map((item, i) => {
          const val = sortKey === 'roas' ? item.roas : sortKey === 'spend' ? item.spend : sortKey === 'revenue' ? item.revenue : sortKey === 'conversions' ? item.conversions : sortKey === 'ctr' ? item.ctr : item.cpa
          const barWidth = Math.min(100, (val / maxVal) * 100)
          const noise = item.spend < 1   // spent ~nothing → any ratio metric is an artifact

          return (
            <div key={i} style={{ padding: '11px 20px', borderTop: i ? `1px solid ${LINE}` : 'none', opacity: noise ? 0.45 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 750, color: FAINT, fontVariantNumeric: 'tabular-nums', width: 16, flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexShrink: 0 }}>
                  <span style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{fmt(item.spend, currency)} spent</span>
                  <span style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 400, letterSpacing: '-.01em', color: noise ? FAINT : metricColor(item), fontVariantNumeric: 'tabular-nums', minWidth: 58, textAlign: 'right' }}>
                    {metricVal(item)}
                  </span>
                </div>
              </div>
              {/* Thin ROAS-tinted bar, debrief-style */}
              <div style={{ height: 5, background: '#eef1ec', borderRadius: 100, overflow: 'hidden', marginTop: 7 }}>
                <div style={{ height: '100%', width: barWidth + '%', background: roasColor(item.roas), opacity: noise ? .35 : .9, borderRadius: 100, transition: 'width .3s' }} />
              </div>
              {/* One quiet metrics line */}
              <div style={{ fontSize: 10.5, color: FAINT, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                Revenue {fmt(item.revenue, currency)} · Conv {item.conversions} · CTR {item.ctr.toFixed(2)}% · CPA {fmt(item.cpa, currency)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Show More */}
      {rest.length > 0 && (
        <button onClick={() => toggle(sectionKey)} style={{ width: '100%', padding: '11px', background: 'none', border: 'none', borderTop: `1px solid ${LINE}`, color: MUTED, fontSize: 12, fontWeight: 750, fontFamily: 'inherit', cursor: 'pointer' }}>
          {isExpanded ? 'Show less ↑' : `Show ${rest.length} more ↓`}
        </button>
      )}
    </div>
  )
}

// ── Gate: needs a connected Meta ad account. MetaGate keys off the connection (BYO or OAuth),
// not the old META_LIVE flag — connected users get the surface, everyone else a connect prompt. ──
export default function ReportsPageGate() {
  return <MetaGate feature="Reports"><ReportsPage /></MetaGate>
}
