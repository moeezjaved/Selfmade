'use client'
/**
 * The Standup — Mello's daily briefing as a CONVERSATION, not a document.
 * The four laws it runs on (see the design doc):
 *   1. The machine speaks first — Mello opens with an agenda ("Three things — ninety seconds").
 *   2. Meetings end — the standup has a sign-off; it is finite.
 *   3. Work arrives finished — the headline is a decision with the creative already made.
 *   4. Memory is spoken — replies run through the real Mello agent, which can cite live data.
 * You can interrupt any turn in plain language; Mello answers inline (/api/brief/reply).
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ArrowUp } from 'lucide-react'

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', LIME = '#dffe95', FOREST = '#17251c', GREEN = '#3f8f4f'

type Item = { id?: string; kind: string; importance: number; title: string; body?: string; why?: string; cta_label?: string; cta_href?: string; thumbs?: string[]; media?: { image: string | null; videoUrl: string | null }[]; at?: string }
type Brief = {
  summary: { adsScanned: number; brandsWatched: number; spiedBrands: number; creativesReady: number }
  firstName: string | null
  headline: Item | null
  items: Item[]
  learning: Item | null
  quiet: boolean
}
type Turn =
  | { who: 'mello'; kind: 'say'; text: React.ReactNode }
  | { who: 'mello'; kind: 'item'; n: string; item: Item; agenda?: boolean }
  | { who: 'mello'; kind: 'signoff'; text: string }
  | { who: 'user'; text: string }
  | { who: 'mello'; kind: 'reply'; text: string; pending?: boolean }

function MelloFace({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
      <rect x="34" y="30" width="92" height="96" rx="34" fill={LIME} stroke={FOREST} strokeWidth="5" />
      <path d="M60 30v-12M100 30v-12" stroke={FOREST} strokeWidth="5" strokeLinecap="round" />
      <circle cx="60" cy="16" r="5" fill="#7be0a0" stroke={FOREST} strokeWidth="5" />
      <circle cx="100" cy="16" r="5" fill="#7be0a0" stroke={FOREST} strokeWidth="5" />
      <rect x="52" y="60" width="56" height="34" rx="17" fill="#fff" stroke={FOREST} strokeWidth="5" />
      <circle cx="70" cy="77" r="7.5" fill={FOREST} /><circle cx="90" cy="77" r="7.5" fill={FOREST} />
      <path d="M70 104q10 8 20 0" stroke={FOREST} strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/** A creative thumbnail that quietly handles video (Mello's video creatives are .mp4) — shows the
 *  first frame with a play glyph instead of a broken <img>. */
function Thumb({ src, w = 78, h = 96 }: { src: string; w?: number; h?: number }) {
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)
  const box: React.CSSProperties = { width: w, height: h, borderRadius: 12, objectFit: 'cover', border: `1px solid ${LINE}`, background: '#0d120e', display: 'block' }
  if (isVideo) {
    return (
      <span style={{ position: 'relative', display: 'inline-block' }}>
        <video src={src} muted playsInline preload="metadata" style={box} />
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 18, textShadow: '0 2px 8px rgba(0,0,0,.5)', pointerEvents: 'none' }}>▶</span>
      </span>
    )
  }
  /* eslint-disable-next-line @next/next/no-img-element */
  return <img src={src} alt="" style={box} />
}

/** A competitor-ad preview: poster image, and if it's a video, hover to play a few seconds inline. */
function AdPreview({ image, videoUrl, w = 62, h = 78 }: { image: string | null; videoUrl: string | null; w?: number; h?: number }) {
  const ref = useRef<HTMLVideoElement | null>(null)
  const box: React.CSSProperties = { width: w, height: h, borderRadius: 10, objectFit: 'cover', border: `1px solid ${LINE}`, background: '#0d120e', display: 'block' }
  if (videoUrl) {
    return (
      <span style={{ position: 'relative', display: 'inline-block' }}
        onMouseEnter={() => { const v = ref.current; if (v) { v.currentTime = 0; v.play().catch(() => {}) } }}
        onMouseLeave={() => { const v = ref.current; if (v) { v.pause() } }}>
        <video ref={ref} src={videoUrl} poster={image || undefined} muted loop playsInline preload="metadata" style={box} />
        <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 15, textShadow: '0 2px 8px rgba(0,0,0,.55)', pointerEvents: 'none' }}>▶</span>
      </span>
    )
  }
  if (image) /* eslint-disable-next-line @next/next/no-img-element */ return <img src={image} alt="" style={box} />
  return <span style={box} />
}

/** A line Mello speaks — appears with a gentle rise so the standup has a spoken rhythm on first load. */
function Say({ children, delay = 0, big = false }: { children: React.ReactNode; delay?: number; big?: boolean }) {
  const [shown, setShown] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShown(true), delay); return () => clearTimeout(t) }, [delay])
  return (
    <div style={{ opacity: shown ? 1 : 0, transform: shown ? 'none' : 'translateY(10px)', transition: 'opacity .5s cubic-bezier(0,0,.2,1), transform .5s cubic-bezier(0,0,.2,1)', fontSize: big ? 19 : 16, fontWeight: big ? 700 : 400, letterSpacing: big ? '-.015em' : 0, lineHeight: 1.65, color: INK, margin: '0 0 16px' }}>
      {children}
    </div>
  )
}

export default function StandupPage() {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [err, setErr] = useState(false)
  const [thread, setThread] = useState<Turn[]>([])          // the live conversation after the agenda
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [focusItem, setFocusItem] = useState<Item | null>(null)   // what the composer is "about"
  const [headlineState, setHeadlineState] = useState<null | 'approved' | 'passed'>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fetch('/api/brief').then(r => r.ok ? r.json() : Promise.reject()).then((b: Brief) => { setBrief(b); setFocusItem(b.headline || b.items[0] || null) }).catch(() => setErr(true)) }, [])
  useEffect(() => { if (thread.length) endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [thread])

  const h = new Date().getHours()
  const greet = h < 5 ? 'Late one' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'
  const agendaItems = brief ? [...(brief.headline ? [brief.headline] : []), ...brief.items] : []
  const count = agendaItems.length
  const numword = (i: number) => ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'][i] || `${i + 1}`

  // Send a reply to Mello (grounded by the real agent). `about` = the item being discussed, for context.
  async function say(text: string, about?: Item | null) {
    const q = text.trim()
    if (!q || busy) return
    setDraft('')
    setThread(t => [...t, { who: 'user', text: q }, { who: 'mello', kind: 'reply', text: '', pending: true }])
    setBusy(true)
    try {
      const r = await fetch('/api/brief/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, item: about ? { title: about.title, body: about.body } : (focusItem ? { title: focusItem.title, body: focusItem.body } : undefined) }) })
      const j = await r.json().catch(() => ({}))
      setThread(t => { const c = [...t]; const last = c[c.length - 1]; if (last && last.who === 'mello' && (last as any).kind === 'reply') (c[c.length - 1] as any) = { who: 'mello', kind: 'reply', text: j.reply || 'Got it.' }; return c })
    } catch {
      setThread(t => { const c = [...t]; (c[c.length - 1] as any) = { who: 'mello', kind: 'reply', text: 'I hit a snag — try me again in a moment.' }; return c })
    } finally { setBusy(false) }
  }

  const markActed = (it: Item) => { if (it.id) fetch('/api/brief', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: it.id }) }).catch(() => {}) }
  // Day-30 memory: log approve/kill decisions so Mello can cite them later ("you passed on this on Jul 23").
  const logDecision = (content: string) =>
    fetch('/api/interview/notebook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: [{ kind: 'decision', content }], source: 'standup' }) }).catch(() => {})

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', padding: '26px 20px 150px', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* header — Mello is present, not a page title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingBottom: 20, marginBottom: 22, borderBottom: `1px solid ${LINE}` }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <MelloFace />
          <span style={{ position: 'absolute', right: -2, bottom: 0, width: 9, height: 9, borderRadius: '50%', background: GREEN, border: '2px solid #fff', animation: 'mp 2s infinite' }} />
        </span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: INK, letterSpacing: '-.01em' }}>Mello</div>
          <div style={{ fontSize: 11.5, color: MUTED }}>Daily standup · {new Date().toLocaleDateString('en-US', { weekday: 'long' })}</div>
        </div>
        <style>{`@keyframes mp{50%{opacity:.35}}`}</style>
      </div>

      {/* loading / error */}
      {!brief && !err && <div style={{ color: MUTED, fontSize: 15 }}><span style={{ opacity: .7 }}>Mello is pulling the room together…</span></div>}
      {err && <div style={{ color: MUTED, fontSize: 15 }}>I couldn&rsquo;t start the standup — refresh in a moment.</div>}

      {brief && (
        <>
          {/* ── Mello opens: greeting + agenda count ── */}
          <Say delay={80} big>{greet}{brief.firstName ? `, ${brief.firstName}` : ''}.{' '}
            {brief.quiet ? 'Quiet night — nothing needs you today.' : count === 1 ? 'One thing, then you&rsquo;re done.' : `${count} things — ninety seconds.`}
          </Say>

          {/* ── the overnight report, spoken in one line ── */}
          <Say delay={260}>
            <span style={{ color: MUTED }}>
              Last night I read <b style={{ color: INK }}>{brief.summary.adsScanned.toLocaleString()} ads</b>
              {brief.summary.brandsWatched > 0 && <> and checked your <b style={{ color: INK }}>{brief.summary.brandsWatched} competitor{brief.summary.brandsWatched === 1 ? '' : 's'}</b></>}.
              {brief.quiet ? ' Routine rotation only — my recommendation is don’t spend today.' : ' Here’s what matters.'}
            </span>
          </Say>

          {/* ── agenda: each item spoken as a numbered turn ── */}
          {agendaItems.map((it, i) => {
            const isHeadline = brief.headline && it === brief.headline
            const quick = isHeadline
              ? ['Ship it', 'Why this one?', 'Not today']
              : it.kind === 'competitor_ads' ? ['Respond to this', 'Why does it matter?']
              : it.kind === 'trend' ? ['Draft one for me', 'Show me the ads']
              : ['Tell me more', 'Why?']
            return (
              <div key={it.id || i}>
                <Say delay={420 + i * 200}>
                  <b style={{ fontWeight: 800 }}>{numword(i)}.</b>{' '}{it.title}
                  {it.why && <span style={{ display: 'block', fontSize: 13, color: GREEN, fontWeight: 600, marginTop: 5 }}>{it.why}</span>}
                </Say>

                {/* work arrives finished — headline carries the creative + the approve action */}
                {isHeadline && !!it.thumbs?.length && (
                  <div style={{ display: 'flex', gap: 9, margin: '-4px 0 14px' }}>
                    {it.thumbs.slice(0, 3).map((t, k) => <Thumb key={k} src={t} />)}
                  </div>
                )}

                {/* competitor ads — show the actual creatives, hover a video to preview it */}
                {!isHeadline && !!it.media?.length && (
                  <div style={{ display: 'flex', gap: 8, margin: '-2px 0 14px' }}>
                    {it.media.slice(0, 3).map((m, k) => <AdPreview key={k} image={m.image} videoUrl={m.videoUrl} />)}
                  </div>
                )}

                {/* interrupt in plain language — contextual quick replies + the real action */}
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', margin: '-4px 0 22px' }}>
                  {isHeadline && it.cta_href && headlineState !== 'passed' && (
                    <Link href={it.cta_href} onClick={() => { markActed(it); setHeadlineState('approved'); logDecision(`Approved a creative from the brief: "${it.title}" (${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}).`) }} style={{ background: FOREST, color: LIME, fontSize: 12.5, fontWeight: 800, padding: '9px 15px', borderRadius: 100, textDecoration: 'none' }}>
                      ✓ {headlineState === 'approved' ? 'Opening…' : (it.cta_label || 'Review & approve')}
                    </Link>
                  )}
                  {!isHeadline && it.cta_href && (
                    <Link href={it.cta_href} onClick={() => markActed(it)} style={{ background: '#fff', border: `1.5px solid ${LINE}`, color: INK, fontSize: 12.5, fontWeight: 800, padding: '9px 15px', borderRadius: 100, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      {it.cta_label || 'Open'} <ArrowRight size={13} />
                    </Link>
                  )}
                  {quick.map(qr => (
                    <button key={qr} onClick={() => {
                      setFocusItem(it); say(qr, it)
                      if (isHeadline && qr === 'Not today') { setHeadlineState('passed'); logDecision(`Passed on a suggested creative: "${it.title}" (${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}).`) }
                      if (isHeadline && qr === 'Ship it') logDecision(`Shipped a creative from the brief: "${it.title}" (${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}).`)
                    }} disabled={busy} style={{ background: 'transparent', border: `1.5px solid ${LINE}`, color: INK, fontSize: 12.5, fontWeight: 750, padding: '9px 14px', borderRadius: 100, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1, fontFamily: 'inherit' }}>
                      {qr}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          {/* ── one lesson, then the meeting ends ── */}
          {brief.learning && (
            <Say delay={480 + count * 200}>
              <span style={{ color: MUTED }}>Before you go — worth learning today: {brief.learning.title.replace(/^Today's lesson:\s*/i, '')}{' '}
                {brief.learning.cta_href && <Link href={brief.learning.cta_href} style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>Open the examples →</Link>}
              </span>
            </Say>
          )}

          {/* ── sign-off: the standup is finite ── */}
          <div style={{ opacity: .9, marginTop: 6, display: 'flex', alignItems: 'center', gap: 10, color: MUTED, fontSize: 13.5, fontWeight: 600 }}>
            <span style={{ width: 26, height: 1, background: LINE }} />
            {brief.quiet ? 'Enjoy the quiet. I’ll break it the moment something moves. — Mello' : 'That’s the standup. I’m here if anything moves. — Mello'}
          </div>

          {/* ── the conversation after the agenda ── */}
          {thread.length > 0 && (
            <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px dashed ${LINE}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {thread.map((t, i) => t.who === 'user' ? (
                <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '82%', background: '#eef4ea', borderRadius: '16px 16px 4px 16px', padding: '9px 14px', fontSize: 14, fontWeight: 550, color: INK }}>{t.text}</div>
              ) : (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: '90%' }}>
                  <MelloFace size={26} />
                  <div style={{ fontSize: 14.5, lineHeight: 1.6, color: INK, paddingTop: 2 }}>
                    {(t as any).pending ? <span style={{ color: MUTED }}>Mello is thinking<span style={{ animation: 'mp 1.2s infinite' }}>…</span></span> : (t as any).text}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </>
      )}

      {/* ── composer: interrupt anytime, in plain language ── */}
      {brief && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'linear-gradient(transparent, #f6f8f5 34%)', padding: '26px 20px 22px', pointerEvents: 'none' }}>
          <form onSubmit={(e) => { e.preventDefault(); say(draft) }} style={{ maxWidth: 620, margin: '0 auto', display: 'flex', gap: 9, pointerEvents: 'auto' }}>
            <input value={draft} onChange={e => setDraft(e.target.value)} disabled={busy}
              placeholder={busy ? 'Mello is thinking…' : focusItem ? `Reply to Mello — “make it warmer”, “why?”…` : 'Say anything to Mello…'}
              style={{ flex: 1, border: `1.5px solid ${LINE}`, background: '#fff', borderRadius: 100, padding: '13px 20px', fontSize: 14, color: INK, outline: 'none', fontFamily: 'inherit', boxShadow: '0 6px 20px rgba(16,24,15,.06)' }} />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" style={{ width: 46, height: 46, borderRadius: '50%', border: 'none', background: draft.trim() && !busy ? FOREST : '#c7cec5', color: LIME, display: 'grid', placeItems: 'center', cursor: draft.trim() && !busy ? 'pointer' : 'default', flexShrink: 0 }}>
              <ArrowUp size={18} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
