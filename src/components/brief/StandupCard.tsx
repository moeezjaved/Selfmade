'use client'
/**
 * StandupCard — the "Good morning, here's each department" roll-call at the top of the brief. One
 * grounded line per department + a Calendar connect prompt + "Prepare everything?" which reveals the
 * queued approvals (the real one-tap fan-out lands with the coordinator). Renders nothing until it has
 * lines, so it never shows an empty shell.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

const INK = '#141d15', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.07)', FOREST = '#141d15', LIME = '#ff5a2c'

type Line = { key: string; emoji: string; name: string; text: string; connect?: boolean }
type Prompt = { key: string; emoji: string; label: string }
type Standup = { greeting: string; dateLabel: string; lines: Line[]; pendingCount: number; pendingTitles: string[]; calendarConnected: boolean; connectPrompts?: Prompt[] }
type Prep = { prepared: { dept: string; detail: string }[]; awaiting: { title: string; kind: string; cost: string }[]; summary: string }

export default function StandupCard({ brandId }: { brandId?: string | null }) {
  const [s, setS] = useState<Standup | null>(null)
  const [open, setOpen] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [prep, setPrep] = useState<Prep | null>(null)

  useEffect(() => {
    setS(null)   // clear the previous brand's standup on switch so stale cross-brand lines never show
    fetch(`/api/company/standup${brandId ? `?brand=${encodeURIComponent(brandId)}` : ''}`, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.lines)) setS(j) }).catch(() => {})
  }, [brandId])

  const prepareEverything = () => {
    setPreparing(true); setOpen(true)
    fetch('/api/company/prepare', { method: 'POST' }).then(r => r.json())
      .then(j => { if (j?.ok) setPrep(j) })
      .catch(() => {})
      .finally(() => setPreparing(false))
  }

  if (!s || s.lines.length === 0) return null

  return (
    <div className="bsx-e" style={{ background: FOREST, borderRadius: 18, padding: '20px 22px', marginBottom: 20, boxShadow: '0 10px 30px -18px rgba(17,37,28,.5)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#fff', letterSpacing: '-.01em' }}>{s.greeting}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#9db29a', textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.dateLabel}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {s.lines.map((l) => (
          <div key={l.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '9px 0', borderTop: `1px solid rgba(255,255,255,.08)` }}>
            <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>{l.emoji}</span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9db29a' }}>{l.name}</span>
              <div style={{ fontSize: 13.5, color: '#eaf3e6', lineHeight: 1.45, marginTop: 1 }}>{l.text}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Small "finish setup" chips — calendar / comms — quiet, not a big banner. */}
      {!!(s.connectPrompts && s.connectPrompts.length) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {s.connectPrompts.map(p => (
            // Deep-link to the right Settings tab — comms + calendar both live under Channels — instead of
            // dumping the founder on the Account/profile tab.
            <Link key={p.key} href="/settings?tab=channels" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 100, padding: '5px 11px', fontSize: 12, fontWeight: 700, color: '#eaf3e6', textDecoration: 'none' }}>
              <span>{p.emoji}</span>{p.label}<span style={{ color: LIME }}>→</span>
            </Link>
          ))}
        </div>
      )}

      {/* Prepare everything — one tap fans out the free prep and lines up what needs your OK. */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid rgba(255,255,255,.12)` }}>
        {!open ? (
          <button onClick={prepareEverything} style={{ background: LIME, color: FOREST, border: 'none', borderRadius: 100, padding: '10px 20px', fontSize: 13.5, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>
            Should I prepare everything? →
          </button>
        ) : preparing ? (
          <div style={{ fontSize: 13, color: '#eaf3e6' }}>Mello is preparing everything…</div>
        ) : prep ? (
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 750, color: '#fff', marginBottom: 10 }}>Done — {prep.summary}</div>
            {prep.prepared.length > 0 && (
              <div style={{ marginBottom: prep.awaiting.length ? 12 : 0 }}>
                {prep.prepared.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#eaf3e6', padding: '3px 0' }}>
                    <span style={{ color: LIME }}>✓</span><b style={{ color: '#fff', fontWeight: 700 }}>{p.dept}</b> — {p.detail}
                  </div>
                ))}
              </div>
            )}
            {prep.awaiting.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9db29a', marginBottom: 6 }}>Needs your OK</div>
                {prep.awaiting.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, color: '#fff', padding: '3px 0' }}>
                    <span style={{ color: LIME }}>›</span><span style={{ flex: 1 }}>{a.title}</span><span style={{ fontSize: 11, color: (a.cost.includes('spend') || a.cost.includes('credit')) ? '#f0c86a' : '#9db29a', fontWeight: 700, whiteSpace: 'nowrap' }}>{a.cost}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11.5, color: '#9db29a', marginTop: 8 }}>Money stays behind the button — approve each on your desk below.</div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#eaf3e6' }}>Nothing needs prep right now. 🌱</div>
        )}
      </div>
    </div>
  )
}
