'use client'
/**
 * Morning Brief — Mello's daily report. A DOCUMENT, not a feed:
 *   greeting → overnight report → today's ONE decision (0 or 1, never more) →
 *   "From your market" → "Worth learning today" → signed sign-off. It ENDS.
 * Rules the design enforces:
 *   · every card answers "why should I care?" (the why-chip)
 *   · evidence lives in the EXPANDED state — collapsed cards stay one calm line
 *   · no numeric confidence theater; qualitative evidence until outcomes are wired
 *   · quiet days are a recommendation to do nothing (the trust device)
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, Sparkles, TrendingUp, ArrowRight, Radar, Sun, GraduationCap, ChevronDown } from 'lucide-react'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', LIME = '#dffe95', FOREST = '#17251c', GREEN = '#3f8f4f'

type Item = { id?: string; kind: string; importance: number; title: string; body?: string; why?: string; cta_label?: string; cta_href?: string; thumbs?: string[]; at?: string }
type Brief = {
  summary: { adsScanned: number; brandsWatched: number; spiedBrands: number; creativesReady: number }
  headline: Item | null
  items: Item[]
  learning: Item | null
  quiet: boolean
}

function MelloFace({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160">
      <rect x="34" y="30" width="92" height="96" rx="34" fill={LIME} stroke={FOREST} strokeWidth="4" />
      <path d="M60 30v-12M100 30v-12" stroke={FOREST} strokeWidth="4" strokeLinecap="round" />
      <circle cx="60" cy="16" r="5" fill="#7be0a0" stroke={FOREST} strokeWidth="4" />
      <circle cx="100" cy="16" r="5" fill="#7be0a0" stroke={FOREST} strokeWidth="4" />
      <rect x="52" y="60" width="56" height="34" rx="17" fill="#fff" stroke={FOREST} strokeWidth="4" />
      <circle cx="70" cy="77" r="7" fill={FOREST} /><circle cx="90" cy="77" r="7" fill={FOREST} />
      <circle cx="72" cy="75" r="2.4" fill="#fff" /><circle cx="92" cy="75" r="2.4" fill="#fff" />
      <path d="M70 104q10 8 20 0" stroke={FOREST} strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  )
}

const KIND_ICON: Record<string, any> = { competitor_ads: Eye, creative_ready: Sparkles, trend: TrendingUp, learning: GraduationCap }
const KIND_TINT: Record<string, string> = { competitor_ads: '#eef6ff', creative_ready: '#f4fbe6', trend: '#fff7ed', learning: '#f6f1ff' }

function SectionHead({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.13em', textTransform: 'uppercase', color: MUTED, margin: '30px 0 12px' }}>{children}</div>
}

/** One collapsed-calm / expanded-evidence card. Collapsed = title + why. Expanded = body + thumbs + CTA. */
function BriefCard({ it, onAct }: { it: Item; onAct: (it: Item) => void }) {
  const [open, setOpen] = useState(false)
  const Icon = KIND_ICON[it.kind] || Sun
  const expandable = !!(it.body || it.thumbs?.length)
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, marginBottom: 10, overflow: 'hidden' }}>
      <button onClick={() => expandable && setOpen(o => !o)} style={{ all: 'unset', boxSizing: 'border-box', display: 'flex', gap: 14, alignItems: 'flex-start', padding: '16px 18px', width: '100%', cursor: expandable ? 'pointer' : 'default' }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: KIND_TINT[it.kind] || '#f6f8f5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
          <Icon size={18} color={FOREST} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 15, fontWeight: 750, color: INK, lineHeight: 1.4 }}>{it.title}</span>
          {it.why && <span style={{ display: 'inline-block', fontSize: 11.5, color: '#2c4a1f', background: '#f4fbe6', borderRadius: 8, padding: '3px 9px', fontWeight: 700, marginTop: 7 }}>Why you care: {it.why}</span>}
        </span>
        {expandable && <ChevronDown size={16} color={MUTED} style={{ flexShrink: 0, marginTop: 6, transition: 'transform .25s', transform: open ? 'rotate(180deg)' : 'none' }} />}
      </button>
      {/* Evidence drawer — the expanded state carries the detail so the collapsed brief stays calm. */}
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .3s cubic-bezier(0,0,.2,1)' }}>
        <div style={{ overflow: 'hidden' }}>
          <div style={{ padding: '0 18px 16px 70px' }}>
            {it.body && <div style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.6 }}>{it.body}</div>}
            {!!it.thumbs?.length && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {it.thumbs.map((t, k) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img key={k} src={t} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', border: `1px solid ${LINE}` }} />
                ))}
              </div>
            )}
            {it.cta_label && it.cta_href && (
              <Link href={it.cta_href} onClick={() => onAct(it)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: FOREST, color: LIME, fontSize: 12.5, fontWeight: 800, padding: '8px 14px', borderRadius: 100, textDecoration: 'none' }}>
                {it.cta_label} <ArrowRight size={13} />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BriefPage() {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [err, setErr] = useState(false)
  const [headlineGone, setHeadlineGone] = useState<null | 'ignored'>(null)
  const [showReasoning, setShowReasoning] = useState(false)
  useEffect(() => {
    fetch('/api/brief').then(r => r.ok ? r.json() : Promise.reject()).then(setBrief).catch(() => setErr(true))
  }, [])
  const h = new Date().getHours()
  const greet = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  const acted = (it: Item) => { if (it.id) fetch('/api/brief', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: it.id }) }).catch(() => {}) }

  const market = brief?.items.filter(i => i.kind === 'competitor_ads' || i.kind === 'trend') || []
  const suggests = brief?.items.filter(i => i.kind !== 'competitor_ads' && i.kind !== 'trend') || []
  const headline = headlineGone ? null : brief?.headline

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '28px 20px 90px', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* ── 1. Greeting ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <MelloFace />
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: INK }}>{greet} <span aria-hidden>👋</span></h1>
          <div style={{ fontSize: 13.5, color: MUTED, fontWeight: 600 }}>{new Date().toLocaleDateString('en-US', { weekday: 'long' })} brief · I worked while you were away.</div>
        </div>
      </div>

      {/* ── Overnight report ── */}
      {brief && (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '6px 18px', margin: '18px 0 0' }}>
          {[
            { label: <>Analyzed <b>{brief.summary.adsScanned.toLocaleString()} ads</b> across the market in the last 24h</>, show: brief.summary.adsScanned > 0 },
            { label: <>Watched <b>{brief.summary.brandsWatched} competitor{brief.summary.brandsWatched === 1 ? '' : 's'}</b> for you</>, show: brief.summary.brandsWatched > 0 },
            { label: <>Prepared <b>{brief.summary.creativesReady} creative{brief.summary.creativesReady === 1 ? '' : 's'}</b> for your review</>, show: brief.summary.creativesReady > 0 },
            { label: <>Found <b>{brief.items.length} thing{brief.items.length === 1 ? '' : 's'}</b> worth your attention today</>, show: brief.items.length > 0 },
          ].filter(r => r.show).map((r, i, arr) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px dashed #eef2ec' : 'none', fontSize: 14 }}>
              <span style={{ color: GREEN, fontWeight: 900, fontSize: 13 }}>✓</span>
              <span style={{ color: INK }}>{r.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* loading / error */}
      {!brief && !err && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ height: 92, borderRadius: 16, background: 'linear-gradient(100deg,#f2f5f1 30%,#fafbf9 50%,#f2f5f1 70%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />)}
          <style>{`@keyframes shimmer{to{background-position:-200% 0}}`}</style>
        </div>
      )}
      {err && <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 22, color: MUTED, fontSize: 14, marginTop: 18 }}>I couldn&rsquo;t load the brief just now — refresh in a moment.</div>}

      {/* ── 2. Today's ONE decision (0 or 1 — never more) ── */}
      {headline && (
        <>
          <SectionHead>Today&rsquo;s decision</SectionHead>
          <div style={{ background: 'linear-gradient(120deg,#f4fbe6,#eefbd2)', border: '1px solid #cfe9a4', borderRadius: 20, padding: '22px 24px' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: INK, letterSpacing: '-.01em', lineHeight: 1.35 }}>{headline.title}</div>
            {headline.why && <div style={{ fontSize: 12.5, color: '#4c6b3c', fontWeight: 600, marginTop: 6 }}>{headline.why}</div>}
            {!!headline.thumbs?.length && (
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                {headline.thumbs.map((t, k) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img key={k} src={t} alt="" style={{ width: 84, height: 100, borderRadius: 12, objectFit: 'cover', border: '1px solid #cfe9a4' }} />
                ))}
              </div>
            )}
            {showReasoning && headline.body && (
              <div style={{ marginTop: 12, fontSize: 13.5, color: '#3c5233', lineHeight: 1.6, background: '#ffffffa8', borderRadius: 12, padding: '11px 14px' }}>{headline.body}</div>
            )}
            <div style={{ display: 'flex', gap: 9, marginTop: 16, flexWrap: 'wrap' }}>
              {headline.cta_href && (
                <Link href={headline.cta_href} onClick={() => acted(headline)} style={{ background: FOREST, color: LIME, fontSize: 13, fontWeight: 800, padding: '10px 18px', borderRadius: 100, textDecoration: 'none' }}>
                  ✓ {headline.cta_label || 'Review & approve'}
                </Link>
              )}
              <button onClick={() => setShowReasoning(s => !s)} style={{ background: '#fff', color: INK, border: '1.5px solid #cfe9a4', fontSize: 13, fontWeight: 800, padding: '10px 18px', borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit' }}>
                {showReasoning ? 'Hide my reasoning' : 'See my reasoning'}
              </button>
              <button onClick={() => { acted(headline); setHeadlineGone('ignored') }} style={{ background: 'transparent', color: MUTED, border: 'none', fontSize: 13, fontWeight: 700, padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                Not today
              </button>
            </div>
          </div>
        </>
      )}
      {headlineGone === 'ignored' && (
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 10, paddingLeft: 4 }}>Noted — I&rsquo;ll keep it in My Creatives if you change your mind.</div>
      )}

      {/* ── 3. Market intelligence ── */}
      {market.length > 0 && (
        <>
          <SectionHead>From your market</SectionHead>
          {market.map((it, i) => <BriefCard key={it.id || `m${i}`} it={it} onAct={acted} />)}
        </>
      )}

      {/* ── 4. Mello's suggestions (spine insights etc.) ── */}
      {suggests.length > 0 && (
        <>
          <SectionHead>I also noticed</SectionHead>
          {suggests.map((it, i) => <BriefCard key={it.id || `s${i}`} it={it} onAct={acted} />)}
        </>
      )}

      {/* ── 5. One lesson a day ── */}
      {brief?.learning && (
        <>
          <SectionHead>Worth learning today</SectionHead>
          <BriefCard it={brief.learning} onAct={acted} />
        </>
      )}

      {/* ── 6. Quiet day — a recommendation, not an empty state ── */}
      {brief && brief.quiet && (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: '30px 26px', textAlign: 'center', marginTop: 22 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: INK, marginBottom: 6 }}>Nothing needs you today.</div>
          <p style={{ fontSize: 13.5, color: MUTED, margin: '0 auto 18px', maxWidth: 420, lineHeight: 1.55 }}>
            No competitor moves worth reacting to, no work waiting on your approval. My recommendation: don&rsquo;t spend today. I&rsquo;m still watching — spy on a competitor and tomorrow&rsquo;s brief gets sharper.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/discovery/brand-spy" style={{ background: FOREST, color: LIME, fontSize: 13, fontWeight: 800, padding: '10px 18px', borderRadius: 100, textDecoration: 'none' }}>Spy on a competitor</Link>
            <Link href="/discovery" style={{ background: '#fff', color: INK, border: `1.5px solid ${LINE}`, fontSize: 13, fontWeight: 800, padding: '10px 18px', borderRadius: 100, textDecoration: 'none' }}>Browse winning ads</Link>
          </div>
        </div>
      )}

      {/* ── 7. Sign-off — the brief ENDS. That's the point. ── */}
      {brief && !brief.quiet && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginTop: 34, color: MUTED, fontSize: 13, fontWeight: 600 }}>
          <span style={{ width: 34, height: 1, background: LINE }} />
          That&rsquo;s everything worth your time today. — Mello
          <span style={{ width: 34, height: 1, background: LINE }} />
        </div>
      )}
    </div>
  )
}
