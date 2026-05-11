'use client'
/**
 * Brand crawl management — see all tracked brands, when they were last
 * crawled, when they'll re-crawl, and add new ones.
 */
import { useEffect, useState, useCallback } from 'react'

interface BrandTerm {
  id: string
  term: string
  term_type: string
  page_id: string | null
  category: string
  categories: string[]
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
}

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
  const [importCsv, setImportCsv] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [previewBrand, setPreviewBrand] = useState<{ page_id: string; brand_name: string } | null>(null)
  const [previewData, setPreviewData] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [newBrand, setNewBrand] = useState({ term: '', page_id: '', category: 'General', priority: 5 })
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/brands')
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
    load()
    const t = setInterval(load, 30_000) // refresh every 30s
    return () => clearInterval(t)
  }, [load])

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

  const forceRecrawl = async (page_id: string) => {
    await fetch('/api/admin/brands', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'force_recrawl', page_id }),
    })
    load()
  }

  const deleteBrand = async (id: string) => {
    if (!confirm('Delete this brand from the crawl rotation?')) return
    await fetch(`/api/admin/brands?id=${id}`, { method: 'DELETE' })
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

  // Sort newest first so just-imported brands appear at top
  const filtered = data.terms
    .filter(t =>
      !filter || t.term.toLowerCase().includes(filter.toLowerCase()) || t.brand_name?.toLowerCase().includes(filter.toLowerCase())
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a3a1a' }}>Brand Crawl Schedule</h1>
          <p style={{ fontSize: 13, color: '#7a9a7a', marginTop: 4 }}>
            Brands tracked. Auto re-crawl every 7 days. Add more to expand the index.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setShowImport(s => !s); setShowAdd(false) }}
            style={{ padding: '9px 18px', background: '#fff', color: '#1a3a1a', border: '1px solid #1a3a1a', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            {showImport ? '× Cancel import' : '📥 Bulk import CSV'}
          </button>
          <button onClick={() => { setShowAdd(s => !s); setShowImport(false) }}
            style={{ padding: '9px 18px', background: '#dffe95', color: '#1a3a1a', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
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
              style={{ padding: '9px 18px', background: importing ? '#ccc' : '#1a3a1a', color: '#dffe95', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: importing ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
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
              style={{ padding: '8px 18px', background: newBrand.term.trim() ? '#1a3a1a' : '#ccc', color: '#dffe95', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: newBrand.term.trim() ? 'pointer' : 'not-allowed', height: 36, fontFamily: 'inherit' }}>
              Add
            </button>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
            💡 Find Page ID: open the brand on Facebook, view source, search for &quot;page_id&quot;. Or use{' '}
            <a href="https://findmyfbid.in/" target="_blank" rel="noopener noreferrer" style={{ color: '#1a3a1a' }}>findmyfbid.in</a>.
          </div>
        </div>
      )}

      {/* Filter input */}
      <input value={filter} onChange={e => setFilter(e.target.value)}
        placeholder="Filter brands by name…"
        style={{ ...inputStyle, marginBottom: 12, width: 260 }} />

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
                          {(Date.now() - new Date(t.created_at).getTime()) < 86_400_000 && (
                            <span style={{
                              fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 100,
                              background: '#dffe95', color: '#1a3a1a',
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
                    {t.status === 'in_progress' ? 'next cron tick' : timeUntil(t.next_recrawl_at)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {t.page_id && (
                        <button onClick={() => openPreview(t.page_id!, t.brand_name)}
                          style={{ padding: '4px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#1a3a1a', fontFamily: 'inherit' }}>
                          🔍 Preview
                        </button>
                      )}
                      {t.page_id && (
                        <button onClick={() => forceRecrawl(t.page_id!)}
                          style={{ padding: '4px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#1a3a1a', fontFamily: 'inherit' }}>
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
        style={{ width: 160, padding: '4px 8px', fontSize: 11, border: '1px solid #1a3a1a', borderRadius: 4, outline: 'none', fontFamily: 'inherit' }}
      />
    </div>
  )
}

// ── PreviewDrawer ────────────────────────────────────────
function PreviewDrawer({ brand, data, loading, onClose }: {
  brand: { page_id: string; brand_name: string }
  data: any
  loading: boolean
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
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666' }}>×</button>
        </div>
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
              {data.ads.map((ad: any) => (
                <div key={ad.ad_id} style={{ padding: 12, marginBottom: 10, border: '1px solid #e2e8f0', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ad.is_active ? '#22c55e' : '#d1d5db', display: 'inline-block', marginRight: 6 }} />
                      {ad.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span>{ad.ad_id}</span>
                  </div>
                  {ad.title && <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{ad.title}</div>}
                  {ad.body && <div style={{ fontSize: 12, color: '#333', lineHeight: 1.4 }}>{ad.body.slice(0, 200)}{ad.body.length > 200 ? '…' : ''}</div>}
                  {ad.snapshot_url && (
                    <a href={ad.snapshot_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#1d4ed8', display: 'inline-block', marginTop: 6 }}>
                      View in Meta Ads Library →
                    </a>
                  )}
                </div>
              ))}
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
