'use client'
/**
 * Brand crawl management — see all tracked brands, when they were last
 * crawled, when they'll re-crawl, and add new ones.
 */
import { useEffect, useState, useCallback } from 'react'

// The 17 industries the Discovery filter offers (must match the worker's
// classify.ts list). A manual pick here overrides keyword auto-detection.
const INDUSTRY_OPTS = [
  'Apparel & Accessories', 'Beauty & Personal Care', 'Baby, Kids & Maternity',
  'Food & Beverage', 'Health & Fitness', 'Electronics & Technology',
  'Finance & Insurance', 'Home & Garden', 'Travel & Tourism', 'Pets',
  'Education', 'Real Estate', 'Jewelry & Watches', 'Sports & Outdoors',
  'Business Services', 'E-Commerce', 'Charity & NGO',
]

interface BrandTerm {
  id: string
  term: string
  term_type: string
  page_id: string | null
  category: string
  categories: string[]
  industry: string | null
  countries: string[]
  priority: number
  is_active: boolean
  follower_count: number | null
  picture: string | null
  website: string | null
  brand_name: string
  ad_count: number
  created_at: string
  status: 'queued' | 'in_progress' | 'exhausted_waiting' | 'ready_to_recrawl'
  next_recrawl_at: string | null
  crawling_now?: boolean
  fully_crawled?: boolean
  never_crawled?: boolean
  is_spy?: boolean
  in_progress?: boolean
  soft_gated?: boolean
  new_ads_last_run?: number
  state: {
    last_run_at: string
    ads_indexed: number
    last_run_added: number
    exhausted_at: string | null
    in_progress: boolean
  } | null
}

interface Summary {
  total_terms: number
  active_terms: number
  brands_indexed: number
  total_ads: number
  never_crawled?: number
  fully_crawled?: number
  crawling_now?: number
  spy?: number
  in_progress?: number
  new_ads?: number
  soft_gated?: number
  removed?: number
}

const VIEWS: { key: string; label: string; sumKey?: keyof Summary }[] = [
  { key: 'all', label: 'All' },
  { key: 'top', label: '🔥 Highest ads' },
  { key: 'new_ads', label: '🆕 Most new ads', sumKey: 'new_ads' },
  { key: 'crawling', label: '⏳ Crawling now', sumKey: 'crawling_now' },
  { key: 'in_progress', label: '↪️ In progress', sumKey: 'in_progress' },
  { key: 'soft_gated', label: '🚧 Soft-gated', sumKey: 'soft_gated' },
  { key: 'spy', label: '🎯 Spied', sumKey: 'spy' },
  { key: 'never', label: 'Never crawled', sumKey: 'never_crawled' },
  { key: 'fully', label: '✅ Fully crawled', sumKey: 'fully_crawled' },
  { key: 'removed', label: '🗑️ Removed', sumKey: 'removed' },
]

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  queued:             { bg: '#f1f5f9', color: '#374151', label: 'Queued' },
  in_progress:        { bg: '#dbeafe', color: '#1d4ed8', label: '⏳ Crawling' },
  exhausted_waiting:  { bg: '#f0fdf4', color: '#166534', label: '✅ Done — waiting' },
  ready_to_recrawl:   { bg: '#fef3c7', color: '#92400e', label: '🔄 Re-crawl ready' },
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

function timeUntil(iso: string | null): string {
  if (!iso) return '—'
  const sec = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  if (sec < 0) return 'now'
  if (sec < 3600) return `in ${Math.floor(sec / 60)}m`
  if (sec < 86400) return `in ${Math.floor(sec / 3600)}h`
  return `in ${Math.floor(sec / 86400)}d`
}

export default function BrandsPage() {
  const [data, setData] = useState<{ terms: BrandTerm[]; summary: Summary } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showUrlLookup, setShowUrlLookup] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [urlLookupLoading, setUrlLookupLoading] = useState(false)
  const [urlLookupResult, setUrlLookupResult] = useState<any>(null)
  const [editableCats, setEditableCats] = useState<string[]>([])
  const [importCsv, setImportCsv] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [previewBrand, setPreviewBrand] = useState<{ page_id: string; brand_name: string } | null>(null)
  const [previewData, setPreviewData] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [newBrand, setNewBrand] = useState({ term: '', page_id: '', category: 'General', priority: 5 })
  const [filter, setFilter] = useState('')
  const [view, setView] = useState('all')

  const load = useCallback(async (q?: string, v?: string) => {
    try {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (v && v !== 'all') params.set('view', v)
      const qs = params.toString()
      const res = await fetch(`/api/admin/brands${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      setData(j)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Debounced SERVER-side search + view filter: covers ALL brands (not just the loaded 1000).
    // Refreshes every 30s so "Crawling now" stays live.
    const debounce = setTimeout(() => load(filter || undefined, view), filter ? 300 : 0)
    const t = setInterval(() => load(filter || undefined, view), 30_000)
    return () => { clearTimeout(debounce); clearInterval(t) }
  }, [load, filter, view])

  const addBrand = async () => {
    if (!newBrand.term.trim()) return
    await fetch('/api/admin/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newBrand, term_type: 'brand' }),
    })
    setNewBrand({ term: '', page_id: '', category: 'General', priority: 5 })
    setShowAdd(false)
    load()
  }

  const toggleActive = async (id: string, is_active: boolean) => {
    await fetch('/api/admin/brands', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', id, is_active }),
    })
    load()
  }

  const forceRecrawl = async (page_id: string, brand_name?: string) => {
    const res = await fetch('/api/admin/brands', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_recrawl', page_id }),
    })
    const j = await res.json()
    if (res.ok) {
      alert(`✅ ${brand_name || 'Brand'} queued — crawl starts in next ≤15 min cron tick.`)
    } else {
      alert(`❌ Failed: ${j.error || 'Unknown error'}`)
    }
    load()
  }

  const deleteBrand = async (id: string) => {
    if (!confirm('Delete this brand from the crawl rotation?')) return
    await fetch(`/api/admin/brands?id=${id}`, { method: 'DELETE' })
    load()
  }

  // Put an auto-removed brand back into the crawl rotation (re-activates + re-queues it).
  const restoreBrand = async (id: string | null, page_id: string | null, name?: string) => {
    if (!confirm(`Restore "${name || page_id}" to the crawl rotation? It will re-crawl on the next cron tick.`)) return
    await fetch('/api/admin/brands', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', id, page_id }),
    })
    load()
  }

  const updateCategories = async (id: string, categories: string[]) => {
    await fetch('/api/admin/brands', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_categories', id, categories }),
    })
    load()
  }

  const updateIndustry = async (id: string, page_id: string | null, industry: string) => {
    await fetch('/api/admin/brands', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_industry', id, page_id, industry: industry || null }),
    })
    load()
  }

  const runBulkImport = async () => {
    if (!importCsv.trim()) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await fetch('/api/admin/brands/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: importCsv }),
      })
      const j = await res.json()
      setImportResult(j)
      if (res.ok) load()
    } catch (e) {
      setImportResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setImporting(false)
    }
  }

  const lookupFromUrl = async () => {
    if (!urlInput.trim()) return
    setUrlLookupLoading(true)
    setUrlLookupResult(null)
    setEditableCats([])
    try {
      const res = await fetch('/api/admin/brands/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput }),
      })
      const j = await res.json()
      if (!res.ok) {
        setUrlLookupResult({ error: j.error })
      } else {
        setUrlLookupResult(j)
        setEditableCats(j.suggested_categories || [])
      }
    } catch (e) {
      setUrlLookupResult({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setUrlLookupLoading(false)
    }
  }

  const confirmAddFromUrl = async () => {
    if (!urlLookupResult?.page_id) return
    await fetch('/api/admin/brands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        term: urlLookupResult.name?.toLowerCase() || '',
        page_id: urlLookupResult.page_id,
        term_type: 'brand',
        category: editableCats[0] || 'General',
        countries: ['US'],
        priority: 5,
      }),
    })
    // Also save the categories array (POST only stores the first one as "category")
    // Need to find the new id then patch categories
    const refreshRes = await fetch('/api/admin/brands')
    const refreshJ = await refreshRes.json()
    const newRow = refreshJ.terms?.find((t: any) => t.page_id === urlLookupResult.page_id)
    if (newRow && editableCats.length > 0) {
      await fetch('/api/admin/brands', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_categories', id: newRow.id, categories: editableCats }),
      })
    }
    setUrlInput('')
    setUrlLookupResult(null)
    setEditableCats([])
    setShowUrlLookup(false)
    load()
  }

  const openPreview = async (page_id: string, brand_name: string) => {
    setPreviewBrand({ page_id, brand_name })
    setPreviewData(null)
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/admin/brands/preview?page_id=${page_id}&limit=10`)
      const j = await res.json()
      setPreviewData(j)
    } catch (e) {
      setPreviewData({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setPreviewLoading(false)
    }
  }

  if (loading && !data) return <div style={{ padding: 32 }}>Loading…</div>
  if (error && !data) return <div style={{ padding: 32, color: '#c0392b' }}>Error: {error}</div>
  if (!data) return null

  // The API already filters by the search box + view (server-side, across ALL brands). Preserve
  // the server's ordering for views that impose one (top = ad_count, crawling/fully = time);
  // otherwise sort newest-first. No client filter (it would hide page_id matches).
  const filtered = view === 'top'
    ? [...data.terms].sort((a, b) => (b.ad_count || 0) - (a.ad_count || 0))
    : view === 'new_ads'
      ? [...data.terms].sort((a, b) => (b.new_ads_last_run || 0) - (a.new_ads_last_run || 0))
      : (view === 'crawling' || view === 'fully' || view === 'in_progress' || view === 'soft_gated')
        ? data.terms
        : [...data.terms].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#141d15' }}>Brand Crawl Schedule</h1>
          <p style={{ fontSize: 13, color: '#7a9a7a', marginTop: 4 }}>
            Brands tracked. Auto re-crawl every 7 days. Add more to expand the index.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setShowUrlLookup(s => !s); setShowAdd(false); setShowImport(false) }}
            style={{ padding: '9px 18px', background: '#fff', color: '#141d15', border: '1px solid #141d15', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {showUrlLookup ? '× Cancel' : '🔗 Add by URL'}
          </button>
          <button onClick={() => { setShowImport(s => !s); setShowAdd(false); setShowUrlLookup(false) }}
            style={{ padding: '9px 18px', background: '#fff', color: '#141d15', border: '1px solid #141d15', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {showImport ? '× Cancel import' : '📥 Bulk import CSV'}
          </button>
          <button onClick={() => { setShowAdd(s => !s); setShowImport(false); setShowUrlLookup(false) }}
            style={{ padding: '9px 18px', background: '#ff5a2c', color: '#141d15', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
            {showAdd ? '× Cancel' : '+ Add brand'}
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <KPI label="Tracked terms" value={data.summary.total_terms} sub={`${data.summary.active_terms} active`} />
        <KPI label="Brands indexed" value={data.summary.brands_indexed} />
        <KPI label="Total ads in DB" value={data.summary.total_ads.toLocaleString()} />
      </div>

      {/* URL Lookup Panel */}
      {showUrlLookup && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 18, marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>🔗 Add brand by URL</div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
            Paste a Meta Ads Library URL (with <code style={{ background: '#f1f5f9', padding: '1px 4px', borderRadius: 3 }}>view_all_page_id=…</code>) or a Facebook page URL. We&apos;ll auto-extract the page_id, fetch brand info, and suggest categories.
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://www.facebook.com/ads/library/?...view_all_page_id=355136938262536..."
              onKeyDown={e => e.key === 'Enter' && lookupFromUrl()}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={lookupFromUrl} disabled={!urlInput.trim() || urlLookupLoading}
              style={{ padding: '8px 16px', background: '#141d15', color: '#ff5a2c', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: urlLookupLoading ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {urlLookupLoading ? '⏳ Looking up…' : '🔍 Lookup'}
            </button>
          </div>

          {urlLookupResult && (
            <div style={{ padding: 14, background: '#f8fafc', borderRadius: 8 }}>
              {urlLookupResult.error ? (
                <div style={{ color: '#c0392b' }}>❌ {urlLookupResult.error}</div>
              ) : (
                <>
                  {urlLookupResult.warning && (
                    <div style={{ marginBottom: 12, padding: 10, background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, color: '#92400e', fontSize: 12 }}>
                      ⚠️ {urlLookupResult.warning}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                    {urlLookupResult.picture && (
                      <img src={urlLookupResult.picture} alt="" style={{ width: 48, height: 48, borderRadius: '50%' }} />
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {urlLookupResult.name}
                        {urlLookupResult.verified && <span style={{ color: '#1d4ed8' }}>✓</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#666' }}>
                        {urlLookupResult.follower_count?.toLocaleString() || '?'} followers · {urlLookupResult.category}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
                        Page ID: {urlLookupResult.page_id}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 6 }}>
                      🏷 Suggested categories (Claude AI) — click × to remove, type to add
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, minHeight: 36 }}>
                      {editableCats.map((c, i) => (
                        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, padding: '3px 8px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, border: '1px solid #bfdbfe' }}>
                          {c}
                          <button onClick={() => setEditableCats(s => s.filter((_, idx) => idx !== i))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#1d4ed8', fontSize: 14, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                      <input
                        placeholder="add category…"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const v = (e.currentTarget.value || '').trim().toLowerCase()
                            if (v && !editableCats.includes(v)) setEditableCats(s => [...s, v])
                            e.currentTarget.value = ''
                          }
                        }}
                        style={{ border: 'none', outline: 'none', fontSize: 12, fontFamily: 'inherit', flex: 1, minWidth: 100, padding: '3px 6px' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={confirmAddFromUrl}
                      style={{ padding: '9px 18px', background: '#ff5a2c', color: '#141d15', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✓ Add this brand
                    </button>
                    <button onClick={() => { setUrlLookupResult(null); setUrlInput(''); setEditableCats([]) }}
                      style={{ padding: '9px 18px', background: '#fff', color: '#666', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Bulk Import Modal */}
      {showImport && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 18, marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>📥 Bulk import brands</div>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
            Paste CSV with columns: <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>brand_name, page_id (optional), category (optional), priority (optional), website (optional)</code>
          </p>
          <textarea
            value={importCsv}
            onChange={e => setImportCsv(e.target.value)}
            placeholder={`brand_name,page_id,category,priority\ngymshark,129669023798560,gymwear,8\nlululemon,,athleisure,7\nnike,,sports,8`}
            style={{ width: '100%', minHeight: 200, padding: 12, fontSize: 12, fontFamily: 'ui-monospace, monospace', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none' }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
            <button onClick={runBulkImport} disabled={importing || !importCsv.trim()}
              style={{ padding: '9px 18px', background: importing ? '#ccc' : '#141d15', color: '#ff5a2c', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: importing ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
              {importing ? '⏳ Importing… (may take 30-60s)' : '🚀 Import & lookup page IDs'}
            </button>
            <span style={{ fontSize: 11, color: '#888' }}>Brands without page_id will be auto-looked up via Meta Search.</span>
          </div>

          {/* Result summary */}
          {importResult && (
            <div style={{ marginTop: 14, padding: 12, background: '#f8fafc', borderRadius: 8, fontSize: 12 }}>
              {importResult.error && <div style={{ color: '#c0392b' }}>❌ {importResult.error}</div>}
              {importResult.summary && (
                <>
                  <div style={{ display: 'flex', gap: 14, fontWeight: 700, marginBottom: 8 }}>
                    <span>Total: {importResult.summary.total}</span>
                    <span style={{ color: '#22c55e' }}>✅ Imported: {importResult.summary.imported}</span>
                    <span style={{ color: '#1d4ed8' }}>🔄 Updated: {importResult.summary.updated}</span>
                    <span style={{ color: '#f59e0b' }}>⚠️ Needs manual: {importResult.summary.needs_manual}</span>
                    <span style={{ color: '#c0392b' }}>❌ Errors: {importResult.summary.errors}</span>
                  </div>
                  {/* Show errors first */}
                  {importResult.results?.filter((r: any) => r.status === 'error').slice(0, 20).map((r: any, i: number) => (
                    <div key={`e${i}`} style={{ fontSize: 11, color: '#c0392b', marginTop: 4 }}>
                      ❌ <b>{r.brand_name}</b>: {r.message}
                    </div>
                  ))}
                  {importResult.results?.filter((r: any) => r.status === 'needs_manual').slice(0, 10).map((r: any, i: number) => (
                    <div key={`n${i}`} style={{ fontSize: 11, color: '#92400e', marginTop: 4 }}>
                      ⚠️ <b>{r.brand_name}</b>: {r.message}
                      {r.candidates?.length > 0 && (
                        <div style={{ marginLeft: 16 }}>
                          Candidates: {r.candidates.map((c: any) => `${c.name} (${c.id}, ${c.fan_count?.toLocaleString() || '?'} fans)`).join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add brand form */}
      {showAdd && (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 18, marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 12 }}>Add a new brand</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <Field label="Brand name (e.g. nike)">
              <input value={newBrand.term} onChange={e => setNewBrand(b => ({ ...b, term: e.target.value }))}
                placeholder="brand"
                style={inputStyle} />
            </Field>
            <Field label="Facebook Page ID">
              <input value={newBrand.page_id} onChange={e => setNewBrand(b => ({ ...b, page_id: e.target.value }))}
                placeholder="129669023798560"
                style={inputStyle} />
            </Field>
            <Field label="Category">
              <input value={newBrand.category} onChange={e => setNewBrand(b => ({ ...b, category: e.target.value }))}
                placeholder="Fashion"
                style={inputStyle} />
            </Field>
            <Field label="Priority (1-10)">
              <input type="number" min={1} max={10} value={newBrand.priority}
                onChange={e => setNewBrand(b => ({ ...b, priority: parseInt(e.target.value) || 5 }))}
                style={inputStyle} />
            </Field>
            <button onClick={addBrand} disabled={!newBrand.term.trim()}
              style={{ padding: '8px 18px', background: newBrand.term.trim() ? '#141d15' : '#ccc', color: '#ff5a2c', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: newBrand.term.trim() ? 'pointer' : 'not-allowed', height: 36, fontFamily: 'inherit' }}>
              Add
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
            💡 Find Page ID: open the brand on Facebook, view source, search for &quot;page_id&quot;. Or use{' '}
            <a href="https://findmyfbid.in/" target="_blank" rel="noopener noreferrer" style={{ color: '#141d15' }}>findmyfbid.in</a>.
          </div>
        </div>
      )}

      {/* View filters — server-side, cover ALL brands. Counts come from the summary. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {VIEWS.map(v => {
          const on = view === v.key
          const cnt = v.sumKey && data?.summary ? (data.summary[v.sumKey] as number | undefined) : undefined
          return (
            <button key={v.key} onClick={() => setView(v.key)}
              style={{ padding: '7px 13px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: on ? '1px solid #2075ff' : '1px solid #e2e8f0', background: on ? '#eaf2ff' : '#fff', color: on ? '#1d4ed8' : '#374151' }}>
              {v.label}{cnt != null ? <span style={{ color: '#94a3b8', fontWeight: 600 }}> · {cnt.toLocaleString()}</span> : null}
            </button>
          )
        })}
      </div>

      {/* Search input — server-side across ALL brands (by name or exact page_id) */}
      <input value={filter} onChange={e => setFilter(e.target.value)}
        placeholder="Search all brands by name or page ID…"
        style={{ ...inputStyle, marginBottom: 12, width: 320 }} />
      {view === 'crawling' && <span style={{ marginLeft: 4, fontSize: 12, color: '#888' }}>brands being crawled in the last 35 min · 🎯 = spied · auto-refreshes every 30s</span>}
      {filter && <span style={{ marginLeft: 10, fontSize: 12, color: '#888' }}>{filtered.length} match{filtered.length === 1 ? '' : 'es'}</span>}

      {/* Brands table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ background: '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
            <tr>
              {['', 'Brand', 'Categories', 'Status', 'Ads indexed', 'Last crawled', 'Next re-crawl', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#888' }}>No brands match the filter</td></tr>
            )}
            {filtered.map(t => {
              const status = STATUS_COLORS[t.status] || STATUS_COLORS.queued
              return (
                <tr key={t.id} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <input type="checkbox" checked={t.is_active} onChange={e => toggleActive(t.id, e.target.checked)}
                      style={{ cursor: 'pointer' }} />
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {t.picture && (
                        <img src={t.picture} alt="" style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                      )}
                      <div>
                        <div style={{ fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {t.brand_name || t.term}
                          {t.crawling_now && (
                            <span title="Being crawled right now" style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100, background: '#dbeafe', color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: 0.5 }}>⏳ LIVE</span>
                          )}
                          {t.is_spy && (
                            <span title="Spied brand (priority 9 — always full crawl)" style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100, background: '#fae8ff', color: '#86198f', textTransform: 'uppercase', letterSpacing: 0.5 }}>🎯 SPY</span>
                          )}
                          {t.fully_crawled && (
                            <span title="Has had a complete deep-archive crawl" style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100, background: '#dcfce7', color: '#166534', textTransform: 'uppercase', letterSpacing: 0.5 }}>✅ FULL</span>
                          )}
                          {t.soft_gated && (
                            <span title="Meta soft-gated this brand's last crawl (truncated the library)" style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100, background: '#ffedd5', color: '#9a3412', textTransform: 'uppercase', letterSpacing: 0.5 }}>🚧 SOFT-GATE</span>
                          )}
                          {t.in_progress && (
                            <span title="Mid-walk — a resume cursor is saved; it'll continue next pass" style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100, background: '#e0e7ff', color: '#3730a3', textTransform: 'uppercase', letterSpacing: 0.5 }}>↪️ IN PROGRESS</span>
                          )}
                          {(view === 'new_ads' && (t.new_ads_last_run ?? 0) > 0) && (
                            <span title="New ads added on the last crawl run" style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100, background: '#dcfce7', color: '#166534', textTransform: 'uppercase', letterSpacing: 0.5 }}>+{t.new_ads_last_run} NEW</span>
                          )}
                          {(Date.now() - new Date(t.created_at).getTime()) < 86_400_000 && (
                            <span style={{
                              fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100,
                              background: '#ff5a2c', color: '#141d15',
                              textTransform: 'uppercase', letterSpacing: 0.5,
                            }}>NEW</span>
                          )}
                          {t.page_id && t.ad_count === 0 && (
                            <span title="Verify by clicking Preview" style={{
                              fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100,
                              background: '#fef3c7', color: '#92400e',
                              textTransform: 'uppercase', letterSpacing: 0.5,
                            }}>UNVERIFIED</span>
                          )}
                        </div>
                        {t.page_id && <div style={{ fontSize: 11, color: '#888', fontFamily: 'ui-monospace, monospace' }}>{t.page_id}</div>}
                        {t.follower_count != null && (
                          <div style={{ fontSize: 10, color: '#666' }}>{t.follower_count.toLocaleString()} followers</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <CategoryEditor categories={t.categories || []} onSave={cats => updateCategories(t.id, cats)} />
                    <select
                      value={t.industry || ''}
                      onChange={e => updateIndustry(t.id, t.page_id, e.target.value)}
                      title="Manual industry override (beats auto-detection)"
                      style={{ marginTop: 6, width: '100%', fontSize: 11, padding: '4px 6px', borderRadius: 6, border: `1px solid ${t.industry ? '#bfdbfe' : '#e2e8f0'}`, background: t.industry ? '#eff6ff' : '#fff', color: t.industry ? '#1d4ed8' : '#64748b', cursor: 'pointer' }}>
                      <option value="">🏭 Industry: auto-detect</option>
                      {INDUSTRY_OPTS.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 100, background: status.bg, color: status.color }}>
                      {status.label}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                    {t.ad_count.toLocaleString()}
                    {t.state?.last_run_added != null && <span style={{ color: '#999', fontSize: 11, marginLeft: 6 }}>(+{t.state.last_run_added.toLocaleString()})</span>}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#666' }}>{timeAgo(t.state?.last_run_at || null)}</td>
                  <td style={{ padding: '10px 12px', color: '#666' }}>
                    {t.status === 'in_progress' || t.status === 'queued' || t.status === 'ready_to_recrawl'
                      ? 'next cron tick (≤15m)'
                      : timeUntil(t.next_recrawl_at)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {t.page_id && (
                        <button onClick={() => openPreview(t.page_id!, t.brand_name)}
                          style={{ padding: '4px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#141d15', fontFamily: 'inherit' }}>
                          🔍 Preview
                        </button>
                      )}
                      {view === 'removed' && (
                        <button onClick={() => restoreBrand(t.id, t.page_id, t.brand_name)}
                          style={{ padding: '4px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#166534', fontFamily: 'inherit' }}>
                          ♻️ Restore
                        </button>
                      )}
                      {t.page_id && view !== 'removed' && (
                        <button onClick={() => forceRecrawl(t.page_id!, t.brand_name)}
                          style={{ padding: '4px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#141d15', fontFamily: 'inherit' }}>
                          Re-crawl now
                        </button>
                      )}
                      <button onClick={() => deleteBrand(t.id)}
                        style={{ padding: '4px 10px', background: '#fff', border: '1px solid #fee', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#c0392b', fontFamily: 'inherit' }}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#999' }}>
        Auto-refreshes every 30s. Cron drains active brands every 15 min.
      </div>

      {/* Preview Drawer */}
      {previewBrand && (
        <PreviewDrawer
          brand={previewBrand}
          data={previewData}
          loading={previewLoading}
          removed={view === 'removed'}
          onRestore={async () => {
            await restoreBrand(null, previewBrand.page_id, previewBrand.brand_name)
            setPreviewBrand(null); setPreviewData(null)
          }}
          onClose={() => { setPreviewBrand(null); setPreviewData(null) }}
        />
      )}
    </div>
  )
}

// ── CategoryEditor (inline) ────────────────────────────────
function CategoryEditor({ categories, onSave }: { categories: string[]; onSave: (c: string[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(categories.join(', '))

  if (!editing) {
    return (
      <div onClick={() => { setText(categories.join(', ')); setEditing(true) }}
        style={{ cursor: 'pointer', display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 24, alignItems: 'center' }}>
        {categories.length === 0 && <span style={{ fontSize: 11, color: '#999', fontStyle: 'italic' }}>+ add</span>}
        {categories.map((c, i) => (
          <span key={i} style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 4, border: '1px solid #bfdbfe' }}>
            {c}
          </span>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input value={text} onChange={e => setText(e.target.value)}
        placeholder="gymwear, athleisure"
        autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter') {
            onSave(text.split(',').map(s => s.trim()).filter(Boolean))
            setEditing(false)
          }
          if (e.key === 'Escape') setEditing(false)
        }}
        onBlur={() => {
          onSave(text.split(',').map(s => s.trim()).filter(Boolean))
          setEditing(false)
        }}
        style={{ width: 160, padding: '4px 8px', fontSize: 11, border: '1px solid #141d15', borderRadius: 4, outline: 'none', fontFamily: 'inherit' }}
      />
    </div>
  )
}

// ── PreviewDrawer ────────────────────────────────────────
function PreviewDrawer({ brand, data, loading, removed, onRestore, onClose }: {
  brand: { page_id: string; brand_name: string }
  data: any
  loading: boolean
  removed?: boolean
  onRestore?: () => void
  onClose: () => void
}) {
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 600, maxWidth: '95vw', height: '100vh', background: '#fff', overflowY: 'auto', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)' }}>
        <div style={{ padding: 18, borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{brand.brand_name}</div>
            <div style={{ fontSize: 11, color: '#888', fontFamily: 'ui-monospace, monospace' }}>{brand.page_id}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {removed && onRestore && (
              <button onClick={onRestore}
                style={{ padding: '6px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', color: '#166534', fontFamily: 'inherit' }}>
                ♻️ Restore to crawl
              </button>
            )}
            <button onClick={onClose}
              style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666' }}>×</button>
          </div>
        </div>
        {removed && (
          <div style={{ padding: '8px 18px', background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 600 }}>
            🗑️ Auto-removed as empty. If you see real ads below, it was a false positive — click Restore.
          </div>
        )}
        <div style={{ padding: 18 }}>
          {loading && <div style={{ color: '#666' }}>Loading sample ads from Meta…</div>}
          {data?.error && <div style={{ color: '#c0392b' }}>Error: {data.error}</div>}
          {data?.page && (
            <div style={{ marginBottom: 18, padding: 12, background: '#f8fafc', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'center' }}>
              {data.page.picture && <img src={data.page.picture} alt="" style={{ width: 48, height: 48, borderRadius: '50%' }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{data.page.name} {data.page.verified && '✓'}</div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {data.page.follower_count?.toLocaleString() || '?'} followers · {data.page.category}
                </div>
                {data.page.website && (
                  <a href={data.page.website} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#1d4ed8' }}>{data.page.website}</a>
                )}
              </div>
            </div>
          )}
          {data?.ads?.length > 0 && (
            <>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>{data.ads.length} sample ads from Meta:</div>
              {data.ads.map((ad: any) => {
                // The token-free preview API now returns raw fbcdn URLs
                // for images + videos. Show the first image (or video poster)
                // inline so the admin can visually verify the brand at a glance.
                const heroImage = ad.image_urls?.[0] || ad.video_preview_urls?.[0] || null
                const heroVideo = ad.video_urls?.[0] || null
                return (
                  <div key={ad.ad_id} style={{ padding: 12, marginBottom: 10, border: '1px solid #e2e8f0', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                      <span>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: ad.is_active ? '#22c55e' : '#d1d5db', display: 'inline-block', marginRight: 6 }} />
                        {ad.is_active ? 'Active' : 'Inactive'}
                        {ad.display_format && <span style={{ marginLeft: 8, color: '#94a3b8' }}>· {ad.display_format}</span>}
                      </span>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>{ad.ad_id}</span>
                    </div>
                    {heroImage && (
                      <img src={heroImage} alt="" loading="lazy" referrerPolicy="no-referrer"
                        style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6, marginBottom: 8, background: '#f1f5f9' }} />
                    )}
                    {ad.title && <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{ad.title}</div>}
                    {ad.body && <div style={{ fontSize: 12, color: '#333', lineHeight: 1.4 }}>{ad.body.slice(0, 200)}{ad.body.length > 200 ? '…' : ''}</div>}
                    <div style={{ marginTop: 8, fontSize: 11, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {ad.snapshot_url && (
                        <a href={ad.snapshot_url} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>
                          View on Meta Ads Library →
                        </a>
                      )}
                      {heroVideo && (
                        <a href={heroVideo} target="_blank" rel="noreferrer" style={{ color: '#1d4ed8' }}>
                          ▶ Video
                        </a>
                      )}
                      {ad.image_urls?.length > 1 && (
                        <span style={{ color: '#666' }}>+{ad.image_urls.length - 1} more image{ad.image_urls.length - 1 === 1 ? '' : 's'}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          )}
          {data && !loading && data.ads?.length === 0 && (
            <div style={{ color: '#888', textAlign: 'center', padding: 24 }}>No ads found for this brand on Meta.</div>
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

function KPI({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#111', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  )
}
