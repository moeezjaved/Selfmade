'use client'
/**
 * Admin → Brand Directory. Upload the brand catalog CSV (e.g. the ~611K Foreplay list), map its
 * columns, and import in throttled batches (upsert on page_id). Powers the user-facing Brands tab.
 */
import { useEffect, useState, useCallback, useRef } from 'react'

const DARK = '#1a3a1a', LIME = '#dffe95'
const BATCH = 1000          // rows per request
const THROTTLE_MS = 250     // pause between batches — gentle on the DB

// Our columns → guesses for matching CSV headers.
const FIELDS: { key: string; label: string; required?: boolean; guesses: string[] }[] = [
  { key: 'page_id', label: 'Facebook page id', required: true, guesses: ['page_id', 'pageid', 'fb_id', 'facebook_id', 'fbid', 'id', 'page id'] },
  { key: 'name', label: 'Brand name', required: true, guesses: ['name', 'brand', 'brand_name', 'title', 'page_name'] },
  { key: 'industry', label: 'Industry / category', guesses: ['industry', 'category', 'niche', 'vertical'] },
  { key: 'source_ad_count', label: 'Ad count', guesses: ['ad_count', 'ads', 'num_ads', 'community_ads', '# ads', '# community ads', 'count'] },
  { key: 'avatar_url', label: 'Avatar / logo URL', guesses: ['avatar', 'avatar_url', 'logo', 'image', 'picture', 'icon'] },
  { key: 'country', label: 'Country', guesses: ['country', 'countries', 'geo'] },
  { key: 'website', label: 'Website', guesses: ['website', 'url', 'site', 'domain'] },
]

const inp: React.CSSProperties = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13, fontFamily: 'inherit' }
const btn = (primary = true): React.CSSProperties => ({ padding: '9px 18px', borderRadius: 8, border: primary ? 'none' : '1px solid #d1d5db', background: primary ? DARK : '#fff', color: primary ? LIME : '#374151', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' })

// Minimal RFC-ish CSV parse: handles quoted fields with commas + escaped quotes.
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += c
    } else {
      if (c === '"') inQ = true
      else if (c === ',') { row.push(field); field = '' }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (c === '\r') { /* skip */ }
      else field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim()))
}

export default function BrandDirectoryPage() {
  const [count, setCount] = useState<number | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])         // data rows (no header)
  const [map, setMap] = useState<Record<string, string>>({})  // field.key → header
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, inserted: 0, skipped: 0 })
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const cancelRef = useRef(false)

  const loadCount = useCallback(async () => {
    try { const r = await fetch('/api/admin/brand-directory'); const d = await r.json(); if (r.ok) setCount(d.count) } catch {}
  }, [])
  useEffect(() => { loadCount() }, [loadCount])

  const onFile = (f: File) => {
    setError(null); setFileName(f.name)
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCSV(String(reader.result || ''))
      if (parsed.length < 2) { setError('CSV has no data rows'); return }
      const hdr = parsed[0].map(h => h.trim())
      setHeaders(hdr); setRows(parsed.slice(1))
      // Auto-guess column mapping from header names.
      const m: Record<string, string> = {}
      for (const f of FIELDS) {
        const hit = hdr.find(h => f.guesses.includes(h.toLowerCase().trim()))
        if (hit) m[f.key] = hit
      }
      setMap(m)
    }
    reader.readAsText(f)
  }

  const startImport = async () => {
    if (!map.page_id || !map.name) { setError('Map at least page id + brand name'); return }
    setError(null); setImporting(true); cancelRef.current = false
    const idx: Record<string, number> = {}
    for (const f of FIELDS) if (map[f.key]) idx[f.key] = headers.indexOf(map[f.key])
    const total = rows.length
    setProgress({ done: 0, total, inserted: 0, skipped: 0 })
    let inserted = 0, skipped = 0
    try {
      for (let i = 0; i < total; i += BATCH) {
        if (cancelRef.current) break
        const batch = rows.slice(i, i + BATCH).map(r => {
          const o: Record<string, any> = {}
          for (const k of Object.keys(idx)) o[k] = r[idx[k]]
          return o
        })
        const res = await fetch('/api/admin/brand-directory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: batch }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || 'batch failed')
        inserted += d.inserted || 0; skipped += d.skipped || 0
        setProgress({ done: Math.min(i + BATCH, total), total, inserted, skipped })
        if (THROTTLE_MS) await new Promise(r => setTimeout(r, THROTTLE_MS))
      }
      await loadCount()
    } catch (e) { setError(e instanceof Error ? e.message : 'import failed') }
    finally { setImporting(false) }
  }

  const clearAll = async () => {
    if (!confirm('Delete the ENTIRE brand directory? This cannot be undone.')) return
    await fetch('/api/admin/brand-directory?confirm=1', { method: 'DELETE' }); await loadCount()
  }

  const pct = progress.total ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 4 }}>Brand Directory</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Bulk-import the brand catalog (CSV). Upserts on Facebook page id. Powers the user <code>Brands</code> tab and the spy search.
      </p>

      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#854d0e', marginBottom: 20 }}>
        ⚠️ The full 611K import is a heavy write. Run it <strong>after the us-east migration</strong> (or off-peak with crawl/drain paused). Test with a small sample first.
      </div>

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><div style={{ fontSize: 12, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase' }}>In directory</div><div style={{ fontSize: 24, fontWeight: 800, color: DARK }}>{count == null ? '…' : count.toLocaleString()}</div></div>
        <button onClick={clearAll} style={{ ...btn(false), color: '#dc2626', borderColor: '#fecaca' }}>Clear all</button>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>{error}</div>}

      {/* Upload */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18 }}>
        <label style={{ ...btn(), display: 'inline-block' }}>
          {fileName ? `📄 ${fileName}` : 'Choose CSV…'}
          <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        {rows.length > 0 && <span style={{ marginLeft: 12, fontSize: 13, color: '#6b7280' }}>{rows.length.toLocaleString()} rows detected</span>}

        {/* Column mapping */}
        {headers.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 }}>Map columns</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {FIELDS.map(f => (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 170, fontSize: 13, fontWeight: 600, color: '#374151' }}>{f.label}{f.required && <span style={{ color: '#dc2626' }}> *</span>}</div>
                  <select style={{ ...inp, flex: 1 }} value={map[f.key] || ''} onChange={e => setMap(m => ({ ...m, [f.key]: e.target.value }))}>
                    <option value="">— skip —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
              {!importing
                ? <button style={btn()} onClick={startImport}>Import {rows.length.toLocaleString()} brands</button>
                : <button style={{ ...btn(false), color: '#dc2626' }} onClick={() => { cancelRef.current = true }}>Stop</button>}
              {(importing || progress.total > 0) && (
                <div style={{ flex: 1 }}>
                  <div style={{ height: 8, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: DARK, transition: 'width .2s' }} />
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    {progress.done.toLocaleString()} / {progress.total.toLocaleString()} ({pct}%) · {progress.inserted.toLocaleString()} imported{progress.skipped ? ` · ${progress.skipped.toLocaleString()} skipped (no id/name)` : ''}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
