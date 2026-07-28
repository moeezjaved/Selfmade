'use client'
/**
 * MetaGate — the single gate for every surface that needs a connected Meta ad account (M4/Launch,
 * Campaigns, Scale & Insights, Reports, Snapshots, KPI Dashboard, Leaderboard).
 *
 * The old gate was NEXT_PUBLIC_META_LIVE — tied to the OAuth app, which died in the account hack.
 * BYO-token connect (/connect/meta) works WITHOUT that app, so the correct gate is simply "does the
 * user have an active connection?" Connected → render the surface. Not connected → one clear prompt
 * to teach Mello their ad account (never a dead "coming soon"). One component, one behaviour,
 * everywhere — so the whole cockpit un-gates the moment a token lands.
 */
import React, { useEffect, useState } from 'react'

export default function MetaGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'connected' | 'none'>('loading')
  useEffect(() => {
    let alive = true
    fetch('/api/meta/accounts', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (alive) setState((j.accounts || []).length ? 'connected' : 'none') })
      .catch(() => { if (alive) setState('none') })
    return () => { alive = false }
  }, [])

  if (state === 'loading') return <div style={{ padding: 60, textAlign: 'center', color: '#9aa79a', fontFamily: "'Inter',-apple-system,sans-serif" }}>Loading…</div>
  if (state === 'connected') return <>{children}</>

  return (
    <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 20px', fontFamily: "'Inter',-apple-system,sans-serif", textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 6 }}>🎯</div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.025em', color: '#161c17' }}>Connect Meta to unlock {feature}</div>
      <p style={{ fontSize: 15, color: '#68756b', lineHeight: 1.65, margin: '12px 0 24px' }}>
        Selfmade launches, scales, and manages your Meta campaigns from one place — and Mello audits them
        for you every morning. Connect your ad account with your own Business token; ~30 seconds, no app-review wait.
      </p>
      <a href="/connect/meta" style={{ display: 'inline-block', background: '#17251c', color: '#dffe95', borderRadius: 100, padding: '13px 28px', fontSize: 14.5, fontWeight: 800, textDecoration: 'none' }}>Teach Mello your ad account →</a>
    </div>
  )
}
