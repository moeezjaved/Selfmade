'use client'
import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Step { label: string; count: number; pct: number }
interface AnonAudit { type?: 'seo' | 'ads'; domain: string | null; page_id?: string | null; site_name: string | null; score: number | null; category: string | null; created_at: string; email?: string | null; status?: string | null }

const SEV_COLOR: Record<string, string> = { high: '#dc2626', medium: '#d97706', low: '#6b7280' }
const money = (n: number, cur: string) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', maximumFractionDigits: 0 }).format(n || 0) } catch { return `${Math.round(n || 0)} ${cur}` } }

// Inline render of a stored ScanResult — the exact audit the anonymous lead saw.
function ScanReport({ result }: { result: any }) {
  if (!result) return <div style={{ padding: 16, color: '#aaa', fontSize: 13 }}>Loading report…</div>
  return (
    <div style={{ background: '#fff', border: '1px solid #eceeec', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
        {[
          ['Overall', `${result.score} · ${result.grade}`],
          ['Website', result.websiteScore ?? 'No data'],
          ['Visibility', result.visibilityScore ?? 'No data'],
          ['Problems', result.problemCount],
          ['Revenue lost / yr', money(result.revenueLostPerYear, result.currency)],
        ].map(([k, v]) => (
          <div key={String(k)}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{v as any}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{k as any}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(result.sections || []).map((s: any) => (
          <div key={s.key} style={{ border: '1px solid #f0f2f0', borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontWeight: 700, color: '#111', fontSize: 13 }}>{s.name}</span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{s.sub}</span>
              <span style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 13, color: s.score == null ? '#9ca3af' : s.score >= 70 ? '#16a34a' : s.score >= 45 ? '#d97706' : '#dc2626' }}>{s.score == null ? 'No data' : s.score}</span>
            </div>
            {(s.findings || []).length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(s.findings || []).map((f: any) => (
                  <li key={f.id} style={{ fontSize: 12, color: '#333', lineHeight: 1.5 }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: SEV_COLOR[f.severity] || '#6b7280', marginRight: 7 }} />
                    <b>{f.title}</b>{f.detail ? ` — ${f.detail}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

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

// Inline render of an ADS audit (the DNA result) — score, subscores, gaps, and the real crawled ads.
function AdsReport({ data }: { data: any }) {
  if (!data) return <div style={{ padding: 16, color: '#aaa', fontSize: 13 }}>Loading audit…</div>
  if (data.building) return (
    <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: 16, fontSize: 13, color: '#c2410c' }}>
      ⏳ Still crawling this brand&rsquo;s Meta Ad Library — no ads on file yet, so there&rsquo;s no audit to show. We never score without real ads. Re-open in a few minutes.
    </div>
  )
  const score = data.score || {}
  const winners = data.winners?.examples || []
  const own = data.own?.examples || []
  const gaps = data.gaps || []
  return (
    <div style={{ background: '#fff', border: '1px solid #eceeec', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14, alignItems: 'baseline' }}>
        <div><div style={{ fontSize: 22, fontWeight: 800, color: scoreColor(score.total) }}>{score.total ?? '—'}{score.band ? ` · ${score.band}` : ''}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>Ad-presence score</div></div>
        <div><div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{data.own?.totalAds ?? 0}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>Your ads</div></div>
        <div><div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{data.winners?.sampleSize ?? 0}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>Rival ads analysed</div></div>
      </div>
      {(score.subscores || []).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginBottom: 14 }}>
          {score.subscores.map((s: any) => (
            <div key={s.key} style={{ border: '1px solid #f0f2f0', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 12, color: '#333', fontWeight: 600 }}>{s.label}</span><span style={{ fontSize: 12, fontWeight: 800, color: scoreColor(s.value) }}>{s.value == null ? 'No data' : s.value}</span></div>
              {s.note && <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>{s.note}</div>}
            </div>
          ))}
        </div>
      )}
      {gaps.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Gaps vs rivals</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {gaps.slice(0, 10).map((g: any, i: number) => <li key={i} style={{ fontSize: 12, color: '#333', lineHeight: 1.5 }}><b>{g.label}</b> — you {g.yourPct}% vs winners {g.winnerPct}% <span style={{ color: '#c2410c' }}>({g.kind})</span></li>)}
          </ul>
        </div>
      )}
      {winners.length > 0 && (
        <div style={{ marginBottom: own.length ? 14 : 0 }}>
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Rival winning ads ({winners.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 8 }}>
            {winners.slice(0, 18).map((a: any, i: number) => (
              <div key={i} style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden', background: '#fafafa' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div style={{ aspectRatio: '1', background: '#f0f0f0' }}>{a.thumb && <img src={a.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
                <div style={{ fontSize: 9, color: '#888', padding: '3px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`${a.brand} · ${a.daysRunning}d`}>{a.brand} · {a.daysRunning}d</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {own.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Their own ads ({own.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))', gap: 8 }}>
            {own.slice(0, 12).map((a: any, i: number) => (
              <div key={i} style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden', background: '#fafafa' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <div style={{ aspectRatio: '1', background: '#f0f0f0' }}>{a.thumb && <img src={a.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
                <div style={{ fontSize: 9, color: '#888', padding: '3px 5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.daysRunning}d</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function FunnelPage() {
  const [steps, setSteps] = useState<Step[]>([])
  const [auditFunnel, setAuditFunnel] = useState<Step[]>([])
  const [anon, setAnon] = useState<AnonAudit[]>([])
  const [anonCount, setAnonCount] = useState(0)
  const [recentSignups, setRecentSignups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [openDomain, setOpenDomain] = useState<string | null>(null)
  const [scans, setScans] = useState<Record<string, any>>({})
  const router = useRouter()

  const [openAds, setOpenAds] = useState<string | null>(null)
  const [adsData, setAdsData] = useState<Record<string, any>>({})

  const toggleLead = (domain: string) => {
    if (openDomain === domain) { setOpenDomain(null); return }
    setOpenDomain(domain)
    if (!(domain in scans)) {
      fetch(`/api/admin/audit-scan?domain=${encodeURIComponent(domain)}`)
        .then(r => r.json())
        .then(d => setScans(prev => ({ ...prev, [domain]: d.result || null })))
        .catch(() => setScans(prev => ({ ...prev, [domain]: null })))
    }
  }

  const toggleAds = (pageId: string) => {
    if (openAds === pageId) { setOpenAds(null); return }
    setOpenAds(pageId)
    if (!(pageId in adsData)) {
      // completes the audit server-side if the crawl has since landed, then returns the full result
      fetch(`/api/admin/ads-audit?page_id=${encodeURIComponent(pageId)}`)
        .then(r => r.json())
        .then(d => setAdsData(prev => ({ ...prev, [pageId]: d.result || null })))
        .catch(() => setAdsData(prev => ({ ...prev, [pageId]: null })))
    }
  }

  useEffect(() => {
    fetch('/api/admin/funnel')
      .then(r => r.json())
      .then(d => {
        setSteps(d.steps || [])
        setAuditFunnel(d.auditFunnel || [])
        setAnon(d.anonymousAudits || [])
        setAnonCount(d.anonymousAuditsCount || 0)
        setRecentSignups(d.recentSignups || [])
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

          {/* Every recent signup + where they got stuck — so no new account is invisible */}
          <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e8e8e8', overflow: 'hidden', margin: '8px 0 36px' }}>
            <div style={{ padding: '18px 20px 8px' }}>
              <h2 style={{ fontSize: '15px', fontWeight: 700, color: '#111', margin: 0 }}>
                Recent signups <span style={{ color: '#888' }}>({recentSignups.length.toLocaleString()})</span>
              </h2>
              <p style={{ color: '#999', fontSize: '13px', margin: '4px 0 0' }}>Every new account, newest first, and the furthest stage it reached — so you always know what happened to a signup.</p>
            </div>
            {recentSignups.length === 0 ? (
              <div style={{ padding: '24px 20px', color: '#aaa', fontSize: 13 }}>No signups yet.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#fafafa', borderTop: '1px solid #f0f0f0', borderBottom: '1px solid #f0f0f0' }}>
                    {['Email', 'Via', 'Stage', 'Brand', 'Signed up'].map(h => (
                      <th key={h} style={{ padding: '9px 20px', textAlign: 'left', color: '#999', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentSignups.map((u, i) => {
                    const S: Record<string, { t: string; c: string; bg: string }> = {
                      signed_up: { t: 'Signed up', c: '#6b7280', bg: '#f3f4f6' },
                      audit_started: { t: 'Reached audit', c: '#b45309', bg: '#fef3c7' },
                      audit_done: { t: 'Completed audit', c: '#1d4ed8', bg: '#dbeafe' },
                      connected: { t: 'Connected store', c: '#0f766e', bg: '#ccfbf1' },
                      generated: { t: 'Generated an ad', c: '#7c3aed', bg: '#ede9fe' },
                      paid: { t: 'Paid', c: '#15803d', bg: '#dcfce7' },
                    }
                    const s = S[u.stage] || S.signed_up
                    return (
                      <tr key={(u.email || i) + i} style={{ borderBottom: '1px solid #f6f6f6' }}>
                        <td style={{ padding: '10px 20px', color: '#111', fontWeight: 600 }}>{u.email || '—'}</td>
                        <td style={{ padding: '10px 20px', color: '#777', textTransform: 'capitalize' }}>{u.provider || 'email'}</td>
                        <td style={{ padding: '10px 20px' }}><span style={{ fontSize: 11, fontWeight: 700, color: s.c, background: s.bg, borderRadius: 20, padding: '2px 10px' }}>{s.t}</span></td>
                        <td style={{ padding: '10px 20px', color: '#555' }}>{u.brand || <span style={{ color: '#c3c7c3' }}>—</span>}</td>
                        <td style={{ padding: '10px 20px', color: '#888' }}>{fmt(u.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              </div>
            )}
          </div>

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
                    {['Domain', 'Store', 'Category', 'Score', 'Email', 'Scanned'].map(h => (
                      <th key={h} style={{ padding: '9px 20px', textAlign: 'left', color: '#999', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {anon.map((a, i) => {
                    const isAds = a.type === 'ads'
                    const key = a.domain || a.page_id || String(i)
                    const open = isAds ? (openAds === a.page_id) : (openDomain === a.domain)
                    return (
                    <React.Fragment key={key + i}>
                      <tr onClick={() => { if (isAds) { if (a.page_id) toggleAds(a.page_id) } else if (a.domain) toggleLead(a.domain) }} style={{ borderBottom: '1px solid #f6f6f6', cursor: 'pointer', background: open ? '#faf9f6' : 'transparent' }}>
                        <td style={{ padding: '10px 20px', fontWeight: 600 }}>
                          <span style={{ color: '#c3c7c3', marginRight: 6 }}>{open ? '▾' : '▸'}</span>
                          {isAds ? (
                            <span style={{ color: '#111' }}>{a.site_name || a.page_id}</span>
                          ) : (
                            <span onClick={(e) => { e.stopPropagation(); router.push(`/admin/site/${encodeURIComponent(a.domain!)}`) }} style={{ color: '#2563eb', cursor: 'pointer' }} title="Open everything about this site">{a.domain}</span>
                          )}
                          <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: isAds ? '#1877F2' : '#7c3aed', background: isAds ? '#1877F214' : '#7c3aed14', borderRadius: 20, padding: '1px 7px' }} title="Which audit they ran">{isAds ? 'Ads audit' : 'SEO audit'}</span>
                          {isAds
                            ? <a href={`https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&view_all_page_id=${a.page_id}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#9ca3af', textDecoration: 'none', marginLeft: 6, fontSize: 11 }}>ad library ↗</a>
                            : <a href={`https://${a.domain}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#9ca3af', textDecoration: 'none', marginLeft: 6, fontSize: 11 }}>↗</a>}
                        </td>
                        <td style={{ padding: '10px 20px', color: '#333' }}>{a.site_name || '—'}</td>
                        <td style={{ padding: '10px 20px', color: '#777' }}>{a.category || '—'}</td>
                        <td style={{ padding: '10px 20px' }}><span style={{ fontWeight: 800, color: scoreColor(a.score) }}>{a.score ?? '—'}</span></td>
                        <td style={{ padding: '10px 20px', color: a.email ? '#333' : '#c3c7c3' }}>{a.email ? <a href={`mailto:${a.email}`} onClick={(e) => e.stopPropagation()} style={{ color: '#2563eb', textDecoration: 'none' }}>{a.email}</a> : '— none'}</td>
                        <td style={{ padding: '10px 20px', color: '#888' }}>{fmt(a.created_at)}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={6} style={{ padding: '4px 20px 16px' }}>
                            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                              {isAds ? <AdsReport data={a.page_id ? adsData[a.page_id] : null} /> : <ScanReport result={scans[a.domain!]} />}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )})}
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
