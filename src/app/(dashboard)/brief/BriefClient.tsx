'use client'
/**
 * The Brief — redesigned as a THINKING experience, not a dashboard (2026-07-24).
 * A founder over coffee should know in <10s: what happened, why care, what to do.
 * Hierarchy (strict, top → bottom, progressive disclosure):
 *   1. WHAT HAPPENED — one sentence, one number, one visual, one action.
 *   2. WHY IT MATTERS — three one-line insights.
 *   3. TODAY — three recommendations. Never leave the founder thinking.
 *   4. THE EVIDENCE — only now, the ads. Evidence supports decisions; it isn't the decision.
 * Whitespace + typography carry the hierarchy — no boxes, no competing CTAs.
 * Replies still run through the real Mello agent (/api/brief/reply); the old Desk view
 * is preserved behind ?view=desk.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUp } from 'lucide-react'
import TryMello from './TryMello'
import BriefAlerts from './BriefAlerts'
import BriefWishlist from './BriefWishlist'
import BriefScan from './BriefScan'
import MelloFace, { type MelloState } from '@/components/MelloFace'
import dynamic from 'next/dynamic'
import Working from '@/components/Working'
import { mello } from '@/lib/design/voice'
import { openCredits } from '@/components/credits/CreditModal'
import { Markdown } from '@/components/mello/Markdown'
const AddCompetitors = dynamic(() => import('@/components/AddCompetitors'), { ssr: false })

const INK = '#161c17', MUTED = '#68756b', LINE = '#e7ece7', LIME = '#dffe95', FOREST = '#17251c', GREEN = '#3f8f4f'

type Item = { id?: string; kind: string; importance: number; title: string; body?: string; why?: string; cta_label?: string; cta_href?: string; thumbs?: string[]; media?: { image: string | null; videoUrl: string | null; adId?: string }[]; forBrand?: string; at?: string }
type Brief = {
  summary: { adsScanned: number; brandsWatched: number; spiedBrands: number; creativesReady: number }
  lastCycleAt?: string | null
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

/** "2h ago" — relative so it's timezone-proof (no SSR/client mismatch) and reads like a colleague. */
function agoLabel(iso?: string | null): string | null {
  if (!iso) return null
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (!isFinite(mins) || mins < 0) return null
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d}d ago`
}

/** The overnight number, counted up on first paint. The value is REAL and server-rendered — the
 *  animation is pure enhancement, so a failed hydration still shows the true figure. */
function CountUp({ n }: { n: number }) {
  const [v, setV] = useState(n)
  useEffect(() => {
    if (typeof window === 'undefined' || !n) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const start = performance.now(), DUR = 900
    setV(0)
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / DUR)
      setV(Math.round(n * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n])
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toLocaleString()}</span>
}

/** A creative thumbnail that quietly handles video (Mello's video creatives are .mp4) — shows the
 *  first frame with a play glyph instead of a broken <img>. */
function Thumb({ src, w = 78, h = 96 }: { src: string; w?: number; h?: number }) {
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(src)
  // contain (not cover) so the whole creative shows — no cropped tops. pointer-events:none so a
  // single click always reaches the wrapping link instead of the <video> swallowing it.
  const box: React.CSSProperties = { width: w, height: h, borderRadius: 12, objectFit: 'contain', border: `1px solid ${LINE}`, background: '#0d120e', display: 'block', pointerEvents: 'none' }
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

/** A competitor-ad preview. Video ads render as a STATIC poster + ▶ badge (no live <video>), so a
 *  single click on the wrapping link always opens the ad — nothing can swallow the click. The full
 *  video plays on the ad's detail page. Everything is pointer-events:none for the same reason. */
function AdPreview({ image, videoUrl, w = 62, h = 78 }: { image: string | null; videoUrl: string | null; w?: number; h?: number }) {
  // contain (show the whole ad, no cropped top) + pointer-events:none so one click reaches the link.
  const box: React.CSSProperties = { width: w, height: h, borderRadius: 10, objectFit: 'contain', border: `1px solid ${LINE}`, background: '#0d120e', display: 'block', pointerEvents: 'none' }
  const badge = <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 15, textShadow: '0 2px 8px rgba(0,0,0,.55)', pointerEvents: 'none' }}>▶</span>
  if (videoUrl && image) {
    return <span style={{ position: 'relative', display: 'inline-block' }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={image} alt="" style={box} />{badge}</span>
  }
  if (videoUrl) {
    return <span style={{ position: 'relative', display: 'inline-block' }}><video src={videoUrl} muted playsInline preload="metadata" style={box} />{badge}</span>
  }
  if (image) /* eslint-disable-next-line @next/next/no-img-element */ return <img src={image} alt="" style={box} />
  return <span style={box} />
}

/** A line Mello speaks — fades up on first load. Uses a PURE CSS animation (not a JS useEffect) so the
 *  content is visible even when the client never hydrates (broken extensions); animation-fill-mode:both
 *  holds opacity:0 during the delay, then reveals — no JavaScript required. */
function Say({ children, delay = 0, big = false }: { children: React.ReactNode; delay?: number; big?: boolean }) {
  return (
    <div className="brief-say" style={{ animationDelay: `${delay}ms`, fontSize: big ? 19 : 16, fontWeight: big ? 700 : 400, letterSpacing: big ? '-.015em' : 0, lineHeight: 1.65, color: INK, margin: '0 0 16px' }}>
      {children}
    </div>
  )
}

/** THE DESK — the same brief, but as a prepared workspace: a signed morning memo, the finished work
 *  laid out as prints, the rest of the news as sticky notes, and a "desk is clear" close. Calm,
 *  finite, editorial. Same data as the standup; the composer below stays so it's still talkable. */
const PAPER = '#fffdf4', PAPERLINE = '#efe9c8', STICKY = '#fff8c4'
function DeskView({ brief, greet, onAct, onDecision }: { brief: Brief; greet: string; onAct: (it: Item) => void; onDecision: (s: string) => void }) {
  const [passed, setPassed] = useState(false)
  const hl = brief.headline
  const competitors = brief.items.filter(i => i.kind === 'competitor_ads')
  const notes = brief.items.filter(i => i.kind !== 'competitor_ads')   // trend / market_read / insight → sticky notes
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div>
      <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600, marginBottom: 16 }}>{dateStr} — <b style={{ color: INK }}>Mello was here.</b> {brief.quiet ? 'A quiet desk today.' : 'A few things left for you.'}</div>

      {/* the morning memo */}
      <div style={{ background: PAPER, border: `1px solid ${PAPERLINE}`, borderRadius: 6, padding: '24px 26px 20px', boxShadow: '0 24px 50px -22px rgba(43,42,34,.28)', position: 'relative', marginBottom: 22 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: LIME, borderRadius: '6px 6px 0 0' }} />
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.2em', color: '#98937f', marginBottom: 14 }}>THE MORNING MEMO</div>
        <p style={{ fontSize: 15, lineHeight: 1.8, color: '#2b2a22', margin: '0 0 12px' }}>
          {greet}{brief.firstName ? `, ${brief.firstName}` : ''} — last night I read <b>{brief.summary.adsScanned.toLocaleString()} ads</b>{brief.summary.brandsWatched ? <> and checked your <b>{brief.summary.brandsWatched} competitors</b></> : ''}. {brief.quiet ? 'Nothing needs you today — my honest read is don’t spend.' : 'Here’s what’s on your desk.'}
        </p>
        {hl && <p style={{ fontSize: 15, lineHeight: 1.8, color: '#2b2a22', margin: '0 0 12px' }}>{hl.title} {hl.why}</p>}
        <div style={{ fontFamily: "'Snell Roundhand','Segoe Script',cursive", fontSize: 21, color: '#1f2a1c', marginTop: 8 }}>Mello</div>
      </div>

      {/* the work — headline creative as prints, with the decision */}
      {hl && !passed && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.18em', color: MUTED, textTransform: 'uppercase', marginBottom: 10 }}>On your desk — ready</div>
          {!!hl.thumbs?.length && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              {hl.thumbs.slice(0, 3).map((t, k) => (
                <span key={k} style={{ position: 'relative', display: 'inline-block', transform: k === 0 ? 'rotate(-1.5deg)' : k === 1 ? 'rotate(1.5deg)' : 'rotate(-.5deg)', padding: 5, background: '#fff', border: `1px solid ${PAPERLINE}`, boxShadow: '0 14px 30px -14px rgba(43,42,34,.4)', borderRadius: 3 }}>
                  <Thumb src={t} w={88} h={110} />
                  {k === 0 && <span style={{ position: 'absolute', bottom: -9, left: '50%', transform: 'translateX(-50%)', background: '#2b2a22', color: '#fff', fontSize: 8, fontWeight: 800, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 100, whiteSpace: 'nowrap' }}>MY PICK</span>}
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {hl.cta_href && <Link href={hl.cta_href} onClick={() => { onAct(hl); onDecision(`Approved a creative from the desk: "${hl.title}" (${today()}).`) }} style={{ background: FOREST, color: LIME, fontSize: 12.5, fontWeight: 800, padding: '10px 16px', borderRadius: 100, textDecoration: 'none' }}>✓ {hl.cta_label || 'Review & approve'}</Link>}
            <button onClick={() => { onAct(hl); onDecision(`Passed on a suggested creative: "${hl.title}" (${today()}).`); setPassed(true) }} style={{ background: '#fff', border: `1.5px solid ${PAPERLINE}`, color: '#2b2a22', fontSize: 12.5, fontWeight: 750, padding: '10px 16px', borderRadius: 100, cursor: 'pointer', fontFamily: 'inherit' }}>Not today</button>
          </div>
        </div>
      )}

      {/* competitor prints */}
      {competitors.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.18em', color: MUTED, textTransform: 'uppercase', marginBottom: 10 }}>What your competitors shipped</div>
          {competitors.map((it, i) => (
            <div key={it.id || i} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13.5, fontWeight: 750, color: INK }}>
                {it.title}
                {it.forBrand && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: GREEN, background: '#eef6e4', border: '1px solid #d3e6b8', borderRadius: 100, padding: '1px 8px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>for {it.forBrand}</span>}
              </div>
              {!!it.media?.length && (
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  {it.media.slice(0, 3).map((m, k) => (
                    <span key={k} style={{ padding: 4, background: '#fff', border: `1px solid ${PAPERLINE}`, boxShadow: '0 10px 22px -12px rgba(43,42,34,.35)', borderRadius: 3, transform: k % 2 ? 'rotate(1deg)' : 'rotate(-1deg)' }}>
                      <AdPreview image={m.image} videoUrl={m.videoUrl} w={58} h={72} />
                    </span>
                  ))}
                </div>
              )}
              {it.cta_href && <Link href={it.cta_href} onClick={() => onAct(it)} style={{ display: 'inline-block', fontSize: 12, fontWeight: 800, color: GREEN, textDecoration: 'none', marginTop: 8 }}>{it.cta_label || 'See the ads'} →</Link>}
            </div>
          ))}
        </div>
      )}

      {/* sticky notes — synthesis, trend, insights, learning */}
      {(notes.length > 0 || brief.learning) && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          {[...notes, ...(brief.learning ? [brief.learning] : [])].slice(0, 4).map((it, i) => (
            <div key={it.id || `n${i}`} style={{ width: 200, background: STICKY, padding: '14px 15px', borderRadius: 2, boxShadow: '0 12px 26px -12px rgba(43,42,34,.3)', transform: i % 2 ? 'rotate(1.2deg)' : 'rotate(-1.2deg)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#5a5433', lineHeight: 1.5 }}>{it.title}</div>
              {it.cta_href && <Link href={it.cta_href} onClick={() => onAct(it)} style={{ display: 'inline-block', fontSize: 11, fontWeight: 800, color: '#7a6a1f', textDecoration: 'none', marginTop: 8 }}>{it.cta_label || 'Open'} →</Link>}
            </div>
          ))}
        </div>
      )}

      {/* desk is clear */}
      <div style={{ borderTop: `1px dashed ${PAPERLINE}`, paddingTop: 16, fontSize: 12.5, color: MUTED, fontWeight: 600 }}>
        {brief.quiet ? 'Your desk is clear. Enjoy the quiet — I’ll set out anything that matters. — Mello' : 'When you’ve handled these, the desk is clear. That’s the whole app. — Mello'}
      </div>
    </div>
  )
}

export default function BriefClient({ initialBrief, initialView = 'standup', brands = [], activeBrandId = null, welcome = false }: { initialBrief: Brief | null; initialView?: 'standup' | 'desk' | 'scan'; brands?: { id: string; name: string }[]; activeBrandId?: string | null; welcome?: boolean }) {
  // Seeded from the SERVER render — the brief content is already in the HTML, so it shows even if the
  // client never hydrates (broken extensions). We only fetch as a fallback when the server had nothing.
  const [brief, setBrief] = useState<Brief | null>(initialBrief)
  const [err, setErr] = useState(false)
  const [thread, setThread] = useState<Turn[]>([])          // the live conversation after the agenda
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [focusItem, setFocusItem] = useState<Item | null>(initialBrief?.headline || initialBrief?.items?.[0] || null)   // what the composer is "about"
  const [headlineState, setHeadlineState] = useState<null | 'approved' | 'passed'>(null)
  const [view, setView] = useState<'standup' | 'desk' | 'scan'>(initialView)   // conversation · prepared desk · one-page scan
  const [credits, setCredits] = useState<number | null>(null)
  const [plan, setPlan] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addBrandId, setAddBrandId] = useState<string | null>(null)   // which brand the add-competitor modal targets
  const [planDismissed, setPlanDismissed] = useState(false)
  const [subscribing, setSubscribing] = useState(false)

  // One plan, $49/mo (Section 4 / Polsia-simple). Reuses onboarding's proven checkout call; on any
  // misconfig it just stops — never dead-ends. Credits are the pay-as-you-go alternative (openCredits).
  const goFullTime = async () => {
    if (subscribing) return
    setSubscribing(true)
    try {
      // PayFast is the active rail — auto-submits a form to the hosted page. Stripe is the fallback.
      if (process.env.NEXT_PUBLIC_PAYMENTS_PROVIDER === 'payfast') {
        const { startPayfastCheckout } = await import('@/lib/payfast/start')
        await startPayfastCheckout({ kind: 'subscription', plan: 'starter', cycle: 'monthly' })
        return   // redirecting to PayFast
      }
      const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'starter', cycle: 'monthly' }) })
      const j = await r.json().catch(() => ({}))
      if (j?.url) { window.location.href = j.url; return }
    } catch { /* fall through */ }
    setSubscribing(false)
  }
  const endRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Credit balance for the scan's Mello column — the same source as the header counter.
  useEffect(() => {
    let live = true
    fetch('/api/credits/balance').then(r => r.ok ? r.json() : null).then(j => { if (live && j) { if (typeof j.balance === 'number') setCredits(j.balance); if (j.plan) setPlan(String(j.plan)) } }).catch(() => {})
    return () => { live = false }
  }, [])

  // Brand switcher: navigate (server re-scopes the brief), preserving the current view. Interactivity
  // only — the scoped content is already server-rendered from ?brand=, so a failed hydration still
  // shows the right brand; only the ability to switch needs JS.
  const goBrand = (id: string) => {
    const p = new URLSearchParams()
    if (id) p.set('brand', id)
    if (view !== 'standup') p.set('view', view)
    const qs = p.toString()
    router.push(`/brief${qs ? `?${qs}` : ''}`)
  }

  // One calm default — no toggle, fewer decisions. The Desk variant stays reachable via ?view=desk.
  // (the view arrives server-rendered via initialView — no client effect, so it survives a failed hydration)
  // Fallback only: the server already rendered the brief into the HTML. We re-fetch client-side ONLY
  // if the server render came back empty (rare), so a transient server hiccup can still recover.
  useEffect(() => {
    if (initialBrief) return
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 22000)
    fetch(`/api/brief${activeBrandId ? `?brand=${encodeURIComponent(activeBrandId)}` : ''}`, { signal: ctrl.signal }).then(r => r.ok ? r.json() : Promise.reject())
      .then((b: Brief) => { setBrief(b); setFocusItem(b.headline || b.items[0] || null) })
      .catch(() => setErr(true))
      .finally(() => clearTimeout(t))
    return () => clearTimeout(t)
  }, [initialBrief])

  // Brand switch re-navigates → the server component re-runs with a fresh, scoped initialBrief, but
  // BriefClient isn't remounted, so useState(initialBrief) would keep the OLD brand's data. Re-sync
  // when the active brand changes (a real, distinct server render arrives alongside it).
  const didMountBrand = useRef(false)
  useEffect(() => {
    if (!didMountBrand.current) { didMountBrand.current = true; return }
    if (initialBrief) { setBrief(initialBrief); setFocusItem(initialBrief.headline || initialBrief.items?.[0] || null); setThread([]) }
  }, [activeBrandId])   // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the newest turn just above the composer — block:'end' so it never yanks the page to the top.
  useEffect(() => { if (thread.length) setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 40) }, [thread])

  const h = new Date().getHours()
  const greet = h < 5 ? 'Late one' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'
  // State without reading: the face reports what's actually true of today's brief.
  const melloState: MelloState = !brief ? 'awake'
    : brief.quiet ? 'resting'
    : (brief.headline || brief.summary.creativesReady > 0) ? 'delivered'
    : 'awake'

  // Send a reply to Mello (grounded by the real agent). `about` = the item being discussed, for context.
  async function say(text: string, about?: Item | null) {
    const q = text.trim()
    if (!q || busy) return
    setDraft('')
    // The brief chat can only talk — it can't generate. If the founder asks to MAKE/CREATE/REMAKE an
    // ad/image/video, hand off to the studio, where Mello can actually build it (and drive the canvas).
    if (/\b(make|create|design|build|generate|remake|clone|whip up|come up with|mock up)\b[\s\S]*\b(ad|ads|image|images|photo|picture|creative|creatives|video|videos|ugc|banner|graphic)\b/i.test(q)
        || /\b(ad|image|video|creative)\b[\s\S]*\b(for my brand|from scratch)\b/i.test(q)) {
      setThread(t => [...t, { who: 'user', text: q }, { who: 'mello', kind: 'reply', text: 'On it — opening the studio, where I can build that with you.' }])
      setTimeout(() => router.push('/studio'), 650)
      return
    }
    setThread(t => [...t, { who: 'user', text: q }, { who: 'mello', kind: 'reply', text: '', pending: true }])
    setBusy(true)
    try {
      // Hard client timeout — the reply runs the full Mello agent (tools + LLM), which can occasionally
      // stall; without this the composer sat on "Mello is thinking…" forever. 75s then a graceful msg.
      const r = await fetch('/api/brief/reply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, item: about ? { title: about.title, body: about.body } : (focusItem ? { title: focusItem.title, body: focusItem.body } : undefined) }), signal: AbortSignal.timeout(40000) })
      const j = await r.json().catch(() => ({}))
      setThread(t => { const c = [...t]; const last = c[c.length - 1]; if (last && last.who === 'mello' && (last as any).kind === 'reply') (c[c.length - 1] as any) = { who: 'mello', kind: 'reply', text: j.reply || 'Got it.' }; return c })
    } catch (e: any) {
      const msg = e?.name === 'TimeoutError' || e?.name === 'AbortError'
        ? 'That took longer than I like — ask me again and I’ll be quicker.'
        : 'I hit a snag — try me again in a moment.'
      setThread(t => { const c = [...t]; (c[c.length - 1] as any) = { who: 'mello', kind: 'reply', text: msg }; return c })
    } finally { setBusy(false) }
  }

  const markActed = (it: Item) => { if (it.id) fetch('/api/brief', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: it.id }) }).catch(() => {}) }
  // Day-30 memory: log approve/kill decisions so Mello can cite them later ("you passed on this on Jul 23").
  const logDecision = (content: string) =>
    fetch('/api/interview/notebook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ entries: [{ kind: 'decision', content }], source: 'standup' }) }).catch(() => {})

  // The conversation bubbles — ONE render used by both views. The scan view (the default brief) had a
  // composer but no thread, so asking Mello sent the message into a void (the answer only rendered in
  // the standup view). This makes the reply show wherever you ask.
  const threadBubbles = (
    <>
      {thread.map((t, i) => t.who === 'user' ? (
        <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '82%', background: '#eef4ea', borderRadius: '16px 16px 4px 16px', padding: '9px 14px', fontSize: 14, fontWeight: 550, color: INK, overflowWrap: 'anywhere', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{t.text}</div>
      ) : (
        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: '90%', minWidth: 0 }}>
          <MelloFace size={26} />
          <div style={{ fontSize: 14.5, lineHeight: 1.6, color: INK, paddingTop: 2, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
            {(t as any).pending ? <span style={{ color: MUTED }}>Mello is thinking<span style={{ animation: 'mp 1.2s infinite' }}>…</span></span> : <Markdown content={String((t as any).text || '')} />}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </>
  )

  return (
    // 620 is the reading measure for the narrative brief; the scan is the founder's workspace —
    // it breathes at 1440 with real gutters (the 70/30 grid needs the room).
    <div style={{ maxWidth: view === 'scan' ? 1440 : 620, margin: '0 auto', padding: view === 'scan' ? '26px clamp(20px, 4vw, 48px) 140px' : '26px 20px 72px', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* header — a quiet presence, not chrome. No toggle, no competing decisions. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          {/* The face carries the state now — the old dot pulsed green even on a dead day. */}
          <MelloFace size={28} state={melloState} />
        </span>
        <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 650 }}>
          Mello · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {/* Presence, not chrome: proof an employee was here — real timestamp, never invented. */}
          {brief?.lastCycleAt && agoLabel(brief.lastCycleAt) && (
            <span style={{ color: '#9aa79a' }}> · last worked {agoLabel(brief.lastCycleAt)}</span>
          )}
        </div>
        <style>{`@keyframes mp{50%{opacity:.35}} details.more-mello>summary::-webkit-details-marker{display:none}
          @keyframes sayIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
          .brief-say{animation:sayIn .5s cubic-bezier(0,0,.2,1) both}
          @media(prefers-reduced-motion:reduce){.brief-say{animation:none;opacity:1;transform:none}}`}</style>
      </div>

      {/* brand switcher — only with 2+ brands (pointless for one). Scopes the whole brief to one
          brand's world; "All brands" is the pooled default. */}
      {brands.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 2px' }}>
          <span style={{ fontSize: 12.5, fontWeight: 650, color: '#9aa79a' }}>Showing</span>
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <select value={activeBrandId || ''} onChange={e => goBrand(e.target.value)}
              style={{ appearance: 'none', WebkitAppearance: 'none', background: activeBrandId ? '#eef6e4' : '#fff', border: `1px solid ${activeBrandId ? '#d3e6b8' : PAPERLINE}`, borderRadius: 100, color: INK, fontWeight: 750, fontSize: 13, fontFamily: 'inherit', padding: '5px 30px 5px 13px', cursor: 'pointer', outline: 'none' }}>
              <option value="">All brands</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <span style={{ position: 'absolute', right: 12, pointerEvents: 'none', color: MUTED, fontSize: 10 }}>▾</span>
          </div>
        </div>
      )}

      {/* First arrival from onboarding — the reveal, sequenced BEFORE the ask (Section 4). A calm
          serif line, not a banner-ad: proof the night's work was real, then straight into the brief. */}
      {welcome && (
        <div style={{ margin: '16px 0 2px', paddingBottom: 16, borderBottom: `1px solid ${PAPERLINE}` }}>
          <div style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif', fontWeight: 750, fontSize: 20, lineHeight: 1.25, color: INK, letterSpacing: '-.015em' }}>
            I worked through the night{brief?.firstName ? `, ${brief.firstName}` : ''}. Here’s your first briefing.
          </div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>Everything below is real — your actual competitors, your market. Not a demo.</div>
        </div>
      )}

      {/* loading / error */}
      {!brief && !err && (
        <div style={{ marginTop: 18 }}>
          <Working lines={['reading your competitors’ overnight ads', 'decoding this week’s hooks and formats', 'pulling the room together']} />
        </div>
      )}
      {err && <div style={{ color: MUTED, fontSize: 15 }}>I couldn&rsquo;t start the standup — refresh in a moment.</div>}

      {brief && view === 'desk' && <DeskView brief={brief} greet={greet} onAct={markActed} onDecision={logDecision} />}
      {brief && view === 'scan' && <BriefScan brief={brief} melloState={melloState} onAct={markActed} onWhy={(it) => { setFocusItem(it); say('Why does it matter?', it) }}
        credits={credits} plan={plan} onGoFullTime={goFullTime} subscribing={subscribing} onBuyCredits={() => openCredits('buy')}
        activeBrandId={activeBrandId} activeBrandName={activeBrandId ? (brands.find(b => b.id === activeBrandId)?.name || null) : null}
        onAddCompetitor={() => {
          // Resolve which brand to attach the competitor to: the selected one, or the user's only
          // brand when none is selected (the switcher is hidden with a single brand, so activeBrandId
          // is null even though they DO have a brand — that's why "+ Add a competitor" used to bounce
          // to the brand page instead of opening the modal). Only fall back to /brands when there's no
          // brand at all (create one first) or 2+ brands and none picked (go choose).
          // Open the add-competitor modal for the selected brand, or the first brand when on "All brands"
          // (the modal shows which brand it's for). Only bounce to /brands when there's NO brand yet.
          const target = activeBrandId || brands[0]?.id || null
          if (target) { setAddBrandId(target); setAddOpen(true) }
          else router.push('/brands')
        }} />}

      {/* Add-competitor modal — opened from the scan's Competitors column for the resolved brand. */}
      {addOpen && addBrandId && (
        <AddCompetitors brandId={addBrandId} brandName={brands.find(b => b.id === addBrandId)?.name || 'this brand'}
          onClose={() => setAddOpen(false)} onDone={() => { setAddOpen(false); router.refresh() }} />
      )}

      {brief && view === 'standup' && (() => {
        // ── The hierarchy: 1 what happened · 2 why it matters · 3 what to do · 4 evidence ──
        const hero = brief.headline || brief.items[0] || null
        const isHeadlineHero = !!(brief.headline && hero === brief.headline)
        const rest = brief.items.filter(it => it !== hero)
        const insights = rest.slice(0, 3)
        const evidence = rest.filter(it => !!it.media?.length)
        const compItem = [hero, ...rest].find(it => it?.kind === 'competitor_ads') || null
        const compBrand = compItem ? compItem.title.replace(/\s+launched.*$/i, '').replace(/\.$/, '') : null
        const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const recs: { text: string; href?: string }[] = brief.quiet
          ? [
              { text: 'Don’t spend today — save the budget for a real signal.' },
              { text: 'Tell me what to make next — I’ll build it with you in the studio.', href: '/studio' },
            ]
          : [
              ...(isHeadlineHero ? [{ text: 'Approve or kill the creative I made — it keeps your pipeline moving.', href: brief.headline!.cta_href }] : []),
              ...(compItem ? [{ text: `Answer ${compBrand} — remake one of their new ads for your brand.`, href: compItem.cta_href }] : []),
              { text: 'Tell me what to make next — I’ll build it with you in the studio.', href: '/studio' },
            ]
        const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '.16em', color: MUTED, textTransform: 'uppercase', marginBottom: 14 }
        return (
        <>
          {/* ── 1 · WHAT HAPPENED — one sentence, one number, one visual, one action ── */}
          {/* premium: open with print-like air; the day should feel unhurried, not a dashboard. */}
          {/* First arrival: the welcome banner above already greeted, so drop the standard "greet,
              name —" line (it was double-greeting) and tighten the air. Keep the ad-count as proof. */}
          <div style={{ marginTop: welcome ? 22 : 68 }}>
            <Say delay={60}>
              <span style={{ fontSize: 13.5, color: MUTED, fontWeight: 600, letterSpacing: '.002em' }}>
                {welcome
                  ? <>Overnight I read <b style={{ color: INK, fontWeight: 750 }}><CountUp n={brief.summary.adsScanned} /> ads</b>{brief.summary.brandsWatched > 0 ? <> across your <b style={{ color: INK, fontWeight: 750 }}>{brief.summary.brandsWatched} competitor{brief.summary.brandsWatched === 1 ? '' : 's'}</b></> : null}.</>
                  : <>{greet}{brief.firstName ? `, ${brief.firstName}` : ''} — overnight I read <b style={{ color: INK, fontWeight: 750 }}><CountUp n={brief.summary.adsScanned} /> ads</b>{brief.summary.brandsWatched > 0 ? <> across your <b style={{ color: INK, fontWeight: 750 }}>{brief.summary.brandsWatched} competitor{brief.summary.brandsWatched === 1 ? '' : 's'}</b></> : null}.</>}
              </span>
            </Say>
            <Say delay={200}>
              {/* The headline is the one editorial statement of the day — Mello's own words, so it's set
                  in the serif register (voice.mello). Premium: larger, calmer, print-masthead scale. */}
              <h1 style={{ ...mello(52), fontSize: 'clamp(38px, 4.6vw, 54px)', lineHeight: 1.05, letterSpacing: '-.018em', margin: '16px 0 0', textWrap: 'balance' as any }}>
                {brief.quiet || !hero ? 'Nothing needs you today.' : hero.title.replace(/\.+$/, '') + '.'}
              </h1>
            </Say>
            {!brief.quiet && hero && (
              <Say delay={340}>
                <div>
                  {hero.why && <p style={{ fontSize: 16, color: MUTED, lineHeight: 1.72, margin: '18px 0 0', maxWidth: 540 }}>{hero.why}</p>}
                  {/* one visual — never a wall of thumbnails */}
                  {isHeadlineHero && hero.thumbs?.[0] && (
                    <div style={{ marginTop: 30 }}><Thumb src={hero.thumbs[0]} w={158} h={198} /></div>
                  )}
                  {!isHeadlineHero && hero.media?.[0] && (
                    <div style={{ marginTop: 30 }}>
                      {hero.media[0].adId
                        ? <Link href={`/knowledge/ad/${hero.media[0].adId}`}><AdPreview image={hero.media[0].image} videoUrl={hero.media[0].videoUrl} w={158} h={198} /></Link>
                        : <AdPreview image={hero.media[0].image} videoUrl={hero.media[0].videoUrl} w={158} h={198} />}
                    </div>
                  )}
                  {/* one primary action; the alternatives whisper */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 24 }}>
                    {hero.cta_href && headlineState !== 'passed' && (
                      <Link href={hero.cta_href} onClick={() => { markActed(hero); if (isHeadlineHero) { setHeadlineState('approved'); logDecision(`Approved a creative from the brief: "${hero.title}" (${today()}).`) } }}
                        style={{ background: FOREST, color: LIME, fontSize: 13.5, fontWeight: 800, padding: '12px 22px', borderRadius: 100, textDecoration: 'none' }}>
                        {isHeadlineHero ? (headlineState === 'approved' ? 'Opening…' : `✓ ${hero.cta_label || 'Review & approve'}`) : (hero.cta_label || 'Open')}
                      </Link>
                    )}
                    {isHeadlineHero && headlineState !== 'passed' && (
                      <button onClick={() => { setFocusItem(hero); setHeadlineState('passed'); logDecision(`Passed on a suggested creative: "${hero.title}" (${today()}).`) }}
                        style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>Not today</button>
                    )}
                    <button onClick={() => { setFocusItem(hero); say(isHeadlineHero ? 'Why this one?' : 'Why does it matter?', hero) }} disabled={busy}
                      style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', padding: 0 }}>Why?</button>
                  </div>
                </div>
              </Say>
            )}
            {brief.quiet && (
              <p style={{ fontSize: 16, color: MUTED, lineHeight: 1.72, margin: '18px 0 0', maxWidth: 540 }}>Routine rotation only — my honest read is don’t spend today. I’ll break the quiet the moment something moves.</p>
            )}
          </div>

          {/* ── 2 · WHY IT MATTERS — three one-line insights, nothing else ── */}
          {!brief.quiet && insights.length > 0 && (
            <div style={{ marginTop: 72 }}>
              <div style={label}>Why it matters</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {insights.map((it, i) => (
                  <div key={it.id || i} style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-.011em', color: INK, lineHeight: 1.5 }}>
                    {it.cta_href
                      ? <Link href={it.cta_href} onClick={() => markActed(it)} style={{ color: INK, textDecoration: 'none' }}>{it.title} <span style={{ color: GREEN }}>→</span></Link>
                      : it.title}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 3 · WHAT TO DO — three recommendations. Never leave the founder thinking. ── */}
          <div style={{ marginTop: 72 }}>
            <div style={label}>Today, I’d do three things</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {recs.slice(0, 3).map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 15.5, color: INK, lineHeight: 1.5 }}>
                  <span style={{ color: GREEN, fontWeight: 800 }}>✓</span>
                  {r.href ? <Link href={r.href} style={{ color: INK, textDecoration: 'none', borderBottom: `1px solid ${LINE}` }}>{r.text}</Link> : <span>{r.text}</span>}
                </div>
              ))}
            </div>
          </div>

          {/* ── 4 · THE EVIDENCE — only now, the ads ── */}
          {evidence.length > 0 && (
            <div style={{ marginTop: 72 }}>
              <div style={label}>The evidence</div>
              {evidence.map((it, i) => {
                // Clicking an ad opens its "AD · ON RECORD" knowledge page — the breakdown +
                // "Remake for my brand". The brand-file link goes to the richer Brand Spy page.
                const brandFileHref = it.cta_href?.replace('/knowledge/brand/', '/discovery/brand-spy/') || it.cta_href
                return (
                <div key={it.id || i} style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, marginBottom: 10 }}>
                    {it.title}
                    {it.forBrand && <span style={{ marginLeft: 8, fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: GREEN, background: '#eef6e4', border: '1px solid #d3e6b8', borderRadius: 100, padding: '1px 8px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>for {it.forBrand}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {it.media!.slice(0, 3).map((m, k) => m.adId
                      ? <Link key={k} href={`/knowledge/ad/${m.adId}`} onClick={() => markActed(it)} title="Open the ad breakdown & remake"><AdPreview image={m.image} videoUrl={m.videoUrl} w={92} h={116} /></Link>
                      : <AdPreview key={k} image={m.image} videoUrl={m.videoUrl} w={92} h={116} />)}
                  </div>
                  <div style={{ display: 'flex', gap: 18, marginTop: 10 }}>
                    {brandFileHref && <Link href={brandFileHref} onClick={() => markActed(it)} style={{ fontSize: 12.5, fontWeight: 750, color: GREEN, textDecoration: 'none' }}>{it.cta_label || 'Open the brand file'} →</Link>}
                    <button onClick={() => { setFocusItem(it); say('Why does it matter?', it) }} disabled={busy}
                      style={{ background: 'none', border: 'none', color: MUTED, fontSize: 12.5, fontWeight: 700, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', padding: 0 }}>Why does it matter?</button>
                  </div>
                </div>
                )
              })}
            </div>
          )}

          {/* ── one lesson, then it ends ── */}
          {brief.learning && (
            <div style={{ marginTop: 46, fontSize: 13.5, color: MUTED, lineHeight: 1.6 }}>
              Worth learning today: {brief.learning.title.replace(/^Today's lesson:\s*/i, '')}{' '}
              {brief.learning.cta_href && <Link href={brief.learning.cta_href} style={{ color: GREEN, fontWeight: 700, textDecoration: 'none' }}>Open the examples →</Link>}
            </div>
          )}

          {/* ── sign-off: the brief is finite ── */}
          <div style={{ marginTop: 36, display: 'flex', alignItems: 'center', gap: 10, color: MUTED, fontSize: 13, fontWeight: 600 }}>
            <span style={{ width: 26, height: 1, background: LINE }} />
            {brief.quiet ? 'Enjoy the quiet. I’ll break it the moment something moves. — Mello' : 'That’s everything. I’m here if anything moves. — Mello'}
          </div>

          {/* ── the conversation after the agenda (standup view) ── */}
          {thread.length > 0 && (
            <div style={{ marginTop: 26, paddingTop: 22, borderTop: `1px dashed ${LINE}`, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {threadBubbles}
            </div>
          )}
        </>
        )
      })()}

      {/* THE ASK — sequenced after the value (Section 4: show, then sell). Only on first arrival, and
          only after the brief above has been seen. A quiet card, not a wall; Free keeps working. */}
      {welcome && brief && !planDismissed && (
        <div style={{ marginTop: 40, border: `1px solid ${PAPERLINE}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ background: FOREST, color: '#b9c6b4', font: "12px/1.6 ui-monospace, 'SF Mono', Menlo, monospace", padding: '9px 18px', letterSpacing: '.04em' }}>
            <span style={{ color: LIME }}>✓</span> that was one night. this is every morning.
          </div>
          <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontFamily: 'Inter, -apple-system, system-ui, sans-serif', fontWeight: 750, fontSize: 20, color: INK, lineHeight: 1.25, letterSpacing: '-.015em' }}>Keep Mello on full-time — $49<span style={{ fontSize: 15, color: MUTED }}>/mo</span>.</div>
              <div style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.55, marginTop: 4 }}>You&rsquo;re on Free &mdash; 75 credits to start (about 5 image ads), 1 competitor. Full-time unlocks video ads, every competitor watched, and fresh creatives every morning &mdash; or top up credits and pay as you go.</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <button onClick={goFullTime} disabled={subscribing} style={{ background: FOREST, color: LIME, fontSize: 13.5, fontWeight: 800, padding: '11px 20px', borderRadius: 100, border: 'none', cursor: subscribing ? 'default' : 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>{subscribing ? 'Opening…' : 'Go full-time · $49/mo'}</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button onClick={() => openCredits('buy')} style={{ background: 'none', border: 'none', color: GREEN, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>Buy credits</button>
                <button onClick={() => setPlanDismissed(true)} style={{ background: 'none', border: 'none', color: MUTED, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>I&rsquo;m good on Free</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Below the brief: timely alerts stay visible; the feature deck hides behind one quiet line
          (progressive disclosure — depth only for those who ask for it). */}
      {/* Account-wide alerts pull ALL notifications — hide them in a brand view, or a brand watching
          nobody would still see other brands' competitor launches below the fold. */}
      {brief && !activeBrandId && <BriefAlerts exclude={[...(brief.headline ? [brief.headline.title] : []), ...brief.items.map(i => i.title)]} />}
      {/* All the ways to make something — kept on the brief, compact so they don't compete with it. */}
      {/* The scan already carries the capability menu as its fourth column — don't print it twice. */}
      {brief && view !== 'scan' && <TryMello compact />}
      {brief && <BriefWishlist />}

      {/* ── the conversation in the SCAN view — a floating panel just above the composer, so asking
          Mello on the brief actually shows the answer (it used to render only in the standup view, so
          the scan brief's composer sent into a void). Fixed + scrollable, sits over the desk. ── */}
      {brief && view === 'scan' && thread.length > 0 && (
        <div className="brief-thread" style={{ position: 'fixed', left: 0, right: 0, bottom: 92, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 45, paddingLeft: 20, paddingRight: 20 }}>
          <div style={{ width: 'min(680px, 100%)', maxHeight: '58vh', overflowY: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 18, boxShadow: '0 24px 70px -24px rgba(16,24,15,.35)', padding: '16px 18px', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 750, color: MUTED }}>Mello</span>
              <button onClick={() => setThread([])} aria-label="Close" style={{ background: 'none', border: 'none', color: '#9aa79a', fontSize: 18, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>×</button>
            </div>
            {threadBubbles}
          </div>
        </div>
      )}
      {/* The app rail (72px) offsets the content column on desktop; nudge the thread panel to match. */}
      <style>{`@media(min-width:769px){.brief-thread{padding-left:92px}}`}</style>

      {/* ── composer: interrupt anytime, in plain language ── */}
      {/* The bar is viewport-fixed; the app rail (72px) offsets the content column, so pad the bar's
          left by the rail on desktop or the inner form drifts ~36px off-center from the brief above. */}
      <style>{`.brief-composer{padding-left:20px}@media(min-width:769px){.brief-composer{padding-left:92px}}
        /* The composer is the LAST arrival — Mello finishes laying out the desk, then invites you to
           talk. Pure enhancement; reduced-motion shows it instantly. */
        .brief-composer form{animation:bcIn .6s cubic-bezier(.2,.7,.2,1) both;animation-delay:.85s}
        @keyframes bcIn{from{opacity:.001;transform:translateY(10px)}to{opacity:1;transform:none}}
        @media(prefers-reduced-motion:reduce){.brief-composer form{animation:none}}`}</style>
      {brief && (
        <div className="brief-composer" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: 'linear-gradient(transparent, #f6f8f5 44%)', paddingTop: 30, paddingRight: 20, paddingBottom: 22, pointerEvents: 'none' }}>
          {/* The composer floats — Claude-style: one centered pill, soft elevation, always there.
              Talking to Mello should feel like talking to your co-founder, not filling a form. */}
          <form onSubmit={(e) => { e.preventDefault(); say(draft) }} style={{ maxWidth: 680, margin: '0 auto', display: 'flex', alignItems: 'flex-end', gap: 9, pointerEvents: 'auto' }}>
            {/* textarea, not input, so Shift+Enter inserts a newline and Enter sends. Auto-grows to ~5 lines. */}
            <textarea value={draft} onChange={e => setDraft(e.target.value)} disabled={busy} rows={1}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(draft) } }}
              placeholder={busy ? 'Mello is thinking…' : 'Ask Mello anything…'}
              style={{ flex: 1, border: `1px solid ${LINE}`, background: '#fff', borderRadius: 26, padding: '15px 22px', fontSize: 14.5, color: INK, outline: 'none', fontFamily: 'inherit', boxShadow: '0 2px 6px rgba(16,24,15,.05), 0 18px 50px -16px rgba(16,24,15,.22)', resize: 'none', maxHeight: 132, lineHeight: 1.5 }} />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" style={{ width: 50, height: 50, borderRadius: '50%', border: 'none', background: draft.trim() && !busy ? FOREST : '#c7cec5', color: LIME, display: 'grid', placeItems: 'center', cursor: draft.trim() && !busy ? 'pointer' : 'default', flexShrink: 0, boxShadow: draft.trim() && !busy ? '0 10px 26px -10px rgba(23,37,28,.5)' : 'none', transition: 'background .15s, box-shadow .15s' }}>
              <ArrowUp size={19} />
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
