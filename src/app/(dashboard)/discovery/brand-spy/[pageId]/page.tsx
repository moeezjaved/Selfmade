'use client'
/**
 * Brand Spy — per-brand competitor dashboard, Foreplay-style tabs (Overview / Creative Tests
 * / Hooks / Timeline / Landing Pages) over a persistent summary panel. All from data the
 * crawler already collects (discovery_ads_index).
 */
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import CloneModal from '../../CloneModal'
import CloneVideoModal from '../../CloneVideoModal'
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
  hooks: { text: string; count: number; days: number; adId: string; snapshot_url: string | null; thumb: string | null; active: boolean }[]
  topAds: { adId: string; score: number; days: number; active: boolean; hook: string; thumb: string | null; snapshot_url: string | null }[]
  // Atria-style Overview DNA
  topPersonas?: { label: string; count: number }[]
  topAnglesDNA?: { label: string; count: number }[]
  topUSPs?: { label: string; count: number }[]
  topDesires?: { label: string; count: number }[]
  topEmotions?: { label: string; count: number }[]
  topThemes?: { label: string; count: number }[]
  topCTAs?: { label: string; count: number }[]
  counts?: { hooks: number; adCopy: number; headlines: number; landingPages: number }
  trend?: { liveLast30: number; newLast30: number; pctChange: number | null }
}

// ── Overview tab (Atria-style): media mix + the brand's creative-DNA chip rows + count tiles ──
function ChipRow({ icon, label, items }: { icon: string; label: string; items?: { label: string; count: number }[] }) {
  if (!items || !items.length) return null
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ width: 150, flexShrink: 0, fontSize: 13, fontWeight: 700, color: '#374151', display: 'flex', alignItems: 'center', gap: 6 }}><span>{icon}</span>{label}</div>
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.slice(0, 8).map((it) => (
          <span key={it.label} title={`${it.count} ads`} style={{ fontSize: 12, fontWeight: 600, color: '#1a3a1a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 100, padding: '3px 10px', whiteSpace: 'nowrap' }}>
            {it.label} <span style={{ opacity: 0.55, fontWeight: 700 }}>{it.count}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// Per-dimension deep-dive (Atria tabs: Personas / Ad angles / USPs / Desires / Emotions / Themes) —
// the full ranked breakdown with proportion bars + ad counts.
function DnaList({ title, items }: { title: string; items?: { label: string; count: number }[] }) {
  if (!items?.length) return (
    <div style={{ ...card, padding: 48, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
      No {title.toLowerCase()} yet — the AI classifier is still processing this brand&apos;s ads. Check back shortly.
    </div>
  )
  const max = items[0]?.count || 1
  return (
    <div style={{ ...card, padding: 18 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 14 }}>{title} <span style={{ fontWeight: 500, color: '#9ca3af' }}>· {items.length}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {items.map((it, i) => (
          <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 22, fontSize: 12, color: '#9ca3af', fontWeight: 700, textAlign: 'right', flexShrink: 0 }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111', marginBottom: 4 }}>{it.label}</div>
              <div style={{ height: 6, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${Math.round((it.count / max) * 100)}%`, height: '100%', background: '#1a3a1a', borderRadius: 4 }} />
              </div>
            </div>
            <div style={{ width: 64, textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#374151', flexShrink: 0 }}>{it.count} ads</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Overview({ d }: { d: Spy }) {
  const c = d.counts || { hooks: 0, adCopy: 0, headlines: 0, landingPages: 0 }
  const t = d.trend
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Trend header (Atria) */}
      {t && (
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>
          <strong style={{ fontWeight: 800 }}>{t.liveLast30.toLocaleString()} ads</strong> were live in the last 30 days
          {t.newLast30 > 0 && <>, including <strong style={{ fontWeight: 800 }}>{t.newLast30.toLocaleString()} new ads</strong></>}
          {t.pctChange != null && (
            <span style={{ marginLeft: 8, fontSize: 15, fontWeight: 800, color: t.pctChange >= 0 ? '#059669' : '#dc2626' }}>
              ({t.pctChange >= 0 ? '+' : ''}{t.pctChange}%)
            </span>
          )}
        </div>
      )}
      {/* Media mix bar */}
      <div style={{ ...card, padding: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#111', marginBottom: 12 }}>Media mix</div>
        <div style={{ display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', marginBottom: 14 }}>
          {d.formatMix.map((f) => <div key={f.format} style={{ width: `${f.pct}%`, background: FMT_COLORS[f.format] || '#9ca3af' }} />)}
        </div>
        {d.formatMix.map((f) => (
          <div key={f.format} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: FMT_COLORS[f.format] || '#9ca3af' }} />
            <span style={{ flex: 1, color: '#374151', fontWeight: 600 }}>{f.format}</span>
            <span style={{ color: '#111', fontWeight: 700 }}>{f.count} ads</span>
            <span style={{ width: 52, textAlign: 'right', color: '#6b7280', fontWeight: 700 }}>{f.pct}%</span>
          </div>
        ))}
      </div>

      {/* Creative-DNA chip rows */}
      <div style={{ ...card, padding: '6px 18px 12px' }}>
        <ChipRow icon="🧑" label="Top personas" items={d.topPersonas} />
        <ChipRow icon="🎯" label="Top ad angles" items={d.topAnglesDNA?.length ? d.topAnglesDNA : d.topAngles} />
        <ChipRow icon="⭐" label="Top USPs" items={d.topUSPs} />
        <ChipRow icon="🔥" label="Top desires" items={d.topDesires} />
        <ChipRow icon="😊" label="Top emotions" items={d.topEmotions} />
        <ChipRow icon="🎨" label="Top themes" items={d.topThemes} />
        <ChipRow icon="📣" label="Top CTAs" items={d.topCTAs} />
        <ChipRow icon="🪝" label="Top hooks" items={d.topHooks} />
      </div>

      {/* Count tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px,100%), 1fr))', gap: 12 }}>
        {[['Hooks', c.hooks], ['Ad copy', c.adCopy], ['Headlines', c.headlines], ['Landing pages', c.landingPages]].map(([k, v]) => (
          <div key={k as string} style={{ ...card, padding: 16, textAlign: 'center' }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#111' }}>{(v as number).toLocaleString()}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginTop: 2 }}>{k as string}</div>
          </div>
        ))}
      </div>
    </div>
  )
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
            {h.thumb
              ? <img src={h.thumb} alt="" loading="lazy" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8, background: '#f3f4f6' }} />
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

// ── Per-ad card from db-search (reused: same media/thumbnail resolution as Discovery) ──
type Card = {
  id: string; pageName: string; body: string | null; title: string | null; caption: string | null
  snapshotUrl: string | null; thumbnailUrl: string | null; videoUrl: string | null
  startDate: string | null; stopDate: string | null; platforms: string[]
  isActive: boolean; daysRunning: number | null; format: string | null
  hookType: string | null; angle: string | null; cta: string | null; niche: string | null
}

// Fetch a spied brand's ads from db-search with filters + pagination (Ad Library + Timeline share this).
function useBrandAds(pageId: string, opts: { days: number; format: string; status: string; sort: string }) {
  const { days, format, status, sort } = opts
  const [ads, setAds] = useState<Card[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { setPage(0) }, [pageId, days, format, status, sort])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const p = new URLSearchParams({ page: String(page), sort })
    if (days) p.set('days', String(days))
    if (format) p.set('format', format)
    if (status && status !== 'ALL') p.set('status', status)
    // Brand Spy's own ads endpoint — reads discovery_ads_index directly (raw media), so it shows
    // every ad even before the drain downloads creatives. (db-search would 0-out a fresh brand.)
    fetch(`/api/discovery/brand-spy/${pageId}/ads?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setAds((prev) => (page === 0 ? d.ads || [] : [...prev, ...(d.ads || [])]))
        setHasMore(!!d.hasMore)
        if (typeof d.total === 'number') setTotal(d.total)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pageId, page, days, format, status, sort])
  return { ads, loading, hasMore, total, loadMore: () => setPage((p) => p + 1) }
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const FMT_BADGE: Record<string, string> = { Video: '#2075ff', Image: '#10b981', 'Carousel/DCO': '#f59e0b' }

function AdCard({ a, onOpen, onClone }: { a: Card; onOpen: (a: Card) => void; onClone?: (a: Card) => void }) {
  const isVideo = (a.format || '').toLowerCase().includes('video') || !!a.videoUrl
  const img = a.thumbnailUrl
  return (
    <div onClick={() => onOpen(a)} style={{ textAlign: 'left', background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#2075ff' }}>{(a.pageName || '?')[0]?.toUpperCase()}</div>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.pageName}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: a.isActive ? '#16a34a' : '#9ca3af' }}>{a.isActive ? '● Live' : 'Off'}</span>
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', padding: '0 12px 8px' }}>{fmtDate(a.startDate)}{a.isActive ? ' – Present' : a.stopDate ? ` – ${fmtDate(a.stopDate)}` : ''}</div>
      {a.body && <div style={{ fontSize: 12, color: '#374151', padding: '0 12px 8px', lineHeight: 1.4, maxHeight: 52, overflow: 'hidden' }}>{a.body.slice(0, 120)}</div>}
      <div style={{ position: 'relative', aspectRatio: '4 / 5', background: '#f3f4f6' }}>
        {img ? <img src={img} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#c4c4c4', fontSize: 12 }}>no preview</div>}
        {isVideo && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>▶</div></div>}
        <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 800, color: '#fff', background: FMT_BADGE[a.format || ''] || '#6b7280', padding: '2px 7px', borderRadius: 6 }}>{a.format || 'Ad'}</span>
        {(a.daysRunning || 0) > 0 && <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 10, fontWeight: 800, color: '#111', background: 'rgba(255,255,255,0.92)', padding: '2px 7px', borderRadius: 6 }}>{a.daysRunning}d</span>}
        {onClone && <button onClick={(e) => { e.stopPropagation(); onClone(a) }} style={{ position: 'absolute', bottom: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 5, background: '#dffe95', color: '#111', border: 'none', borderRadius: 20, fontSize: 11.5, fontWeight: 800, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>✨ Clone</button>}
      </div>
    </div>
  )
}

function AdDetailsDrawer({ a, onClose }: { a: Card; onClose: () => void }) {
  const { pageId } = useParams() as { pageId: string }
  const [cloning, setCloning] = useState(false)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onClose])
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, padding: '9px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
      <div style={{ color: '#9ca3af', fontWeight: 600 }}>{k}</div><div style={{ color: '#111' }}>{v}</div>
    </div>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,0.45)', zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(880px, 94vw)', height: '100%', background: '#fff', overflowY: 'auto', boxShadow: '-8px 0 30px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #eee', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div style={{ fontSize: 13, color: '#6b7280' }}>ID: {a.id}</div>
          <button onClick={onClose} style={{ fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid #e6e6e6', background: '#fff', cursor: 'pointer' }}>ESC to close ✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <div style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#2075ff' }}>{(a.pageName || '?')[0]?.toUpperCase()}</div>
              <b style={{ fontSize: 14 }}>{a.pageName}</b>
            </div>
            {a.body && <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, marginBottom: 12, whiteSpace: 'pre-wrap' }}>{a.body.slice(0, 600)}</div>}
            <div style={{ borderRadius: 10, overflow: 'hidden', background: '#f3f4f6' }}>
              {a.videoUrl ? <video src={a.videoUrl} poster={a.thumbnailUrl || undefined} controls style={{ width: '100%', display: 'block' }} />
                : a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" style={{ width: '100%', display: 'block' }} />
                : <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>no preview</div>}
            </div>
          </div>
          <div style={{ padding: 18, borderLeft: '1px solid #f3f4f6' }}>
            <button onClick={() => setCloning(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', background: '#111', color: ACCENT, fontWeight: 800, fontSize: 14, padding: '11px 0', borderRadius: 10, border: 'none', cursor: 'pointer', marginBottom: 10, fontFamily: 'inherit' }}>✨ Clone this ad</button>
            <a href={a.snapshotUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'block', textAlign: 'center', background: ACCENT, color: '#111', fontWeight: 800, fontSize: 14, padding: '11px 0', borderRadius: 10, textDecoration: 'none', marginBottom: 14 }}>Open in Meta Ad Library ↗</a>
            {cloning && ((a.format || '').toLowerCase().includes('video') || !!a.videoUrl
              ? <CloneVideoModal sourceAdId={a.id} sourcePoster={a.thumbnailUrl || undefined} onClose={() => setCloning(false)} />
              : <CloneModal ad={{ id: a.id, pageId, pageName: a.pageName, assetImageUrl: a.thumbnailUrl || undefined }} onClose={() => setCloning(false)} />)}
            <Row k="Status" v={a.isActive ? <span style={{ color: '#16a34a', fontWeight: 700 }}>● Still Running{a.startDate ? ` from ${fmtDate(a.startDate)}` : ''}</span> : <span style={{ color: '#9ca3af' }}>Inactive{a.stopDate ? ` (ended ${fmtDate(a.stopDate)})` : ''}</span>} />
            <Row k="Time Running" v={`${a.daysRunning || 0} day${(a.daysRunning || 0) === 1 ? '' : 's'}`} />
            <Row k="Format" v={a.format || '—'} />
            <Row k="Niche" v={a.niche || '—'} />
            <Row k="Platforms" v={(a.platforms || []).join(', ') || '—'} />
            <Row k="Hook" v={a.hookType || '—'} />
            <Row k="Angle" v={a.angle || '—'} />
            <Row k="CTA" v={a.cta || '—'} />
            <Row k="First seen" v={fmtDate(a.startDate)} />
          </div>
        </div>
      </div>
    </div>
  )
}

const FILTER_BTN = (on: boolean): React.CSSProperties => ({ fontSize: 13, fontWeight: 700, padding: '7px 12px', borderRadius: 8, border: '1px solid #e6e6e6', background: on ? 'rgba(223,254,149,0.5)' : '#fff', cursor: 'pointer', color: '#111' })

function FilterBar({ days, setDays, format, setFormat, status, setStatus, sort, setSort, total }: any) {
  const Sel = (val: string, set: (v: string) => void, opts: [string, string][]) => (
    <select value={val} onChange={(e) => set(e.target.value)} style={{ ...FILTER_BTN(!!val && val !== 'ALL'), appearance: 'auto' }}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {([[0, 'All time'], [7, '7d'], [30, '30d'], [90, '90d'], [180, '180d']] as [number, string][]).map(([d, l]) => (
        <button key={d} onClick={() => setDays(d)} style={FILTER_BTN(days === d)}>{l}</button>
      ))}
      <div style={{ width: 1, height: 22, background: '#e6e6e6', margin: '0 2px' }} />
      {Sel(format, setFormat, [['', 'Format · All'], ['Video', 'Video'], ['Image', 'Image'], ['Carousel', 'Carousel']])}
      {Sel(status, setStatus, [['ALL', 'Status · All'], ['ACTIVE', 'Active'], ['INACTIVE', 'Inactive']])}
      {Sel(sort, setSort, [['newest', 'Newest'], ['longest', 'Longest running'], ['recommended', 'Recommended']])}
      <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>{total != null ? `${total.toLocaleString()} ads` : ''}</div>
    </div>
  )
}

function AdLibrary({ d, pageId, onOpen }: { d: Spy; pageId: string; onOpen: (a: Card) => void }) {
  const [days, setDays] = useState(0)
  const [format, setFormat] = useState('')
  const [status, setStatus] = useState('ALL')
  const [sort, setSort] = useState('newest')
  const { ads, loading, hasMore, total, loadMore } = useBrandAds(pageId, { days, format, status, sort })
  const [cloneImageAd, setCloneImageAd] = useState<Card | null>(null)
  const [cloneVideoAd, setCloneVideoAd] = useState<Card | null>(null)
  // Video ads → the Seedance video-clone; image ads → the Gemini image-clone.
  const openClone = (a: Card) => {
    const isVid = (a.format || '').toLowerCase().includes('video') || !!a.videoUrl
    if (isVid) setCloneVideoAd(a); else setCloneImageAd(a)
  }
  return (
    <div>
      {cloneImageAd && <CloneModal ad={{ id: cloneImageAd.id, pageId, pageName: cloneImageAd.pageName, assetImageUrl: cloneImageAd.thumbnailUrl || undefined }} onClose={() => setCloneImageAd(null)} />}
      {cloneVideoAd && <CloneVideoModal sourceAdId={cloneVideoAd.id} sourcePoster={cloneVideoAd.thumbnailUrl || undefined} onClose={() => setCloneVideoAd(null)} />}
      {/* Analytics header — Media Mix · Top Landing Pages · Top Hooks (Foreplay layout) */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <MediaMix d={d} />
        <div style={card}>
          <div style={label}>Top Landing Pages</div>
          {d.landingPages.slice(0, 6).map((p) => (
            <div key={p.url} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
              <span style={{ flex: 1, color: '#2075ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url}</span>
              <b style={{ color: '#111' }}>{p.total}</b><span style={{ color: '#9ca3af', width: 40, textAlign: 'right' }}>{Math.round((p.total / Math.max(1, d.summary.total)) * 100)}%</span>
            </div>
          ))}
          {d.landingPages.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No destination URLs yet</div>}
        </div>
        <div style={card}>
          <div style={label}>Top Hooks</div>
          {d.hooks.slice(0, 6).map((h) => (
            <div key={h.text} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
              <span style={{ flex: 1, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>“{h.text}”</span>
              <b style={{ color: h.active ? '#16a34a' : '#9ca3af' }}>{h.days}d</b>
            </div>
          ))}
          {d.hooks.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No hooks yet</div>}
        </div>
      </div>

      <FilterBar days={days} setDays={setDays} format={format} setFormat={setFormat} status={status} setStatus={setStatus} sort={sort} setSort={setSort} total={total} />

      {ads.length === 0 && loading && <div style={{ color: '#9ca3af', fontSize: 14, padding: 20 }}>Loading ads…</div>}
      {ads.length === 0 && !loading && <div style={{ color: '#9ca3af', fontSize: 14, padding: 20 }}>No ads match these filters.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px,100%), 1fr))', gap: 12 }}>
        {ads.map((a) => <AdCard key={a.id} a={a} onOpen={onOpen} onClone={openClone} />)}
      </div>
      {hasMore && (
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <button onClick={loadMore} disabled={loading} style={{ padding: '10px 24px', borderRadius: 10, border: '1px solid #e6e6e6', background: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{loading ? 'Loading…' : 'Load more ads'}</button>
        </div>
      )}
    </div>
  )
}

function TimelineGantt({ pageId, onOpen }: { pageId: string; onOpen: (a: Card) => void }) {
  const { ads, loading, hasMore, loadMore } = useBrandAds(pageId, { days: 0, format: '', status: 'ALL', sort: 'recent' })
  if (loading && ads.length === 0) return <div style={{ color: '#9ca3af', fontSize: 14, padding: 20 }}>Loading timeline…</div>
  if (ads.length === 0) return <div style={{ color: '#9ca3af', fontSize: 14, padding: 20 }}>No ads to chart yet.</div>
  const now = Date.now()
  const spans = ads.map((a) => ({ a, s: a.startDate ? +new Date(a.startDate) : NaN, e: a.stopDate ? +new Date(a.stopDate) : (a.isActive ? now : NaN) })).filter((x) => !isNaN(x.s))
  const min = Math.min(...spans.map((x) => x.s))
  const max = now
  const span = Math.max(1, max - min)
  const months: { label: string; left: number }[] = []
  const d0 = new Date(min); d0.setDate(1)
  for (let t = +d0; t <= max; ) { const dt = new Date(t); months.push({ label: dt.toLocaleString('en', { month: 'short', year: '2-digit' }), left: ((t - min) / span) * 100 }); dt.setMonth(dt.getMonth() + 1); t = +dt }
  return (
    <div style={card}>
      <div style={label}>Timeline <span style={{ textTransform: 'none', fontWeight: 500 }}>— each ad’s live window; click to inspect</span></div>
      <div style={{ position: 'relative', height: 18, marginLeft: 200, marginBottom: 6, borderBottom: '1px solid #eee' }}>
        {months.map((m, i) => <span key={i} style={{ position: 'absolute', left: `${m.left}%`, fontSize: 10, color: '#9ca3af' }}>{m.label}</span>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 560, overflowY: 'auto' }}>
        {spans.map(({ a, s, e }) => {
          const left = ((s - min) / span) * 100
          const width = Math.max(0.6, ((Math.min(e, max) - s) / span) * 100)
          return (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 8, alignItems: 'center' }}>
              <button onClick={() => onOpen(a)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', overflow: 'hidden' }}>
                {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: 'cover', flexShrink: 0 }} /> : <div style={{ width: 26, height: 26, borderRadius: 5, background: '#f3f4f6', flexShrink: 0 }} />}
                <span style={{ fontSize: 11, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.id}</span>
              </button>
              <div style={{ position: 'relative', height: 18, background: '#f8f9fa', borderRadius: 5 }}>
                <button onClick={() => onOpen(a)} title={`${fmtDate(a.startDate)} → ${a.isActive ? 'Present' : fmtDate(a.stopDate)}`} style={{ position: 'absolute', left: `${left}%`, width: `${width}%`, top: 2, height: 14, borderRadius: 5, border: 'none', cursor: 'pointer', background: a.isActive ? '#bbf7d0' : '#e5e7eb' }} />
              </div>
            </div>
          )
        })}
      </div>
      {hasMore && <div style={{ textAlign: 'center', marginTop: 12 }}><button onClick={loadMore} disabled={loading} style={{ padding: '8px 20px', borderRadius: 8, border: '1px solid #e6e6e6', background: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{loading ? 'Loading…' : 'Load more'}</button></div>}
    </div>
  )
}

// Creative Tests — each launch-day row expands (Foreplay-style) to show that day's ads, fetched
// on demand from the /ads?day= endpoint. survival = still-running / launched.
function CreativeTests({ d, pageId, onOpen }: { d: Spy; pageId: string; onOpen: (a: Card) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [adsByDay, setAdsByDay] = useState<Record<string, Card[]>>({})
  const [loadingDay, setLoadingDay] = useState<string | null>(null)
  const toggle = async (date: string) => {
    if (open === date) { setOpen(null); return }
    setOpen(date)
    if (!adsByDay[date]) {
      setLoadingDay(date)
      try {
        const r = await fetch(`/api/discovery/brand-spy/${pageId}/ads?day=${date}&sort=longest`)
        const j = await r.json()
        setAdsByDay((m) => ({ ...m, [date]: j.ads || [] }))
      } finally { setLoadingDay(null) }
    }
  }
  return (
    <div style={card}>
      <div style={label}>Creative Tests <span style={{ textTransform: 'none', fontWeight: 500 }}>— ads launched together on one day; click to see them. survival = still-running / launched</span></div>
      {d.creativeTests.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No multi-ad launch batches detected yet.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {d.creativeTests.map((t) => {
          const color = t.survival >= 60 ? '#10b981' : t.survival >= 30 ? '#f59e0b' : '#ef4444'
          const isOpen = open === t.date
          return (
            <div key={t.date} style={{ border: '1px solid #f0f0f0', borderRadius: 10, overflow: 'hidden' }}>
              <button onClick={() => toggle(t.date)} style={{ width: '100%', display: 'grid', gridTemplateColumns: '20px 120px 1fr 140px', alignItems: 'center', gap: 12, padding: '10px 12px', background: isOpen ? '#fafafa' : '#fff', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ color: '#9ca3af', fontSize: 12 }}>{isOpen ? '▾' : '▸'}</span>
                <span style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>{new Date(t.date).toLocaleDateString()}</span>
                <span style={{ height: 16, background: '#f3f4f6', borderRadius: 6, overflow: 'hidden', display: 'block' }}><span style={{ display: 'block', width: `${t.survival}%`, height: '100%', background: color, borderRadius: 6 }} /></span>
                <span style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#111' }}>{t.running}/{t.launched} live <span style={{ color, fontWeight: 800 }}>{t.survival}%</span></span>
              </button>
              {isOpen && (
                <div style={{ padding: 12, background: '#fafafa', borderTop: '1px solid #f0f0f0' }}>
                  {loadingDay === t.date && <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading ads…</div>}
                  {adsByDay[t.date] && adsByDay[t.date].length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No previews for this day.</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px,100%), 1fr))', gap: 10 }}>
                    {(adsByDay[t.date] || []).map((a) => <AdCard key={a.id} a={a} onOpen={onOpen} />)}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Timeline tab — Ad Launch Trends + Active Ad Trends (range-filtered) + Top 10 ads by performance.
function TimelineTab({ d, pageId, onOpen }: { d: Spy; pageId: string; onOpen: (a: Card) => void }) {
  const [range, setRange] = useState(0)   // months to show; 0 = all
  const launches = range ? d.launchesByMonth.slice(-range) : d.launchesByMonth
  const trend = range ? d.activeTrend.slice(-Math.round(range * 4.33)) : d.activeTrend
  return (
    <div>
      {/* Top 10 ads by performance score */}
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={label}>Top Ads by Performance <span style={{ textTransform: 'none', fontWeight: 500 }}>— highest performance score (rollup)</span></div>
        {d.topAds.length === 0 && <div style={{ color: '#9ca3af', fontSize: 13 }}>No performance scores computed yet — these fill in after the nightly rollup.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(150px,100%), 1fr))', gap: 10 }}>
          {d.topAds.map((a, i) => (
            <a key={a.adId} href={a.snapshot_url || '#'} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit', border: '1px solid #e6e6e6', borderRadius: 10, overflow: 'hidden', position: 'relative', display: 'block' }}>
              <span style={{ position: 'absolute', top: 6, left: 6, zIndex: 1, fontSize: 10, fontWeight: 800, color: '#111', background: ACCENT, padding: '2px 7px', borderRadius: 6 }}>#{i + 1}</span>
              <span style={{ position: 'absolute', top: 6, right: 6, zIndex: 1, fontSize: 10, fontWeight: 800, color: '#fff', background: '#2075ff', padding: '2px 7px', borderRadius: 6 }}>{a.score}</span>
              <div style={{ aspectRatio: '4 / 5', background: '#f3f4f6' }}>
                {a.thumb ? <img src={a.thumb} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#c4c4c4', fontSize: 11 }}>no preview</div>}
              </div>
              <div style={{ padding: '7px 9px', fontSize: 11, color: '#374151', lineHeight: 1.3, maxHeight: 46, overflow: 'hidden' }}>{a.hook}</div>
              <div style={{ padding: '0 9px 8px', fontSize: 11, fontWeight: 700, color: a.active ? '#16a34a' : '#9ca3af' }}>{a.active ? '● ' : ''}{a.days}d</div>
            </a>
          ))}
        </div>
      </div>

      {/* Range filter for the trend charts */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {([[3, '3m'], [6, '6m'], [12, '12m'], [0, 'All']] as [number, string][]).map(([m, l]) => (
          <button key={m} onClick={() => setRange(m)} style={FILTER_BTN(range === m)}>{l}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={card}>
          <div style={label}>Ad Launch Trends <span style={{ textTransform: 'none', fontWeight: 500 }}>— new ads / month</span></div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={launches} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} /><YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} /><Tooltip /><Line type="monotone" dataKey="count" stroke="#ff7a00" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div style={card}>
          <div style={label}>Active Ad Trends <span style={{ textTransform: 'none', fontWeight: 500 }}>— ads live / week</span></div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs><linearGradient id="spyArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff7a00" stopOpacity={0.35} /><stop offset="100%" stopColor="#ff7a00" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="week" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={3} /><YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} /><Tooltip /><Area type="monotone" dataKey="active" stroke="#ff7a00" strokeWidth={2} fill="url(#spyArea)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{ marginTop: 12 }}><TimelineGantt pageId={pageId} onOpen={onOpen} /></div>
      <div style={{ marginTop: 14, padding: 12, background: 'rgba(223,254,149,0.18)', border: `1px solid ${ACCENT}`, borderRadius: 10, fontSize: 12, color: '#3f6212' }}>◆ Trends reconstructed from every ad’s live window in our index — history from before you started watching, from real snapshots.</div>
    </div>
  )
}

const TABS = [['overview', 'Overview'], ['library', 'Ad Library'], ['hooks', 'Hooks'], ['personas', 'Personas'], ['angles', 'Ad angles'], ['usps', 'USPs'], ['desires', 'Desires'], ['emotions', 'Emotions'], ['themes', 'Themes'], ['tests', 'Creative Tests'], ['timeline', 'Timeline'], ['landing', 'Landing Pages']] as const

// Per-brand email alerts — opt in right from the brand you're spying. Costs 2 credits per email.
function EmailAlertToggle({ pageId, brandName }: { pageId: string; brandName?: string }) {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    fetch('/api/follows').then(r => r.json()).then(j => {
      const b = (j.brands || []).find((x: any) => String(x.page_id) === String(pageId))
      setOn(!!b?.email_alerts)
    }).catch(() => setOn(false))
  }, [pageId])
  const toggle = async () => {
    if (on == null || busy) return
    const next = !on
    setBusy(true); setOn(next)
    try {
      await fetch('/api/follows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'set_email', pageId, brandName, email_alerts: next }) })
    } catch { setOn(!next) } finally { setBusy(false) }
  }
  return (
    <button onClick={toggle} title="Get emailed when this brand launches new ads (2 credits per email)"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, padding: '6px 13px', borderRadius: 100, cursor: on == null ? 'default' : 'pointer', border: '1px solid', borderColor: on ? '#1a3a1a' : '#d1d5db', background: on ? '#1a3a1a' : '#fff', color: on ? '#dffe95' : '#374151', opacity: on == null ? 0.5 : 1 }}>
      🔔 {on ? 'Email alerts on' : 'Email me new ads'} <span style={{ opacity: 0.7, fontWeight: 600 }}>· 2 cr</span>
    </button>
  )
}

export default function BrandSpyDetail() {
  const { pageId } = useParams<{ pageId: string }>()
  const [d, setD] = useState<Spy | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<typeof TABS[number][0]>('overview')
  const [drawerAd, setDrawerAd] = useState<Card | null>(null)

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
          <button onClick={() => setTab('library')} style={{ fontSize: 13, fontWeight: 700, color: '#2075ff', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>View all ads →</button>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '4px 0 2px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: '#111', margin: 0 }}>{d.brand.name}</h1>
        <EmailAlertToggle pageId={pageId} brandName={d.brand.name} />
      </div>
      <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 18 }}>
        {s.firstSeen ? `Earliest ad ${new Date(s.firstSeen).toLocaleDateString()}` : 'Spying since first crawl'}
        {s.dataAsOf ? <span> · <span style={{ color: '#16a34a', fontWeight: 600 }}>data as of {new Date(s.dataAsOf).toLocaleString()}</span></span> : null}
      </div>

      {/* Persistent summary panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px,100%), 1fr))', gap: 12, marginBottom: 16 }}>
        <Stat k="Total ads" v={s.total.toLocaleString()} sub={s.affiliateCount ? `${(s.ownCount ?? 0).toLocaleString()} own + ${s.affiliateCount.toLocaleString()} affiliate` : undefined} />
        <Stat k="Active" v={s.active.toLocaleString()} sub={`${s.activePct}% live`} />
        <Stat k="Inactive" v={s.inactive.toLocaleString()} sub="taken down" />
        <Stat k="Video / Image" v={`${s.videoPct}% / ${s.imagePct}%`} sub="creative mix" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
        {TABS.map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: '7px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap', color: tab === id ? '#111' : '#6b7280', background: tab === id ? 'rgba(223,254,149,0.5)' : '#f3f4f6' }}>{lbl}</button>
        ))}
      </div>

      {tab === 'overview' && <Overview d={d} />}
      {tab === 'personas' && <DnaList title="Personas" items={d.topPersonas} />}
      {tab === 'angles' && <DnaList title="Ad angles" items={d.topAnglesDNA?.length ? d.topAnglesDNA : d.topAngles} />}
      {tab === 'usps' && <DnaList title="USPs" items={d.topUSPs} />}
      {tab === 'desires' && <DnaList title="Desires" items={d.topDesires} />}
      {tab === 'emotions' && <DnaList title="Emotions" items={d.topEmotions} />}
      {tab === 'themes' && <DnaList title="Themes" items={d.topThemes} />}
      {tab === 'library' && <AdLibrary d={d} pageId={pageId} onOpen={setDrawerAd} />}

      {tab === 'timeline' && <TimelineTab d={d} pageId={pageId} onOpen={setDrawerAd} />}

      {tab === 'tests' && <CreativeTests d={d} pageId={pageId} onOpen={setDrawerAd} />}

      {tab === 'hooks' && <Hooks d={d} />}

      {tab === 'landing' && <LandingPages d={d} />}

      {drawerAd && <AdDetailsDrawer a={drawerAd} onClose={() => setDrawerAd(null)} />}
    </div>
  )
}
