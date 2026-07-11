'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { ExternalLink, ArrowLeft, Bookmark } from 'lucide-react'
import { cleanCopy } from '@/lib/cleanCopy'
import CloneModal from '../../CloneModal'
import CloneVideoModal from '../../CloneVideoModal'

const FMT_BADGE: Record<string, string> = { Video: '#2075ff', Image: '#10b981', Carousel: '#f59e0b' }
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
const FILTER_BTN = (on: boolean): React.CSSProperties => ({ fontSize: 13, fontWeight: 700, padding: '7px 12px', borderRadius: 8, border: '1px solid #e6e6e6', background: on ? 'rgba(223,254,149,0.5)' : '#fff', cursor: 'pointer', color: '#111', fontFamily: 'inherit' })

// ── Types ────────────────────────────────────────────────────
interface Ad {
  id: string; pageId: string; pageName: string; body: string; title: string
  caption: string; snapshotUrl: string; startDate: string; stopDate: string | null
  platforms: string[]; mediaType: string; isActive: boolean; daysRunning: number
  thumbnailUrl?: string | null; videoUrl?: string | null
}

interface Analysis {
  personas: string[]; adAngles: string[]; usps: string[]
  desires: string[]; emotions: string[]; hooks: string[]; themes: string[]
}

// Ads grid ("Creatives") leads — it's the ad library people come to see. Overview/analysis follow.
const TABS = ['Creatives', 'Overview', 'Hooks', 'Ad Copy', 'Headlines', 'Personas', 'Ad Angles', 'USPs', 'Desires', 'Emotions', 'Themes']

// ── Helpers ──────────────────────────────────────────────────
function extractHook(body: string): string {
  if (!body) return ''
  const first = body.split(/[.!?]\s/)[0]
  return first.length > 120 ? first.slice(0, 120) + '…' : first
}

function getFormat(mediaType: string): string {
  if (!mediaType) return 'Image'
  const m = mediaType.toUpperCase()
  if (m.includes('VIDEO')) return 'Video'
  if (m.includes('CAROUSEL') || m === 'DCO') return 'Carousel'
  return 'Image'
}

// ── Tag Chip ─────────────────────────────────────────────────
function Chip({ text, color = '#f0fdf4', textColor = '#166534', border = '#bbf7d0' }: {
  text: string; color?: string; textColor?: string; border?: string
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 14px', background: color, color: textColor, border: `1px solid ${border}`, borderRadius: 100, fontSize: 13, fontWeight: 600, margin: '4px 4px 4px 0', lineHeight: 1.4 }}>
      {text}
    </span>
  )
}

// ── Skeleton ─────────────────────────────────────────────────
function Shimmer({ width = '100%', height = 16 }: { width?: string | number; height?: number }) {
  return <div style={{ width, height, background: '#e2e8f0', borderRadius: 6 }} className="shimmer" />
}

// ── Ad Card (Brand-Spy-style: header + Live badge + media + format/days badge + Clone) ──
function MiniAdCard({ ad, onClone }: { ad: Ad; onClone?: (ad: Ad) => void }) {
  const [imgFailed, setImgFailed] = useState(false)
  const fmt = getFormat(ad.mediaType)
  const isVideo = fmt === 'Video' || !!ad.videoUrl
  const img = ad.thumbnailUrl || null
  const body = cleanCopy(ad.body, ad.title)
  return (
    <div style={{ textAlign: 'left', background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
        <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#2075ff', flexShrink: 0 }}>{(ad.pageName || '?')[0]?.toUpperCase()}</div>
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.pageName}</div>
        <span style={{ fontSize: 11, fontWeight: 700, color: ad.isActive ? '#16a34a' : '#9ca3af' }}>{ad.isActive ? '● Live' : 'Off'}</span>
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af', padding: '0 12px 8px' }}>{fmtDate(ad.startDate)}{ad.isActive ? ' – Present' : ad.stopDate ? ` – ${fmtDate(ad.stopDate)}` : ''}</div>
      {body && <div style={{ fontSize: 12, color: '#374151', padding: '0 12px 8px', lineHeight: 1.4, maxHeight: 52, overflow: 'hidden' }}>{body.slice(0, 120)}</div>}
      <div style={{ position: 'relative', aspectRatio: '4 / 5', background: '#f3f4f6' }}>
        {img && !imgFailed
          ? <img src={img} alt="" loading="lazy" onError={() => setImgFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#c4c4c4', fontSize: 12 }}>no preview</div>}
        {isVideo && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}><div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>▶</div></div>}
        <span style={{ position: 'absolute', top: 8, left: 8, fontSize: 10, fontWeight: 800, color: '#fff', background: FMT_BADGE[fmt] || '#6b7280', padding: '2px 7px', borderRadius: 6 }}>{fmt}</span>
        {(ad.daysRunning || 0) > 0 && <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 800, color: '#111', background: 'rgba(255,255,255,0.92)', padding: '2px 7px', borderRadius: 6 }}>{ad.daysRunning}d</span>}
        {ad.snapshotUrl && <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer" title="Open original" style={{ position: 'absolute', inset: 0, zIndex: 1 }} />}
        {onClone && <button onClick={(e) => { e.stopPropagation(); onClone(ad) }} style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 5, background: '#dffe95', color: '#111', border: 'none', borderRadius: 20, fontSize: 11.5, fontWeight: 800, padding: '6px 11px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>✨ Clone</button>}
      </div>
    </div>
  )
}

// ── Text List Item ────────────────────────────────────────────
function TextItem({ text, index }: { text: string; index: number }) {
  return (
    <div style={{ padding: '14px 18px', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 8, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#f0fdf4', color: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
        {index + 1}
      </span>
      <p style={{ margin: 0, fontSize: 14, color: '#111', lineHeight: 1.6 }}>{text}</p>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────
export default function BrandPage() {
  const { pageId } = useParams<{ pageId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('Creatives')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  // Prefer an explicit ?name=, else the real page name from the loaded ads — so a direct visit to
  // /discovery/brand/<id> (e.g. from Following) shows the brand, not the placeholder "Brand".
  const pageName: string = searchParams.get('name') || (ads.find(a => (a as any).pageName && (a as any).pageName !== pageId) as any)?.pageName || 'Brand'

  // Creatives-tab (ad library) filters — applied client-side over the loaded ads.
  const [fDays, setFDays] = useState(0)
  const [fFormat, setFFormat] = useState('')
  const [fStatus, setFStatus] = useState('ALL')
  const [fSort, setFSort] = useState('newest')
  const [cloneImg, setCloneImg] = useState<Ad | null>(null)
  const [cloneVid, setCloneVid] = useState<Ad | null>(null)
  const filteredAds = useMemo(() => {
    let arr = ads.slice()
    if (fDays > 0) { const since = Date.now() - fDays * 86_400_000; arr = arr.filter(a => a.isActive || (a.startDate && new Date(a.startDate).getTime() >= since)) }
    if (fFormat) arr = arr.filter(a => getFormat(a.mediaType).toLowerCase() === fFormat.toLowerCase())
    if (fStatus === 'ACTIVE') arr = arr.filter(a => a.isActive)
    else if (fStatus === 'INACTIVE') arr = arr.filter(a => !a.isActive)
    if (fSort === 'longest') arr.sort((a, b) => (b.daysRunning || 0) - (a.daysRunning || 0))
    else arr.sort((a, b) => new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime()) // newest
    return arr
  }, [ads, fDays, fFormat, fStatus, fSort])
  const openClone = (ad: Ad) => { if (getFormat(ad.mediaType) === 'Video' || ad.videoUrl) setCloneVid(ad); else setCloneImg(ad) }

  // Load ads
  const fetchAds = useCallback(async (reset = true, cursor?: string) => {
    setLoading(reset)
    try {
      const params = new URLSearchParams({ page_id: pageId, ...(cursor ? { after: cursor } : {}) })
      const res = await fetch(`/api/discovery/brand?${params}`)
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      // Guard: the brand API omits `ads` entirely when a brand has no creative-backed ads
      // (e.g. freshly-spied brands whose creatives aren't drained yet) → setAds(undefined) used to
      // crash every ads.map/.length below with a client-side exception.
      const incoming = Array.isArray(data.ads) ? data.ads : []
      setAds(prev => reset ? incoming : [...prev, ...incoming])
      setHasMore(!!data.hasMore)
      setNextCursor(data.nextCursor ?? null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [pageId])

  // Check following status
  useEffect(() => {
    fetchAds()
    fetch('/api/discovery/follow')
      .then(r => r.json())
      .then(d => {
        const followed = (d.brands || []).some((b: any) => b.page_id === pageId)
        setIsFollowing(followed)
      })
  }, [pageId])

  // AI analysis — triggered when switching to AI tabs
  const needsAI = ['Personas', 'Ad Angles', 'USPs', 'Desires', 'Emotions'].includes(activeTab)
  useEffect(() => {
    if (!needsAI || analysis || ads.length === 0 || analyzing) return
    setAnalyzing(true)
    fetch('/api/discovery/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_id: pageId, page_name: pageName, ads }),
    })
      .then(r => r.json())
      .then(d => { if (d.analysis) setAnalysis(d.analysis) })
      .finally(() => setAnalyzing(false))
  }, [activeTab, ads])

  const toggleFollow = async () => {
    setFollowLoading(true)
    try {
      if (isFollowing) {
        await fetch(`/api/discovery/follow?page_id=${pageId}`, { method: 'DELETE' })
        setIsFollowing(false)
      } else {
        await fetch('/api/discovery/follow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page_id: pageId, page_name: pageName }),
        })
        setIsFollowing(true)
      }
    } finally {
      setFollowLoading(false)
    }
  }

  // ── Computed stats ────────────────────────────────────────
  const stats = {
    total: ads.length,
    active: ads.filter(a => a.isActive).length,
    video: ads.filter(a => getFormat(a.mediaType) === 'Video').length,
    image: ads.filter(a => getFormat(a.mediaType) === 'Image').length,
    carousel: ads.filter(a => getFormat(a.mediaType) === 'Carousel').length,
    avgDays: ads.length ? Math.round(ads.reduce((s, a) => s + a.daysRunning, 0) / ads.length) : 0,
    maxDays: ads.length ? Math.max(...ads.map(a => a.daysRunning)) : 0,
  }

  // Clean {{mustache}} template tokens out of all ad copy before deriving hooks/copies/headlines.
  const hooks = Array.from(new Set(ads.map(a => extractHook(cleanCopy(a.body))).filter(Boolean))).slice(0, 20)
  const copies = Array.from(new Set(ads.map(a => cleanCopy(a.body)).filter(Boolean))).slice(0, 30)
  const headlines = Array.from(new Set(ads.map(a => cleanCopy(a.title)).filter(Boolean))).slice(0, 30)

  // ── Themes from regex ────────────────────────────────────
  const THEME_PATTERNS: [string, RegExp][] = [
    ['Before & After', /before[\s\S]{0,60}after|transformation|results/i],
    ['Question', /\?/],
    ['Testimonial', /\bi (was|tried|used|love)\b|changed my|my experience/i],
    ['Announcement', /introducing|new|launch|just dropped|announcing/i],
    ['Sale/Discount', /\d+\s*%\s*off|\bsale\b|discount|free shipping|limited time/i],
    ['Pain Point', /struggling|tired of|problem|solution|fix/i],
    ['Tutorial', /how to|step \d|tutorial|guide/i],
    ['Social Proof', /\d[\d,]+\s*(customer|review|sold)|trusted by|#1/i],
  ]
  const themeMap: Record<string, number> = {}
  ads.forEach(ad => {
    const text = `${ad.body} ${ad.title}`
    THEME_PATTERNS.forEach(([name, re]) => {
      if (re.test(text)) themeMap[name] = (themeMap[name] || 0) + 1
    })
  })
  const themes = Object.entries(themeMap).sort((a, b) => b[1] - a[1])

  const initials = pageName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

  const isPermError = error.toLowerCase().includes('permission') || error.toLowerCase().includes('application does not')

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Header ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '16px 28px' }}>
        <button onClick={() => router.back()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 13, fontFamily: 'inherit', marginBottom: 14, padding: 0 }}>
          <ArrowLeft size={14} /> Back to Discovery
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Brand avatar */}
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#1a3a1a', color: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 900, flexShrink: 0 }}>
            {initials}
          </div>

          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#111' }}>{pageName}</h1>
            {!loading && ads.length > 0 && (
              <div style={{ fontSize: 13, color: '#6b7280', marginTop: 3 }}>
                {stats.total} ads loaded · {stats.active} active · Avg {stats.avgDays} days running
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <a
              href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&view_all_page_id=${pageId}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              <ExternalLink size={13} /> Meta Library
            </a>
            <button
              onClick={toggleFollow}
              disabled={followLoading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px',
                background: isFollowing ? '#f0fdf4' : '#1a3a1a',
                color: isFollowing ? '#1a3a1a' : '#dffe95',
                border: `1px solid ${isFollowing ? '#bbf7d0' : '#1a3a1a'}`,
                borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {isFollowing ? '✓ Following' : '+ Follow'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginTop: 20, borderBottom: '1px solid #e2e8f0', marginBottom: -17, overflowX: 'auto' }}>
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 16px', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: activeTab === tab ? 700 : 500,
                color: activeTab === tab ? '#1a3a1a' : '#6b7280',
                borderBottom: `2px solid ${activeTab === tab ? '#1a3a1a' : 'transparent'}`,
                whiteSpace: 'nowrap', fontFamily: 'inherit', marginBottom: -1,
              }}>
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: '28px' }}>

        {/* Permission error */}
        {isPermError && (
          <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔐</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111', marginBottom: 8 }}>API Access Pending</div>
            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 20 }}>
              Meta Ads Library API access is being processed (48hrs).<br />
              Once approved, the full brand profile will load here.
            </div>
            <a href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=US&view_all_page_id=${pageId}`}
              target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', background: '#1a3a1a', color: '#dffe95', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
              <ExternalLink size={14} /> View on Meta Ads Library
            </a>
          </div>
        )}

        {/* Loading */}
        {loading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px,100%), 1fr))', gap: 14 }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '10px 12px', display: 'flex', gap: 8, borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#e2e8f0' }} className="shimmer" />
                  <div style={{ flex: 1 }}><Shimmer height={12} /><div style={{ height: 6 }} /><Shimmer width="50%" height={10} /></div>
                </div>
                <div style={{ height: 220, background: '#e2e8f0' }} className="shimmer" />
              </div>
            ))}
          </div>
        )}

        {!loading && !error && ads.length > 0 && (
          <>
            {/* ── OVERVIEW ── */}
            {activeTab === 'Overview' && (
              <div>
                {/* Media mix */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(180px,100%), 1fr))', gap: 14, marginBottom: 28 }}>
                  {[
                    { label: 'Total Ads', value: stats.total, icon: '📊', color: '#f0fdf4' },
                    { label: 'Active Now', value: stats.active, icon: '🟢', color: '#f0fdf4' },
                    { label: 'Videos', value: stats.video, icon: '🎬', color: '#fef3c7' },
                    { label: 'Images', value: stats.image, icon: '🖼', color: '#ede9fe' },
                    { label: 'Carousels', value: stats.carousel, icon: '🔁', color: '#fce7f3' },
                    { label: 'Avg Runtime', value: `${stats.avgDays}d`, icon: '⏱', color: '#e0f2fe' },
                    { label: 'Longest Ad', value: `${stats.maxDays}d`, icon: '🏆', color: '#fff7ed' },
                  ].map(card => (
                    <div key={card.label} style={{ background: card.color, borderRadius: 14, padding: '18px 20px', border: '1px solid rgba(0,0,0,0.06)' }}>
                      <div style={{ fontSize: 24, marginBottom: 8 }}>{card.icon}</div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: '#111' }}>{card.value}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginTop: 2 }}>{card.label}</div>
                    </div>
                  ))}
                </div>

                {/* Media mix bar */}
                {stats.total > 0 && (
                  <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '20px 24px', marginBottom: 20 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 14 }}>Media Mix</div>
                    <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 12, marginBottom: 14 }}>
                      {stats.video > 0 && <div style={{ flex: stats.video, background: '#22c55e' }} title={`Video: ${stats.video}`} />}
                      {stats.image > 0 && <div style={{ flex: stats.image, background: '#3b82f6' }} title={`Image: ${stats.image}`} />}
                      {stats.carousel > 0 && <div style={{ flex: stats.carousel, background: '#f59e0b' }} title={`Carousel: ${stats.carousel}`} />}
                    </div>
                    <div style={{ display: 'flex', gap: 20 }}>
                      {([['🟢 Video', stats.video], ['🔵 Image', stats.image], ['🟡 Carousel', stats.carousel]] as [string, number][]).map(([label, count]) => (
                        count > 0 && (
                          <div key={label} style={{ fontSize: 13, color: '#374151' }}>
                            {label}: <strong>{count}</strong> ({Math.round(count / stats.total * 100)}%)
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                )}

                {/* Top hooks preview */}
                <div style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '20px 24px' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 14 }}>Top Hooks</div>
                  {hooks.slice(0, 5).map((h, i) => <TextItem key={i} text={h} index={i} />)}
                  {hooks.length > 5 && (
                    <button onClick={() => setActiveTab('Hooks')}
                      style={{ marginTop: 8, fontSize: 13, color: '#1a3a1a', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      View all {hooks.length} hooks →
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── CREATIVES ── */}
            {activeTab === 'Creatives' && (
              <div>
                {/* Filter bar — time chips + Format + Status + Sort (Brand-Spy style) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                  {([[0, 'All time'], [7, '7d'], [30, '30d'], [90, '90d'], [180, '180d']] as [number, string][]).map(([d, l]) => (
                    <button key={d} onClick={() => setFDays(d)} style={FILTER_BTN(fDays === d)}>{l}</button>
                  ))}
                  <div style={{ width: 1, height: 22, background: '#e6e6e6', margin: '0 2px' }} />
                  <select value={fFormat} onChange={e => setFFormat(e.target.value)} style={{ ...FILTER_BTN(!!fFormat), appearance: 'auto' }}>
                    {[['', 'Format · All'], ['Video', 'Video'], ['Image', 'Image'], ['Carousel', 'Carousel']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select value={fStatus} onChange={e => setFStatus(e.target.value)} style={{ ...FILTER_BTN(fStatus !== 'ALL'), appearance: 'auto' }}>
                    {[['ALL', 'Status · All'], ['ACTIVE', 'Live'], ['INACTIVE', 'Off']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select value={fSort} onChange={e => setFSort(e.target.value)} style={{ ...FILTER_BTN(false), appearance: 'auto' }}>
                    {[['newest', 'Newest'], ['longest', 'Longest running']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <div style={{ marginLeft: 'auto', fontSize: 13, color: '#6b7280' }}>{filteredAds.length.toLocaleString()} ads</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px,100%), 1fr))', gap: 12 }}>
                  {filteredAds.map(ad => <MiniAdCard key={ad.id} ad={ad} onClone={openClone} />)}
                </div>
                {hasMore && (
                  <div style={{ textAlign: 'center', marginTop: 24 }}>
                    <button onClick={() => fetchAds(false, nextCursor || undefined)}
                      style={{ padding: '10px 28px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 9, fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Load more
                    </button>
                  </div>
                )}
                {cloneImg && <CloneModal ad={{ id: cloneImg.id, pageId, pageName: cloneImg.pageName, assetImageUrl: cloneImg.thumbnailUrl || undefined }} onClose={() => setCloneImg(null)} />}
                {cloneVid && <CloneVideoModal sourceAdId={cloneVid.id} sourcePoster={cloneVid.thumbnailUrl || undefined} onClose={() => setCloneVid(null)} />}
              </div>
            )}

            {/* ── HOOKS ── */}
            {activeTab === 'Hooks' && (
              <div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{hooks.length} unique hooks extracted from ad copy</div>
                {hooks.map((h, i) => <TextItem key={i} text={h} index={i} />)}
              </div>
            )}

            {/* ── AD COPY ── */}
            {activeTab === 'Ad Copy' && (
              <div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{copies.length} unique ad copies</div>
                {copies.map((c, i) => <TextItem key={i} text={c} index={i} />)}
              </div>
            )}

            {/* ── HEADLINES ── */}
            {activeTab === 'Headlines' && (
              <div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{headlines.length} unique headlines</div>
                {headlines.map((h, i) => <TextItem key={i} text={h} index={i} />)}
              </div>
            )}

            {/* ── THEMES ── */}
            {activeTab === 'Themes' && (
              <div>
                <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Detected from {ads.length} ads using pattern matching</div>
                {themes.length === 0 ? (
                  <div style={{ textAlign: 'center', color: '#9ca3af', padding: 40 }}>No clear themes detected in this ad set</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px,100%), 1fr))', gap: 12 }}>
                    {themes.map(([name, count]) => (
                      <div key={name} style={{ background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0', padding: '20px 22px' }}>
                        <div style={{ fontSize: 28, fontWeight: 900, color: '#1a3a1a', marginBottom: 4 }}>{count}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{name}</div>
                        <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                          {Math.round(count / ads.length * 100)}% of ads
                        </div>
                        <div style={{ marginTop: 10, height: 4, background: '#f1f5f9', borderRadius: 4 }}>
                          <div style={{ height: '100%', background: '#1a3a1a', borderRadius: 4, width: `${Math.round(count / ads.length * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── AI TABS ── */}
            {['Personas', 'Ad Angles', 'USPs', 'Desires', 'Emotions'].includes(activeTab) && (
              <div>
                {analyzing && (
                  <div style={{ textAlign: 'center', padding: '60px 20px' }}>
                    <div style={{ fontSize: 36, marginBottom: 16 }}>🤖</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 8 }}>Analyzing {ads.length} ads with AI…</div>
                    <div style={{ fontSize: 13, color: '#6b7280' }}>Mello is reading all ad copy and extracting intelligence</div>
                    <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center' }}>
                      {[...Array(4)].map((_, i) => (
                        <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#1a3a1a', animation: `bounce 1s ease-in-out ${i * 0.15}s infinite` }} />
                      ))}
                    </div>
                  </div>
                )}

                {!analyzing && !analysis && (
                  <div style={{ textAlign: 'center', padding: '60px 20px', color: '#6b7280' }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>💡</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>Switch to another tab first to load ads, then come back</div>
                  </div>
                )}

                {analysis && (
                  <div>
                    <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
                      AI-generated from {ads.length} ads · Powered by Mello
                    </div>
                    {activeTab === 'Personas' && analysis.personas?.map((p, i) => <TextItem key={i} text={p} index={i} />)}
                    {activeTab === 'Ad Angles' && analysis.adAngles?.map((a, i) => <TextItem key={i} text={a} index={i} />)}
                    {activeTab === 'USPs' && analysis.usps?.map((u, i) => <TextItem key={i} text={u} index={i} />)}
                    {activeTab === 'Desires' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                        {analysis.desires?.map(d => <Chip key={d} text={d} color="#fef3c7" textColor="#92400e" border="#fde68a" />)}
                      </div>
                    )}
                    {activeTab === 'Emotions' && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                        {analysis.emotions?.map(e => <Chip key={e} text={e} color="#ede9fe" textColor="#5b21b6" border="#c4b5fd" />)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-8px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
