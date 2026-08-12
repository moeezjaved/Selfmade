'use client'
/**
 * Brands tab — browse/search the brand directory (the big catalog). Search any brand to spy it,
 * jump to its Meta Ad Library, or open Brand Spy. Sits next to Explore in the Discovery sub-nav.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Search, Target, ExternalLink, Eye } from 'lucide-react'

const DARK = '#141d15'

interface Brand {
  pageId: string; name: string; avatar: string | null; industry: string | null; adCount: number
  country: string | null; adLibraryUrl: string; isCrawled: boolean; isSpied: boolean
}

const TABS = [
  { label: '🔍 Explore', href: '/discovery' },
  { label: '🏷️ Brands', href: '/discovery/brands' },
]

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([])
  const [industries, setIndustries] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [industry, setIndustry] = useState('')
  const [sort, setSort] = useState('ads')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sentinel = useRef<HTMLDivElement>(null)

  const fetchPage = useCallback(async (p: number, replace: boolean) => {
    setLoading(true); setError(null)
    try {
      const sp = new URLSearchParams({ page: String(p), sort })
      if (q) sp.set('q', q); if (industry) sp.set('industry', industry)
      const r = await fetch(`/api/discovery/brands?${sp}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'failed')
      setBrands(prev => replace ? d.brands : [...prev, ...d.brands])
      setTotal(d.total); setHasMore(d.hasMore)
      if (d.industries?.length) setIndustries(d.industries)
    } catch (e) { setError(e instanceof Error ? e.message : 'failed to load') }
    finally { setLoading(false) }
  }, [q, industry, sort])

  // Reset + reload whenever the query/filter/sort changes.
  useEffect(() => { setPage(0); fetchPage(0, true) }, [q, industry, sort, fetchPage])

  // Infinite scroll.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && hasMore && !loading) { const np = page + 1; setPage(np); fetchPage(np, false) }
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, loading, page, fetchPage])

  const submitSearch = (e: React.FormEvent) => { e.preventDefault(); setQ(qInput.trim()) }

  // Spy = enqueue an on-demand crawl of this brand's ads (+ charge once per user), THEN open the
  // spy view. Most directory brands aren't crawled yet, so this POST is what makes them useful.
  const [spying, setSpying] = useState<string | null>(null)
  const [confirmSpy, setConfirmSpy] = useState<Brand | null>(null)   // in-app dialog (replaces window.confirm)
  const spy = (b: Brand) => {
    if (b.isSpied) { window.location.assign(`/discovery/brand-spy/${b.pageId}`); return }
    setConfirmSpy(b)
  }
  const doSpy = async (b: Brand) => {
    setConfirmSpy(null); setSpying(b.pageId); setError(null)
    try {
      const r = await fetch('/api/discovery/brand-spy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: b.pageId, name: b.name }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 402) throw new Error(d.message || 'You’ve hit your plan’s tracked-brand limit — upgrade to track more.')
      if (!r.ok) throw new Error(d.error || 'failed to start spying')
      window.location.assign(`/discovery/brand-spy/${b.pageId}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'failed to start spying'); setSpying(null) }
  }

  // Brand not in the directory? Let the user paste a Meta Ad Library link and spy it on the spot —
  // same path as Brand Spy's "Add Manually" (the POST extracts page_id from the URL, crawls + tracks).
  const [manualUrl, setManualUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const importFromUrl = async () => {
    const url = manualUrl.trim()
    if (!url) return
    setImporting(true); setError(null)
    try {
      const r = await fetch('/api/discovery/brand-spy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 402) throw new Error(d.message || 'You’ve hit your plan’s tracked-brand limit — upgrade to track more.')
      if (!r.ok || !d.pageId) throw new Error(d.error || 'Paste a valid Meta Ad Library link (it contains …view_all_page_id=123…).')
      window.location.assign(`/discovery/brand-spy/${d.pageId}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not import that brand.'); setImporting(false) }
  }

  return (
    <div style={{ padding: '20px 28px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header + sub-nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ marginRight: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>Brands</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Search {total ? total.toLocaleString() : ''} brands · spy any of them</div>
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 9, padding: 3 }}>
          {TABS.map(t => {
            const active = t.href === '/discovery/brands'
            return <a key={t.href} href={t.href} style={{ padding: '6px 14px', borderRadius: 7, fontSize: 13, fontWeight: 600, background: active ? '#fff' : 'transparent', color: active ? '#111' : '#6b7280', textDecoration: 'none', boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{t.label}</a>
          })}
        </div>
        <form onSubmit={submitSearch} style={{ flex: 1, maxWidth: 420, position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
          <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Search brands…"
            style={{ width: '100%', padding: '9px 12px 9px 34px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, outline: 'none', fontFamily: 'inherit', background: '#f8fafc', boxSizing: 'border-box' }} />
        </form>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={industry} onChange={e => setIndustry(e.target.value)} style={{ padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff', fontFamily: 'inherit' }}>
          <option value="">All industries</option>
          {industries.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ padding: '7px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: '#fff', fontFamily: 'inherit' }}>
          <option value="ads">Sort: Most ads</option>
          <option value="name">Sort: A–Z</option>
        </select>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* List */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 640, padding: '10px 16px', borderBottom: '1px solid #f1f5f9', fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span style={{ flex: 1 }}>Brand</span>
          <span style={{ width: 160, flexShrink: 0 }}>Industry</span>
          <span style={{ width: 90, flexShrink: 0, textAlign: 'right' }}># Ads</span>
          <span style={{ width: 230, flexShrink: 0 }} />
        </div>
        {brands.map(b => (
          <div key={b.pageId} style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 640, padding: '11px 16px', borderBottom: '1px solid #f8fafc' }}>
            {/* Brand → opens OUR brand page (spy dashboard); auto-crawls its ads if we don't have them
                yet. "Ad Library" stays as a separate button for the raw Meta view. */}
            <a href={`/discovery/brand-spy/${b.pageId}`} title={`Open ${b.name} on Selfmade`}
              style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
              {/* Letter avatar underneath; the real picture overlays it and, if it fails to load,
                  onError hides the img so the letter shows through — no broken-image icon. */}
              <div style={{ position: 'relative', width: 34, height: 34, borderRadius: '50%', background: '#eef2f7', color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0, overflow: 'hidden' }}>
                {b.name.slice(0, 1).toUpperCase()}
                {b.avatar && <img src={b.avatar} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                  onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}>{b.name}</div>
                {b.isCrawled && <span style={{ fontSize: 10, fontWeight: 700, color: '#059669' }}>● in your index</span>}
              </div>
            </a>
            <span style={{ width: 160, flexShrink: 0, fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.industry || '—'}</span>
            <span style={{ width: 90, flexShrink: 0, textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#374151' }}>{b.adCount.toLocaleString()}</span>
            <div style={{ width: 230, flexShrink: 0, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <a href={b.adLibraryUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 600, color: '#6b7280', textDecoration: 'none', padding: '6px 10px', border: '1px solid #e5e7eb', borderRadius: 7 }}>
                <ExternalLink size={13} /> Ad Library
              </a>
              <button onClick={() => spy(b)} disabled={spying === b.pageId}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, color: '#ff5a2c', background: DARK, border: 'none', cursor: spying === b.pageId ? 'default' : 'pointer', padding: '6px 12px', borderRadius: 7, fontFamily: 'inherit' }}>
                {b.isSpied ? <Eye size={13} /> : <Target size={13} />} {spying === b.pageId ? 'Starting…' : b.isSpied ? 'Spying' : 'Spy'}
              </button>
            </div>
          </div>
        ))}
        {loading && <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Loading…</div>}
        {!loading && brands.length === 0 && (
          <div style={{ padding: 50, textAlign: 'center', color: '#9ca3af' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#374151' }}>No brands match {q ? `“${q}”` : 'your search'}.</div>
            <div style={{ fontSize: 13, marginTop: 4, marginBottom: 16 }}>Spy any competitor instantly — paste its Meta Ad Library link and we’ll import it for you.</div>
            <div style={{ display: 'flex', gap: 8, maxWidth: 560, margin: '0 auto', flexWrap: 'wrap' }}>
              <input value={manualUrl} onChange={e => setManualUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') importFromUrl() }}
                placeholder="https://www.facebook.com/ads/library/?...view_all_page_id=123..."
                style={{ flex: 1, minWidth: 240, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13.5, outline: 'none', color: '#111' }} />
              <button onClick={importFromUrl} disabled={importing || !manualUrl.trim()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: DARK, color: '#ff5a2c', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 13.5, fontWeight: 700, cursor: importing || !manualUrl.trim() ? 'default' : 'pointer', opacity: importing || !manualUrl.trim() ? 0.6 : 1, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                <Target size={14} /> {importing ? 'Importing…' : 'Spy this brand'}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: '#9ca3af', marginTop: 8 }}>Open the brand on the <a href="https://www.facebook.com/ads/library" target="_blank" rel="noopener noreferrer" style={{ color: '#141d15', fontWeight: 600 }}>Meta Ad Library</a>, copy the page URL, and paste it above.</div>
          </div>
        )}
        <div ref={sentinel} style={{ height: 1 }} />
      </div>

      {/* In-app spy confirmation (replaces window.confirm) */}
      {confirmSpy && (
        <div onClick={() => setConfirmSpy(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(14,27,18,0.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 'min(440px,96vw)', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 24px 70px rgba(0,0,0,0.35)' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>Spy “{confirmSpy.name}”?</div>
            <div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 8, lineHeight: 1.55 }}>
              We’ll crawl their full ad archive from the Meta Ad Library and track it over time. This costs <b>50 credits ($0.50)</b> — one-time per brand; re-adding a brand you’ve already spied is free.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setConfirmSpy(null)} style={{ background: 'none', border: '1px solid #e5e7eb', color: '#374151', padding: '9px 18px', borderRadius: 100, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={() => doSpy(confirmSpy)} style={{ background: '#141d15', color: '#ff5a2c', border: 'none', padding: '9px 22px', borderRadius: 100, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Spy this brand</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
