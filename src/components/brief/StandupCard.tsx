'use client'
/**
 * StandupCard — the "Good morning, here's each department" roll-call at the top of the brief. One
 * grounded line per department + a Calendar connect prompt + "Prepare everything?" which reveals the
 * queued approvals (the real one-tap fan-out lands with the coordinator). Renders nothing until it has
 * lines, so it never shows an empty shell.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'

const INK = '#17251c', SUB = '#7a9a7a', LINE = 'rgba(0,0,0,0.07)', FOREST = '#1a3a1a', LIME = '#dffe95'

type Line = { key: string; emoji: string; name: string; text: string; connect?: boolean }
type Standup = { greeting: string; dateLabel: string; lines: Line[]; pendingCount: number; pendingTitles: string[]; calendarConnected: boolean }

export default function StandupCard() {
  const [s, setS] = useState<Standup | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/company/standup', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { if (j && Array.isArray(j.lines)) setS(j) }).catch(() => {})
  }, [])

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
              <div style={{ fontSize: 13.5, color: '#eaf3e6', lineHeight: 1.45, marginTop: 1 }}>{l.text}{l.connect && <> <Link href="/settings" style={{ color: LIME, fontWeight: 700, textDecoration: 'none' }}>Connect →</Link></>}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Prepare everything — reveals the queued approvals (one-tap fan-out arrives with the coordinator) */}
      {s.pendingCount > 0 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid rgba(255,255,255,.12)` }}>
          {!open ? (
            <button onClick={() => setOpen(true)} style={{ background: LIME, color: FOREST, border: 'none', borderRadius: 100, padding: '10px 20px', fontSize: 13.5, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }}>
              Should I prepare everything? →
            </button>
          ) : (
            <div>
              <div style={{ fontSize: 12.5, color: '#eaf3e6', marginBottom: 8 }}>Here&rsquo;s what&rsquo;s ready for your OK — approve each below on your desk:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {s.pendingTitles.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#fff' }}>
                    <span style={{ color: LIME }}>›</span>{t}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: '#9db29a', marginTop: 8 }}>One-tap “do it all” arrives when Mello&rsquo;s coordinator is on.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
