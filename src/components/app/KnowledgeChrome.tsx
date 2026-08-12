'use client'
/**
 * KnowledgeChrome — the chrome for public knowledge surfaces (Discover, Playbooks,
 * ad/brand pages, Search). Logged OUT (and for crawlers / first paint): a slim
 * marketing top bar, so these pages stay statically renderable for SEO. Logged IN:
 * the exact same <AppShell> as the rest of the app, so clicking Discover/Playbooks
 * never feels like leaving. Auth is resolved client-side, so the page itself stays
 * static (no cookies on the server → ISR/SEO intact); logged-in users see the
 * sidebar appear a beat after load.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import AppShell from '@/components/app/AppShell'

const INK = '#14181a', MUTED = '#7a827c', LINE = '#eef0ee'

function PublicNav() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 28px', maxWidth: 1200, margin: '0 auto' }}>
      <Link href="/" style={{ fontWeight: 850, fontSize: 17, letterSpacing: '-.02em', color: INK, textDecoration: 'none' }}>Selfmade</Link>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <Link href="/discover" style={{ fontSize: 12.5, color: MUTED, textDecoration: 'none', fontWeight: 700 }}>Discover</Link>
        <Link href="/playbooks" style={{ fontSize: 12.5, color: MUTED, textDecoration: 'none', fontWeight: 700 }}>Playbooks</Link>
        <Link href="/search" style={{ fontSize: 12.5, color: MUTED, textDecoration: 'none', border: `1px solid ${LINE}`, borderRadius: 100, padding: '7px 14px', fontWeight: 600 }}>Search</Link>
        <Link href="/hire" style={{ fontSize: 12.5, fontWeight: 800, color: '#141d15', textDecoration: 'none', background: '#ff5a2c', borderRadius: 100, padding: '8px 16px' }}>Hire Mello</Link>
      </div>
    </div>
  )
}

export default function KnowledgeChrome({ children }: { children: React.ReactNode }) {
  // null = unknown (SSR + first paint) → render public chrome so crawlers/logged-out
  // see the right thing and there's no hydration mismatch.
  const [authed, setAuthed] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    createClient().auth.getUser().then(({ data }) => { if (alive) setAuthed(!!data.user) }).catch(() => { if (alive) setAuthed(false) })
    return () => { alive = false }
  }, [])

  if (authed) return <AppShell>{children}</AppShell>
  return <>
    <PublicNav />
    {children}
  </>
}
