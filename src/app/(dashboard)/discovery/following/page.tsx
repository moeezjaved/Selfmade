'use client'
import { Heart } from 'lucide-react'
import Link from 'next/link'

export default function FollowingPage() {
  return (
    <div style={{ padding: 48, maxWidth: 560, margin: '40px auto', textAlign: 'center' }}>
      <Heart size={40} style={{ color: '#dffe95', marginBottom: 12 }} />
      <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 8 }}>Following</h1>
      <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 20 }}>
        Follow brands to get a feed of just their new ads as they launch. Coming soon —
        follow a brand from its hover card or profile to start building this list.
      </p>
      <Link href="/discovery" style={{ display: 'inline-block', padding: '10px 18px', background: '#1a3a1a', color: '#dffe95', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
        Find brands to follow →
      </Link>
    </div>
  )
}
