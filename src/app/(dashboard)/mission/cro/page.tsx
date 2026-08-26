'use client'
/**
 * /mission/cro — the CRO department (v1). Reads the store's homepage + top product page and reports the
 * conversion leaks (reviews, express-pay, shipping, media, trust, offer clarity, copy) — each framed as a
 * CVR/€ impact. Rules + one LLM review. Charges cro_audit credits. Fixes (PDP makeover, template pages)
 * come next.
 */
import { useCallback, useEffect, useState } from 'react'
import { openCredits } from '@/components/credits/CreditModal'

type Finding = { area: 'home' | 'product' | 'global'; severity: 'high' | 'medium' | 'low'; title: string; detail: string; impact?: string; source: 'rule' | 'ai' }
type Audit = { hasData: boolean; site?: string; domain?: string; score?: number; productUrl?: string | null; findings?: Finding[]; note?: string; scannedAt?: string }

const INK = '#141d15', SUB = '#6b776b', LINE = '#e6ebe3', ORANGE = '#ef4a1e'
const SEV = { high: { c: '#b42318', bg: '#fef3f2', b: '#fecdca', label: 'High' }, medium: { c: '#9a6a12', bg: '#fdf6e9', b: '#f3e2c5', label: 'Medium' }, low: { c: '#3f6b4a', bg: '#f0f9f2', b: '#bbe6c6', label: 'Low' } } as const
const AREA = { home: 'Homepage', product: 'Product page', global: 'Store-wide' } as const

export default function CroPage() {
  const [audit, setAudit] = useState<Audit | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const r = await fetch('/api/cro/audit'); const j = await r.json(); if (r.ok) setAudit(j as Audit) } catch { /* empty state */ }
  }, [])
  useEffect(() => { load() }, [load])

  const run = async () => {
    if (busy) return
    setBusy(true); setNote(null)
    try {
      const r = await fetch('/api/cro/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await r.json()
      if (r.ok && j?.hasData) setAudit(j as Audit)
      else if (r.status === 402) openCredits('buy', j.reason || 'A CRO audit costs credits — top up to run it.')
      else if (r.status === 400) setNote(j.note || 'Connect a store or add your website first.')
      else setNote(j.note || j.error || 'Couldn’t run the audit — try again.')
    } catch { setNote('Something went wrong — try again.') } finally { setBusy(false) }
  }

  const findings = audit?.findings || []
  const counts = { high: findings.filter(f => f.severity === 'high').length, medium: findings.filter(f => f.severity === 'medium').length, low: findings.filter(f => f.severity === 'low').length }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px 80px', fontFamily: "'Inter',-apple-system,sans-serif", color: INK }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: '-.02em' }}>Conversion audit</h1>
          <p style={{ fontSize: 14, color: SUB, marginTop: 6, lineHeight: 1.5, maxWidth: 560 }}>Mello reads your homepage and product page and finds what&rsquo;s leaking conversions — each fix framed by its impact on your revenue.</p>
        </div>
        <button onClick={run} disabled={busy} style={{ background: ORANGE, color: '#fff', border: 'none', borderRadius: 100, padding: '11px 22px', fontSize: 14, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Scanning your store…' : audit?.hasData ? 'Re-run audit' : 'Run CRO audit'}
        </button>
      </div>

      {note && <div style={{ marginTop: 16, background: '#fdf6e9', border: '1px solid #f3e2c5', color: '#8a5a1a', borderRadius: 12, padding: '11px 14px', fontSize: 13.5 }}>{note}</div>}

      {!audit?.hasData && !busy && !note && (
        <div style={{ marginTop: 24, border: `1px solid ${LINE}`, borderRadius: 16, padding: 40, textAlign: 'center', color: SUB }}>
          No conversion audit yet. Hit <b style={{ color: INK }}>Run CRO audit</b> and Mello will read your store and list the leaks.
        </div>
      )}

      {audit?.hasData && (
        <div style={{ marginTop: 22 }}>
          {/* score strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 22, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 22px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1, color: (audit.score || 0) >= 75 ? '#3f6b4a' : (audit.score || 0) >= 50 ? '#9a6a12' : '#b42318' }}>{audit.score}<span style={{ fontSize: 18, color: SUB, fontWeight: 700 }}>/100</span></div>
              <div style={{ fontSize: 12, color: SUB, fontWeight: 700, marginTop: 4 }}>Conversion score</div>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{audit.site || audit.domain}</div>
              <div style={{ fontSize: 12.5, color: SUB, marginTop: 4 }}>
                {counts.high} high · {counts.medium} medium · {counts.low} low
                {audit.productUrl && <> · read your homepage + <a href={audit.productUrl} target="_blank" rel="noreferrer" style={{ color: ORANGE, fontWeight: 600 }}>top product page ↗</a></>}
              </div>
            </div>
          </div>

          {/* findings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {findings.map((f, i) => {
              const s = SEV[f.severity]
              return (
                <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 14, padding: '16px 18px', background: '#fff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: s.c, background: s.bg, border: `1px solid ${s.b}`, borderRadius: 100, padding: '2px 9px' }}>{s.label}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: SUB, background: '#f4f6f2', borderRadius: 100, padding: '2px 9px' }}>{AREA[f.area]}</span>
                    <span style={{ fontSize: 15, fontWeight: 750 }}>{f.title}</span>
                  </div>
                  <div style={{ fontSize: 13.5, color: '#3a463a', lineHeight: 1.55 }}>{f.detail}</div>
                  {f.impact && <div style={{ fontSize: 12.5, color: '#3f6b4a', marginTop: 8, background: '#f0f9f2', border: '1px solid #d6ecda', borderRadius: 8, padding: '8px 11px' }}>💸 {f.impact}</div>}
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 18, fontSize: 12, color: SUB, textAlign: 'center' }}>Impact figures are conservative estimates. Fix-it (PDP makeover + built pages) is coming next.</div>
        </div>
      )}
    </div>
  )
}
