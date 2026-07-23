'use client'
/**
 * FOR YOU — the personal ribbon inside the Edition. Renders nothing for logged-out
 * readers (the public edition stays clean); for a logged-in reader it slots
 * "Today · For {brand}" between Mello's note and the lead story.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

type Line = { text: string; href: string }

export default function ForYou() {
  const [data, setData] = useState<{ brandName: string | null; lines: Line[] } | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/edition/foryou')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && Array.isArray(d.lines) && d.lines.length) setData(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  if (!data) return null

  return (
    <div style={{ margin: '34px 0 0', borderLeft: '3px solid #dffe95', paddingLeft: 18 }}>
      <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: '.16em', color: '#7a827c', textTransform: 'uppercase' }}>
        Today · For {data.brandName || 'your brand'}
      </div>
      <div style={{ marginTop: 8 }}>
        {data.lines.map((l, i) => (
          <Link key={i} href={l.href} style={{ display: 'block', padding: '7px 0', fontSize: 14.5, fontWeight: 650, color: '#14181a', textDecoration: 'none', letterSpacing: '-.005em', lineHeight: 1.45 }}>
            {l.text} <span style={{ color: '#aab0ab', fontWeight: 700 }}>→</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
