'use client'
/**
 * THE SCAN — the brief as a one-page company scan (Polsia's structure, Selfmade's skin).
 *
 * Four columns: Mello (who's working) · Today (the one decision) · Competitors (who moved) ·
 * What Mello can do (the capability menu). Founders land and see, without clicking, what happened
 * and everything they're able to do about it — the discoverability Polsia gets right.
 *
 * Where it deliberately departs from Polsia:
 *   · rows are RANKED, not equal-weight — the day's decision still wins the page
 *   · hairlines and type instead of boxed mono buttons — boxes are brittle at narrow widths
 *     (all-caps labels wrap and boxes can only grow taller); type reflows
 *   · the accent is spent twice — the approve button and the one Auto — not on twelve buttons
 *
 * Responsive: ≥1200 four columns · 860–1199 a 2×2 grid · <860 one column, re-ordered so the
 * decision leads and Mello's column collapses to a single status strip.
 */
import Link from 'next/link'
import MelloFace, { type MelloState } from '@/components/MelloFace'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e3e2da', HAIR = '#ecebe3', LIME = '#dffe95', FOREST = '#17251c', GREEN = '#3f8f4f'

type Item = { id?: string; kind: string; importance: number; title: string; body?: string; why?: string; cta_label?: string; cta_href?: string; thumbs?: string[]; media?: { image: string | null; videoUrl: string | null; adId?: string }[]; at?: string }
type Brief = {
  summary: { adsScanned: number; brandsWatched: number; spiedBrands: number; creativesReady: number }
  lastCycleAt?: string | null
  firstName: string | null
  headline: Item | null
  items: Item[]
  learning: Item | null
  quiet: boolean
}

const ago = (iso?: string | null): string | null => {
  if (!iso) return null
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (!isFinite(m) || m < 0) return null
  if (m < 60) return m <= 1 ? 'just now' : `${m}m ago`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24); return d === 1 ? 'yesterday' : `${d}d ago`
}

const label: React.CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: '.15em', textTransform: 'uppercase', color: '#8a968a', margin: '0 0 12px' }
const serif: React.CSSProperties = { fontFamily: "'Instrument Serif', Georgia, serif", fontSize: 17, fontWeight: 400, color: INK, lineHeight: 1.25, letterSpacing: '-.005em' }
const sub: React.CSSProperties = { fontSize: 11.5, color: MUTED, lineHeight: 1.45 }

/** A creative, shown. This is an ads product — the ad IS the content, so the scan must carry it.
 *  Video renders as a static poster + badge (never a live <video>): nothing to swallow the click. */
function Shot({ image, videoUrl, w, h }: { image?: string | null; videoUrl?: string | null; w: number; h: number }) {
  const box: React.CSSProperties = { width: w, height: h, borderRadius: 9, objectFit: 'contain', border: `1px solid ${LINE}`, background: '#0d120e', display: 'block', pointerEvents: 'none' }
  const badge = <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 13, textShadow: '0 2px 8px rgba(0,0,0,.55)', pointerEvents: 'none' }}>▶</span>
  if (image) return <span style={{ position: 'relative', display: 'inline-block' }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} alt="" style={box} />{videoUrl ? badge : null}</span>
  if (videoUrl) return <span style={{ position: 'relative', display: 'inline-block' }}><video src={videoUrl} muted playsInline preload="metadata" style={box} />{badge}</span>
  return null
}

/** One hairline row — a verb and what it does. Never a box. */
function Row({ href, onClick, title, desc, right, first }: {
  href?: string; onClick?: () => void; title: string; desc: string; right?: React.ReactNode; first?: boolean
}) {
  const inner = (
    <>
      {right && <span style={{ float: 'right', marginLeft: 10 }}>{right}</span>}
      <span className="bs-t" style={{ ...serif, display: 'block', transition: 'color .15s' }}>{title}</span>
      <span style={{ ...sub, display: 'block' }}>{desc}</span>
    </>
  )
  const style: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
    borderTop: first ? 'none' : `1px solid ${HAIR}`, padding: first ? '0 0 11px' : '11px 0',
    cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'none',
  }
  if (href) return <Link href={href} onClick={onClick} className="bs-row" style={style}>{inner}</Link>
  return <button onClick={onClick} className="bs-row" style={style}>{inner}</button>
}

const ARROW = <span className="bs-a" style={{ color: '#c2ccc0', fontSize: 13, transition: 'color .15s, transform .15s', display: 'inline-block' }}>→</span>
const AUTO = <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: FOREST, background: '#f2f8ea', border: '1px solid #a8cf6f', borderRadius: 100, padding: '3px 8px' }}>Auto</span>

export default function BriefScan({ brief, melloState, onAct, onWhy }: {
  brief: Brief; melloState: MelloState; onAct: (it: Item) => void; onWhy: (it: Item) => void
}) {
  const hero = brief.headline || brief.items[0] || null
  const competitors = brief.items.filter(i => i.kind === 'competitor_ads').slice(0, 4)
  const second = brief.items.find(i => i !== hero && i.kind !== 'competitor_ads') || competitors[0] || null
  const worked = ago(brief.lastCycleAt)
  const stateWord = brief.quiet ? 'Resting' : melloState === 'delivered' ? 'Delivered' : 'Awake'

  return (
    <div className="bs" style={{ marginTop: 26, border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', background: '#faf9f5' }}>
      {/* the night's work, as one line of texture — truncates rather than wraps */}
      <div style={{ background: FOREST, color: '#b9c6b4', font: "11.5px/1.8 ui-monospace, 'SF Mono', Menlo, monospace", padding: '9px 18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        &gt; read <b style={{ color: LIME, fontWeight: 400 }}>{brief.summary.adsScanned.toLocaleString()} ads</b> across your {brief.summary.brandsWatched} competitor{brief.summary.brandsWatched === 1 ? '' : 's'}
        {brief.summary.creativesReady > 0 && <> &nbsp;·&nbsp; drafted <b style={{ color: LIME, fontWeight: 400 }}>{brief.summary.creativesReady} creative{brief.summary.creativesReady === 1 ? '' : 's'}</b></>}
        {worked && <> &nbsp;·&nbsp; last worked {worked}</>}
      </div>

      <div className="bs-grid">
        {/* ── MELLO — collapses to a single strip under 860 ── */}
        <div className="bs-col bs-mello">
          <div className="bs-mello-desk">
            <div style={label}>Mello</div>
            <MelloFace size={52} state={melloState} />
            <div style={{ ...serif, marginTop: 10 }}>{stateWord}</div>
            <div style={{ ...sub, marginBottom: 12 }}>
              {brief.quiet ? 'Nothing needs you today.' : brief.summary.creativesReady > 0 ? `${brief.summary.creativesReady} creative${brief.summary.creativesReady === 1 ? '' : 's'} waiting on your call` : 'Watching your competitors.'}
            </div>
            {[['Ads read', brief.summary.adsScanned.toLocaleString()], ['Competitors', String(brief.summary.brandsWatched)], ...(worked ? [['Last worked', worked]] : [])].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: MUTED, padding: '6px 0' }}>
                <span>{k}</span><b style={{ color: INK, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{v}</b>
              </div>
            ))}
          </div>
          {/* mobile: one line, so the decision stays above the fold */}
          <div className="bs-mello-strip">
            <MelloFace size={38} state={melloState} />
            <div style={{ minWidth: 0 }}>
              <div style={{ ...serif, fontSize: 16 }}>{stateWord}{brief.summary.creativesReady > 0 ? ` — ${brief.summary.creativesReady} waiting` : ''}</div>
              <div style={{ ...sub, fontSize: 11 }}>{brief.summary.adsScanned.toLocaleString()} ads · {brief.summary.brandsWatched} competitors{worked ? ` · ${worked}` : ''}</div>
            </div>
          </div>
        </div>

        {/* ── TODAY — the one decision ── */}
        <div className="bs-col bs-today">
          <div style={label}>Today</div>
          {brief.quiet || !hero ? (
            <div><div style={serif}>Nothing needs you today.</div><div style={sub}>My honest read is don’t spend.</div></div>
          ) : (
            <>
              <div style={{ paddingBottom: 12 }}>
                <div style={serif}>{hero.title.replace(/\.+$/, '')}</div>
                {hero.body && <div style={{ ...sub, marginTop: 2 }}>{hero.body}</div>}
                {(hero.thumbs?.[0] || hero.media?.[0]) && (
                  <div style={{ marginTop: 10 }}>
                    <Shot image={hero.thumbs?.[0] || hero.media?.[0]?.image} videoUrl={hero.media?.[0]?.videoUrl} w={132} h={165} />
                  </div>
                )}
                <div style={{ marginTop: 11, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {hero.cta_href && (
                    <Link href={hero.cta_href} onClick={() => onAct(hero)}
                      style={{ background: LIME, color: FOREST, borderRadius: 100, padding: '9px 16px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
                      ✓ {hero.cta_label || 'Review & approve'}
                    </Link>
                  )}
                  <button onClick={() => onWhy(hero)} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Why?</button>
                </div>
              </div>
              {second && (
                <Row first={false} title={second.title.replace(/\.+$/, '')} desc={second.why || second.body || 'Worth a look today.'}
                  href={second.cta_href} onClick={() => onAct(second)} right={ARROW} />
              )}
            </>
          )}
        </div>

        {/* ── COMPETITORS — who moved ── */}
        <div className="bs-col">
          <div style={label}>Competitors</div>
          {competitors.length === 0
            ? <div style={sub}>No new launches in the last 48 hours.</div>
            : competitors.map((c, i) => (
                <div key={c.id || i} style={{ borderTop: i === 0 ? 'none' : `1px solid ${HAIR}`, padding: i === 0 ? '0 0 12px' : '12px 0' }}>
                  <Link href={c.cta_href?.replace('/knowledge/brand/', '/discovery/brand-spy/') || c.cta_href || '/discovery'}
                    onClick={() => onAct(c)} className="bs-row" style={{ display: 'block', textDecoration: 'none' }}>
                    <span style={{ float: 'right', marginLeft: 10 }}>{ARROW}</span>
                    <span className="bs-t" style={{ ...serif, display: 'block', transition: 'color .15s' }}>{c.title.replace(/\s+launched.*$/i, '').replace(/[.:]$/, '')}</span>
                    <span style={{ ...sub, display: 'block' }}>{(c.title.match(/launched.*/i)?.[0] || 'New activity').replace(/\.$/, '')}{ago(c.at) ? ` · ${ago(c.at)}` : ''}</span>
                  </Link>
                  {/* what they actually launched — a scan of an ads product has to show the ads */}
                  {!!c.media?.length && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      {c.media.slice(0, 3).map((m, k) => (
                        <Link key={k} href={m.adId ? `/knowledge/ad/${m.adId}` : (c.cta_href || '/discovery')} onClick={() => onAct(c)}>
                          <Shot image={m.image} videoUrl={m.videoUrl} w={44} h={55} />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
        </div>

        {/* ── WHAT MELLO CAN DO — the capability menu, always visible ── */}
        <div className="bs-col">
          <div style={label}>What Mello can do</div>
          <Row first href="/discovery" title="Remake a winner" desc="Their proven ad, rebuilt around your product." right={ARROW} />
          <Row href="/studio" title="Create a fresh ad" desc="An original, on-brand, from your product photos." right={ARROW} />
          <Row href="/studio" title="Make a UGC video" desc="A creator-style video, in your language." right={ARROW} />
          <Row href="/discovery/brand-spy" title="Spy on a competitor" desc="I’ll watch every ad they launch." right={ARROW} />
          <Row href="/settings" title="Make ads for me daily" desc="Pick how many — delivered every morning." right={AUTO} />
        </div>
      </div>

      <style>{`
        .bs-grid{display:grid;grid-template-columns:repeat(4,1fr)}
        .bs-col{border-right:1px solid ${LINE};padding:16px 18px 22px;min-width:0}
        .bs-col:last-child{border-right:none}
        .bs-mello-strip{display:none}
        .bs-row:hover .bs-t{color:${GREEN}}
        .bs-row:hover .bs-a{color:${GREEN};transform:translateX(3px)}
        @media(max-width:1199px){
          .bs-grid{grid-template-columns:repeat(2,1fr)}
          .bs-col:nth-child(2n){border-right:none}
          .bs-col:nth-child(-n+2){border-bottom:1px solid ${LINE}}
        }
        @media(max-width:859px){
          .bs-grid{grid-template-columns:1fr}
          .bs-col{border-right:none;border-bottom:1px solid ${LINE};padding:15px}
          .bs-col:last-child{border-bottom:none}
          /* the decision leads on a phone; Mello becomes one line above it */
          .bs-mello{order:-2;padding-bottom:13px}
          .bs-today{order:-1}
          .bs-mello-desk{display:none}
          .bs-mello-strip{display:flex;align-items:center;gap:11px}
        }
      `}</style>
    </div>
  )
}
