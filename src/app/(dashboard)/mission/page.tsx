'use client'
/**
 * /mission — the founder's "next moves" desk, powered by the Strategist (POST /api/mello/strategist).
 * The "+ New Task" button asks Mello's founder-brain to reason over the account and draft the next
 * high-impact tasks. A task the account can't run yet (e.g. Meta not connected — the "launch your first
 * campaign" blueprint) routes to Connect Meta. Additive page; it only generates SUGGESTED tasks.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'

const INK = '#1c1710', SUB = '#6f665a', MUT = '#a49a89', LINE = '#e2d9c4', LINE2 = '#d3c8ae'
const PAPER = '#f6f1e6', CARD = '#fffdf8', CARD2 = '#f8f3e7'
const FLAME = '#ef4a1e', LIVE = '#1f8a53', RUN = '#2f6df0', WAIT = '#c07d17'

type Task = { title: string; lever: string; dept: string; why: string; steps: string[]; hypothesis: string; impact: string; runnable: boolean; needs?: 'meta' | 'shopify' | 'klaviyo' | null; suggested_key: string }
const CONNECT: Record<string, { label: string; href: string }> = {
  meta: { label: 'Connect Meta to launch →', href: '/connect/meta' },
  shopify: { label: 'Connect Shopify to fix this →', href: '/connect/shopify' },
  klaviyo: { label: 'Connect Klaviyo to send →', href: '/settings' },
}
type Plan = { stage: string; headline: string; tasks: Task[]; grounding?: string[] }

const STAGE_LABEL: Record<string, string> = { setup: 'Setup', 'first-cycle': 'First cycle', running: 'Running', scaling: 'Scaling' }
const LEVER_COLOR: Record<string, string> = { traffic: RUN, conversion: FLAME, aov: WAIT, retention: '#7a52c0', efficiency: LIVE, brand: '#b06a2c' }

export default function MissionPage() {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState(0)
  const [open, setOpen] = useState<string | null>(null)

  const STEPS = ['Reviewing your funnel + backlog…', 'Benchmarking against your competitors…', 'Diagnosing your biggest constraint…', 'Drafting your highest-impact moves…']

  const fetchPlan = useCallback(async () => {
    setLoading(true); setStep(0)
    const iv = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600)
    try {
      const r = await fetch('/api/mello/strategist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ persist: true }) })
      const j = await r.json()
      if (r.ok && Array.isArray(j?.tasks)) setPlan(j as Plan)
      else setPlan({ stage: 'setup', headline: j?.error ? 'Mello couldn’t reach your data just now — try again.' : 'No plan yet.', tasks: [] })
    } catch { setPlan({ stage: 'setup', headline: 'Something went wrong reaching Mello. Try again.', tasks: [] }) }
    clearInterval(iv); setLoading(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchPlan() }, [fetchPlan])

  return (
    <div style={{ background: PAPER, minHeight: '100%', color: INK, fontFamily: 'Inter,system-ui,sans-serif', padding: 'clamp(18px,3vw,32px)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={{ fontFamily: 'Fraunces,Georgia,serif', fontWeight: 600, fontSize: 26, letterSpacing: '-.02em' }}>Your next moves</div>
            <div style={{ fontSize: 13, color: SUB, marginTop: 2 }}>Drafted by Mello — grounded in your data, not generic tips.</div>
          </div>
          {plan && !loading && (
            <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: FLAME, background: 'rgba(239,74,30,.08)', border: '1px solid rgba(239,74,30,.22)', borderRadius: 100, padding: '4px 11px' }}>
              Stage · {STAGE_LABEL[plan.stage] || plan.stage}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={fetchPlan} disabled={loading} style={btnDark(loading)}>{loading ? 'Thinking…' : '+ New moves'}</button>
        </div>

        {/* diagnosis headline */}
        {plan && !loading && plan.headline && (
          <div style={{ fontFamily: 'Fraunces,Georgia,serif', fontStyle: 'italic', fontWeight: 500, fontSize: 'clamp(19px,2.8vw,26px)', lineHeight: 1.25, letterSpacing: '-.01em', color: INK, margin: '4px 0 22px', maxWidth: 720 }}>
            “{plan.headline}”
          </div>
        )}

        {/* loading */}
        {loading && (
          <div style={{ background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: 24 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', opacity: i <= step ? 1 : .35, transition: 'opacity .3s', fontFamily: 'ui-monospace,monospace', fontSize: 13, color: i < step ? LIVE : i === step ? INK : MUT }}>
                <span>{i < step ? '✓' : i === step ? '▸' : '·'}</span> {s}
              </div>
            ))}
          </div>
        )}

        {/* tasks */}
        {!loading && plan && plan.tasks.map((t, i) => {
          const lc = LEVER_COLOR[t.lever] || SUB
          const isOpen = open === t.suggested_key
          const connect = t.needs ? CONNECT[t.needs] : null
          const highlight = !!connect
          return (
            <div key={t.suggested_key || i} style={{ background: CARD, border: `1px solid ${highlight ? FLAME : LINE}`, boxShadow: highlight ? '0 0 0 3px rgba(239,74,30,.07)' : 'none', borderRadius: 14, padding: 17, marginBottom: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
                <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: lc, background: `${lc}18`, borderRadius: 100, padding: '3px 9px' }}>{t.lever}</span>
                <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, letterSpacing: '.05em', textTransform: 'uppercase', color: MUT }}>{t.dept}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace,monospace', fontSize: 12, fontWeight: 700, color: t.impact.includes('$') ? LIVE : SUB }}>{t.impact}</span>
              </div>
              <div style={{ fontFamily: 'Fraunces,Georgia,serif', fontWeight: 600, fontSize: 17, letterSpacing: '-.01em', lineHeight: 1.2, marginBottom: 6 }}>{t.title}</div>
              <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.5, marginBottom: 12 }}>{t.why}</div>

              {isOpen && (t.steps.length > 0 || t.hypothesis) && (
                <div style={{ background: CARD2, border: `1px solid ${LINE}`, borderRadius: 11, padding: '14px 16px', marginBottom: 12 }}>
                  {t.steps.length > 0 && <>
                    <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10, letterSpacing: '.06em', color: MUT, marginBottom: 8 }}>THE BRIEF</div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55, color: INK }}>{t.steps.map((s, j) => <li key={j} style={{ marginBottom: 5 }}>{s}</li>)}</ol>
                  </>}
                  {t.hypothesis && <div style={{ fontSize: 13, color: SUB, marginTop: t.steps.length ? 10 : 0, fontStyle: 'italic' }}><b style={{ color: INK, fontStyle: 'normal' }}>Bet:</b> {t.hypothesis}</div>}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {connect
                  ? <a href={connect.href} style={btnFlame()}>{connect.label}</a>
                  : t.runnable
                    ? <button style={btnFlame()}>Approve &amp; run →</button>
                    : <button onClick={() => setOpen(t.suggested_key)} style={btnFlame()}>Get the brief →</button>}
                <button onClick={() => setOpen(isOpen ? null : t.suggested_key)} style={btnGhost()}>{isOpen ? 'Hide brief' : 'Open brief'}</button>
              </div>
            </div>
          )
        })}

        {!loading && plan && plan.tasks.length === 0 && (
          <div style={{ color: SUB, fontSize: 15, padding: '30px 0' }}>No moves yet. Tap <b>+ New moves</b> and Mello will draft your highest-impact next steps.</div>
        )}

        <div style={{ marginTop: 22, fontFamily: 'ui-monospace,monospace', fontSize: 11, color: MUT }}>Approve mode · nothing runs or spends without your yes.</div>
      </div>
    </div>
  )
}

const btnDark = (dis: boolean): CSSProperties => ({ fontFamily: 'ui-monospace,monospace', fontSize: 12, fontWeight: 700, letterSpacing: '.03em', background: dis ? MUT : INK, color: PAPER, border: 'none', borderRadius: 8, padding: '10px 16px', cursor: dis ? 'default' : 'pointer' })
const btnFlame = (): CSSProperties => ({ fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 700, background: FLAME, color: '#fff', border: 'none', borderRadius: 100, padding: '9px 18px', cursor: 'pointer', textDecoration: 'none', display: 'inline-block' })
const btnGhost = (): CSSProperties => ({ fontFamily: 'Inter,sans-serif', fontSize: 13, fontWeight: 600, background: 'transparent', color: INK, border: `1px solid ${LINE2}`, borderRadius: 100, padding: '9px 16px', cursor: 'pointer' })
