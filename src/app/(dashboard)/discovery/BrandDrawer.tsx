'use client'
import { useState, useEffect, useRef } from 'react'
import { X, ExternalLink, Heart, Clock, TrendingUp, Video, Image, Layers } from 'lucide-react'
import { cleanCopy } from '@/lib/cleanCopy'

// ── Types ────────────────────────────────────────────────────────
interface BrandData {
  brand: {
    page_id: string; page_name: string; total_ads: number; active_ads: number
    first_seen: string | null; last_seen: string | null
    with_creative: number; video_ads: number; avg_days_running: number
  }
  creatives: any[]
  adCopies: { id: string; text: string; isActive: boolean; date: string; snapshot_url: string; thumb: string | null }[]
  headlines: { id: string; text: string; isActive: boolean; date: string; snapshot_url: string }[]
  hooks: { type: string; count: number; examples: { id: string; body: string; thumb: string | null }[] }[]
  angles: { text: string; count: number }[]
  emotions: { text: string; count: number }[]
  themes: { text: string; count: number }[]
  personas: { text: string; count: number }[]
  usps: { text: string; count: number }[]
  desires: { text: string; count: number }[]
  landingPages: any[]
}

interface BrandDrawerProps {
  pageId: string
  pageName: string
  onClose: () => void
}

// ── Constants ────────────────────────────────────────────────────
const DRAWER_TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'creatives', label: 'Creatives' },
  { id: 'hooks',     label: 'Hooks' },
  { id: 'adcopy',    label: 'Ad copy' },
  { id: 'headlines', label: 'Headlines' },
  { id: 'landing',   label: 'Landing pages' },
  { id: 'personas',  label: 'Personas' },
  { id: 'angles',    label: 'Ad angles' },
  { id: 'usps',      label: 'USPs' },
  { id: 'desires',   label: 'Desires' },
  { id: 'emotions',  label: 'Emotions' },
  { id: 'themes',    label: 'Themes' },
]

const TIME_FILTERS = [
  { label: 'All time', days: 0 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
]

const AVATAR_COLORS = ['#1a3a1a','#1e3a5f','#4a1942','#3a1a1a','#1a3a38','#2d3a1a','#3a2a1a']
function avatarColor(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length
  return AVATAR_COLORS[h]
}

function relativeDate(iso: string | null) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d < 30) return `${d}d ago`
  if (d < 365) return `${Math.floor(d/30)}mo ago`
  return `${Math.floor(d/365)}y ago`
}

// ── FrequencyBar ─────────────────────────────────────────────────
function FreqBar({ label, count, max, color = '#1a3a1a' }: { label: string; count: number; max: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: 140, fontSize: 12, color: '#374151', fontWeight: 500, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={label}>{label}</div>
      <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', background: color, borderRadius: 4, width: `${Math.max(4, (count / max) * 100)}%`, transition: 'width 0.4s ease' }} />
      </div>
      <div style={{ width: 28, fontSize: 11, color: '#6b7280', textAlign: 'right', flexShrink: 0 }}>{count}</div>
    </div>
  )
}

// ── TagCloud ─────────────────────────────────────────────────────
function TagCloud({ items, color = '#1a3a1a', bg = '#f0fdf4', border = '#bbf7d0' }: {
  items: { text: string; count: number }[]
  color?: string; bg?: string; border?: string
}) {
  if (!items.length) return <EmptyState text="No data yet — run AI classification first" />
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map(({ text, count }) => (
        <span key={text} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '5px 12px', background: bg, color, border: `1px solid ${border}`,
          borderRadius: 100, fontSize: 13, fontWeight: 500,
        }}>
          {text}
          <span style={{ fontSize: 10, opacity: 0.6, fontWeight: 700 }}>{count}</span>
        </span>
      ))}
    </div>
  )
}

// ── EmptyState ───────────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af' }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>🤷</div>
      <div style={{ fontSize: 14 }}>{text}</div>
    </div>
  )
}

// ── CreativeCard (mini) ──────────────────────────────────────────
function MiniCreativeCard({ ad }: { ad: any }) {
  const [imgErr, setImgErr] = useState(false)
  const thumb = ad.thumbnail_url || (ad.page_id ? `https://graph.facebook.com/${ad.page_id}/picture?type=large` : null)
  const initials = (ad.page_name || '?').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
  const bg = avatarColor(ad.page_name || '')

  return (
    <a href={ad.snapshot_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden',
        transition: 'box-shadow 0.15s',
      }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)')}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
      >
        {/* Image */}
        <div style={{ position: 'relative', aspectRatio: '4/3', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <span style={{ fontSize: 32, fontWeight: 800, color: '#dffe95' }}>{initials}</span>
          {thumb && !imgErr && (
            <img src={thumb} alt="" onError={() => setImgErr(true)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          {(ad.format === 'Video' || ad.video_url) && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 14, marginLeft: 2 }}>▶</span>
              </div>
            </div>
          )}
          <div style={{ position: 'absolute', top: 6, left: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: ad.is_active ? '#22c55e' : '#9ca3af', display: 'inline-block', border: '1.5px solid #fff' }} />
          </div>
          {ad.days_running > 0 && (
            <div style={{ position: 'absolute', bottom: 6, right: 6, fontSize: 9, fontWeight: 700, padding: '2px 5px', background: 'rgba(0,0,0,0.6)', color: '#fff', borderRadius: 4 }}>
              {ad.days_running}d
            </div>
          )}
        </div>
        {/* Text */}
        {(() => {
          const title = cleanCopy(ad.title)
          const body = cleanCopy(ad.body)
          if (!title && !body) return null
          return (
            <div style={{ padding: '8px 10px' }}>
              {title && <div style={{ fontSize: 11, fontWeight: 700, color: '#111', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>}
              {body && <div style={{ fontSize: 10, color: '#6b7280', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{body}</div>}
            </div>
          )
        })()}
      </div>
    </a>
  )
}

// ── Overview Tab ─────────────────────────────────────────────────
function OverviewTab({ data }: { data: BrandData }) {
  const { brand, hooks, angles, emotions, themes } = data
  const maxHook = hooks[0]?.count || 1
  const maxAngle = angles[0]?.count || 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px,100%), 1fr))', gap: 12 }}>
        {[
          { icon: '📦', label: 'Total Ads', value: brand.total_ads.toLocaleString(), color: '#1a3a1a' },
          { icon: '🟢', label: 'Active Now', value: brand.active_ads.toLocaleString(), color: '#16a34a' },
          { icon: '📅', label: 'Avg Runtime', value: `${brand.avg_days_running}d`, color: '#7c3aed' },
          { icon: '🎬', label: 'Video Ads', value: brand.video_ads.toLocaleString(), color: '#0891b2' },
          { icon: '🖼', label: 'With Creative', value: brand.with_creative.toLocaleString(), color: '#b45309' },
          { icon: '📊', label: 'Image Ads', value: (brand.total_ads - brand.video_ads).toLocaleString(), color: '#dc2626' },
        ].map(s => (
          <div key={s.label} style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', border: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>{s.icon}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Top Hooks */}
      {hooks.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 12 }}>Top Hooks</div>
          {hooks.slice(0, 6).map(h => (
            <FreqBar key={h.type} label={h.type} count={h.count} max={maxHook} color="#1a3a1a" />
          ))}
        </div>
      )}

      {/* Top Angles */}
      {angles.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 12 }}>Top Ad Angles</div>
          {angles.slice(0, 5).map(a => (
            <FreqBar key={a.text} label={a.text} count={a.count} max={maxAngle} color="#7c3aed" />
          ))}
        </div>
      )}

      {/* Quick themes */}
      {themes.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', marginBottom: 10 }}>Themes Used</div>
          <TagCloud items={themes.slice(0, 12)} color="#166534" bg="#f0fdf4" border="#bbf7d0" />
        </div>
      )}

      {!hooks.length && !angles.length && (
        <EmptyState text="No AI classification yet. Run the crawler with AI classification to unlock this tab." />
      )}
    </div>
  )
}

// ── Hooks Tab ────────────────────────────────────────────────────
function HooksTab({ hooks }: { hooks: BrandData['hooks'] }) {
  if (!hooks.length) return <EmptyState text="No hooks classified yet. Run AI classification first." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {hooks.map(hook => (
        <div key={hook.type} style={{ background: '#f8fafc', borderRadius: 12, padding: 16, border: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{hook.type}</div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', background: '#1a3a1a', color: '#dffe95', borderRadius: 100 }}>
              {hook.count} ads
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hook.examples.map(ex => {
              const body = cleanCopy(ex.body)
              if (!body) return null
              return (
                <div key={ex.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  {ex.thumb && (
                    <img src={ex.thumb} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: '1px solid #e2e8f0' }}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  )}
                  <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, fontStyle: 'italic' }}>
                    "{body}{body.length >= 160 ? '…' : ''}"
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Text List Tab (Ad copy / Headlines) ──────────────────────────
function TextListTab({ items, emptyMsg }: {
  items: { id: string; text: string; isActive: boolean; date: string; snapshot_url: string; thumb?: string | null }[]
  emptyMsg: string
}) {
  // Strip dynamic-creative {{tokens}} and drop entries that were nothing but tokens.
  const visible = items.map(i => ({ ...i, text: cleanCopy(i.text) })).filter(i => i.text)
  if (!visible.length) return <EmptyState text={emptyMsg} />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visible.map(item => (
        <a key={item.id} href={item.snapshot_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          <div style={{
            padding: '12px 14px', background: '#fff', borderRadius: 10, border: '1px solid #f1f5f9',
            transition: 'border-color 0.15s, box-shadow 0.15s',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#1a3a1a'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#f1f5f9'; e.currentTarget.style.boxShadow = 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              {item.thumb && (
                <img src={item.thumb} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: '1px solid #e2e8f0' }}
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#1f2937', lineHeight: 1.6 }}>{item.text}</div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.isActive ? '#22c55e' : '#d1d5db', display: 'inline-block' }} />
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>
                    {item.isActive ? 'Active' : 'Ended'}
                    {item.date && ` · ${new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}`}
                  </span>
                  <ExternalLink size={10} style={{ color: '#d1d5db', marginLeft: 'auto' }} />
                </div>
              </div>
            </div>
          </div>
        </a>
      ))}
    </div>
  )
}

// ── Main BrandDrawer ─────────────────────────────────────────────
export default function BrandDrawer({ pageId, pageName, onClose }: BrandDrawerProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [timeDays, setTimeDays] = useState(0)
  const [data, setData] = useState<BrandData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [followed, setFollowed] = useState(false)
  const tabsRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const [pulling, setPulling] = useState(false)

  // Fetch brand data
  useEffect(() => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page_id: pageId })
    if (timeDays > 0) params.set('days', String(timeDays))
    fetch(`/api/discovery/brand?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [pageId, timeDays])

  // ON-DEMAND CRAWL: opening a brand in Discovery = user interest → refresh its ads so the freshest
  // creatives are available to clone. Fire-and-forget; the server's freshness guard skips brands we
  // crawled recently, and the per-plan daily cap bounds IPRoyal spend. Non-blocking: the drawer shows
  // whatever we already have immediately, and fresh ads land on the next open. (Spy-only crawler picks
  // it up right away since crawlOnly marks it priority=9 + last_crawled_at=null.)
  useEffect(() => {
    let cancelled = false
    fetch('/api/discovery/brand-spy', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageId, name: pageName, crawlOnly: true }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d && d.crawlOnly && !d.alreadyFresh) setPulling(true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [pageId, pageName])

  const initials = pageName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  const avatarBg = avatarColor(pageName)
  const brand = data?.brand

  const renderTab = () => {
    if (loading) return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, flexDirection: 'column', gap: 12 }}>
        <div style={{ width: 28, height: 28, border: '3px solid #e2e8f0', borderTopColor: '#1a3a1a', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <div style={{ fontSize: 13, color: '#9ca3af' }}>Loading brand data…</div>
      </div>
    )
    if (error) return <EmptyState text={`Error: ${error}`} />
    if (!data) return <EmptyState text="No data available" />

    switch (activeTab) {
      case 'overview':  return <OverviewTab data={data} />
      case 'creatives': return (
        data.creatives.length
          ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px,100%), 1fr))', gap: 12 }}>
              {data.creatives.map(ad => <MiniCreativeCard key={ad.ad_id} ad={ad} />)}
            </div>
          : <EmptyState text="No creatives yet. Run the crawler with Bright Data to get real ad images." />
      )
      case 'hooks':     return <HooksTab hooks={data.hooks} />
      case 'adcopy':    return <TextListTab items={data.adCopies.map(a => ({ ...a, thumb: a.thumb }))} emptyMsg="No ad copy found for this brand." />
      case 'headlines': return <TextListTab items={data.headlines.map(a => ({ ...a, thumb: null }))} emptyMsg="No headlines found for this brand." />
      case 'landing':   return (
        <div style={{ textAlign: 'center', padding: '60px 24px' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🚧</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 8 }}>Landing Pages — Coming Soon</div>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.7 }}>
            We'll scrape each ad's destination URL and capture<br />screenshots + extracted copy. Requires Bright Data setup.
          </div>
        </div>
      )
      case 'personas':  return (
        <div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Who this brand targets in their ads, based on AI classification.</div>
          <TagCloud items={data.personas} color="#1d4ed8" bg="#eff6ff" border="#bfdbfe" />
          {!data.personas.length && <EmptyState text="No personas classified yet. Run AI classification first." />}
        </div>
      )
      case 'angles':    return (
        <div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>The persuasion angles this brand uses most in their ads.</div>
          {data.angles.length
            ? data.angles.map(a => <FreqBar key={a.text} label={a.text} count={a.count} max={data.angles[0]?.count || 1} color="#7c3aed" />)
            : <EmptyState text="No ad angles classified yet." />}
        </div>
      )
      case 'usps':      return (
        <div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Unique selling points this brand emphasizes across their ads.</div>
          <TagCloud items={data.usps} color="#0891b2" bg="#f0f9ff" border="#bae6fd" />
          {!data.usps.length && <EmptyState text="No USPs classified yet. Run AI classification first." />}
        </div>
      )
      case 'desires':   return (
        <div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Core desires this brand taps into in their ad creative.</div>
          <TagCloud items={data.desires} color="#dc2626" bg="#fef2f2" border="#fecaca" />
          {!data.desires.length && <EmptyState text="No desires classified yet." />}
        </div>
      )
      case 'emotions':  return (
        <div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Emotions this brand triggers in their ads.</div>
          {data.emotions.length
            ? data.emotions.map(e => <FreqBar key={e.text} label={e.text} count={e.count} max={data.emotions[0]?.count || 1} color="#ea580c" />)
            : <EmptyState text="No emotions classified yet." />}
        </div>
      )
      case 'themes':    return (
        <div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Recurring themes detected across this brand's ads.</div>
          {data.themes.length
            ? data.themes.map(t => <FreqBar key={t.text} label={t.text} count={t.count} max={data.themes[0]?.count || 1} color="#059669" />)
            : <EmptyState text="No themes detected yet." />}
        </div>
      )
      default: return null
    }
  }

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } } @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>

      {/* Overlay */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, backdropFilter: 'blur(2px)' }}
      />

      {/* Drawer panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 820,
        background: '#fff', zIndex: 201, display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.2)',
        animation: 'slideIn 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* ── Header ── */}
        <div style={{ padding: '20px 24px 0', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            {/* Avatar */}
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: avatarBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: '#dffe95', flexShrink: 0, letterSpacing: -0.5 }}>
              {initials}
            </div>

            {/* Name + meta */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#111', marginBottom: 2 }}>{pageName || 'Brand'}</div>
              {brand && (
                <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: brand.active_ads > 0 ? '#22c55e' : '#9ca3af', display: 'inline-block' }} />
                    {brand.active_ads > 0 ? `${brand.active_ads} active` : 'No active ads'}
                  </span>
                  {brand.first_seen && (
                    <span>First seen {relativeDate(brand.first_seen)}</span>
                  )}
                  {brand.last_seen && (
                    <span>Updated {relativeDate(brand.last_seen)}</span>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {pulling && (
                <span title="We're pulling this brand's latest ads — refresh in a moment to see them"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#15803d' }}>
                  <span style={{ width: 12, height: 12, border: '2px solid #bbf7d0', borderTopColor: '#15803d', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Fetching latest ads…
                </span>
              )}
              <button
                onClick={() => setFollowed(f => !f)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
                  background: followed ? '#1a3a1a' : '#fff',
                  border: `1.5px solid ${followed ? '#1a3a1a' : '#e2e8f0'}`,
                  borderRadius: 8, fontSize: 13, fontWeight: 700,
                  color: followed ? '#dffe95' : '#374151',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <Heart size={13} fill={followed ? '#dffe95' : 'none'} />
                {followed ? 'Following' : 'Follow'}
              </button>
              <a
                href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&view_all_page_id=${pageId}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#374151', textDecoration: 'none', fontWeight: 600, fontFamily: 'inherit' }}
              >
                Meta library <ExternalLink size={11} />
              </a>
              <button onClick={onClose} style={{ padding: 8, background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280' }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Time filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 0 }}>
            {TIME_FILTERS.map(f => (
              <button key={f.days} onClick={() => setTimeDays(f.days)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: timeDays === f.days ? '#1a3a1a' : 'transparent',
                  color: timeDays === f.days ? '#dffe95' : '#6b7280',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Tab nav */}
          <div ref={tabsRef} style={{ display: 'flex', gap: 0, overflowX: 'auto', marginTop: 4, paddingBottom: 0 }}
            className="hide-scrollbar">
            {DRAWER_TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '10px 14px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                  background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  color: activeTab === tab.id ? '#1a3a1a' : '#6b7280',
                  borderBottom: `2px solid ${activeTab === tab.id ? '#1a3a1a' : 'transparent'}`,
                  transition: 'color 0.15s, border-color 0.15s',
                }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {renderTab()}
        </div>
      </div>
    </>
  )
}
