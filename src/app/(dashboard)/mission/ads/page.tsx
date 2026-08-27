'use client'
/**
 * Ads department — the Meta paid-ads agents in one place. The always-on Health watchdog up top (CPA spike,
 * ROAS drop, fatigue…), then the on-demand playbook agents (weekly report, scaling, ASC setup, retargeting
 * ladder, CAPI health, signal recovery, exclusions, offer testing, promo calendar, audience expansion).
 * Advisory — every agent produces a grounded brief; nothing changes the account without you.
 */
import { useEffect, useState, useCallback } from 'react'

const INK = '#141d15', SUB = '#7a9a7a', LIME = '#ff5a2c', LINE = 'rgba(0,0,0,0.08)', PAPER = '#faf9f5', GOOD = '#256029', RED = '#c0392b'

type Issue = { kind: string; severity: 'high' | 'med'; title: string; body: string }
type Health = { connected: boolean; issues: Issue[]; recent?: any; baseline?: any; account?: { id: string; currency?: string } }
type Pb = { kind: string; name: string; blurb: string; dataGrounded?: boolean }
type Section = { heading: string; items: string[] }
type Playbook = { kind: string; name: string; title: string; sections: Section[]; grounded: boolean }

export default function AdsPage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [playbooks, setPlaybooks] = useState<Pb[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<Playbook | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/meta/playbooks'); const j = await r.json(); if (r.ok) { setHealth(j.health); setPlaybooks(j.playbooks || []) } } catch { /* noop */ }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { const h = () => load(); window.addEventListener('sf:brandchange', h); return () => window.removeEventListener('sf:brandchange', h) }, [load])

  const run = async (kind: string) => {
    setBusy(kind); setNote(null); setOpen(null)
    try {
      const r = await fetch('/api/meta/playbooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind }) })
      const j = await r.json()
      if (r.ok) setOpen(j.playbook)
      else setNote(j.error || 'Could not generate.')
    } catch { setNote('Network error.') }
    setBusy(null)
  }

  if (loading) return <Shell><div style={{ color: SUB }}>Loading…</div></Shell>

  return (
    <Shell>
      <div style={{ marginBottom: 6, fontSize: 12.5, color: SUB, fontWeight: 700, letterSpacing: '.02em', textTransform: 'uppercase' }}>Ads department · Meta</div>
      <h1 style={{ fontSize: 27, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 6px' }}>Your paid-ads team</h1>
      <p style={{ color: SUB, fontSize: 15, margin: '0 0 22px', lineHeight: 1.5 }}>
        Always-on account health, plus agents that write account-grounded playbooks on demand. Advisory — nothing changes your ads without you.
      </p>

      {note && <div style={{ borderRadius: 12, padding: '11px 15px', marginBottom: 18, fontSize: 14, fontWeight: 600, background: '#eef4fb', color: '#28527a', border: '1px solid #cddcf0' }}>{note}</div>}

      {/* Health watchdog */}
      <div style={{ border: `1px solid ${LINE}`, borderRadius: 16, background: '#fff', padding: 18, marginBottom: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Account health <span style={{ fontSize: 12, fontWeight: 700, color: SUB }}>· 7d vs 30d</span></div>
        {!health?.connected ? (
          <div style={{ fontSize: 13.5, color: SUB }}>Connect Meta to turn on the watchdog. <a href="/connect-meta" style={{ color: LIME, fontWeight: 700 }}>Connect →</a></div>
        ) : health.issues.length === 0 ? (
          <div style={{ fontSize: 13.5, color: GOOD, fontWeight: 600 }}>✓ No issues flagged — efficiency is holding.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {health.issues.map((iss, i) => (
              <div key={i} style={{ borderLeft: `3px solid ${iss.severity === 'high' ? RED : LIME}`, background: iss.severity === 'high' ? '#fdecea' : '#fff6f2', borderRadius: 8, padding: '10px 13px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: INK }}>{iss.title}</div>
                <div style={{ fontSize: 12.5, color: SUB, marginTop: 2, lineHeight: 1.4 }}>{iss.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Playbook agents */}
      <div style={{ fontSize: 15, fontWeight: 800, margin: '0 0 12px' }}>Playbook agents</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
        {playbooks.map((p) => (
          <div key={p.kind} style={{ border: `1px solid ${LINE}`, borderRadius: 14, background: '#fff', padding: 15, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800 }}>{p.name}{p.dataGrounded && <span style={{ fontSize: 10, fontWeight: 800, color: GOOD, background: '#eaf6e6', borderRadius: 20, padding: '2px 7px', marginLeft: 6 }}>live data</span>}</div>
            <div style={{ fontSize: 12.5, color: SUB, lineHeight: 1.4, flex: 1 }}>{p.blurb}</div>
            <button onClick={() => run(p.kind)} disabled={!!busy} style={{ background: LIME, color: '#fff', border: 'none', borderRadius: 100, padding: '8px 14px', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy === p.kind ? 0.6 : 1, alignSelf: 'flex-start' }}>{busy === p.kind ? 'Writing…' : 'Run →'}</button>
          </div>
        ))}
      </div>

      {/* Output */}
      {open && (
        <div style={{ border: `1.5px solid ${LIME}`, borderRadius: 16, background: '#fff', padding: 22, marginTop: 22 }}>
          <div style={{ fontSize: 11.5, color: SUB, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>{open.name}{!open.grounded && ' · generic (connect Meta for account-specific)'}</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.01em', margin: '4px 0 14px' }}>{open.title}</h2>
          {open.sections.map((s, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: INK, marginBottom: 6 }}>{s.heading}</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.items.map((it, j) => <li key={j} style={{ fontSize: 14, lineHeight: 1.55, color: '#2c3a2e', marginBottom: 5 }}>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 780, margin: '0 auto', padding: '40px 20px 90px', fontFamily: 'Inter, system-ui, sans-serif', color: INK }}>{children}</div>
}
