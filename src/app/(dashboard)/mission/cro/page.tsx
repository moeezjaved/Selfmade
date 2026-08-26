'use client'
/**
 * /mission/cro — the CRO department: a forensic conversion audit of the store (homepage + product page),
 * rendered as score → biggest leaks → highest-impact changes → new homepage structure → PDP changes →
 * ranked A/B tests → the single first move. Powered by rules (ground truth) + vision + an expert prompt.
 */
import { useCallback, useEffect, useState } from 'react'
import { openCredits } from '@/components/credits/CreditModal'

type Leak = { title: string; why: string; fix: string }
type Change = { title: string; detail: string; impact: string }
type HomeSection = { section: string; why: string; content?: string }
type PdpChange = { change: string; why: string }
type AbTest = { name: string; hypothesis: string; impact: string }
type Report = {
  hasData: boolean; domain?: string; site?: string; productUrl?: string | null; score?: number; verdict?: string
  leaks?: Leak[]; changes?: Change[]; homepage?: HomeSection[]; productPage?: PdpChange[]; abtests?: AbTest[]; firstChange?: string
  usedVision?: boolean; note?: string
}

const INK = '#141d15', SUB = '#6b776b', LINE = '#e6ebe3', ORANGE = '#ef4a1e'
const scoreColor = (s: number) => s >= 75 ? '#3f6b4a' : s >= 50 ? '#9a6a12' : '#b42318'

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '18px 20px', background: '#fff', ...style }}>{children}</div>
}
function SectionTitle({ n, children }: { n: string; children: React.ReactNode }) {
  return <h2 style={{ fontSize: 17, fontWeight: 800, margin: '30px 0 12px', display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 24, height: 24, borderRadius: 7, background: '#f4f0e7', color: ORANGE, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 }}>{n}</span>{children}</h2>
}

export default function CroPage() {
  const [r, setR] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => { try { const res = await fetch('/api/cro/audit'); const j = await res.json(); if (res.ok) setR(j as Report) } catch { /* empty */ } }, [])
  useEffect(() => { load() }, [load])

  const run = async () => {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const res = await fetch('/api/cro/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await res.json()
      if (res.ok && j?.hasData) setR(j as Report)
      else if (res.status === 402) openCredits('buy', j.reason || 'A CRO audit costs credits — top up to run it.')
      else if (res.status === 400) setNote(j.note || 'Connect a store or add your website first.')
      else setNote(j.note || j.error || 'Couldn’t run the audit — try again.')
    } catch { setNote('Something went wrong — try again.') } finally { setBusy(false) }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px 90px', fontFamily: "'Inter',-apple-system,sans-serif", color: INK }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: '-.02em' }}>Conversion audit</h1>
          <p style={{ fontSize: 14, color: SUB, marginTop: 6, lineHeight: 1.5, maxWidth: 580 }}>A forensic CRO teardown of your store — brutally honest. Where you leak sales, the highest-impact fixes, the exact pages to build, and what to test first.</p>
        </div>
        <button onClick={run} disabled={busy} style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Auditing your store…' : r?.hasData ? 'Re-run audit' : 'Run CRO audit'}
        </button>
      </div>

      {note && <div style={{ marginTop: 16, background: '#fdf6e9', border: '1px solid #f3e2c5', color: '#8a5a1a', borderRadius: 12, padding: '11px 14px', fontSize: 13.5 }}>{note}</div>}
      {busy && <div style={{ marginTop: 16, fontSize: 13.5, color: SUB }}>Reading your homepage + product page{r?.usedVision === false ? '' : ' (and the rendered design)'} — this takes ~30–60s.</div>}

      {!r?.hasData && !busy && !note && (
        <div style={{ marginTop: 24, border: `1px solid ${LINE}`, borderRadius: 16, padding: 40, textAlign: 'center', color: SUB }}>
          No audit yet. Hit <b style={{ color: INK }}>Run CRO audit</b> and Mello tears down your store like a world-class CRO expert.
        </div>
      )}

      {r?.hasData && (
        <div style={{ marginTop: 22 }}>
          {/* score + verdict */}
          <Card style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 46, fontWeight: 900, lineHeight: 1, color: scoreColor(r.score || 0) }}>{r.score}<span style={{ fontSize: 18, color: SUB, fontWeight: 700 }}>/100</span></div>
              <div style={{ fontSize: 11.5, color: SUB, fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>CRO score</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 15, fontWeight: 750, lineHeight: 1.4 }}>{r.verdict}</div>
              <div style={{ fontSize: 12.5, color: SUB, marginTop: 6 }}>{r.site || r.domain}{r.productUrl && <> · analyzed your homepage + <a href={r.productUrl} target="_blank" rel="noreferrer" style={{ color: ORANGE, fontWeight: 600 }}>top product page ↗</a></>}{r.usedVision ? ' · incl. rendered design' : ''}</div>
            </div>
          </Card>

          {r.firstChange && (
            <Card style={{ marginTop: 14, background: '#fff7f4', borderColor: `${ORANGE}44` }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: ORANGE }}>⚡ Do this first</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6, lineHeight: 1.5 }}>{r.firstChange}</div>
            </Card>
          )}

          {!!r.leaks?.length && (<>
            <SectionTitle n="1">The 5 biggest conversion leaks</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {r.leaks.map((l, i) => (
                <Card key={i}>
                  <div style={{ fontSize: 15, fontWeight: 750 }}>{i + 1}. {l.title}</div>
                  <div style={{ fontSize: 13.5, color: '#a5342c', marginTop: 6, lineHeight: 1.5 }}><b>Why it costs sales:</b> {l.why}</div>
                  <div style={{ fontSize: 13.5, color: '#3a463a', marginTop: 6, lineHeight: 1.5 }}><b style={{ color: '#3f6b4a' }}>Replace with:</b> {l.fix}</div>
                </Card>
              ))}
            </div>
          </>)}

          {!!r.changes?.length && (<>
            <SectionTitle n="2">The 5 highest-impact changes</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {r.changes.map((c, i) => (
                <Card key={i}>
                  <div style={{ fontSize: 15, fontWeight: 750 }}>{c.title}</div>
                  <div style={{ fontSize: 13.5, color: '#3a463a', marginTop: 6, lineHeight: 1.5 }}>{c.detail}</div>
                  {c.impact && <div style={{ fontSize: 12.5, color: '#3f6b4a', marginTop: 8, background: '#f0f9f2', border: '1px solid #d6ecda', borderRadius: 8, padding: '7px 11px' }}>💸 {c.impact}</div>}
                </Card>
              ))}
            </div>
          </>)}

          {!!r.homepage?.length && (<>
            <SectionTitle n="3">Your exact new homepage structure</SectionTitle>
            <Card>
              {r.homepage.map((h, i) => (
                <div key={i} style={{ padding: '12px 0', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                  <div style={{ fontSize: 14.5, fontWeight: 750 }}><span style={{ color: ORANGE, fontWeight: 900, marginRight: 8 }}>{i + 1}</span>{h.section}</div>
                  <div style={{ fontSize: 13, color: SUB, marginTop: 4, lineHeight: 1.5 }}>{h.why}</div>
                  {h.content && <div style={{ fontSize: 13, color: '#3a463a', marginTop: 6, background: '#f7f9f6', borderRadius: 8, padding: '8px 11px', lineHeight: 1.5 }}>{h.content}</div>}
                </div>
              ))}
            </Card>
          </>)}

          {!!r.productPage?.length && (<>
            <SectionTitle n="4">Exact product-page changes</SectionTitle>
            <Card>
              {r.productPage.map((p, i) => (
                <div key={i} style={{ padding: '10px 0', borderTop: i ? `1px solid ${LINE}` : 'none' }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>✓ {p.change}</div>
                  <div style={{ fontSize: 12.5, color: SUB, marginTop: 3, lineHeight: 1.5 }}>{p.why}</div>
                </div>
              ))}
            </Card>
          </>)}

          {!!r.abtests?.length && (<>
            <SectionTitle n="5">A/B tests to run — ranked by revenue impact</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {r.abtests.map((t, i) => (
                <Card key={i}>
                  <div style={{ fontSize: 14.5, fontWeight: 750 }}><span style={{ color: ORANGE, fontWeight: 900, marginRight: 8 }}>#{i + 1}</span>{t.name}</div>
                  <div style={{ fontSize: 13, color: '#3a463a', marginTop: 5, lineHeight: 1.5 }}>{t.hypothesis}</div>
                  {t.impact && <div style={{ fontSize: 12.5, color: '#3f6b4a', marginTop: 6 }}>Expected: {t.impact}</div>}
                </Card>
              ))}
            </div>
          </>)}

          <div style={{ marginTop: 20, fontSize: 12, color: SUB, textAlign: 'center' }}>Estimates are conservative. Next: one-click PDP makeover + built pages that ship these fixes.</div>
        </div>
      )}
    </div>
  )
}
