'use client'
/**
 * Discovery route shell. DiscoveryClient is client-only (masonic virtualizer + render-time
 * window access) and must never server-render. We gate it behind a post-mount flag with a
 * STATIC import — NOT next/dynamic(ssr:false).
 *
 * Why: next/dynamic(ssr:false) wraps the component in a lazy/Suspense boundary. Nested under the
 * dashboard layout's own whole-layout mount-gate, that boundary DEADLOCKED hydration on cold load
 * — the layout's setMounted effect never committed, so /discovery rendered BLANK on a direct URL
 * load or refresh (it only worked via client-side nav, when the layout was already mounted).
 * /dashboard (same layout, no ssr:false page) always worked, which pinned the cause to the dynamic
 * boundary. A plain post-mount conditional has no Suspense: SSR + first client render emit the same
 * placeholder (nothing to mismatch), then DiscoveryClient mounts on the client. The static import is
 * server-safe because DiscoveryClient's window access is inside handlers/render, never top-level —
 * and the gate guarantees it never renders on the server.
 */
import { useState, useEffect } from 'react'
import DiscoveryClient from './DiscoveryClient'

export default function DiscoveryPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <div style={{ minHeight: '100vh', background: '#f8fafc' }} />
  return <DiscoveryClient />
}
