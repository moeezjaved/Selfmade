'use client'
/**
 * BriefOpportunities — "What Mello would do" on the Morning Brief. Fetches /api/meta/opportunities
 * (the SAME computeOpportunities engine Reports uses, so the cards are identical) and renders the
 * ranked action cards with expected impact + a confidence meter. Renders nothing until there's data,
 * so it never clutters a brief for someone without a connected/active ad account.
 */
import React, { useEffect, useRef, useState } from 'react'
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

export default function BriefOpportunities({ initial, onAct, accountId }: { initial?: Opportunity[]; onAct?: (o: Opportunity) => void; accountId?: string | null }) {
  // `initial` = the cards computed by the nightly audit and stored in the brief payload. If present, we
  // render them immediately with ZERO live calls. Refresh (or the empty-state button) pulls fresh.
  const hasInitial = !!(initial && initial.length)
  const [ops, setOps] = useState<Opportunity[] | null>(hasInitial ? initial! : null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(hasInitial)

  // Live pull — the nightly cards are usually enough, so this only fires on an explicit tap (refresh /
  // "See Mello's moves") or when the founder switches the account in the Facebook card. Result is
  // cached server-side so re-opening is cheap. `acct` scopes to the switched account so the currency
  // and figures match what the Facebook card is showing.
  const load = (acct?: string | null) => {
    setBusy(true)
    const qs = acct ? `?accountId=${encodeURIComponent(acct)}` : ''
    fetch(`/api/meta/opportunities${qs}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j && Array.isArray(j.opportunities)) setOps(j.opportunities) })
      .catch(() => {})
      .finally(() => { setBusy(false); setLoaded(true) })
  }

  // Show the moves by DEFAULT, not behind a click. If the nightly audit already stored them
  // (`initial`), they render instantly with zero calls; if not, pull them once on mount (the endpoint
  // is cached server-side, so repeat brief loads don't re-hit Meta). This is the bridge until every
  // nightly run stores them — the founder should never see an empty "pull it yourself" prompt.
  useEffect(() => {
    if (!hasInitial) load(accountId || undefined)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the Facebook card's account switch so every number on the brief speaks one currency.
  // Skips the very first value (mount → primary, already matches `initial` / the mount load above).
  const firstScope = useRef(true)
  useEffect(() => {
    if (firstScope.current) { firstScope.current = false; return }
    if (accountId) load(accountId)
  }, [accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Not loaded yet → a quiet prompt (no Graph call until tapped).
  if (!loaded) {
    return (
      <div className="bsx-e" style={{ ...card, marginBottom: 24, padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', animationDelay: '.36s' }}>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 750, color: INK }}>What Mello would do</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>The ranked moves to improve your ads — pull the latest when you want it.</div>
        </div>
        <button onClick={() => load(accountId)} disabled={busy} style={{ flexShrink: 0, background: FOREST, color: LIME, border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {busy ? 'Thinking…' : "See Mello's moves →"}
        </button>
      </div>
    )
  }

  if (!ops || ops.length === 0) return null
  const shown = showAll ? ops : ops.slice(0, 3)

  return (
    <div className="bsx-e" style={{ marginBottom: 24, animationDelay: '.36s' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 750, letterSpacing: '-.02em', color: INK }}>What Mello would do</div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => load(accountId)} disabled={busy} title="Refresh live from Meta" style={{ background: 'none', border: 'none', color: '#9aa79a', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', padding: 0 }}>{busy ? 'refreshing…' : '↻'}</button>
          <Link href="/reports" style={{ fontSize: 12.5, color: '#3f8f4f', fontWeight: 800, textDecoration: 'none' }}>See the full report →</Link>
        </span>
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
