'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, ExternalLink, RefreshCw } from 'lucide-react'

interface Ad {
  id: string
  pageId: string
  pageName: string
  body: string
  title: string
  caption: string
  snapshotUrl: string
  startDate: string
  stopDate: string | null
  platforms: string[]
  languages: string[]
  isActive: boolean
  daysRunning: number
}

const PLATFORM_OPTS = ['facebook', 'instagram', 'audience_network', 'messenger']
const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook', instagram: 'Instagram',
  audience_network: 'Audience Network', messenger: 'Messenger',
}
const PLATFORM_ICONS: Record<string, string> = {
  facebook: '📘', instagram: '📸', audience_network: '🌐', messenger: '💬',
}

type SortOption = { value: string; label: string }
const SORT_OPTS: SortOption[] = [
  { value: 'recent', label: 'Most Recent' },
  { value: 'longest', label: 'Longest Running' },
  { value: 'oldest', label: 'Oldest First' },
]

function FilterDropdown({ label, options, selected, onToggle, onClear }: {
  label: string
  options: { value: string; label: string; icon?: string }[]
  selected: string[]
  onToggle: (v: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: selected.length ? '#1a3a1a' : '#fff', border: `1px solid ${selected.length ? '#1a3a1a' : '#e2e8f0'}`, borderRadius: 8, fontSize: 13, fontWeight: 600, color: selected.length ? '#dffe95' : '#374151', cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}
      >
        {label}
        {selected.length > 0 && <span style={{ background: '#dffe95', color: '#1a3a1a', borderRadius: 100, fontSize: 10, fontWeight: 800, padding: '1px 6px' }}>{selected.length}</span>}
        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 100, minWidth: 180, padding: '6px 0' }}>
          {selected.length > 0 && (
            <button onClick={() => { onClear(); setOpen(false) }} style={{ width: '100%', textAlign: 'left', padding: '7px 14px', fontSize: 12, color: '#dc2626', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              Clear filter
            </button>
          )}
          {options.map(o => (
            <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', cursor: 'pointer', fontSize: 13, color: '#111' }}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} style={{ accentColor: '#1a3a1a' }} />
              {o.icon && <span>{o.icon}</span>}
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function SortDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const current = SORT_OPTS.find(o => o.value === value) || SORT_OPTS[0]
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        Sort: {current.label} <span style={{ fontSize: 10, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 100, minWidth: 180, padding: '6px 0' }}>
          {SORT_OPTS.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', fontSize: 13, color: o.value === value ? '#1a3a1a' : '#374151', fontWeight: o.value === value ? 700 : 400, background: o.value === value ? '#f0fdf4' : 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AdCard({ ad }: { ad: Ad }) {
  const [imgError, setImgError] = useState(false)

  const daysText = ad.daysRunning > 0
    ? ad.daysRunning > 365
      ? `${Math.floor(ad.daysRunning / 365)}y ${Math.floor((ad.daysRunning % 365) / 30)}mo`
      : ad.daysRunning > 30
      ? `${Math.floor(ad.daysRunning / 30)}mo ${ad.daysRunning % 30}d`
      : `${ad.daysRunning}d`
    : 'New'

  const initials = ad.pageName?.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column', transition: 'box-shadow .2s', cursor: 'default' }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 8px 32px rgba(0,0,0,0.1)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
    >
      {/* Brand header */}
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#1a3a1a', color: '#dffe95', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ad.pageName || 'Unknown Brand'}</div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ad.isActive ? '#22c55e' : '#9ca3af', display: 'inline-block', flexShrink: 0 }}/>
            {ad.isActive ? 'Active' : 'Inactive'} · {daysText}
          </div>
        </div>
        <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer"
          title="View ad on Meta Ads Library"
          style={{ color: '#6b7280', flexShrink: 0 }}
          onClick={e => e.stopPropagation()}
        >
          <ExternalLink size={14} />
        </a>
      </div>

      {/* Ad preview iframe */}
      <div style={{ position: 'relative', background: '#f8fafc', overflow: 'hidden', height: 280 }}>
        {ad.snapshotUrl ? (
          <iframe
            src={ad.snapshotUrl}
            style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
            scrolling="no"
            title={`Ad by ${ad.pageName}`}
            loading="lazy"
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 13 }}>
            No preview available
          </div>
        )}
        {/* Overlay to prevent iframe interaction — click goes to snapshot link */}
        <a href={ad.snapshotUrl} target="_blank" rel="noopener noreferrer"
          style={{ position: 'absolute', inset: 0, zIndex: 2 }}
          aria-label="View ad"
        />
      </div>

      {/* Ad copy */}
      {(ad.body || ad.title) && (
        <div style={{ padding: '10px 14px', borderTop: '1px solid #f1f5f9' }}>
          {ad.title && <div style={{ fontSize: 12, fontWeight: 700, color: '#111', marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>{ad.title}</div>}
          {ad.body && <div style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{ad.body}</div>}
        </div>
      )}

      {/* Footer — platforms + days */}
      <div style={{ padding: '8px 14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {ad.platforms.slice(0, 3).map(p => (
            <span key={p} title={PLATFORM_LABELS[p] || p} style={{ fontSize: 13 }}>{PLATFORM_ICONS[p] || '🌐'}</span>
          ))}
        </div>
        {ad.startDate && (
          <div style={{ fontSize: 11, color: '#9ca3af' }}>
            {new Date(ad.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DiscoveryPage() {
  const [query, setQuery] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [sort, setSort] = useState('recent')
  const [platforms, setPlatforms] = useState<string[]>([])
  const [status, setStatus] = useState('ALL')
  const [error, setError] = useState('')

  const fetchAds = useCallback(async (reset = true, cursor?: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        q: query,
        sort,
        status,
        ...(platforms.length ? { platforms: platforms.join(',') } : {}),
        ...(cursor ? { after: cursor } : {}),
      })
      const res = await fetch(`/api/discovery?${params}`)
      const data = await res.json()
      if (data.error) { setError(data.error); setLoading(false); return }
      setAds(prev => reset ? data.ads : [...prev, ...data.ads])
      setNextCursor(data.nextCursor)
      setHasMore(data.hasMore)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [query, sort, platforms, status])

  useEffect(() => { fetchAds(true) }, [query, sort, platforms, status])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(searchInput)
  }

  const togglePlatform = (p: string) => setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])

  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Header */}
      <div style={{ borderBottom: '1px solid #e2e8f0', background: '#fff', padding: '16px 28px', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>

          {/* Title */}
          <div style={{ marginRight: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>Ad Discovery</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>Browse live ads from the Meta Ads Library</div>
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearch} style={{ flex: 1, minWidth: 220, maxWidth: 480 }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={15} style={{ position: 'absolute', left: 12, color: '#9ca3af', pointerEvents: 'none' }} />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search for ads or brands…"
                style={{ width: '100%', padding: '9px 12px 9px 36px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, outline: 'none', fontFamily: 'inherit', background: '#f8fafc', color: '#111', boxSizing: 'border-box' }}
                onFocus={e => (e.target.style.borderColor = '#1a3a1a')}
                onBlur={e => (e.target.style.borderColor = '#e2e8f0')}
              />
              {searchInput && (
                <button type="button" onClick={() => { setSearchInput(''); setQuery('') }}
                  style={{ position: 'absolute', right: 10, background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16, lineHeight: 1 }}>×</button>
              )}
            </div>
          </form>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <FilterDropdown
              label="Platform"
              options={PLATFORM_OPTS.map(p => ({ value: p, label: PLATFORM_LABELS[p], icon: PLATFORM_ICONS[p] }))}
              selected={platforms}
              onToggle={togglePlatform}
              onClear={() => setPlatforms([])}
            />
            <FilterDropdown
              label="Status"
              options={[{ value: 'ALL', label: 'All' }, { value: 'ACTIVE', label: '🟢 Active' }, { value: 'INACTIVE', label: '⚫ Inactive' }]}
              selected={status !== 'ALL' ? [status] : []}
              onToggle={v => setStatus(prev => prev === v ? 'ALL' : v)}
              onClear={() => setStatus('ALL')}
            />
            <SortDropdown value={sort} onChange={setSort} />
            <button onClick={() => fetchAds(true)} disabled={loading}
              style={{ padding: '7px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#374151', display: 'flex', alignItems: 'center' }}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '24px 28px' }}>

        {/* Error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '14px 18px', marginBottom: 20, color: '#dc2626', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && ads.length === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {[...Array(8)].map((_, i) => (
              <div key={i} style={{ background: '#f8fafc', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <div style={{ padding: '12px 14px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#e2e8f0' }} className="shimmer" />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, background: '#e2e8f0', borderRadius: 6, marginBottom: 6, width: '60%' }} className="shimmer" />
                    <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, width: '40%' }} className="shimmer" />
                  </div>
                </div>
                <div style={{ height: 280, background: '#e2e8f0' }} className="shimmer" />
                <div style={{ padding: '10px 14px 12px' }}>
                  <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, marginBottom: 6 }} className="shimmer" />
                  <div style={{ height: 10, background: '#e2e8f0', borderRadius: 6, width: '80%' }} className="shimmer" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && ads.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#6b7280' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111', marginBottom: 8 }}>No ads found</div>
            <div style={{ fontSize: 14 }}>Try a different search term or adjust your filters</div>
          </div>
        )}

        {/* Ad grid */}
        {ads.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Showing {ads.length} ads{query ? ` for "${query}"` : ''}
              {loading && <span style={{ marginLeft: 8, opacity: 0.6 }}>• Loading…</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {ads.map(ad => <AdCard key={ad.id} ad={ad} />)}
            </div>

            {/* Load more */}
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 32 }}>
                <button
                  onClick={() => fetchAds(false, nextCursor || undefined)}
                  disabled={loading}
                  style={{ padding: '12px 32px', background: '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: loading ? 0.7 : 1 }}
                >
                  {loading ? 'Loading…' : 'Load more ads'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
