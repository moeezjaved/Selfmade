'use client'
/**
 * BriefOpportunities — "What Mello would do" on the Morning Brief. Fetches /api/meta/opportunities
 * (the SAME computeOpportunities engine Reports uses, so the cards are identical) and renders the
 * ranked action cards with expected impact + a confidence meter. Renders nothing until there's data,
 * so it never clutters a brief for someone without a connected/active ad account.
 */
import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { oppColor, type Opportunity } from '@/lib/meta/opportunities'

const INK = '#111111', MUTED = '#6b6b6b', LINE = '#ecede8', FOREST = '#17251c', LIME = '#dffe95', FAINT = '#9aa79a'
const GOOD = '#2f7d3a', WARN = '#b7791f'
const card: React.CSSProperties = { background: '#fff', borderRadius: 16, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 10px 30px -18px rgba(17,24,17,.10)' }

function Confidence({ level }: { level: 1 | 2 | 3 }) {
  const label = level === 3 ? 'High confidence' : level === 2 ? 'Medium confidence' : 'Early signal'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[1, 2, 3].map((i) => <span key={i} style={{ width: 12, height: 4, borderRadius: 2, background: i <= level ? (level === 3 ? GOOD : level === 2 ? WARN : FAINT) : '#e6eae4' }} />)}
      </span>
      <span style={{ fontSize: 11, color: MUTED, fontWeight: 650 }}>{label}</span>
    </span>
  )
}

export default function BriefOpportunities({ onAct }: { onAct?: (o: Opportunity) => void }) {
  const [ops, setOps] = useState<Opportunity[] | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/meta/opportunities', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (live && j && Array.isArray(j.opportunities)) setOps(j.opportunities) })
      .catch(() => {})
    return () => { live = false }
  }, [])

  if (!ops || ops.length === 0) return null
  const shown = showAll ? ops : ops.slice(0, 3)

  return (
    <div className="bsx-e" style={{ marginBottom: 24, animationDelay: '.36s' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 750, letterSpacing: '-.02em', color: INK }}>What Mello would do</div>
        <Link href="/reports" style={{ fontSize: 12.5, color: '#3f8f4f', fontWeight: 800, textDecoration: 'none' }}>See the full report →</Link>
      </div>
      <div style={{ fontSize: 13.5, color: MUTED, margin: '0 0 16px' }}>The {ops.length} move{ops.length === 1 ? '' : 's'} that matter — each with what it's worth and how sure I am.</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(290px,100%), 1fr))', gap: 12 }}>
        {shown.map((r, i) => (
          <div key={i} style={{ ...card, borderLeft: `3px solid ${oppColor(r.tone)}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 750, color: INK, letterSpacing: '-.01em' }}>{r.title}</div>
            <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, flex: 1 }}>{r.why}</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: oppColor(r.tone) }}>{r.impact}</span>
              <Confidence level={r.level} />
            </div>
            <Link href={r.href} onClick={() => onAct?.(r)} style={{ alignSelf: 'flex-start', background: FOREST, color: LIME, borderRadius: 100, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', marginTop: 2 }}>{r.cta} →</Link>
          </div>
        ))}
      </div>

      {ops.length > 3 && (
        <button onClick={() => setShowAll(s => !s)} style={{ marginTop: 12, background: 'none', border: 'none', color: '#3f8f4f', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          {showAll ? 'Show fewer' : `Show ${ops.length - 3} more move${ops.length - 3 === 1 ? '' : 's'}`} →
        </button>
      )}
    </div>
  )
}
