'use client'
import { Star } from 'lucide-react'
import Link from 'next/link'

export default function TopPicksPage() {
  return (
    <div style={{ padding: 48, maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
      <Star size={40} style={{ color: '#dffe95', marginBottom: 12 }} />
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 8 }}>Top Picks</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
        A curated feed of the highest-performing ads across your library — proven winners,
        ranked. Coming soon.
      </p>
      <Link href="/discovery" style={{ display: 'inline-block', padding: '10px 18px', background: '#1a3a1a', color: '#dffe95', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
        Browse Discovery →
      </Link>
    </div>
  )
}
