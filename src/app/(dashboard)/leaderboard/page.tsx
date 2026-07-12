'use client'
/**
 * /leaderboard — week-over-week creative leaderboard. Two sections:
 *  1) Performance shifts — Scaling / Declining / Newly launched / Recently paused pill tabs, each a
 *     card carousel with colored WoW Spend + ROAS deltas (themed empty states gated on spend threshold).
 *  2) Creative leaderboard — ranked gray-2 row-cards with rank-movement, weeks on board, Spend, ROAS.
 * Motion mds tokens; functional green/red deltas. Fetches /api/leaderboard.
 */
import { useState, useEffect } from 'react'

const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
const GREEN = '#18794e', RED = '#cd2b31', G11 = '#6f6f6f', G12 = '#171717', G9 = '#8f8f8f', G2 = '#f8f8f8'
const money = (n: number, c: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(n || 0)
const cdn = (u?: string | null, w = 300) => (!u || u.startsWith('data:') || u.includes('.r2.dev') || u.includes('r2.cloudflarestorage') || u.includes('cdn.tryselfmade'))
  ? (u || '') : `https://images.weserv.nl/?url=${encodeURIComponent(u)}&w=${w}&q=78&output=webp`

// A colored week-over-week delta. Null baseline → a plain muted "-".
function Delta({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span style={{ fontSize: 12, color: G9 }}>-</span>
  const up = v >= 0
  return <span style={{ fontSize: 12, fontWeight: 400, color: up ? GREEN : RED }}>{up ? '+' : ''}{Math.round(v)}%</span>
}

function PlayDot() {
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
    </div>
  </div>
}

export default function LeaderboardPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'scaling' | 'declining' | 'newly' | 'paused'>('newly')
  const [shiftExpanded, setShiftExpanded] = useState(false)
  const [boardExpanded, setBoardExpanded] = useState(false)

  useEffect(() => {
    setLoading(true); setError('')
    fetch('/api/leaderboard').then(r => r.json()).then(j => {
      if (j.error && !j.leaderboard?.length) setError(j.error === 'no_account' ? 'Connect a Meta ad account to see your leaderboard.' : j.error)
      setData(j)
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  const currency = data?.currency || 'PKR'
  const counts = data?.shifts?.counts || { scaling: 0, declining: 0, newly: 0, paused: 0 }
  const ago = (() => { if (!data?.updatedAt) return ''; const h = Math.max(1, Math.round((Date.now() - new Date(data.updatedAt).getTime()) / 3600000)); return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago` })()

  const TABS: { key: typeof tab; label: string }[] = [
    { key: 'scaling', label: 'Scaling' }, { key: 'declining', label: 'Declining' },
    { key: 'newly', label: 'Newly launched' }, { key: 'paused', label: 'Recently paused' },
  ]
  const cards: any[] = data?.shifts?.[tab] || []
  const shownCards = shiftExpanded ? cards : cards.slice(0, 8)
  const board: any[] = data?.leaderboard || []
  const shownBoard = boardExpanded ? board : board.slice(0, 10)

  return (
    <div style={{ padding: 28, maxWidth: 1080, margin: '0 auto', fontFamily: FONT, color: G12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: G11, marginBottom: 4 }}>
        <span>Leaderboard</span>
        {ago && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: G9 }} />{ago}</span>}
      </div>
      <h1 style={{ fontSize: 24, lineHeight: '29px', fontWeight: 600, letterSpacing: '-0.019em', margin: 0 }}>Leaderboard</h1>
      <div style={{ fontSize: 14, color: G11, marginTop: 4, marginBottom: 26 }}>Track performance shifts and top creatives</div>

      {error ? <div style={{ padding: 24, background: '#ffefef', border: '1px solid #ffe5e5', borderRadius: 12, color: RED }}>{error}</div> : null}

      {/* ── Section 1: Performance shifts ── */}
      <h2 style={{ fontSize: 20, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.017em', margin: '0 0 14px' }}>Performance shifts</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setShiftExpanded(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 9999, background: 'transparent', border: active ? `1px solid ${G12}` : '1px solid rgba(0,0,0,0.09)', color: G12, fontSize: 14, fontWeight: 400, cursor: 'pointer', fontFamily: FONT, transition: 'background-color .075s ease-in-out' }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#ededed' }} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              {t.label}<span style={{ fontSize: 12, fontWeight: 500, color: G11 }}>{counts[t.key]}</span>
            </button>
          )
        })}
      </div>

      {loading ? <ShiftSkeleton />
        : cards.length === 0 ? <ShiftEmpty tab={tab} />
        : (
          <>
            <div className="lb-carousel" style={{ display: shiftExpanded ? 'grid' : 'flex', gridTemplateColumns: shiftExpanded ? 'repeat(auto-fill, minmax(180px, 1fr))' : undefined, gap: 14, overflowX: shiftExpanded ? undefined : 'auto', paddingBottom: 8 }}>
              {shownCards.map(c => <ShiftCard key={c.key} c={c} currency={currency} showMetrics={tab === 'scaling' || tab === 'declining' || tab === 'paused'} />)}
            </div>
            {cards.length > 8 && <button onClick={() => setShiftExpanded(x => !x)} style={showBtn}>{shiftExpanded ? 'Show less' : `Show more (${cards.length})`}</button>}
          </>
        )}

      {/* ── Section 2: Creative leaderboard ── */}
      <h2 style={{ fontSize: 20, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.017em', margin: '40px 0 14px' }}>Creative leaderboard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 120px 160px 160px', gap: 0, padding: '0 16px 8px', fontSize: 12, fontWeight: 500, color: G11 }}>
        <span>Rank</span><span>Creative</span><span>Wks on board</span><span>Spend</span><span>ROAS</span>
      </div>
      {loading ? <BoardSkeleton />
        : board.length === 0 ? <div style={{ padding: 40, textAlign: 'center', color: G9 }}>No creatives with spend this week.</div>
        : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {shownBoard.map(r => <BoardRow key={r.key} r={r} currency={currency} />)}
            </div>
            {board.length > 10 && <button onClick={() => setBoardExpanded(x => !x)} style={showBtn}>{boardExpanded ? 'Show less' : `Show more (${board.length})`}</button>}
          </>
        )}
    </div>
  )
}

function ShiftCard({ c, currency, showMetrics }: { c: any; currency: string; showMetrics: boolean }) {
  return (
    <div style={{ flex: '0 0 auto', width: 180 }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 16', borderRadius: 12, overflow: 'hidden', background: '#0e1b12' }}>
        {c.thumbnail ? <img src={cdn(c.thumbnail)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        {c.format === 'video' && <PlayDot />}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
      {showMetrics && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: G11 }}>Spend</span><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{money(c.spend, currency)} <Delta v={c.spendDelta} /></span></div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: G11 }}>ROAS</span><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{(c.roas || 0).toFixed(2)}x <Delta v={c.roasDelta} /></span></div>
        </div>
      )}
    </div>
  )
}

function BoardRow({ r, currency }: { r: any; currency: string }) {
  return (
    <div className="lb-row" style={{ display: 'grid', gridTemplateColumns: '64px 1fr 120px 160px 160px', alignItems: 'center', height: 100, background: G2, borderRadius: 16, overflow: 'hidden', transition: 'background-color .075s ease-in-out' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <span style={{ fontSize: 24, fontWeight: 600, color: G12 }}>{r.rank}</span>
        {r.movement === 'new'
          ? <svg width="16" height="16" viewBox="0 0 24 24" fill={G12}><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" /></svg>
          : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={G9} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <div style={{ width: 100, height: 100, flexShrink: 0, background: '#eee', overflow: 'hidden' }}>
          {r.thumbnail ? <img src={cdn(r.thumbnail)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
          <div style={{ fontSize: 12.5, color: G11, marginTop: 2 }}>{r.adCount} {r.adCount === 1 ? 'ad' : 'ads'}</div>
        </div>
      </div>
      <div style={{ fontSize: 14, color: G12 }}>{r.weeksOnBoard} {r.weeksOnBoard === 1 ? 'week' : 'weeks'}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{money(r.spend, currency)}</span><Delta v={r.spendDelta} /></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{(r.roas || 0).toFixed(2)}x</span><Delta v={r.roasDelta} /></div>
    </div>
  )
}

// Themed empty states — Scaling (green) / Declining (red) explain the spend-threshold gate.
function ShiftEmpty({ tab }: { tab: string }) {
  const green = tab === 'scaling' || tab === 'newly'
  const badgeBg = green ? '#ddf3e4' : '#ffe5e5', badgeFg = green ? GREEN : RED
  const headline = tab === 'scaling' ? 'No creatives have scaled this week'
    : tab === 'declining' ? 'No creatives are declining this week'
    : tab === 'newly' ? 'No newly launched creatives yet'
    : 'No creatives were recently paused'
  const sub = (tab === 'scaling' || tab === 'declining') ? 'Ads that pass your spend threshold will appear here.'
    : tab === 'newly' ? 'Recently launched ads that start spending will appear here.'
    : 'Ads you turn off will appear here for the week.'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <div style={{ position: 'relative', width: 150, aspectRatio: '9 / 16', borderRadius: 12, background: '#ededed', flexShrink: 0 }} className="mds-skel">
        {(tab === 'scaling' || tab === 'declining') && (
          <span style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 4, background: badgeBg, color: badgeFg, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 9999 }}>
            {tab === 'scaling' ? '↑ Scaling' : '↓ Declining'}
          </span>
        )}
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{headline}</div>
        <div style={{ fontSize: 14, color: G11 }}>{sub}</div>
      </div>
    </div>
  )
}

function ShiftSkeleton() {
  return <div style={{ display: 'flex', gap: 14 }}>{[0, 1, 2, 3, 4].map(i => <div key={i} className="mds-skel" style={{ width: 180, aspectRatio: '9 / 16', borderRadius: 12 }} />)}</div>
}
function BoardSkeleton() {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map(i => <div key={i} className="mds-skel" style={{ height: 100, borderRadius: 16 }} />)}</div>
}

const showBtn: React.CSSProperties = { marginTop: 14, height: 34, padding: '0 16px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.09)', background: '#fff', color: G12, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: FONT }
