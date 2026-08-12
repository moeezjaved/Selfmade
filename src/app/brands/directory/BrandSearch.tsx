'use client'
/** Public brand search box + live results (client). Debounced fetch to /api/brands/search. */
import { useEffect, useState } from 'react'
import Link from 'next/link'

const titleCase = (s: string) => (s || '').replace(/\b\w/g, (c) => c.toUpperCase())
const initial = (s: string) => (s || '?').trim().charAt(0).toUpperCase()

type Result = { slug: string; name: string; adCount: number }

export default function BrandSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setTotal(0); return }
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/brands/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((j) => { setResults(j.results || []); setTotal(j.total || 0) })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div style={{ maxWidth: 620, margin: '0 auto 28px' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a brand — e.g. Gymshark, Nike…"
          autoFocus
          style={{ flex: 1, border: '1.5px solid #cfe0c0', borderRadius: 100, padding: '12px 20px', fontSize: 15, color: '#141d15', background: '#f9f5ec', outline: 'none', fontFamily: 'inherit' }}
        />
      </div>
      {q.trim().length >= 2 && (
        <div style={{ fontSize: 12, color: '#8a9a8a', margin: '8px 0 4px', textAlign: 'center' }}>
          {loading ? 'Searching…' : `${total.toLocaleString()} brand${total === 1 ? '' : 's'} match “${q.trim()}”`}
        </div>
      )}
      {results.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(230px,100%), 1fr))', gap: 12, marginTop: 8 }}>
          {results.map((b) => (
            <Link key={b.slug} href={`/brands/${b.slug}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12, border: '0.5px solid #e6e6e6', borderRadius: 12, padding: 14, textDecoration: 'none' }}>
              <div style={{ width: 40, height: 40, borderRadius: 9, background: '#eef6e6', color: '#c2410c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>{initial(b.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: '#141d15', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleCase(b.name)}</div>
                <div style={{ fontSize: 12, color: '#8a9a8a' }}>{b.adCount.toLocaleString()} ads</div>
              </div>
              <span style={{ color: '#c2410c', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>View →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
