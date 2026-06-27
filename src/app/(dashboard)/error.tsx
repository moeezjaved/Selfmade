'use client'
/**
 * Dashboard route-group error boundary. Without this, an intermittent 503 on a route's server (RSC)
 * payload — which happens on the heavier routes (/discovery, /mello, /m4, /campaigns, /insights,
 * /brand-spy) under load / cold-start — left the screen BLANK-GREEN with no recovery (the React root
 * never mounted content). Next.js renders this component instead when a segment under (dashboard)
 * fails to render.
 *
 * Because those 503s are TRANSIENT, we auto-retry once shortly after the failure (reset() re-renders
 * the segment, re-fetching the payload), guarded by a sessionStorage timestamp so a genuinely-broken
 * route can't tight-loop. If the retry doesn't take, the user gets a clear spinner + manual Retry
 * instead of a dead page.
 */
import { useEffect, useState } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    // Auto-retry the transient payload failure, but only if we haven't already retried in the last
    // 5s — that throttles a persistently-failing route to one attempt per window instead of a tight
    // reset() loop, while still recovering instantly from a one-off 503.
    let cancelled = false
    try {
      const last = Number(sessionStorage.getItem('dash_err_ts') || 0)
      const now = Date.now()
      if (now - last > 5000) {
        sessionStorage.setItem('dash_err_ts', String(now))
        setRetrying(true)
        const t = setTimeout(() => { if (!cancelled) reset() }, 700)
        return () => { cancelled = true; clearTimeout(t) }
      }
    } catch { /* sessionStorage blocked — fall through to manual retry */ }
  }, [reset])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 16, background: '#1a3a1a', color: '#fff',
      fontFamily: 'Hanken Grotesk, sans-serif', padding: 24, textAlign: 'center',
    }}>
      <div className="selfmade-loading" />
      <div style={{ fontSize: 15, fontWeight: 600, opacity: 0.92 }}>
        {retrying ? 'Reconnecting…' : 'This page didn’t load'}
      </div>
      <div style={{ fontSize: 13, opacity: 0.6, maxWidth: 320 }}>
        The server hiccuped loading this page. It usually clears on a retry.
      </div>
      <button
        onClick={() => { setRetrying(true); reset() }}
        style={{
          marginTop: 4, padding: '9px 20px', borderRadius: 8, background: '#dffe95',
          color: '#243d20', border: 'none', fontWeight: 700, fontSize: 14,
          fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}
