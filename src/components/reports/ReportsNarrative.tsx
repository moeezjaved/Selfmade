'use client'
/**
 * ReportsNarrative — the Reports experience rebuilt from first principles.
 *
 * Not a dashboard: a MORNING DEBRIEF. Mello analyzed the account overnight and walks the founder
 * through it top-to-bottom, each section answering ONE question with a plain-English insight FIRST
 * and the evidence second. Data over iconography: bars, heat cells, quadrants, thumbnails,
 * confidence meters. Everything ranked best → worst. Under 30 seconds to full understanding.
 *
 *  1 · What happened?            — executive summary sentence
 *  2 · How healthy is the account? — score ring + component bars
 *  3 · Winners & losers          — ranked, with the actual ad creative
 *  4 · Where the money went      — proportional budget bar colored by return
 *  5 · The battlefield           — spend × ROAS quadrant map of creatives
 *  6 · Who's buying              — audience heat cells (no tables)
 *  7 · Where ads work            — placement ranking with heat bars
 *  8 · What Mello would do       — opportunity cards with expected impact + confidence
 *  9 · The rhythm                — day/hour heat strips (when buyers show up)
 *
 * All insights are computed deterministically from the same /api/reports payload the old page used —
 * honest numbers, no hallucinated analysis. Deep drill-downs stay below the fold on the page.
 */
import React, { useMemo, useState } from 'react'
import Link from 'next/link'

const INK = '#17251c', MUTED = '#6f7d70', FAINT = '#9aa79a', LINE = '#e9ece7', FOREST = '#17251c', LIME = '#dffe95'
const SERIF = "'Instrument Serif', Georgia, serif"
const CARD: React.CSSProperties = { background: '#fff', borderRadius: 18, boxShadow: '0 1px 2px rgba(17,24,17,.04), 0 12px 32px -20px rgba(17,24,17,.14)' }
const good = '#2f7d3a', warn = '#b7791f', bad = '#c0392b'
const roasColor = (r: number) => (r >= 2 ? good : r >= 1 ? warn : bad)

type Row = { label?: string; name?: string; roas: number; spend: number; revenue: number; conversions: number; ctr: number; cpa: number; thumbnail_url?: string; preview_url?: string; placement?: string; age_range?: string; gender?: string; device?: string; region?: string; hour?: string; day?: string }

const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))

/** Section shell: a numbered question + the one-line answer, then the evidence. */
function Section({ n, question, answer, children, tone }: { n: number; question: string; answer: React.ReactNode; children?: React.ReactNode; tone?: string }) {
  return (
    <section style={{ ...CARD, padding: '22px 24px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: FAINT, fontVariantNumeric: 'tabular-nums' }}>{String(n).padStart(2, '0')}</span>
        <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', color: tone || FAINT }}>{question}</span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 21, color: INK, lineHeight: 1.35, margin: '8px 0 0', letterSpacing: '-.005em', maxWidth: 720 }}>{answer}</div>
      {children && <div style={{ marginTop: 16 }}>{children}</div>}
    </section>
  )
}

const B = ({ children, c }: { children: React.ReactNode; c?: string }) => <b style={{ color: c || INK, fontWeight: 600 }}>{children}</b>

function Thumb({ src, size = 44, ring }: { src?: string; size?: number; ring?: string }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#f0f4ee', display: 'block', boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}>
      {src ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e: any) => { e.target.style.display = 'none' }} /> : null}
    </span>
  )
}

/** Confidence meter — 3 segments, filled by level. Reads at a glance, no numbers needed. */
function Confidence({ level }: { level: 1 | 2 | 3 }) {
  const label = level === 3 ? 'High confidence' : level === 2 ? 'Medium confidence' : 'Early signal'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ display: 'inline-flex', gap: 2 }}>
        {[1, 2, 3].map((i) => <span key={i} style={{ width: 12, height: 4, borderRadius: 2, background: i <= level ? (level === 3 ? good : level === 2 ? warn : FAINT) : '#e6eae4' }} />)}
      </span>
      <span style={{ fontSize: 11, color: MUTED, fontWeight: 650 }}>{label}</span>
    </span>
  )
}

export default function ReportsNarrative({ data, ca, currency, days }: { data: any; ca: any[]; currency: string; days: number }) {
  const [showAllRecs, setShowAllRecs] = useState(false)
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n || 0)

  const m = useMemo(() => {
    const o = data?.overview || {}
    const creatives: Row[] = (data?.creatives || []).map((c: any) => ({ ...c, label: c.name }))
    const placements: Row[] = (data?.placement || []).map((p: any) => ({ ...p, label: p.placement }))
    const ages: Row[] = (data?.age || []).map((a: any) => ({ ...a, label: a.age_range }))
    const genders: Row[] = (data?.gender || []).map((g: any) => ({ ...g, label: g.gender }))
    const hours: Row[] = (data?.hourly || []).map((h: any) => ({ ...h, label: String(h.hour) }))
    const dailies: Row[] = (data?.daily || []).map((d: any) => ({ ...d, label: d.day }))

    const spend = o.spend || 0, revenue = o.revenue || 0, roas = o.roas || 0, conv = o.conversions || 0
    const byRoas = [...creatives].filter(c => c.spend > 0).sort((a, b) => b.roas - a.roas)
    const winners = byRoas.filter(c => c.roas >= Math.max(1, roas)).slice(0, 3)
    const losers = [...byRoas].reverse().filter(c => c.roas < 1 && c.spend > 0).slice(0, 3)
    const bestPl = [...placements].sort((a, b) => b.roas - a.roas)[0]
    const worstPl = [...placements].filter(p => p.spend >= spend * 0.08).sort((a, b) => a.roas - b.roas)[0]
    const bestAge = [...ages].sort((a, b) => b.revenue - a.revenue)[0]
    const bestGender = [...genders].sort((a, b) => b.revenue - a.revenue)[0]
    const bestDay = [...dailies].sort((a, b) => b.revenue - a.revenue)[0]
    const bestHour = [...hours].sort((a, b) => b.revenue - a.revenue)[0]

    // Health components (0–100 each) — honest, explainable, no magic.
    const wastedSpend = creatives.filter(c => c.roas < 1).reduce((s, c) => s + c.spend, 0)
    const efficiency = spend > 0 ? Math.round(((spend - wastedSpend) / spend) * 100) : 0            // % of spend in profitable ads
    const returns = Math.round(clamp(roas / 3) * 100)                                               // 3x = full marks
    const topShare = spend > 0 && byRoas[0] ? byRoas[0].spend / spend : 0
    const resilience = Math.round(clamp(1 - Math.max(0, topShare - 0.45) / 0.55) * 100)             // not hostage to one ad
    const wCtr = spend > 0 ? creatives.reduce((s, c) => s + c.ctr * c.spend, 0) / spend : 0
    const attention = Math.round(clamp(wCtr / 2) * 100)                                             // 2% CTR = full marks
    const health = Math.round(returns * 0.4 + efficiency * 0.3 + resilience * 0.15 + attention * 0.15)
    const healthWord = health >= 75 ? 'in great shape' : health >= 55 ? 'healthy, with leaks to plug' : health >= 35 ? 'needs attention' : 'at risk'
    const healthTone = health >= 75 ? good : health >= 55 ? '#5b8f3e' : health >= 35 ? warn : bad

    // Opportunity cards — deterministic rules, each with an expected impact in currency.
    const recs: { title: string; why: string; impact: string; level: 1 | 2 | 3; href: string; cta: string; tone: string }[] = []
    const daysN = Math.max(1, days)
    if (losers[0]) {
      const monthly = (losers[0].spend / daysN) * 30 * (1 - losers[0].roas)
      recs.push({ title: `Pause “${losers[0].label}”`, why: `${fmt(losers[0].spend)} spent → ${losers[0].roas.toFixed(2)}x. Every day it runs, money leaks.`, impact: `saves ~${fmt(monthly)}/mo`, level: losers[0].spend > spend * 0.15 ? 3 : 2, href: '/campaigns', cta: 'Pause it', tone: bad })
    }
    if (winners[0] && winners[0].roas >= 1.5) {
      const extra = (winners[0].spend / daysN) * 30 * 0.2 * winners[0].roas
      recs.push({ title: `Scale “${winners[0].label}” +20%`, why: `${winners[0].roas.toFixed(2)}x vs ${roas.toFixed(2)}x account average — your proven winner has room.`, impact: `~+${fmt(extra)}/mo revenue`, level: winners[0].conversions >= 5 ? 3 : 2, href: '/campaigns', cta: 'Scale it', tone: good })
    }
    if (bestPl && worstPl && bestPl.label !== worstPl.label && bestPl.roas > worstPl.roas * 1.5) {
      const shift = worstPl.spend * 0.5
      recs.push({ title: `Shift budget ${worstPl.label} → ${bestPl.label}`, why: `${bestPl.label} returns ${bestPl.roas.toFixed(1)}x; ${worstPl.label} only ${worstPl.roas.toFixed(1)}x on ${fmt(worstPl.spend)}.`, impact: `~+${fmt(shift * (bestPl.roas - worstPl.roas) / daysN * 30)}/mo`, level: 2, href: '/campaigns', cta: 'Review placements', tone: warn })
    }
    if (bestAge && bestGender && spend > 0) {
      recs.push({ title: `Lean into ${bestGender.label === 'female' ? 'women' : bestGender.label === 'male' ? 'men' : bestGender.label} ${bestAge.label}`, why: `Your highest-revenue segment. Tightening targeting cuts wasted reach.`, impact: 'lower CPA', level: conv >= 10 ? 2 : 1, href: '/m4', cta: 'Target them', tone: good })
    }
    if (winners[0]) {
      recs.push({ title: `Make 3 variations of “${winners[0].label}”`, why: `Winners fatigue. Variations of a proven ad beat cold new concepts.`, impact: 'extends the winner', level: 2, href: '/creative-studio?studio=1', cta: 'Create in Studio', tone: good })
    }

    return { spend, revenue, roas, conv, creatives, byRoas, winners, losers, placements: [...placements].sort((a, b) => b.roas - a.roas), ages, genders, hours, dailies, bestPl, worstPl, bestAge, bestGender, bestDay, bestHour, health, healthWord, healthTone, efficiency, returns, resilience, attention, wastedSpend, recs }
  }, [data, days])   // eslint-disable-line react-hooks/exhaustive-deps

  if (!data?.overview) return null
  const profit = m.revenue - m.spend
  const maxHourRev = Math.max(...m.hours.map(h => h.revenue), 1)
  const maxDayRev = Math.max(...m.dailies.map(d => d.revenue), 1)
  const heat = (v: number, max: number) => `rgba(63,143,79,${(0.08 + clamp(v / max) * 0.85).toFixed(2)})`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── 01 · WHAT HAPPENED ── */}
      <Section n={1} question="What happened" tone={profit >= 0 ? good : bad}
        answer={<>You spent <B c={bad}>{fmt(m.spend)}</B> and made <B c={good}>{fmt(m.revenue)}</B> back — <B c={roasColor(m.roas)}>{m.roas.toFixed(2)}x</B>, {profit >= 0 ? <>a <B c={good}>{fmt(profit)}</B> profit</> : <>a <B c={bad}>{fmt(-profit)}</B> loss</>} over the last {days} days.
          {m.winners[0] && <> “<B>{m.winners[0].label}</B>” is carrying the account{m.losers[0] ? <>; “<B c={bad}>{m.losers[0].label}</B>” is burning budget.</> : '.'}</>}</>}>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          {[{ l: 'Spend', v: fmt(m.spend), c: INK }, { l: 'Revenue', v: fmt(m.revenue), c: good }, { l: 'ROAS', v: m.roas.toFixed(2) + 'x', c: roasColor(m.roas) }, { l: 'Purchases', v: String(m.conv), c: INK }].map(k => (
            <div key={k.l}><div style={{ fontFamily: SERIF, fontSize: 26, color: k.c, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div><div style={{ fontSize: 11, color: FAINT, fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>{k.l}</div></div>
          ))}
        </div>
      </Section>

      {/* ── 02 · HEALTH ── */}
      <Section n={2} question="Account health" tone={m.healthTone}
        answer={<>The account is <B c={m.healthTone}>{m.healthWord}</B>{m.wastedSpend > 0 && <> — {fmt(m.wastedSpend)} of spend sits in ads returning under 1x.</>}</>}>
        <div style={{ display: 'flex', gap: 26, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* score ring */}
          <div style={{ position: 'relative', width: 108, height: 108, flexShrink: 0 }}>
            <svg width="108" height="108" viewBox="0 0 108 108">
              <circle cx="54" cy="54" r="46" fill="none" stroke="#eef1ec" strokeWidth="10" />
              <circle cx="54" cy="54" r="46" fill="none" stroke={m.healthTone} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={`${(m.health / 100) * 289} 289`} transform="rotate(-90 54 54)" />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <div style={{ textAlign: 'center' }}><div style={{ fontFamily: SERIF, fontSize: 30, color: INK, lineHeight: 1 }}>{m.health}</div><div style={{ fontSize: 9.5, color: FAINT, fontWeight: 800, letterSpacing: '.08em' }}>/ 100</div></div>
            </div>
          </div>
          {/* component bars */}
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[{ l: 'Returns', s: m.returns, d: 'how far each dollar goes' }, { l: 'Efficiency', s: m.efficiency, d: '% of spend in profitable ads' }, { l: 'Resilience', s: m.resilience, d: 'not hostage to one ad' }, { l: 'Attention', s: m.attention, d: 'how hard creatives stop the scroll' }].map(c => (
              <div key={c.l}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{c.l} <span style={{ color: FAINT, fontWeight: 500 }}>· {c.d}</span></span>
                  <span style={{ fontSize: 12.5, fontWeight: 750, color: c.s >= 70 ? good : c.s >= 40 ? warn : bad, fontVariantNumeric: 'tabular-nums' }}>{c.s}</span>
                </div>
                <div style={{ height: 6, background: '#eef1ec', borderRadius: 100 }}><div style={{ height: '100%', width: `${c.s}%`, borderRadius: 100, background: c.s >= 70 ? good : c.s >= 40 ? warn : bad, transition: 'width .4s' }} /></div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 03 · WINNERS & LOSERS ── */}
      <Section n={3} question="Winners & losers"
        answer={m.winners[0]
          ? <>Double down on <B c={good}>{m.winners.length} winner{m.winners.length === 1 ? '' : 's'}</B>{m.losers.length ? <>; cut <B c={bad}>{m.losers.length} loser{m.losers.length === 1 ? '' : 's'}</B> before they spend more.</> : ' — nothing needs cutting.'}</>
          : <>No clear winner yet — the account needs more conversions before the ranking means anything.</>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px,100%), 1fr))', gap: 14 }}>
          {[{ rows: m.winners, tone: good, tag: 'KEEP FEEDING' }, { rows: m.losers, tone: bad, tag: 'STOP THE BLEED' }].map((col, ci) => col.rows.length > 0 && (
            <div key={ci} style={{ border: `1px solid ${LINE}`, borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '8px 14px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.08em', color: col.tone, background: ci === 0 ? 'rgba(47,125,58,.06)' : 'rgba(192,57,43,.05)' }}>{col.tag}</div>
              {col.rows.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: `1px solid ${LINE}` }}>
                  <Thumb src={c.thumbnail_url} ring={col.tone} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</div>
                    <div style={{ fontSize: 11.5, color: MUTED, marginTop: 1 }}>{fmt(c.spend)} → {fmt(c.revenue)} · {c.conversions} sale{c.conversions === 1 ? '' : 's'}</div>
                  </div>
                  <span style={{ fontFamily: SERIF, fontSize: 19, color: col.tone, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{c.roas.toFixed(2)}x</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      {/* ── 04 · WHERE THE MONEY WENT ── */}
      <Section n={4} question="Where the money went"
        answer={m.byRoas[0] ? <>“<B>{[...m.creatives].sort((a, b) => b.spend - a.spend)[0]?.label}</B>” took the biggest share of budget — {m.wastedSpend > 0 ? <><B c={bad}>{Math.round((m.wastedSpend / Math.max(m.spend, 1)) * 100)}%</B> of all spend went to ads that didn't pay for themselves.</> : 'and every ad paid for itself.'}</> : <>No spend recorded in this window.</>}>
        {/* proportional allocation bar — width = spend share, color = return quality */}
        <div style={{ display: 'flex', height: 46, borderRadius: 12, overflow: 'hidden', gap: 2 }}>
          {[...m.creatives].sort((a, b) => b.spend - a.spend).slice(0, 8).map((c, i) => (
            <div key={i} title={`${c.label}: ${fmt(c.spend)} at ${c.roas.toFixed(2)}x`}
              style={{ flexGrow: Math.max(c.spend, 0.01), flexBasis: 0, minWidth: 8, background: roasColor(c.roas), opacity: 0.55 + clamp(c.roas / 4) * 0.45, position: 'relative' }} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10 }}>
          {[...m.creatives].sort((a, b) => b.spend - a.spend).slice(0, 5).map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: MUTED }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: roasColor(c.roas) }} />
              <span style={{ fontWeight: 650, color: INK, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
              {Math.round((c.spend / Math.max(m.spend, 1)) * 100)}%
            </span>
          ))}
        </div>
      </Section>

      {/* ── 05 · THE BATTLEFIELD ── */}
      {m.byRoas.length >= 2 && (
        <Section n={5} question="The creative battlefield"
          answer={<>Each ad, placed by <B>spend</B> (→) and <B>return</B> (↑). Top-left = hidden gems worth feeding; bottom-right = expensive mistakes.</>}>
          <div style={{ position: 'relative', height: 240, background: 'linear-gradient(to top right, rgba(192,57,43,.04), rgba(47,125,58,.05))', borderRadius: 14, border: `1px solid ${LINE}` }}>
            {/* quadrant labels */}
            <span style={{ position: 'absolute', top: 8, left: 12, fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: good, opacity: .75 }}>HIDDEN GEMS</span>
            <span style={{ position: 'absolute', top: 8, right: 12, fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: good }}>SCALE THESE</span>
            <span style={{ position: 'absolute', bottom: 8, left: 12, fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: FAINT }}>STILL TESTING</span>
            <span style={{ position: 'absolute', bottom: 8, right: 12, fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: bad }}>MONEY PIT</span>
            {(() => {
              const maxS = Math.max(...m.byRoas.map(c => c.spend), 1)
              const maxR = Math.max(...m.byRoas.map(c => c.roas), 1)
              return m.byRoas.slice(0, 10).map((c, i) => (
                <a key={i} href={c.preview_url || '#'} target={c.preview_url ? '_blank' : undefined} rel="noreferrer" title={`${c.label} — ${fmt(c.spend)} at ${c.roas.toFixed(2)}x`}
                  style={{ position: 'absolute', left: `calc(${8 + clamp(c.spend / maxS) * 78}% )`, bottom: `calc(${12 + clamp(c.roas / maxR) * 68}% )`, transform: 'translate(-50%, 50%)' }}>
                  <Thumb src={c.thumbnail_url} size={40} ring={roasColor(c.roas)} />
                </a>
              ))
            })()}
          </div>
        </Section>
      )}

      {/* ── 06 · WHO'S BUYING ── */}
      {(m.ages.length > 0 || m.genders.length > 0) && (
        <Section n={6} question="Who's buying"
          answer={m.bestAge ? <><B>{m.bestGender ? (m.bestGender.label === 'female' ? 'Women' : m.bestGender.label === 'male' ? 'Men' : 'People') : 'People'} {m.bestAge.label}</B> drive the most revenue{m.bestAge.roas >= 1 ? <> at a profitable <B c={good}>{m.bestAge.roas.toFixed(1)}x</B></> : ''} — aim the next campaign at them.</> : <>Not enough audience data yet.</>}>
          {/* age heat row */}
          {m.ages.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${m.ages.length}, 1fr)`, gap: 6 }}>
              {[...m.ages].sort((a, b) => (a.label || '').localeCompare(b.label || '')).map((a, i) => (
                <div key={i} title={`${a.label}: ${fmt(a.revenue)} revenue · ${a.roas.toFixed(2)}x`}
                  style={{ background: heat(a.revenue, Math.max(...m.ages.map(x => x.revenue), 1)), borderRadius: 10, padding: '12px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: INK }}>{a.label}</div>
                  <div style={{ fontFamily: SERIF, fontSize: 17, color: roasColor(a.roas), marginTop: 3 }}>{a.roas.toFixed(1)}x</div>
                  <div style={{ fontSize: 10.5, color: MUTED, marginTop: 1 }}>{fmt(a.revenue)}</div>
                </div>
              ))}
            </div>
          )}
          {/* gender split */}
          {m.genders.length > 1 && (
            <div style={{ display: 'flex', height: 34, borderRadius: 10, overflow: 'hidden', marginTop: 10, gap: 2 }}>
              {m.genders.map((g, i) => (
                <div key={i} style={{ flexGrow: Math.max(g.revenue, 0.01), flexBasis: 0, background: g.label === 'female' ? '#b56576' : g.label === 'male' ? '#5b7c99' : '#a8b0a6', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 70 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: '#fff', textTransform: 'capitalize' }}>{g.label}</span>
                  <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,.85)' }}>{fmt(g.revenue)} · {g.roas.toFixed(1)}x</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* ── 07 · WHERE ADS WORK ── */}
      {m.placements.length > 0 && (
        <Section n={7} question="Where ads work"
          answer={m.bestPl ? <><B>{m.bestPl.label}</B> is your best surface at <B c={good}>{m.bestPl.roas.toFixed(1)}x</B>{m.worstPl && m.worstPl.label !== m.bestPl.label ? <> — while <B c={bad}>{m.worstPl.label}</B> takes {fmt(m.worstPl.spend)} and returns {m.worstPl.roas.toFixed(1)}x.</> : '.'}</> : <>No placement data yet.</>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {m.placements.slice(0, 6).map((p, i) => {
              const maxR = Math.max(...m.placements.map(x => x.roas), 1)
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr auto', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                  <div style={{ height: 20, background: '#f0f3ee', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${clamp(p.roas / maxR) * 100}%`, background: roasColor(p.roas), opacity: .85, borderRadius: 6, display: 'flex', alignItems: 'center', paddingLeft: 8 }}>
                      <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff' }}>{p.roas.toFixed(1)}x</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 11.5, color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{fmt(p.spend)}</span>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* ── 08 · WHAT MELLO WOULD DO ── */}
      {m.recs.length > 0 && (
        <Section n={8} question="What Mello would do" tone={good}
          answer={<>The {m.recs.length} moves that matter, ranked by impact — each with what it's worth and how sure I am.</>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(290px,100%), 1fr))', gap: 12 }}>
            {(showAllRecs ? m.recs : m.recs.slice(0, 3)).map((r, i) => (
              <div key={i} style={{ border: `1px solid ${LINE}`, borderLeft: `3px solid ${r.tone}`, borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 750, color: INK, letterSpacing: '-.01em' }}>{r.title}</div>
                <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5, flex: 1 }}>{r.why}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: r.tone }}>{r.impact}</span>
                  <Confidence level={r.level} />
                </div>
                <Link href={r.href} style={{ alignSelf: 'flex-start', background: FOREST, color: LIME, borderRadius: 100, padding: '8px 16px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', marginTop: 2 }}>{r.cta} →</Link>
              </div>
            ))}
          </div>
          {m.recs.length > 3 && (
            <button onClick={() => setShowAllRecs(s => !s)} style={{ marginTop: 12, background: 'none', border: 'none', color: '#3f8f4f', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              {showAllRecs ? 'Show fewer' : `Show ${m.recs.length - 3} more moves`} →
            </button>
          )}
        </Section>
      )}

      {/* ── 09 · THE RHYTHM ── */}
      {(m.hours.length > 0 || m.dailies.length > 0) && (
        <Section n={9} question="When buyers show up"
          answer={<>{m.bestDay && <><B>{m.bestDay.label}</B> is your money day</>}{m.bestDay && m.bestHour && ' — '}{m.bestHour && <>revenue peaks around <B>{m.bestHour.label}:00</B></>}.</>}>
          {m.dailies.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${m.dailies.length}, 1fr)`, gap: 5, marginBottom: m.hours.length ? 10 : 0 }}>
              {m.dailies.map((d, i) => (
                <div key={i} title={`${d.label}: ${fmt(d.revenue)} revenue`} style={{ background: heat(d.revenue, maxDayRev), borderRadius: 8, padding: '9px 4px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: INK }}>{(d.label || '').slice(0, 3)}</div>
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{fmt(d.revenue)}</div>
                </div>
              ))}
            </div>
          )}
          {m.hours.length > 0 && (
            <div style={{ display: 'flex', gap: 2 }}>
              {[...m.hours].sort((a, b) => Number(a.label) - Number(b.label)).map((h, i) => (
                <div key={i} title={`${h.label}:00 — ${fmt(h.revenue)} revenue`} style={{ flex: 1, height: 26, borderRadius: 4, background: heat(h.revenue, maxHourRev) }} />
              ))}
            </div>
          )}
          {m.hours.length > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: FAINT, marginTop: 4 }}><span>midnight</span><span>noon</span><span>11pm</span></div>}
        </Section>
      )}
    </div>
  )
}
