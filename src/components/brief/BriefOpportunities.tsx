'use client'
/**
 * BriefOpportunities — "What Mello would do" on the Morning Brief. Fetches /api/meta/opportunities
 * (the SAME computeOpportunities engine Reports uses, so the cards are identical) and renders the
 * ranked action cards with expected impact + a confidence meter. Renders nothing until there's data,
 * so it never clutters a brief for someone without a connected/active ad account.
 */
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { oppColor, type Opportunity, type ApplyPlan } from '@/lib/meta/opportunities'
import { showUpsell } from '@/components/UpsellModal'

const INK = '#111111', MUTED = '#6b6b6b', LINE = '#ecede8', FOREST = '#141d15', LIME = '#ff5a2c', FAINT = '#9aa79a'
const GOOD = '#ef4a1e', WARN = '#b7791f'
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

type ScaleCampaign = { metaCampaignId?: string | null; name?: string; dailyBudget?: number | null; roas?: number }

// Inline budget-confirm for the "Scale it" card — the approve→act loop, right on the brief. Shows the
// current daily budget, a proposed +20% (editable), and one confirm button. Nothing spends until the
// founder hits Scale. This is the whole product: recommend → confirm a budget → act on Meta.
function ScaleConfirm({ camp, currency }: { camp: ScaleCampaign; currency: string }) {
  const cur = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0)}` } }
  const currentMajor = Math.max(1, Math.round((Number(camp.dailyBudget) || 0) / 100)) // dailyBudget is in cents
  const [open, setOpen] = useState(false)
  const [budget, setBudget] = useState<number>(Math.max(currentMajor + 1, Math.round(currentMajor * 1.2)))
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  if (!camp.metaCampaignId) {
    // No campaign id (older audit) → fall back to the campaigns page.
    return <Link href="/campaigns" style={{ alignSelf: 'flex-start', background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', marginTop: 2 }}>Scale it →</Link>
  }

  if (state === 'done') {
    return <div style={{ marginTop: 4, fontSize: 12.5, fontWeight: 700, color: GOOD }}>✓ Duplicated your winner into a new Scaling campaign at {cur(budget)}/day. Your original keeps running untouched.</div>
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start', background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginTop: 2 }}>Scale it →</button>
  }

  const run = () => {
    setState('busy'); setMsg('')
    fetch('/api/meta/scale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ metaCampaignId: camp.metaCampaignId, newDailyBudget: budget }) })
      .then(r => r.json())
      .then(j => { if (j?.ok) { setState('done') } else if (showUpsell(j)) { setState('idle') } else { setState('err'); setMsg(j?.error || 'Scaling failed — try again.') } })
      .catch(() => { setState('err'); setMsg('Scaling failed — try again.') })
  }

  return (
    <div style={{ marginTop: 6, width: '100%' }}>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>I'll duplicate this winner into a new Scaling campaign (your original stays untouched). Its daily budget:</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input type="number" min={1} value={budget} onChange={e => setBudget(Math.max(1, Math.round(Number(e.target.value) || 0)))} disabled={state === 'busy'}
          style={{ width: 92, border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 10px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', color: INK }} />
        <span style={{ fontSize: 12, color: MUTED }}>{currency}/day</span>
        <button onClick={run} disabled={state === 'busy'} style={{ background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', fontSize: 12.5, fontWeight: 800, cursor: state === 'busy' ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {state === 'busy' ? 'Duplicating…' : `Scale to ${cur(budget)}/day`}
        </button>
        <button onClick={() => setOpen(false)} disabled={state === 'busy'} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
      </div>
      {state === 'err' && <div style={{ marginTop: 6, fontSize: 12, color: '#c0392b' }}>{msg}</div>}
      <div style={{ marginTop: 6, fontSize: 11.5, color: FAINT }}>Copies your winner into a fresh campaign at this budget — the original is never touched, so its learning stays intact.</div>
    </div>
  )
}

// "Target them" / "Review placements" hand off to the Campaigns "Manage with Mello" assistant with the
// exact move pre-filled, so the founder just reviews and taps Send to make it live on Meta (replaces the
// old inline duplicate-confirm — the buttons were dead when the audit had no metaCampaignId).
function TuneConfirm({ apply, camp, cta, onDone }: { apply: ApplyPlan; camp: ScaleCampaign; currency: string; cta: string; onDone?: () => void }) {
  const seg = apply?.label || 'the best segment'
  const cmd = cta === 'Review placements'
    ? `Shift budget toward ${seg}: duplicate my winner into a new campaign focused on that placement.`
    : `Duplicate my winner into a new campaign focused on ${seg}.`
  const manage = String(camp?.metaCampaignId || camp?.name || '')
  const href = manage ? `/campaigns?manage=${encodeURIComponent(manage)}&do=${encodeURIComponent(cmd)}` : '/campaigns'
  return <Link href={href} onClick={() => onDone?.()} style={{ alignSelf: 'flex-start', background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', marginTop: 2 }}>{cta} →</Link>
}

export default function BriefOpportunities({ initial, onAct, accountId, initialAccountId, scaleCampaign, currency }: { initial?: Opportunity[]; onAct?: (o: Opportunity) => void; accountId?: string | null; initialAccountId?: string | null; scaleCampaign?: ScaleCampaign | null; currency?: string }) {
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

  // The account these cards are CURRENTLY showing. Stored cards (`initial`) are for `initialAccountId`
  // (the account the nightly audit ran on). If we don't know it (older payload), treat as unknown.
  const shownAccount = useRef<string | null>(hasInitial ? (initialAccountId || null) : null)

  // Show the moves by DEFAULT, not behind a click, and NEVER for the wrong account. If nothing is
  // stored, pull on mount. This is the bridge until every nightly run stores them.
  useEffect(() => {
    if (!hasInitial) { load(accountId || undefined); shownAccount.current = accountId || 'unknown' }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow whatever account the brief resolved (broadcast by the Facebook card). The cards MUST be for
  // the same account as the rest of the brief — a stored ROY-1 card showing under an Aura-Bura brief is
  // exactly the bug we're killing. Refetch whenever the target account differs from what's shown; if it
  // already matches (stored == resolved primary), no call, so we stay off Meta's rate limit.
  useEffect(() => {
    if (!accountId) return
    if (accountId === shownAccount.current) return
    shownAccount.current = accountId
    load(accountId)
  }, [accountId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Not loaded yet → a quiet prompt (no Graph call until tapped).
  if (!loaded) {
    return (
      <div className="bsx-e" style={{ ...card, marginBottom: 24, padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', animationDelay: '.36s' }}>
        <div>
          <div style={{ fontSize: 15.5, fontWeight: 750, color: INK }}>What Mello would do</div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>The ranked moves to improve your ads — pull the latest when you want it.</div>
        </div>
        <button onClick={() => load(accountId)} disabled={busy} style={{ flexShrink: 0, background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 100, padding: '10px 18px', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
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
          <Link href="/reports" style={{ fontSize: 12.5, color: '#ef4a1e', fontWeight: 800, textDecoration: 'none' }}>See the full report →</Link>
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
            {/* The "Scale it" card ACTS — inline budget-confirm → scales on Meta. Every other card
                still links to where the founder finishes the move. */}
            {r.cta === 'Scale it' && scaleCampaign
              ? <ScaleConfirm camp={scaleCampaign} currency={currency || 'USD'} />
              : r.apply && scaleCampaign
              ? <TuneConfirm apply={r.apply} camp={scaleCampaign} currency={currency || 'USD'} cta={r.cta} onDone={() => onAct?.(r)} />
              : <Link href={r.href} onClick={() => onAct?.(r)} style={{ alignSelf: 'flex-start', background: '#ef4a1e', color: '#fff', borderRadius: 100, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', marginTop: 2 }}>{r.cta} →</Link>}
          </div>
        ))}
      </div>

      {ops.length > 3 && (
        <button onClick={() => setShowAll(s => !s)} style={{ marginTop: 12, background: 'none', border: 'none', color: '#ef4a1e', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
          {showAll ? 'Show fewer' : `Show ${ops.length - 3} more move${ops.length - 3 === 1 ? '' : 's'}`} →
        </button>
      )}
    </div>
  )
}
