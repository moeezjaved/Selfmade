'use client'
/**
 * Auto-discovery seed terms admin.
 * Add/remove category terms that auto-discovery uses to find new brands.
 * Preview ads each seed would surface before activating it.
 */
import { useEffect, useState, useCallback } from 'react'

interface Seed {
  id: string
  term: string
  category: string
  is_active: boolean
  min_followers: number
  countries: string[]
  last_run_at: string | null
  brands_found: number
  notes: string | null
}

export default function SeedsPage() {
  const [seeds, setSeeds] = useState<Seed[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newSeed, setNewSeed] = useState({ term: '', category: 'general', min_followers: 30000 })
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/seeds')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      setSeeds(j.seeds || [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addSeed = async () => {
    if (!newSeed.term.trim()) return
    await fetch('/api/admin/seeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSeed),
    })
    setNewSeed({ term: '', category: 'general', min_followers: 30000 })
    load()
  }

  const toggle = async (id: string, is_active: boolean) => {
    await fetch('/api/admin/seeds', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active }),
    })
    load()
  }

  const remove = async (id: string) => {
    if (!confirm('Remove this seed term?')) return
    await fetch(`/api/admin/seeds?id=${id}`, { method: 'DELETE' })
    load()
  }

  const preview = async (term: string) => {
    setPreviewing(term)
    setPreviewData(null)
    setPreviewLoading(true)
    try {
      const res = await fetch(`/api/admin/seeds/preview?term=${encodeURIComponent(term)}&limit=15`)
      const j = await res.json()
      setPreviewData(j)
    } catch (e) {
      setPreviewData({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      setPreviewLoading(false)
    }
  }

  const grouped = seeds.reduce((acc: Record<string, Seed[]>, s) => {
    const cat = s.category || 'general'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {})
  const categories = Object.keys(grouped).sort()
  const filtered = filter
    ? Object.fromEntries(Object.entries(grouped).map(([cat, list]) => [cat, list.filter(s => s.term.includes(filter.toLowerCase()))]).filter(([, l]) => (l as Seed[]).length))
    : grouped

  if (loading && seeds.length === 0) return <div style={{ padding: 32 }}>Loading…</div>

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#141d15', marginBottom: 4 }}>Auto-discovery Seed Terms</h1>
      <p style={{ fontSize: 13, color: '#7a9a7a', marginBottom: 18 }}>
        Categories that auto-discovery searches across Meta to find new brands. Min {newSeed.min_followers.toLocaleString()}+ followers required.
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 18, fontSize: 13, color: '#666' }}>
        <span>📊 <b>{seeds.length}</b> seeds</span>
        <span>✅ <b>{seeds.filter(s => s.is_active).length}</b> active</span>
        <span>🏷 <b>{Object.keys(grouped).length}</b> categories</span>
      </div>

      {/* Add seed */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 18, display: 'flex', gap: 8, alignItems: 'end' }}>
        <Field label="Seed term">
          <input value={newSeed.term} onChange={e => setNewSeed(s => ({ ...s, term: e.target.value }))}
            placeholder="e.g. wireless earbuds"
            onKeyDown={e => e.key === 'Enter' && addSeed()}
            style={inputStyle} />
        </Field>
        <Field label="Category bucket">
          <input value={newSeed.category} onChange={e => setNewSeed(s => ({ ...s, category: e.target.value }))}
            placeholder="tech"
            style={{ ...inputStyle, width: 120 }} />
        </Field>
        <Field label="Min followers">
          <input type="number" value={newSeed.min_followers}
            onChange={e => setNewSeed(s => ({ ...s, min_followers: parseInt(e.target.value) || 0 }))}
            style={{ ...inputStyle, width: 100 }} />
        </Field>
        <button onClick={addSeed} disabled={!newSeed.term.trim()}
          style={{ padding: '9px 18px', background: newSeed.term.trim() ? '#141d15' : '#ccc', color: '#ff5a2c', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: newSeed.term.trim() ? 'pointer' : 'not-allowed', height: 36, fontFamily: 'inherit' }}>
          + Add seed
        </button>
      </div>

      <input value={filter} onChange={e => setFilter(e.target.value)}
        placeholder="Filter seeds…"
        style={{ ...inputStyle, marginBottom: 14, width: 240 }} />

      {error && <div style={{ color: '#c0392b', marginBottom: 14 }}>{error}</div>}

      {/* Seeds grouped by category */}
      {Object.entries(filtered).map(([category, list]) => (
        <div key={category} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            {category} ({(list as Seed[]).length})
          </div>
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
            {(list as Seed[]).map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i > 0 ? '1px solid #f0f0f0' : 'none' }}>
                <input type="checkbox" checked={s.is_active} onChange={e => toggle(s.id, e.target.checked)}
                  style={{ cursor: 'pointer' }} />
                <div style={{ flex: 1, fontWeight: 600 }}>{s.term}</div>
                <div style={{ fontSize: 11, color: '#666' }}>
                  Min {s.min_followers.toLocaleString()} followers
                </div>
                <div style={{ fontSize: 11, color: '#888', minWidth: 100, textAlign: 'right' }}>
                  {s.brands_found || 0} brands
                </div>
                <button onClick={() => preview(s.term)}
                  style={{ padding: '4px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#141d15', fontFamily: 'inherit' }}>
                  🔍 Preview
                </button>
                <button onClick={() => remove(s.id)}
                  style={{ padding: '4px 10px', background: '#fff', border: '1px solid #fee', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: '#c0392b', fontFamily: 'inherit' }}>
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Preview drawer */}
      {previewing && (
        <div onClick={() => { setPreviewing(null); setPreviewData(null) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 600, maxWidth: '95vw', height: '100vh', background: '#fff', overflowY: 'auto', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: 18, borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>Preview: <code>{previewing}</code></div>
                <div style={{ fontSize: 12, color: '#666' }}>What auto-discovery would surface for this seed</div>
              </div>
              <button onClick={() => { setPreviewing(null); setPreviewData(null) }}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#666' }}>×</button>
            </div>
            <div style={{ padding: 18 }}>
              {previewLoading && <div>Loading…</div>}
              {previewData?.error && <div style={{ color: '#c0392b' }}>{previewData.error}</div>}
              {previewData?.brands && (
                <>
                  <div style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>
                    Found <b>{previewData.unique_brands}</b> brands across <b>{previewData.total_ads_returned}</b> ads.
                  </div>
                  {previewData.brands.map((b: any) => (
                    <div key={b.page_id} style={{ padding: 12, marginBottom: 10, border: '1px solid #e2e8f0', borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{b.page_name || 'Unknown'}</div>
                          <div style={{ fontSize: 11, color: '#888', fontFamily: 'ui-monospace, monospace' }}>{b.page_id}</div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 100, background: '#f1f5f9' }}>{b.ad_count} ads</span>
                      </div>
                      {b.sample_ads.slice(0, 1).map((ad: any) => (
                        <div key={ad.ad_id} style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
                          {ad.body && <div>“{ad.body.slice(0, 150)}{ad.body.length > 150 ? '…' : ''}”</div>}
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      <span style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  )
}
