'use client'
/**
 * DnaReveal — the onboarding "wow": after we detect a founder's competitors, we show the DNA of
 * what's WINNING in their market (proven long-runners), the gaps they can own, and 1–3 ads to make.
 * Powered by /api/onboarding/dna (the L1–L3 DNA engine). Self-contained; parent passes competitors
 * + brand and an onDone() to advance the interview.
 *
 * SCOPE: onboarding only, for now. Not wired anywhere else.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'

const INK = '#161c17', MUTED = '#6f6d5a', LINE = '#efece2', ORANGE = '#ef4a1e', PAPER = '#fffdf4'

type Comp = { pageId: string; name: string }
type Tally = { label: string; count: number; pct: number }
type Example = { adId: string; brand: string; daysRunning: number; hook: string; format: string | null; thumb: string | null }
type Finding = { type: 'gap' | 'strength' | 'note'; title: string; detail: string }
type Prescription = { title: string; hook: string; angle: string; persona: string; offer: string; format: string; rationale: string }
type Result = {
  winners: { dist: Record<string, Tally[]>; sampleSize: number; winnerCount: number; examples: Example[] }
  own: { found: boolean; totalAds: number }
  report: { findings: Finding[]; prescriptions: Prescription[]; confidence: 'high' | 'medium' | 'low' }
}

const LOADING = [
  'Opening the Ad Library…',
  'Pulling every ad your rivals run…',
  'Keeping only the proven winners (running 90+ days)…',
  'Reading their hooks, angles and offers…',
  'Finding the gaps you can own…',
]

export default function DnaReveal({ comps, brand, niche, onDone }: { comps: Comp[]; brand: string; niche?: string | null; onDone: () => void }) {
  const [res, setRes] = useState<Result | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const tick = setInterval(() => setStep((s) => Math.min(s + 1, LOADING.length - 1)), 1400)
    fetch('/api/onboarding/dna', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brandName: brand, competitorPageIds: comps.map((c) => c.pageId), niche: niche || null }),
    })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'failed'); return r.json() })
      .then((j: Result) => setRes(j))
      .catch((e) => setErr(String(e.message || e)))
      .finally(() => clearInterval(tick))
    return () => clearInterval(tick)
  }, [brand, comps, niche])

  // ── loading theater ──
  if (!res && !err) {
    return (
      <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: INK, letterSpacing: '-.01em' }}>Spying on your market…</div>
        <p style={{ color: MUTED, fontSize: 14, margin: '6px 0 22px' }}>Watching {comps.length} competitor{comps.length === 1 ? '' : 's'} you just picked.</p>
        <div style={{ maxWidth: 380, margin: '0 auto', textAlign: 'left' }}>
          {LOADING.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', opacity: i <= step ? 1 : 0.35, transition: 'opacity .3s' }}>
              <span style={{ width: 16, textAlign: 'center', color: i < step ? ORANGE : MUTED, fontWeight: 800 }}>{i < step ? '✓' : '·'}</span>
              <span style={{ fontSize: 14, color: i <= step ? INK : MUTED }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (err) {
    return (
      <div style={{ textAlign: 'center', padding: '10px 0' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: INK }}>Couldn’t finish the market scan.</div>
        <p style={{ color: MUTED, fontSize: 14, margin: '6px 0 18px' }}>No problem — we’ll gather this in your first standup instead.</p>
        <button onClick={onDone} style={btnMain}>Continue →</button>
      </div>
    )
  }

  const r = res!
  const topHooks = r.winners.dist.hook_type || []
  const topFormats = r.winners.dist.format_style || []
  const thin = r.report.confidence === 'low'

  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, color: INK, letterSpacing: '-.015em' }}>
        Here’s what’s <span style={{ color: ORANGE }}>winning</span> in your market.
      </div>
      <p style={{ color: MUTED, fontSize: 14.5, margin: '6px 0 4px' }}>
        From {r.winners.sampleSize.toLocaleString()} of your rivals’ ads, {r.winners.winnerCount.toLocaleString()} have run 90+ days — proven money-makers. The patterns they share are the gaps you can own.
      </p>
      {thin && <p style={{ color: MUTED, fontSize: 12.5, fontStyle: 'italic', margin: '0 0 10px' }}>Early read — we’ll sharpen this as we track them.</p>}

      {/* proof: the actual long-runners */}
      {r.winners.examples.length > 0 && (
        <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '14px 0 6px', margin: '8px 0' }}>
          {r.winners.examples.map((ex) => (
            <div key={ex.adId} style={{ flex: '0 0 132px', width: 132, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ height: 92, background: '#f1ece2', backgroundImage: ex.thumb ? `url(${ex.thumb})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              <div style={{ padding: '8px 9px 10px' }}>
                <div style={{ fontFamily: 'ui-monospace,monospace', fontSize: 10.5, fontWeight: 700, color: ORANGE }}>{ex.daysRunning}d running</div>
                <div style={{ fontSize: 11, color: INK, lineHeight: 1.3, marginTop: 3, maxHeight: 44, overflow: 'hidden' }}>{ex.hook || ex.brand}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* winning-DNA chips */}
      {(topHooks.length > 0 || topFormats.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, margin: '6px 0 4px' }}>
          {topHooks.slice(0, 4).map((h) => (
            <span key={h.label} style={chip}>{h.label} <b style={{ color: ORANGE }}>{h.pct}%</b></span>
          ))}
          {topFormats.slice(0, 2).map((f) => (
            <span key={f.label} style={chip}>{f.label} <b style={{ color: ORANGE }}>{f.pct}%</b></span>
          ))}
        </div>
      )}

      {/* findings */}
      {r.report.findings.length > 0 && (
        <div style={{ margin: '20px 0 6px' }}>
          <div style={label}>What you’re missing</div>
          {r.report.findings.map((f, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < r.report.findings.length - 1 ? `1px solid ${LINE}` : 'none' }}>
              <span style={{ flex: 'none', color: ORANGE, fontWeight: 900 }}>{f.type === 'strength' ? '✓' : '→'}</span>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{f.title}</div>
                <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.45 }}>{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* prescriptions — the ads to make */}
      {r.report.prescriptions.length > 0 && (
        <div style={{ margin: '22px 0 6px' }}>
          <div style={label}>Ads we’ll make first</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {r.report.prescriptions.map((p, i) => (
              <div key={i} style={{ background: '#211a13', borderRadius: 14, padding: '16px 18px', color: '#f3ece0' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 8 }}>{p.title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
                  {[['Hook', p.hook], ['Format', p.format], ['Persona', p.persona], ['Offer', p.offer]].filter(([, v]) => v).map(([k, v]) => (
                    <span key={k as string} style={{ fontSize: 11.5, background: 'rgba(255,255,255,.08)', borderRadius: 7, padding: '4px 9px' }}><b style={{ color: '#ff9f7a' }}>{k}:</b> {v}</span>
                  ))}
                </div>
                <div style={{ fontSize: 12.5, color: '#a99f92', lineHeight: 1.45 }}>{p.rationale}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 22 }}>
        <button onClick={onDone} style={btnMain}>Got it — keep going →</button>
      </div>
    </div>
  )
}

const btnMain: CSSProperties = { background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '13px 28px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }
const chip: CSSProperties = { fontSize: 12.5, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 100, padding: '5px 12px', color: INK }
const label: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '.09em', color: MUTED, textTransform: 'uppercase', marginBottom: 8, textAlign: 'left' }
