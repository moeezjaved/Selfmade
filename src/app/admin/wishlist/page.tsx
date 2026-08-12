'use client'
/**
 * ADMIN · Brief Wishlist — what users want to see more of in their Morning Brief.
 * Every submission from the brief's "what else do you want?" button lands here, so
 * the founder can read demand directly and decide what to build next.
 */
import { useEffect, useState } from 'react'

type Item = { id: string; text: string; email: string | null; at: string }

export default function AdminWishlist() {
  const [items, setItems] = useState<Item[] | null>(null)
  useEffect(() => { fetch('/api/admin/wishlist').then(r => r.json()).then(d => setItems(d.items || [])).catch(() => setItems([])) }, [])

  return (
    <div style={{ padding: '28px 26px 80px', maxWidth: 820, fontFamily: "'Inter', -apple-system, sans-serif", color: '#161c17' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', margin: 0 }}>Brief wishlist</h1>
      <div style={{ fontSize: 13, color: '#6f6d5a', marginTop: 4 }}>What users asked to see more of in their Morning Brief — newest first. Your build backlog, in their words.</div>

      {items === null && <div style={{ marginTop: 24, color: '#6f6d5a', fontSize: 14 }}>Loading…</div>}
      {items && items.length === 0 && <div style={{ marginTop: 24, color: '#6f6d5a', fontSize: 14 }}>No requests yet. They’ll appear here as users tap “What else do you want to see in your brief?”.</div>}

      {items && items.length > 0 && (
        <div style={{ marginTop: 22, display: 'grid', gap: 10 }}>
          {items.map(it => (
            <div key={it.id} style={{ border: '1px solid #efece2', borderRadius: 12, background: '#fff', padding: '14px 16px' }}>
              <div style={{ fontSize: 14.5, fontWeight: 650, color: '#161c17', lineHeight: 1.5 }}>{it.text}</div>
              <div style={{ fontSize: 11.5, color: '#94a096', fontWeight: 600, marginTop: 6 }}>
                {it.email || 'a user'} · {new Date(it.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
