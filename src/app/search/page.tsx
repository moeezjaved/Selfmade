'use client'
/**
 * /search — universal knowledge search as a full page (the ⌘K palette's public,
 * linkable big sibling). Same /api/search sections: knowledge, collections, brands,
 * the raw library. Public — search is a front door, not a feature.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Item = { label: string; sub?: string; href: string; kind: string }
type Section = { title: string; items: Item[] }

const INK = '#14181a', MUTED = '#7a827c', FAINT = '#aab0ab', LINE = '#eceeec'

export default function SearchPage() {
  const [q, setQ] = useState('')
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(false)
  const tRef = useRef<any>(null)

  useEffect(() => {
    clearTimeout(tRef.current)
    setLoading(true)
    tRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        const d = await r.json()
        setSections(Array.isArray(d?.sections) ? d.sections : [])
      } catch { setSections([]) }
      setLoading(false)
    }, 220)
    return () => clearTimeout(tRef.current)
  }, [q])

  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: "'Inter', -apple-system, sans-serif", color: INK }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', maxWidth: 860, margin: '0 auto' }}>
        <Link href="/" style={{ fontWeight: 850, fontSize: 17, letterSpacing: '-.02em', color: INK, textDecoration: 'none' }}>Selfmade</Link>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Link href="/discover" style={{ fontSize: 12.5, color: MUTED, textDecoration: 'none', fontWeight: 700 }}>Today&rsquo;s Edition</Link>
          <Link href="/brief" style={{ fontSize: 12.5, fontWeight: 800, color: INK, textDecoration: 'none' }}>Open app →</Link>
        </div>
      </div>

      <div style={{ maxWidth: 620, margin: '0 auto', padding: '40px 24px 100px' }}>
        <h1 style={{ fontSize: 'clamp(24px,4vw,32px)', fontWeight: 800, letterSpacing: '-.028em', margin: '0 0 18px' }}>Search marketing knowledge</h1>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Brands, hooks, formats, collections…"
          style={{ width: '100%', boxSizing: 'border-box', border: `1.5px solid ${LINE}`, borderRadius: 14, padding: '15px 18px', fontSize: 16.5, fontWeight: 600, color: INK, outline: 'none', fontFamily: 'inherit' }}
        />
        <div style={{ marginTop: 10 }}>
          {loading && <div style={{ padding: '18px 4px', fontSize: 13, color: FAINT, fontWeight: 600 }}>Searching the graph…</div>}
          {!loading && sections.map((s) => (
            <div key={s.title} style={{ marginTop: 22 }}>
              <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '.14em', color: FAINT, textTransform: 'uppercase', marginBottom: 4 }}>{s.title}</div>
              {s.items.map((it) => (
                <Link key={`${it.href}:${it.label}`} href={it.href} style={{ display: 'block', padding: '12px 2px', borderBottom: `1px solid #f2f4f2`, textDecoration: 'none' }}>
                  <span style={{ display: 'block', fontSize: 15, fontWeight: 750, color: INK, letterSpacing: '-.008em' }}>{it.label}</span>
                  {it.sub && <span style={{ display: 'block', fontSize: 12, color: MUTED, fontWeight: 600, marginTop: 2 }}>{it.sub}</span>}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
