'use client'
import MetaGate from '@/components/MetaGate'
import AdsTabs from '@/components/ads/AdsTabs'
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

// A week-over-week delta PILL. Null baseline → a plain muted "-" (no pill).
function Delta({ v }: { v: number | null }) {
  if (v === null || v === undefined) return <span style={{ fontSize: 12, color: G9 }}>-</span>
  const up = v >= 0
  return <span style={{ display: 'inline-flex', alignItems: 'center', height: 20, padding: '0 4px', borderRadius: 10, fontSize: 12, fontWeight: 400, background: up ? '#edf7f1' : '#ffefef', color: up ? GREEN : RED }}>{up ? '+' : ''}{Math.round(v)}%</span>
}

// Rank-movement icon (16px, 24-viewBox, currentColor) — four states with a positions-moved count.
function RankMove({ movement, moved }: { movement: string; moved: number }) {
  if (movement === 'new') return <svg width="16" height="16" viewBox="0 0 24 24" fill={G12}><path d="M10.99 2.63c.406-.84 1.614-.84 2.02 0l2.014 4.182c.163.338.488.572.864.62l4.638.606c.933.122 1.306 1.26.624 1.9l-3.393 3.19a1.1 1.1 0 0 0-.33 1.005l.852 4.556c.171.915-.806 1.619-1.633 1.174l-4.113-2.21a1.13 1.13 0 0 0-1.066 0l-4.113 2.21c-.827.445-1.804-.259-1.633-1.174l.852-4.556a1.1 1.1 0 0 0-.33-1.005L2.85 9.938c-.683-.64-.31-1.778.623-1.9l4.64-.605c.375-.05.7-.283.863-.621z" /></svg>
  if (movement === 'held') return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={G9} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
  const up = movement === 'up', color = up ? '#30a46c' : '#e5484d'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 1, color, fontSize: 11, fontWeight: 600 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={up ? 'M12 5v15M6 10l6-6 6 6' : 'm18 14-6 6-6-6m6 5V4'} /></svg>
      {moved > 0 && moved}
    </span>
  )
}

function PlayDot() {
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
    </div>
  </div>
}

function LeaderboardPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'scaling' | 'declining' | 'newly' | 'paused'>('newly')
  const [shiftExpanded, setShiftExpanded] = useState(false)
  const [boardExpanded, setBoardExpanded] = useState(false)
  const [threshold, setThreshold] = useState(0)          // applied spend threshold
  const [thresholdInput, setThresholdInput] = useState('0')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // Restore the saved spend threshold on mount (browser-local, per-device). Set after hydration to
  // avoid an SSR mismatch; the fetch effect below picks up the restored value.
  useEffect(() => {
    try { const s = localStorage.getItem('selfmade_lb_threshold'); if (s != null) { const n = Number(s) || 0; setThreshold(n); setThresholdInput(String(n)) } } catch {}
  }, [])

  useEffect(() => {
    setLoading(true); setError(''); setAiText('')
    fetch(`/api/leaderboard?spendThreshold=${threshold}`).then(r => r.json()).then(j => {
      if (j.error && !j.leaderboard?.length) setError(j.error === 'no_account' ? 'Connect a Meta ad account to see your leaderboard.' : j.error)
      setData(j)
    }).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [threshold])

  const analyzeShifts = async () => {
    if (!data?.shifts) return
    setAiLoading(true); setAiText('')
    const top = (arr: any[]) => (arr || []).slice(0, 6).map((c: any) => ({ name: c.name, spend: Math.round(c.spend), spendDelta: c.spendDelta, roas: Number((c.roas || 0).toFixed(2)), roasDelta: c.roasDelta }))
    try {
      const res = await fetch('/api/reports/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'leaderboard', currency: data.currency,
          shifts: { scaling: top(data.shifts.scaling), declining: top(data.shifts.declining), newly: top(data.shifts.newly), paused: top(data.shifts.paused) },
          leaderboard: top(data.leaderboard) }),
      })
      const j = await res.json()
      setAiText(j.analysis || j.error || 'Could not analyze.')
    } catch (e: any) { setAiText(e.message) }
    finally { setAiLoading(false) }
  }
  const applyThreshold = () => { const n = Math.max(0, Number(thresholdInput) || 0); setThreshold(n); try { localStorage.setItem('selfmade_lb_threshold', String(n)) } catch {} }

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
      <AdsTabs />
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: G11, marginBottom: 4 }}>
        <span>Leaderboard</span>
        {ago && <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: G9 }} />{ago}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 24, lineHeight: '29px', fontWeight: 600, letterSpacing: '-0.019em', margin: 0 }}>Leaderboard</h1>
          <div style={{ fontSize: 14, color: G11, marginTop: 4 }}>Track performance shifts and top creatives</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* Spend-threshold control — gates what counts as Scaling/Declining. */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.09)', fontSize: 13, color: G11 }}>
            Spend threshold
            <input type="number" value={thresholdInput} onChange={e => setThresholdInput(e.target.value)} onBlur={applyThreshold} onKeyDown={e => e.key === 'Enter' && applyThreshold()}
              style={{ width: 84, height: 24, border: 'none', outline: 'none', fontFamily: FONT, fontSize: 13, fontWeight: 600, color: G12, textAlign: 'right', background: 'transparent' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: G9 }}>{currency}</span>
          </label>
          <button onClick={analyzeShifts} disabled={aiLoading || !data?.shifts}
            style={{ display: 'flex', alignItems: 'center', gap: 5, height: 34, padding: '0 13px', borderRadius: 10, border: 'none', background: '#0e1b12', color: '#dffe95', fontSize: 13, fontWeight: 800, cursor: aiLoading ? 'default' : 'pointer', fontFamily: FONT, opacity: aiLoading || !data?.shifts ? 0.6 : 1 }}>
            ✨ {aiLoading ? 'Reading…' : 'Analyze shifts'}
          </button>
        </div>
      </div>
      <div style={{ height: 26 }} />

      {error ? <div style={{ padding: 24, background: '#ffefef', border: '1px solid #ffe5e5', borderRadius: 12, color: RED }}>{error}</div> : null}

      {(aiText || aiLoading) && (
        <div style={{ marginBottom: 22, background: 'linear-gradient(180deg,#f6faef,#fff)', border: '1px solid #e3ecd4', borderRadius: 12, padding: '13px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: '#5a7a3a', marginBottom: aiText ? 8 : 0 }}>✨ Mello · this week's shifts</div>
          {aiLoading ? <div style={{ fontSize: 12.5, color: G9 }}>Reading the week…</div>
            : <div style={{ fontSize: 13.5, lineHeight: 1.6, color: '#243d17' }} dangerouslySetInnerHTML={{ __html: mdLite(aiText) }} />}
        </div>
      )}

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
            <div className="lb-carousel" style={{ display: 'grid', gap: 16, paddingBottom: 8,
              ...(shiftExpanded
                ? { gridTemplateColumns: 'repeat(auto-fill, 197px)' }
                : { gridAutoFlow: 'column', gridAutoColumns: '197px', overflowX: 'auto' }) }}>
              {shownCards.map(c => <ShiftCard key={c.key} c={c} currency={currency} showMetrics={tab === 'scaling' || tab === 'declining' || tab === 'paused'} />)}
            </div>
            {cards.length > 8 && <button onClick={() => setShiftExpanded(x => !x)} style={showBtn}>{shiftExpanded ? 'Show less' : `Show more (${cards.length})`}</button>}
          </>
        )}

      {/* ── Section 2: Creative leaderboard ── */}
      <h2 style={{ fontSize: 20, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.017em', margin: '40px 0 14px' }}>Creative leaderboard</h2>
      {/* The 5 fixed columns (~620px) overflow a phone; scroll the whole board horizontally as one unit
          (min-width keeps every column its size) instead of letting the thumbnail overlap the metrics. */}
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 620 }}>
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
      </div>
    </div>
  )
}

function ShiftCard({ c, currency, showMetrics }: { c: any; currency: string; showMetrics: boolean }) {
  return (
    <div style={{ width: 197, border: '1px solid rgba(0,0,0,0.09)', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '9 / 16', overflow: 'hidden', background: '#0e1b12' }}>
        {c.thumbnail ? <img src={cdn(c.thumbnail)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        {c.format === 'video' && <PlayDot />}
      </div>
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
        {showMetrics && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: G11 }}>Spend</span><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{money(c.spend, currency)} <Delta v={c.spendDelta} /></span></div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: G11 }}>ROAS</span><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{(c.roas || 0).toFixed(2)}x <Delta v={c.roasDelta} /></span></div>
          </div>
        )}
      </div>
    </div>
  )
}

function BoardRow({ r, currency }: { r: any; currency: string }) {
  return (
    <div className="lb-row" style={{ display: 'grid', gridTemplateColumns: '64px 1fr 120px 160px 160px', alignItems: 'center', height: 100, background: G2, borderRadius: 16, overflow: 'hidden', transition: 'background-color .075s ease-in-out' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <span style={{ fontSize: 24, fontWeight: 600, color: G12 }}>{r.rank}</span>
        <RankMove movement={r.movement} moved={r.moved} />
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

// Minimal markdown → HTML for Mello's read: bold, bullets, line breaks.
function mdLite(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^\s*[-•]\s+(.*)$/gm, '• $1')
    .replace(/\n/g, '<br/>')
}

// ── Gate: needs a connected Meta ad account. MetaGate keys off the connection (BYO or OAuth),
// not the old META_LIVE flag — connected users get the surface, everyone else a connect prompt. ──
export default function LeaderboardPageGate() {
  return <MetaGate feature="the Leaderboard"><LeaderboardPage /></MetaGate>
}
