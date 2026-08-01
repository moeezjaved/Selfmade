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

  // Premium "connect first" state — shown on every Meta surface (Reports, Campaigns, Insights, …) until
  // an account is linked. Warm, on-theme, one clear action (the live one-click OAuth on /connect/meta).
  const perks = [
    ['🌅', 'A full audit every morning', 'Mello reads your account overnight and tells you what changed.'],
    ['📈', 'What to scale, what to pause', 'Ranked moves with the expected impact — not a wall of numbers.'],
    ['⚡', 'One click to act', 'Approve a move and Mello makes the change on Meta for you.'],
  ]
  return (
    <div style={{ maxWidth: 560, margin: '56px auto', padding: '0 20px', fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: 22, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 24px 60px -24px rgba(17,24,17,.18)', padding: '34px 32px', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: '#17251c', color: '#dffe95', display: 'grid', placeItems: 'center', margin: '0 auto 16px', fontSize: 24 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#dffe95" aria-hidden><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>
        </div>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 30, fontWeight: 400, letterSpacing: '-.01em', color: '#17251c', lineHeight: 1.15, margin: 0 }}>Connect your Facebook ads to unlock {feature}</h1>
        <p style={{ fontSize: 14.5, color: '#68756b', lineHeight: 1.6, margin: '10px auto 22px', maxWidth: 400 }}>
          Link your ad account and Mello runs it like your in-house media buyer — reading it every morning and telling you exactly what to do.
        </p>
        <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 380, margin: '0 auto 24px' }}>
          {perks.map(([icon, title, sub]) => (
            <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: '#eef6e4', display: 'grid', placeItems: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</span>
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#17251c' }}>{title}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: '#68756b', lineHeight: 1.5, marginTop: 1 }}>{sub}</span>
              </span>
            </div>
          ))}
        </div>
        <a href="/connect/meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#17251c', color: '#dffe95', borderRadius: 100, padding: '13px 30px', fontSize: 14.5, fontWeight: 800, textDecoration: 'none' }}>
          Connect Facebook →
        </a>
        <div style={{ fontSize: 12, color: '#9aa79a', marginTop: 12 }}>Two clicks, ~30 seconds. You can disconnect anytime.</div>
      </div>
    </div>
  )
}
