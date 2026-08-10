'use client'
/**
 * LaunchReport — Motion's "New Launches" (Sprints/launch-tracking) engine, engine type C.
 * Tracks ads by launch date against an editable Goal (ROAS + spend), shows a Launched → Scaled →
 * Winners funnel, and lists creatives grouped into collapsible launch-week cohorts. Distinct header
 * from the standard report (Goal + Launched window + separate Performance window). Fetches
 * /api/reports/launch. Save/back reuse the same plumbing as GeneratedReport.
 */
import { useState, useEffect, useCallback } from 'react'
import { METRICS, type MetricKey } from '@/lib/reports/templates'
import MetricPicker from './MetricPicker'

const FONT = 'inherit'
const cdn = (u?: string | null, w = 120) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? (u || '') : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=${w}&q=75&output=webp`

const LAUNCH_RANGES: [string, string][] = [['last_7d', 'Last 7 days'], ['last_14d', 'Last 14 days'], ['last_30d', 'Last 30 days'], ['last_60d', 'Last 60 days'], ['last_90d', 'Last 90 days']]
const PERF_RANGES: [string, string][] = [['maximum', 'Lifetime'], ['last_7d', 'Last 7 days'], ['last_14d', 'Last 14 days'], ['last_30d', 'Last 30 days'], ['last_90d', 'Last 90 days']]

function money(n: number, cur: string) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0) }
function fmtM(v: number, key: string, cur: string): string {
  const f = METRICS[key as MetricKey]?.format
  if (f === 'currency') return money(v, cur)
  if (f === 'percent') return (v || 0).toFixed(2) + '%'
  if (f === 'ratio') return (v || 0).toFixed(2) + 'x'
  if (f === 'score' || f === 'seconds') return String(Math.round(v || 0))
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v || 0)
}

export default function LaunchReport({ templateKey, savedId, initialName, initialConfig, onBack, onSave }: {
  templateKey: string; savedId?: string; initialName?: string; initialConfig?: any; onBack?: () => void; onSave?: (p: any) => Promise<boolean>
}) {
  const ic = initialConfig || {}
  const [name, setName] = useState(initialName || 'New Launches')
  const [launchRange, setLaunchRange] = useState<string>(ic.launchRange || 'last_30d')
  const [perfRange, setPerfRange] = useState<string>(ic.perfRange || 'maximum')
  const [goalRoas, setGoalRoas] = useState<number>(ic.goalRoas ?? 1)
  const [goalSpend, setGoalSpend] = useState<number>(ic.goalSpend ?? 0)
  const [metrics, setMetrics] = useState<MetricKey[]>(ic.metrics?.length ? ic.metrics : ['conversions', 'cpa', 'ctr'])
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [picker, setPicker] = useState(false)
  const [goalEdit, setGoalEdit] = useState(false)
  const currency = data?.currency || 'PKR'

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const p = new URLSearchParams({ template: templateKey, launchRange, perfRange, goalRoas: String(goalRoas), goalSpend: String(goalSpend), groupBy: 'creative', metrics: metrics.join(',') })
      const res = await fetch(`/api/reports/launch?${p}`)
      const json = await res.json()
      if (json.error && !json.cohorts?.length) setError(json.error === 'no_account' ? 'Connect a Meta ad account to track launches.' : json.error)
      setData(json)
      // open the newest cohort by default
      if (json.cohorts?.[0]) setOpen({ [json.cohorts[0].key]: true })
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [templateKey, launchRange, perfRange, goalRoas, goalSpend, metrics])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!onSave) return
    await onSave({ id: savedId, name, templateKey, config: { launchRange, perfRange, goalRoas, goalSpend, metrics } })
  }

  const funnel = data?.funnel || { launched: 0, scaled: 0, winners: 0 }
  const rangeLabel = (r: string, opts: [string, string][]) => opts.find(o => o[0] === r)?.[1] || r

  return (
    <div style={{ padding: 24, maxWidth: 1180, margin: '0 auto', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {onBack && <button onClick={onBack} style={{ border: 'none', background: '#f4f6f0', borderRadius: 9, width: 32, height: 32, cursor: 'pointer', fontSize: 16, color: '#3a4636' }}>←</button>}
        <span style={{ fontSize: 22 }}>🚀</span>
        <input value={name} onChange={e => setName(e.target.value)} style={{ fontSize: 21, fontWeight: 800, color: '#0e1b12', border: 'none', background: 'transparent', outline: 'none', fontFamily: 'inherit', flex: 1, minWidth: 120 }} />
        {onSave && <button onClick={save} style={{ padding: '8px 16px', borderRadius: 100, border: 'none', background: '#0e1b12', color: '#dffe95', fontWeight: 800, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>Save</button>}
      </div>

      {/* Goal + windows bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap', background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 12, padding: '10px 14px' }}>
        {/* Goal */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setGoalEdit(g => !g)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: '#f0f7ee', border: '1px solid #cfe6c4', borderRadius: 9, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: '#2d5a2d' }}>
            🎯 Goal: ROAS ≥ {goalRoas}{goalSpend > 0 ? `, Spend ≥ ${money(goalSpend, currency)}` : ''} <span style={{ color: '#7c8577' }}>▾</span>
          </button>
          {goalEdit && (
            <>
              <div onClick={() => setGoalEdit(false)} style={{ position: 'fixed', inset: 0, zIndex: 29 }} />
              <div style={{ position: 'absolute', top: '112%', left: 0, zIndex: 30, background: '#fff', border: '1px solid rgba(0,0,0,.12)', borderRadius: 12, boxShadow: '0 14px 40px rgba(0,0,0,.16)', padding: 14, width: 250 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#9aa196', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>Winning goal</div>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, fontSize: 13, color: '#3a4636', fontWeight: 600 }}>
                  ROAS ≥ <input type="number" step="0.1" value={goalRoas} onChange={e => setGoalRoas(Number(e.target.value))} style={inp} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 13, color: '#3a4636', fontWeight: 600 }}>
                  Spend ≥ <input type="number" value={goalSpend} onChange={e => setGoalSpend(Number(e.target.value))} style={inp} />
                </label>
                <div style={{ fontSize: 11, color: '#9aa196', marginTop: 8 }}>Scaled = hits spend. Winner = scaled &amp; hits ROAS.</div>
              </div>
            </>
          )}
        </div>
        {/* Launch window */}
        <Selector label="Launched" value={launchRange} setValue={setLaunchRange} opts={LAUNCH_RANGES} />
        <div style={{ flex: 1 }} />
        {/* Performance window (distinct) */}
        <Selector label="Perf." value={perfRange} setValue={setPerfRange} opts={PERF_RANGES} />
        <button onClick={() => setPicker(true)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#f4f6f0', border: '1px solid rgba(26,58,26,.12)', borderRadius: 9, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, color: '#3a4636' }}>＋ Add metric</button>
      </div>

      {/* Funnel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { icon: '🚀', label: 'Launched', value: funnel.launched, sub: `in ${rangeLabel(launchRange, LAUNCH_RANGES).toLowerCase()}`, color: '#0e1b12' },
          { icon: '📈', label: 'Scaled', value: funnel.scaled, sub: goalSpend > 0 ? `spend ≥ ${money(goalSpend, currency)}` : 'has spend', color: '#b8860b' },
          { icon: '🏆', label: 'Winners', value: funnel.winners, sub: `ROAS ≥ ${goalRoas}`, color: '#2d7a2d' },
        ].map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 26 }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 26, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: '#3a4636', marginTop: 3 }}>{s.label}</div>
              <div style={{ fontSize: 10.5, color: '#9aa196', marginTop: 1 }}>{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {loading ? <div style={{ padding: 60, textAlign: 'center', color: '#9aa196' }}>Loading launches…</div>
        : error ? <div style={{ padding: 24, background: 'rgba(224,120,110,.1)', border: '1px solid rgba(224,120,110,.3)', borderRadius: 12, color: '#c0392b' }}>{error}</div>
        : !data?.cohorts?.length ? <div style={{ padding: 48, textAlign: 'center', color: '#9aa196' }}>No ads launched in this window.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.cohorts.map((c: any) => {
              const shown = !!open[c.key]
              return (
                <div key={c.key} style={{ background: '#fff', border: '1px solid rgba(26,58,26,.1)', borderRadius: 14, overflow: 'hidden' }}>
                  <button onClick={() => setOpen(o => ({ ...o, [c.key]: !o[c.key] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '12px 16px', border: 'none', background: '#fafcf5', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    <span style={{ fontSize: 11, color: '#9aa196', transform: shown ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▶</span>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: '#0e1b12' }}>{c.label}</span>
                    <span style={{ fontSize: 12, color: '#7c8577' }}>· {c.rows.length} creative{c.rows.length === 1 ? '' : 's'} launched</span>
                  </button>
                  {shown && (
                    <div className="rp-scroll" style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(26,58,26,.08)' }}>
                            <th style={{ ...th, textAlign: 'left', paddingLeft: 16, minWidth: 260 }}>Creative</th>
                            <th style={th}>Achievements</th>
                            <th style={th}>Lifetime spend</th>
                            <th style={th}>ROAS</th>
                            {metrics.map(m => <th key={m} style={th}>{METRICS[m]?.label || m}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {c.rows.map((r: any) => (
                            <tr key={r.key} style={{ borderBottom: '1px solid rgba(26,58,26,.05)' }}>
                              <td style={{ ...td, textAlign: 'left', paddingLeft: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                  <div style={{ width: 42, height: 42, borderRadius: 8, overflow: 'hidden', background: '#f0f4ec', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {r.thumbnail
                                      ? <img src={cdn(r.thumbnail)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                          onError={(e) => { const el = e.currentTarget; el.style.display = 'none'; const ph = el.nextElementSibling as HTMLElement | null; if (ph) ph.style.display = 'flex' }} />
                                      : null}
                                    {/* Fallback when there's no thumbnail OR the (often hotlink-protected/expired) Meta URL 403s —
                                        was a broken-image icon before. Emoji by format so the row still reads. */}
                                    <span style={{ display: r.thumbnail ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', fontSize: 18 }}>
                                      {/(video)/i.test(r.format || '') ? '🎬' : /(carousel)/i.test(r.format || '') ? '🎠' : '🖼️'}
                                    </span>
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#243d17', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>{r.name}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                      <span style={{ fontSize: 9.5, fontWeight: 800, color: r.status === 'active' ? '#2d7a2d' : '#9aa196', textTransform: 'uppercase' }}>{r.status === 'active' ? '● Active' : r.status}</span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td style={{ ...td, textAlign: 'center' }}>
                                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                                  {r.achievements.length ? r.achievements.map((a: string) => (
                                    <span key={a} style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 8px', borderRadius: 999, color: a === 'Winner' ? '#2d7a2d' : '#b8860b', background: a === 'Winner' ? '#eaf7e6' : '#fdf5e3' }}>{a === 'Winner' ? '🏆 ' : '📈 '}{a}</span>
                                  )) : <span style={{ fontSize: 11, color: '#c8cfc0' }}>—</span>}
                                </div>
                              </td>
                              <td style={{ ...td, fontWeight: 700, color: '#0e1b12' }}>{money(r.spend, currency)}</td>
                              <td style={{ ...td }}><span style={{ fontWeight: 800, color: r.metrics.roas >= 2 ? '#2d7a2d' : r.metrics.roas >= 1 ? '#b8860b' : '#c0392b' }}>{(r.metrics.roas || 0).toFixed(2)}x</span></td>
                              {metrics.map(m => <td key={m} style={{ ...td, color: '#3a4636' }}>{fmtM(r.metrics[m], m, currency)}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

      {picker && <MetricPicker metrics={metrics} tagCols={[]} onApply={(m: MetricKey[]) => { setMetrics(m); setPicker(false) }} onSavePreset={() => {}} onClose={() => setPicker(false)} />}
    </div>
  )
}

function Selector({ label, value, setValue, opts }: { label: string; value: string; setValue: (v: string) => void; opts: [string, string][] }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#7c8577', fontWeight: 700 }}>
      {label}
      <select value={value} onChange={e => setValue(e.target.value)} style={{ padding: '6px 9px', borderRadius: 8, border: '1px solid rgba(26,58,26,.14)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: '#0e1b12', background: '#fff', cursor: 'pointer' }}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

const inp: React.CSSProperties = { width: 90, padding: '6px 9px', borderRadius: 8, border: '1px solid rgba(26,58,26,.16)', fontFamily: 'inherit', fontSize: 13, outline: 'none', textAlign: 'right' }
const th: React.CSSProperties = { padding: '9px 12px', textAlign: 'right', fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9aa196', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '9px 12px', textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
