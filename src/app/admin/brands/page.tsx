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
  countries: string[]
  priority: number
  is_active: boolean
  brand_name: string
  ad_count: number
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

  if (loading && !data) return <div style={{ padding: 32 }}>Loading…</div>
  if (error && !data) return <div style={{ padding: 32, color: '#c0392b' }}>Error: {error}</div>
  if (!data) return null

  const filtered = data.terms.filter(t =>
    !filter || t.term.toLowerCase().includes(filter.toLowerCase()) || t.brand_name?.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1a3a1a' }}>Brand Crawl Schedule</h1>
          <p style={{ fontSize: 13, color: '#7a9a7a', marginTop: 4 }}>
            Brands tracked. Auto re-crawl every 7 days. Add more to expand the index.
          </p>
        </div>
        <button onClick={() => setShowAdd(s => !s)}
          style={{ padding: '9px 18px', background: '#dffe95', color: '#1a3a1a', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          {showAdd ? '× Cancel' : '+ Add brand'}
        </button>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <KPI label="Tracked terms" value={data.summary.total_terms} sub={`${data.summary.active_terms} active`} />
        <KPI label="Brands indexed" value={data.summary.brands_indexed} />
        <KPI label="Total ads in DB" value={data.summary.total_ads.toLocaleString()} />
      </div>

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
              {['', 'Brand', 'Status', 'Ads indexed', 'Last crawled', 'Next re-crawl', 'Actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 700, color: '#666', fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#888' }}>No brands match the filter</td></tr>
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
                    <div style={{ fontWeight: 700, color: '#111' }}>{t.brand_name || t.term}</div>
                    {t.page_id && <div style={{ fontSize: 11, color: '#888', fontFamily: 'ui-monospace, monospace' }}>{t.page_id}</div>}
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
