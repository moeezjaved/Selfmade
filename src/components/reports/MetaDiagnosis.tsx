'use client'
/**
 * MetaDiagnosis — big-visual "Account Diagnosis" report. Once a Meta account is connected, it fetches
 * /api/meta/diagnosis and renders one prominent card per metric (skipping 'unknown'), each with a bold
 * value, a colored verdict pill, the plain-English meaning and the fix — led by a dark HERO stating the
 * single biggest lever. Palette matches ScanTheater (INK / ORANGE / PAPER / DARK). Reduced-motion safe.
 */
import { useEffect, useState, type CSSProperties } from 'react'

// ── Palette (mirrors src/components/scan/ScanTheater.tsx) ──
const INK = '#1a1410', SUB = '#6f665a', LINE = 'rgba(26,20,16,.12)', ORANGE = '#ef4a1e'
const DARK = '#1c1611', CREAM = '#f3ece0', MUT = '#a99f92'

type Verdict = 'good' | 'warn' | 'bad' | 'unknown'
type Diagnosis = { key: string; label: string; value: string; verdict: Verdict; headline: string; meaning: string; fix: string }
type Payload = { connected: boolean; spend?: number; currency?: string; lever?: { headline: string; detail: string }; diagnoses?: Diagnosis[]; error?: string }

// verdict → {pill color, pill text, accent for the fix line}
const V: Record<Exclude<Verdict, 'unknown'>, { color: string; bg: string; text: string }> = {
  good: { color: '#1a7f37', bg: 'rgba(26,127,55,.10)', text: 'HEALTHY' },
  warn: { color: '#b7791f', bg: 'rgba(183,121,31,.12)', text: 'WATCH' },
  bad: { color: '#c0392b', bg: 'rgba(192,57,43,.10)', text: 'BLEEDING' },
}

const REVEAL_CSS = `
@keyframes sfd-rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.sfd-rise{animation:sfd-rise .5s cubic-bezier(.2,.7,.2,1) both}
@keyframes sfd-shim{0%{background-position:-200% 0}100%{background-position:200% 0}}
.sfd-shim{background:linear-gradient(90deg,#efe8da 25%,#f7f1e5 37%,#efe8da 63%);background-size:200% 100%;animation:sfd-shim 1.3s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.sfd-rise{animation:none}.sfd-shim{animation:none}}
`
const rise = (i = 0): CSSProperties => ({ animationDelay: `${i * 60}ms` })

export default function MetaDiagnosis() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/meta/diagnosis')
      .then((r) => r.json())
      .then((j: Payload) => { if (alive) setData(j) })
      .catch(() => { if (alive) setData({ connected: false }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const wrap: CSSProperties = { padding: 28, maxWidth: 1080, margin: '0 auto', overflowX: 'hidden' }

  if (loading) {
    return (
      <div style={wrap}>
        <style>{REVEAL_CSS}</style>
        <div className="sfd-shim" style={{ height: 128, borderRadius: 20, marginBottom: 18 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px,100%),1fr))', gap: 16 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="sfd-shim" style={{ height: 190, borderRadius: 18 }} />)}
        </div>
      </div>
    )
  }

  if (!data || !data.connected) {
    return (
      <div style={wrap}>
        <div style={{ background: '#fff', borderRadius: 20, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 12px 32px -20px rgba(17,24,17,.14)', padding: 56, textAlign: 'center', maxWidth: 520, margin: '48px auto' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🩺</div>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 26, color: INK, letterSpacing: '-.01em', lineHeight: 1.1, marginBottom: 8 }}>Connect Meta to see your account diagnosis</div>
          <div style={{ fontSize: 13.5, color: SUB, lineHeight: 1.55, marginBottom: 22 }}>Link your Facebook ad account and we&apos;ll grade every metric — CPM, CTR, conversion, order value, ROAS — good or bad, in plain English, with the fix.</div>
          <a href="/connect/meta" style={{ display: 'inline-block', background: ORANGE, color: '#fff', textDecoration: 'none', padding: '11px 26px', borderRadius: 100, fontSize: 14, fontWeight: 800 }}>Connect Meta →</a>
        </div>
      </div>
    )
  }

  const cards = (data.diagnoses || []).filter((d) => d.verdict !== 'unknown')

  return (
    <div style={wrap}>
      <style>{REVEAL_CSS}</style>

      {/* HERO — the single biggest lever, dark + prominent */}
      {data.lever && (
        <div className="sfd-rise" style={{ background: DARK, borderRadius: 22, padding: '30px 34px', marginBottom: 20, color: CREAM, position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase', color: ORANGE, marginBottom: 12 }}>Your biggest lever</div>
          <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 36, fontWeight: 400, letterSpacing: '-.01em', lineHeight: 1.08, color: '#fff', marginBottom: 12 }}>{data.lever.headline}</div>
          <div style={{ fontSize: 15, lineHeight: 1.6, color: MUT, maxWidth: 720 }}>{data.lever.detail}</div>
        </div>
      )}

      {/* Metric grid — one BIG visual card per diagnosed metric */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px,100%),1fr))', gap: 16 }}>
        {cards.map((d, i) => {
          const v = V[d.verdict as Exclude<Verdict, 'unknown'>]
          return (
            <div key={d.key} className="sfd-rise" style={{ ...rise(i + 1), background: '#fff', borderRadius: 18, borderTop: `4px solid ${v.color}`, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 12px 32px -20px rgba(17,24,17,.16)', padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* label + big value + verdict pill */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: MUT }}>{d.label}</div>
                  <div style={{ fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 44, fontWeight: 400, letterSpacing: '-.02em', lineHeight: 1, color: INK, marginTop: 6 }}>{d.value}</div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 900, letterSpacing: '.06em', color: v.color, background: v.bg, padding: '6px 12px', borderRadius: 100, marginTop: 4 }}>{v.text}</span>
              </div>

              <div style={{ fontSize: 15, fontWeight: 750, color: INK, lineHeight: 1.3, letterSpacing: '-.01em' }}>{d.headline}</div>
              <div style={{ fontSize: 13, color: SUB, lineHeight: 1.55 }}>{d.meaning}</div>
              <div style={{ fontSize: 13, color: v.color, lineHeight: 1.55, borderTop: `1px solid ${LINE}`, paddingTop: 11 }}>
                <span style={{ fontWeight: 800 }}>Fix:</span> {d.fix}
              </div>
            </div>
          )
        })}
      </div>

      {!cards.length && (
        <div style={{ background: '#fff', borderRadius: 18, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 12px 32px -20px rgba(17,24,17,.14)', padding: 40, textAlign: 'center', color: SUB, fontSize: 13.5 }}>
          Not enough spend yet to diagnose your metrics — check back once your campaigns have run a few days.
        </div>
      )}
    </div>
  )
}
