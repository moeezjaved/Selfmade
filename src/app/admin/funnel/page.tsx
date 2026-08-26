'use client'
import { useEffect, useState } from 'react'

interface Step { label: string; count: number; pct: number }
interface AnonAudit { domain: string; site_name: string | null; score: number | null; category: string | null; created_at: string }

const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a']

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function FunnelBars({ steps, denomLabel }: { steps: Step[]; denomLabel: string }) {
  if (!steps.length) return null
  return (
    <>
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e8e8e8', padding: '32px', marginBottom: '20px' }}>
        {steps.map((step, i) => (
          <div key={step.label} style={{ marginBottom: i < steps.length - 1 ? '8px' : '0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '6px' }}>
              <div style={{ width: '180px', fontSize: '13px', fontWeight: '600', color: '#333', flexShrink: 0 }}>{step.label}</div>
              <div style={{ flex: 1, background: '#f3f4f6', borderRadius: '6px', height: '36px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.max(step.pct, 2)}%`, background: COLORS[i % COLORS.length], borderRadius: '6px', display: 'flex', alignItems: 'center', paddingLeft: '12px', transition: 'width 0.8s ease' }}>
                  <span style={{ color: '#fff', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>{step.count.toLocaleString()}</span>
                </div>
              </div>
              <div style={{ width: '54px', textAlign: 'right', fontSize: '14px', fontWeight: '700', color: COLORS[i % COLORS.length], flexShrink: 0 }}>{step.pct}%</div>
            </div>
            {i < steps.length - 1 && steps[i + 1] && (
              <div style={{ marginLeft: '196px', marginBottom: '4px' }}>
                <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: '600' }}>
                  ↓ {steps[i].count - steps[i + 1].count > 0 ? `${(steps[i].count - steps[i + 1].count).toLocaleString()} dropped (${steps[i].pct - steps[i + 1].pct}%)` : 'no drop'}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, 1fr)`, gap: '12px', marginBottom: '36px' }}>
        {steps.map((step, i) => (
          <div key={step.label} style={{ background: '#fff', borderRadius: '12px', border: `1px solid ${COLORS[i % COLORS.length]}30`, padding: '20px', borderTop: `3px solid ${COLORS[i % COLORS.length]}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: COLORS[i % COLORS.length], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>{step.label}</div>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#111', lineHeight: 1 }}>{step.count.toLocaleString()}</div>
            <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>{step.pct}% of {denomLabel}</div>
          </div>
        ))}
      </div>
    </>
  )
}

const scoreColor = (s: number | null) => s == null ? '#9ca3af' : s >= 70 ? '#16a34a' : s >= 45 ? '#d97706' : '#dc2626'

export default function FunnelPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [auditFunnel, setAuditFunnel] = useState<Step[]>([])
  const [anon, setAnon] = useState<AnonAudit[]>([])
  const [anonCount, setAnonCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/funnel')
      .then(r => r.json())
      .then(d => {
        setSteps(d.steps || [])
        setAuditFunnel(d.auditFunnel || [])
        setAnon(d.anonymousAudits || [])
        setAnonCount(d.anonymousAuditsCount || 0)
        setLoading(false)
      })
  }, [])

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#111', margin: '0 0 6px' }}>Conversion Funnel</h1>
      <p style={{ color: '#888', fontSize: '14px', margin: '0 0 32px' }}>From the free audit theater to a paying customer</p>

      {loading ? <div style={{ color: '#aaa', fontSize: '14px' }}>Loading…</div> : (
        <>
          {/* Audit → activation funnel (primary) */}
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 4px' }}>Audit → Activation</h2>
          <p style={{ color: '#999', fontSize: '13px', margin: '0 0 16px' }}>Everyone who finished the free audit, and how far they got.</p>
          <FunnelBars steps={auditFunnel} denomLabel="audits" />

          {/* Completed the audit but never signed up */}
          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e8e8e8', overflow: 'hidden', marginBottom: 36 }}>
            <div style={{ padding: '18px 20px 8px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: 0 }}>
                Completed audit — never signed up <span style={{ color: '#dc2626' }}>({anonCount.toLocaleString()})</span>
              </h2>
              <p style={{ color: '#999', fontSize: '13px', margin: '4px 0 0' }}>Hot leads: they scanned their store but never made an account. {anonCount > anon.length ? `Showing the latest ${anon.length}.` : ''}</p>
            </div>
            {anon.length === 0 ? (
              <div style={{ padding: '24px 20px', color: '#aaa', fontSize: 13 }}>No unclaimed audits yet — everyone who scanned has signed up.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafafa', borderTop: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0' }}>
                    {['Domain', 'Store', 'Category', 'Score', 'Scanned'].map(h => (
                      <th key={h} style={{ padding: '9px 20px', textAlign: 'left', color: '#999', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {anon.map((a, i) => (
                    <tr key={a.domain + i} style={{ borderBottom: '1px solid #f6f6f6' }}>
                      <td style={{ padding: '10px 20px' }}>
                        <a href={`https://${a.domain}`} target="_blank" rel="noreferrer" style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 600 }}>{a.domain}</a>
                      </td>
                      <td style={{ padding: '10px 20px', color: '#333' }}>{a.site_name || '—'}</td>
                      <td style={{ padding: '10px 20px', color: '#777' }}>{a.category || '—'}</td>
                      <td style={{ padding: '10px 20px' }}>
                        <span style={{ fontWeight: 800, color: scoreColor(a.score) }}>{a.score ?? '—'}</span>
                      </td>
                      <td style={{ padding: '10px 20px', color: '#888' }}>{fmt(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Legacy M4 ads funnel */}
          <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: '0 0 4px' }}>Ads funnel (M4)</h2>
          <p style={{ color: '#999', fontSize: '13px', margin: '0 0 16px' }}>The older signup → launch → scale → paid journey.</p>
          <FunnelBars steps={steps} denomLabel="signups" />
        </>
      )}
    </div>
  )
}
