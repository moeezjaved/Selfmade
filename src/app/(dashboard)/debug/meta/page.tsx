'use client'
/**
 * Phase 2.1 — Meta Reality Check (internal QA surface, not a product feature). Renders the golden-question
 * matrix from /api/debug/meta-parity so a real account can be verified: Mello's answer + the raw canonical
 * numbers per period, side by side, with an empty "Ads Manager" column to fill in by eye. Brief == Mello ==
 * Meta is the pass condition.
 */
import { useEffect, useState } from 'react'

export default function MetaReality() {
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    fetch('/api/debug/meta-parity').then(r => r.json()).then(j => { if (j.error) setErr(j.note || j.error); else setD(j) }).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }, [])

  const wrap: React.CSSProperties = { fontFamily: "'Inter',sans-serif", maxWidth: 980, margin: '0 auto', padding: '28px 24px', color: '#141d15' }
  const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em', color: '#6f7d70', padding: '8px 10px', borderBottom: '1px solid #e6e6e6' }
  const td: React.CSSProperties = { fontSize: 13, padding: '9px 10px', borderBottom: '1px solid #f0f2ef', verticalAlign: 'top' }

  if (loading) return <div style={wrap}><div className="selfmade-loading" style={{ width: 40, height: 40, borderRadius: 11 }} /><div style={{ marginTop: 12, color: '#6f7d70' }}>Running the golden matrix against your live account…</div></div>
  if (err) return <div style={wrap}><h1 style={{ fontSize: 22, fontWeight: 800 }}>Meta Reality Check</h1><div style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div></div>

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Meta Reality Check</h1>
      <p style={{ color: '#6f7d70', fontSize: 14, margin: '6px 0 4px' }}>Account <b style={{ color: '#141d15' }}>{d.account?.name || d.account?.id}</b> · {d.account?.currency} · fetched {new Date(d.fetchedAt).toLocaleTimeString()}</p>
      <div style={{ fontSize: 12.5, color: '#6f7d70', background: '#f7faf3', border: '1px solid #e6efdc', borderRadius: 10, padding: '10px 12px', margin: '10px 0 20px', lineHeight: 1.5 }}>
        {d.howToVerify}<br /><b style={{ color: '#92400e' }}>Note:</b> {d.caveat}
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: '18px 0 6px' }}>Raw canonical numbers (compare each to Ads Manager)</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Period</th><th style={th}>Spend</th><th style={th}>ROAS</th><th style={th}>Revenue</th><th style={th}>Purchases</th><th style={th}>Impr.</th><th style={th}>Clicks</th><th style={th}>CTR</th><th style={th}>CPC</th><th style={th}>CPM</th><th style={th}>Ads Mgr ✍️</th></tr></thead>
          <tbody>{d.raw.map((r: any, i: number) => (
            <tr key={i}>
              <td style={td}><b>{r.period}</b><div style={{ color: '#9aa79a', fontSize: 11 }}>{r.preset}</div></td>
              {r.error ? <td style={td} colSpan={9}>{r.error}</td> : <>
                <td style={td}>{r.currency} {r.spend?.toLocaleString?.()}</td><td style={td}>{r.roas}x</td><td style={td}>{r.revenue?.toLocaleString?.()}</td><td style={td}>{r.purchases?.toLocaleString?.()}</td>
                <td style={td}>{r.impressions?.toLocaleString?.()}</td><td style={td}>{r.clicks?.toLocaleString?.()}</td><td style={td}>{r.ctr}%</td><td style={td}>{r.cpc}</td><td style={td}>{r.cpm}</td>
              </>}
              <td style={{ ...td, color: '#c9c9c9' }}>—</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 15, fontWeight: 800, margin: '26px 0 6px' }}>Mello's answers (the real pipeline)</h2>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Group</th><th style={th}>Question</th><th style={th}>Mello</th></tr></thead>
          <tbody>{d.answers.map((r: any, i: number) => (
            <tr key={i}><td style={{ ...td, textTransform: 'capitalize', color: '#6f7d70' }}>{r.group}</td><td style={td}>{r.question}</td><td style={td}>{r.mello}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
