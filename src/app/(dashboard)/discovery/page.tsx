'use client'
/**
 * Discovery route shell. DiscoveryClient is client-only (masonic + handler-level window access), so
 * we render it after mount with a STATIC import + a plain `mounted` gate — NOT next/dynamic(ssr:false).
 *
 * Why not ssr:false: that lazy/Suspense boundary NEVER RESOLVED on a cold/direct load — the page sat
 * permanently on its grey loading fallback and the grid never appeared (confirmed live: the Discovery
 * loading div was present, no search/filter UI, no error). A static import has no async boundary to
 * stall: SSR + first client render emit the same placeholder, then DiscoveryClient mounts on the
 * client. Server-safe because the gate guarantees DiscoveryClient never renders on the server, and
 * its window access lives in handlers, not top-level. (Separate intermittent RSC 503s are handled by
 * (dashboard)/error.tsx + loading.tsx.)
 */
import { useState, useEffect } from 'react'
import DiscoveryClient from './DiscoveryClient'

export default function DiscoveryPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return <div style={{ minHeight: '100vh', background: '#f8fafc' }} />
  return <DiscoveryClient />
}
