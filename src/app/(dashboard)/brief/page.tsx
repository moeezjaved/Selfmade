'use client'
/**
 * Morning Brief — the logged-in landing. Not a dashboard: Mello's daily report.
 * "I worked while you were sleeping" — overnight sweep numbers, then the news that matters,
 * heaviest first (competitor drops, creatives ready for review, rising angles). Every card is
 * a decision, not a chart. Quiet days say so out loud — an employee you trust is one who can
 * say "nothing needs you today."
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Eye, Sparkles, TrendingUp, ArrowRight, Radar, Sun } from 'lucide-react'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', LIME = '#dffe95', FOREST = '#17251c', GREEN = '#3f8f4f'

type Item = { id?: string; kind: string; importance: number; title: string; body?: string; cta_label?: string; cta_href?: string; thumbs?: string[]; at?: string }
type Brief = { summary: { adsScanned: number; brandsWatched: number; spiedBrands: number; creativesReady: number }; items: Item[]; quiet: boolean }

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

const KIND_ICON: Record<string, any> = { competitor_ads: Eye, creative_ready: Sparkles, trend: TrendingUp }
const KIND_TINT: Record<string, string> = { competitor_ads: '#eef6ff', creative_ready: '#f4fbe6', trend: '#fff7ed' }

export default function BriefPage() {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    fetch('/api/brief').then(r => r.ok ? r.json() : Promise.reject()).then(setBrief).catch(() => setErr(true))
  }, [])
  const h = new Date().getHours()
  const greet = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'

  const acted = (it: Item) => { if (it.id) fetch('/api/brief', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: it.id }) }).catch(() => {}) }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '28px 20px 80px', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* ── Mello's header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <MelloFace />
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, letterSpacing: '-.02em', color: INK }}>{greet} <span aria-hidden>👋</span></h1>
          <div style={{ fontSize: 13.5, color: MUTED, fontWeight: 600 }}>Mello&rsquo;s report · I worked while you were away.</div>
        </div>
      </div>

      {/* ── Overnight sweep ── */}
      {brief && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '18px 0 26px' }}>
          {[
            { icon: Radar, label: `Scanned ${brief.summary.adsScanned.toLocaleString()} new ads in the last 24h`, show: brief.summary.adsScanned > 0 },
            { icon: Eye, label: `Watching ${brief.summary.brandsWatched} competitor${brief.summary.brandsWatched === 1 ? '' : 's'} for you`, show: brief.summary.brandsWatched > 0 },
            { icon: Sparkles, label: `${brief.summary.creativesReady} creative${brief.summary.creativesReady === 1 ? '' : 's'} ready for review`, show: brief.summary.creativesReady > 0 },
          ].filter(c => c.show).map((c, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 100, padding: '8px 14px', fontSize: 12.5, fontWeight: 700, color: INK }}>
              <c.icon size={14} color={GREEN} /> {c.label}
            </span>
          ))}
        </div>
      )}

      {/* ── The report ── */}
      {!brief && !err && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[0, 1, 2].map(i => <div key={i} style={{ height: 92, borderRadius: 16, background: 'linear-gradient(100deg,#f2f5f1 30%,#fafbf9 50%,#f2f5f1 70%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />)}
          <style>{`@keyframes shimmer{to{background-position:-200% 0}}`}</style>
        </div>
      )}
      {err && <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: 22, color: MUTED, fontSize: 14 }}>I couldn&rsquo;t load the brief just now — refresh in a moment.</div>}

      {brief && brief.items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {brief.items.map((it, i) => {
            const Icon = KIND_ICON[it.kind] || Sun
            return (
              <div key={it.id || i} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, padding: '16px 18px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{ width: 38, height: 38, borderRadius: 11, background: KIND_TINT[it.kind] || '#f6f8f5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                  <Icon size={18} color={FOREST} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 750, color: INK, lineHeight: 1.4 }}>{it.title}</div>
                  {it.body && <div style={{ fontSize: 13, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{it.body}</div>}
                  {!!it.thumbs?.length && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      {it.thumbs.map((t, k) => (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img key={k} src={t} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: 'cover', border: `1px solid ${LINE}` }} />
                      ))}
                    </div>
                  )}
                  {it.cta_label && it.cta_href && (
                    <Link href={it.cta_href} onClick={() => acted(it)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12, background: FOREST, color: LIME, fontSize: 12.5, fontWeight: 800, padding: '8px 14px', borderRadius: 100, textDecoration: 'none' }}>
                      {it.cta_label} <ArrowRight size={13} />
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── The quiet day — a designed state, not an empty one ── */}
      {brief && brief.items.length === 0 && (
        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 20, padding: '30px 26px', textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: INK, marginBottom: 6 }}>Nothing needs you today.</div>
          <p style={{ fontSize: 13.5, color: MUTED, margin: '0 auto 18px', maxWidth: 420, lineHeight: 1.55 }}>
            No competitor moves worth reacting to, no work waiting on your approval. I&rsquo;m still watching — spy on a competitor or start an ad and tomorrow&rsquo;s brief gets more interesting.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/discovery/brand-spy" style={{ background: FOREST, color: LIME, fontSize: 13, fontWeight: 800, padding: '10px 18px', borderRadius: 100, textDecoration: 'none' }}>Spy on a competitor</Link>
            <Link href="/discovery" style={{ background: '#fff', color: INK, border: `1.5px solid ${LINE}`, fontSize: 13, fontWeight: 800, padding: '10px 18px', borderRadius: 100, textDecoration: 'none' }}>Browse winning ads</Link>
          </div>
        </div>
      )}
    </div>
  )
}
