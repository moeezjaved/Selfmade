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
  // Accounts already connected in the workspace but NOT linked to the active brand — offer to link one
  // here instead of forcing a reconnect (the "Aura says Connect Meta though I already connected" case).
  const [unlinked, setUnlinked] = useState<Array<{ account_id: string; account_name: string | null; currency?: string | null }>>([])
  const [activeBrand, setActiveBrand] = useState<string | null>(null)
  const [linking, setLinking] = useState('')

  const load = React.useCallback(() => {
    let alive = true
    fetch('/api/meta/accounts', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => {
        if (!alive) return
        const brand = j.activeBrand || null
        setActiveBrand(brand)
        // accounts NOT yet linked to the active brand (any brand_id !== active, incl. null)
        setUnlinked(brand ? (j.workspaceAccounts || []).filter((a: any) => a.brand_id !== brand) : [])
        setState((j.accounts || []).length ? 'connected' : 'none')
      })
      .catch(() => { if (alive) setState('none') })
    return () => { alive = false }
  }, [])
  useEffect(() => load(), [load])

  const linkExisting = async (accountId: string) => {
    if (!activeBrand) return
    setLinking(accountId)
    try {
      await fetch('/api/meta/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: accountId, brand_id: activeBrand }) })
      load()
    } finally { setLinking('') }
  }

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
        <div style={{ width: 56, height: 56, borderRadius: 16, background: '#141d15', color: '#ff5a2c', display: 'grid', placeItems: 'center', margin: '0 auto 16px', fontSize: 24 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#ff5a2c" aria-hidden><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"/></svg>
        </div>
        <h1 style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 30, fontWeight: 400, letterSpacing: '-.01em', color: '#141d15', lineHeight: 1.15, margin: 0 }}>Connect your Facebook ads to unlock {feature}</h1>
        <p style={{ fontSize: 14.5, color: '#6f6d5a', lineHeight: 1.6, margin: '10px auto 22px', maxWidth: 400 }}>
          Link your ad account and Mello runs it like your in-house media buyer — reading it every morning and telling you exactly what to do.
        </p>
        <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 380, margin: '0 auto 24px' }}>
          {perks.map(([icon, title, sub]) => (
            <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: '#eef6e4', display: 'grid', placeItems: 'center', fontSize: 16, flexShrink: 0 }}>{icon}</span>
              <span>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#141d15' }}>{title}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: '#6f6d5a', lineHeight: 1.5, marginTop: 1 }}>{sub}</span>
              </span>
            </div>
          ))}
        </div>
        {/* Already connected an account, just not linked to THIS brand → let them link it in one click
            (one ad account per brand) instead of reconnecting Facebook again. */}
        {activeBrand && unlinked.length > 0 && (
          <div style={{ margin: '0 auto 20px', maxWidth: 400, textAlign: 'left', background: '#f7faf3', border: '1px solid #e1ecd7', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#141d15', marginBottom: 3 }}>Already connected an account?</div>
            <div style={{ fontSize: 12.5, color: '#6f6d5a', lineHeight: 1.5, marginBottom: 10 }}>Link one you’ve connected to this brand — no need to reconnect.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {unlinked.map((a) => (
                <button key={a.account_id} onClick={() => linkExisting(a.account_id)} disabled={!!linking}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #e1ecd7', borderRadius: 10, padding: '10px 13px', cursor: linking ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'inherit', opacity: linking && linking !== a.account_id ? 0.5 : 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#141d15', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.account_name || a.account_id}{a.currency ? <span style={{ color: '#9aa79a', fontWeight: 600 }}> · {a.currency}</span> : null}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#ef4a1e', flexShrink: 0 }}>{linking === a.account_id ? 'Linking…' : 'Link →'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <a href="/connect/meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '13px 30px', fontSize: 14.5, fontWeight: 800, textDecoration: 'none' }}>
          {unlinked.length > 0 ? 'Connect a different account →' : 'Connect Facebook →'}
        </a>
        <div style={{ fontSize: 12, color: '#9aa79a', marginTop: 12 }}>Two clicks, ~30 seconds. You can disconnect anytime.</div>
      </div>
    </div>
  )
}
