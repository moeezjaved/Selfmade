'use client'
import { useEffect, useState } from 'react'

interface Step { label: string; count: number; pct: number }

export default function FunnelPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/funnel')
      .then(r => r.json())
      .then(d => { setSteps(d.steps || []); setLoading(false) })
  }, [])

  const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a']
  const DROP_ICONS = ['→', '→', '→', '→']

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#111', margin: '0 0 6px' }}>Conversion Funnel</h1>
      <p style={{ color: '#888', fontSize: '14px', margin: '0 0 32px' }}>Where users drop off on their journey to paying</p>

      {loading ? (
        <div style={{ color: '#aaa', fontSize: '14px' }}>Loading…</div>
      ) : (
        <>
          {/* Visual funnel bars */}
          <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #e8e8e8', padding: '32px', marginBottom: '24px' }}>
            {steps.map((step, i) => (
              <div key={step.label} style={{ marginBottom: i < steps.length - 1 ? '8px' : '0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '6px' }}>
                  <div style={{ width: '160px', fontSize: '13px', fontWeight: '600', color: '#333', flexShrink: 0 }}>{step.label}</div>
                  <div style={{ flex: 1, background: '#f3f4f6', borderRadius: '6px', height: '36px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.max(step.pct, 2)}%`,
                      background: COLORS[i], borderRadius: '6px',
                      display: 'flex', alignItems: 'center', paddingLeft: '12px',
                      transition: 'width 0.8s ease',
                    }}>
                      <span style={{ color: '#fff', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                        {step.count.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div style={{ width: '60px', textAlign: 'right', fontSize: '14px', fontWeight: '700', color: COLORS[i], flexShrink: 0 }}>
                    {step.pct}%
                  </div>
                </div>

                {/* Drop-off indicator */}
                {i < steps.length - 1 && steps[i + 1] && (
                  <div style={{ marginLeft: '176px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: '600' }}>
                      ↓ {steps[i].count - steps[i + 1].count > 0 ? `${steps[i].count - steps[i + 1].count} dropped (${steps[i].pct - steps[i + 1].pct}%)` : 'no drop'}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Step cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
            {steps.map((step, i) => (
              <div key={step.label} style={{ background: '#fff', borderRadius: '12px', border: `1px solid ${COLORS[i]}30`, padding: '20px', borderTop: `3px solid ${COLORS[i]}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: COLORS[i], textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>{step.label}</div>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#111', lineHeight: 1 }}>{step.count.toLocaleString()}</div>
                <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>{step.pct}% of signups</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
