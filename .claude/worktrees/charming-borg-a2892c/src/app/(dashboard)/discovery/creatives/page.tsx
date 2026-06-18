'use client'
/**
 * Creatives Library — groups ads by perceptual hash (Atria-style).
 * Each card = 1 unique visual, with stats: how many ads use it,
 * how many brands run it, copy variations, runtime.
 */
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Creative {
  hash: string
  type: 'image' | 'video'
  thumbnail_url: string | null
  video_url: string | null
  ad_count: number
  active_count: number
  copy_variations: number
  brand_count: number
  brands: string[]
  industries: string[]
  formats: string[]
  first_seen: string
  last_seen: string
  sample_ad_id: string
  sample_body: string | null
}

const SORT_OPTIONS = [
  { value: 'most_used', label: 'Most ads' },
  { value: 'most_brands', label: 'Most brands' },
  { value: 'most_active', label: 'Most active' },
  { value: 'most_variations', label: 'Most copy variations' },
  { value: 'newest', label: 'Newest' },
]

const TYPE_OPTS = [
  { value: 'all', label: 'All' },
  { value: 'image', label: '🖼 Images' },
  { value: 'video', label: '🎬 Videos' },
]

function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000))
}

export default function CreativesPage() {
  const router = useRouter()
  const [creatives, setCreatives] = useState<Creative[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  const [type, setType] = useState<'all' | 'image' | 'video'>('all')
  const [minAds, setMinAds] = useState(2)
  const [sort, setSort] = useState('most_used')
  const [country, setCountry] = useState('US')

  const load = useCallback(async (pageNum = 0, reset = true) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        type,
        min_ads: String(minAds),
        sort,
        page: String(pageNum),
        ...(country && country !== 'ALL' ? { country } : {}),
      })
      const res = await fetch(`/api/discovery/creatives?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      setCreatives(reset ? j.creatives : [...creatives, ...j.creatives])
      setTotal(j.total)
      setHasMore(j.hasMore)
      setPage(pageNum)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, minAds, sort, country])

  useEffect(() => { load(0, true) }, [load])

  return (
    <div style={{ padding: 24, maxWidth: 1600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a3a1a', marginBottom: 4 }}>Creatives Library</h1>
        <p style={{ fontSize: 13, color: '#7a9a7a' }}>
          Unique visual creatives grouped from all indexed ads. Ads sharing the same image are merged into one entry.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid #e2e8f0' }}>
        <Link href="/discovery" style={{ padding: '10px 16px', fontSize: 14, fontWeight: 700, color: '#6b7280', textDecoration: 'none' }}>
          🔍 Explore
        </Link>
        <Link href="/discovery/creatives" style={{ padding: '10px 16px', fontSize: 14, fontWeight: 700, color: '#1a3a1a', borderBottom: '2px solid #1a3a1a', textDecoration: 'none' }}>
          🎨 Creatives
        </Link>
        <Link href="/discovery?tab=saved" style={{ padding: '10px 16px', fontSize: 14, fontWeight: 700, color: '#6b7280', textDecoration: 'none' }}>
          🔖 Saved
        </Link>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        {/* Type pill group */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '2px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          {TYPE_OPTS.map(o => (
            <button key={o.value} onClick={() => setType(o.value as any)}
              style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                background: type === o.value ? '#1a3a1a' : 'transparent',
                color: type === o.value ? '#dffe95' : '#6b7280',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {o.label}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: '#e2e8f0' }} />

        <label style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
          Min ads:
          <input type="number" min={1} value={minAds} onChange={e => setMinAds(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ width: 56, padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontFamily: 'inherit' }} />
        </label>

        <label style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}>
          Country:
          <input value={country} onChange={e => setCountry(e.target.value.toUpperCase())} placeholder="US"
            style={{ width: 60, padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', textTransform: 'uppercase' }} />
        </label>

        <select value={sort} onChange={e => setSort(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', background: '#fff' }}>
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>Sort: {o.label}</option>)}
        </select>

        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>
          {loading ? 'Loading…' : `${total.toLocaleString()} unique creatives`}
        </span>
      </div>

      {/* Grid */}
      {error && <div style={{ padding: 24, color: '#c0392b' }}>Error: {error}</div>}
      {!loading && creatives.length === 0 && !error && (
        <div style={{ background: '#fff', border: '1px dashed #ccc', borderRadius: 8, padding: 40, textAlign: 'center', color: '#888' }}>
          No creatives found. Wait for the worker to index more ads or lower the &quot;Min ads&quot; filter.
        </div>
      )}

      <div style={{ columnWidth: 240, columnGap: 12, columnFill: 'balance' }}>
        {creatives.map(c => (
          <div key={c.hash} style={{ breakInside: 'avoid', marginBottom: 12, display: 'inline-block', width: '100%' }}>
            <CreativeCard creative={c} onOpen={() => router.push(`/discovery/${c.sample_ad_id}`)} />
          </div>
        ))}
      </div>

      {hasMore && !loading && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button onClick={() => load(page + 1, false)}
            style={{ padding: '10px 24px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
            Load more
          </button>
        </div>
      )}
    </div>
  )
}

function CreativeCard({ creative: c, onOpen }: { creative: Creative; onOpen: () => void }) {
  const url = c.thumbnail_url || c.video_url
  const runtime = daysBetween(c.first_seen, c.last_seen)
  const brandsLine = c.brands.slice(0, 3).join(', ') + (c.brand_count > 3 ? ` +${c.brand_count - 3}` : '')

  return (
    <div onClick={onOpen} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow .15s' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
      {/* Visual */}
      <div style={{ position: 'relative', background: '#000', overflow: 'hidden', lineHeight: 0 }}>
        {url ? (
          c.type === 'video' ? (
            <video src={url} muted loop playsInline preload="metadata"
              onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play().catch(() => {})}
              onMouseLeave={(e) => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0 }}
              style={{ width: '100%', height: 'auto', display: 'block', verticalAlign: 'top', background: '#000', maxHeight: 500 }} />
          ) : (
            <img src={url} alt="" loading="lazy" style={{ width: '100%', height: 'auto', display: 'block', verticalAlign: 'top' }} />
          )
        ) : (
          <div style={{ width: '100%', aspectRatio: '4/5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 12 }}>
            no media
          </div>
        )}

        {/* Ad count badge */}
        <div style={{ position: 'absolute', top: 8, right: 8, background: '#1a3a1a', color: '#dffe95', fontSize: 12, fontWeight: 800, padding: '4px 10px', borderRadius: 100, display: 'flex', alignItems: 'center', gap: 4 }}>
          ×{c.ad_count}
        </div>

        {/* Type badge */}
        <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6 }}>
          {c.type === 'video' ? '🎬 Video' : '🖼 Image'}
        </div>
      </div>

      {/* Stats footer */}
      <div style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          {c.active_count > 0 && (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
          )}
          <span style={{ fontSize: 12, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {brandsLine || 'Unknown brand'}
          </span>
        </div>

        {/* Stat pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          <Stat label={`${c.ad_count} ads`} />
          {c.active_count > 0 && c.active_count < c.ad_count && <Stat label={`${c.active_count} active`} tone="green" />}
          {c.copy_variations > 1 && <Stat label={`${c.copy_variations} copy`} />}
          {c.brand_count > 1 && <Stat label={`${c.brand_count} brands`} tone="blue" />}
          {runtime > 0 && <Stat label={`${runtime}d run`} />}
        </div>

        {c.sample_body && (
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.4 }}>
            {c.sample_body}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, tone = 'gray' }: { label: string; tone?: 'gray' | 'green' | 'blue' }) {
  const colors = {
    gray:  { bg: '#f1f5f9', color: '#374151', border: '#e2e8f0' },
    green: { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
    blue:  { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  }[tone]
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: colors.bg, color: colors.color, border: `1px solid ${colors.border}` }}>
      {label}
    </span>
  )
}
