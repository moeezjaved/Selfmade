'use client'
/**
 * ProductTour — the in-app guided onboarding walkthrough. A spotlight overlay + tooltip card (Back /
 * Next / step counter / ✕) that highlights the real product UI and walks the founder through the whole
 * company: brand → Morning Brief → Mello → Spy → Studio → Ads → Inbox → Create.
 *
 * Anchors to the PERSISTENT left-rail nav icons (data-tour="nav-*", always mounted, never virtualized),
 * navigating to each route so the real page shows behind the spotlight. Robust by design: if a target
 * can't be found, the step falls back to a centered card so the tour never breaks.
 *
 * Triggers: first-ever visit auto-starts once (localStorage), `?tour=1` forces a replay, and any element
 * can start it via `window.dispatchEvent(new Event('sf:starttour'))` or `window.startSelfmadeTour()`.
 */
import React from 'react'
import { useRouter, usePathname } from 'next/navigation'

type Step = { target?: string; route?: string; title: string; body: string; placement?: 'right' | 'bottom' | 'top' | 'center' }

const DONE_KEY = 'sf_tour_v1_done'

const STEPS: Step[] = [
  // ── Act 0 · Welcome ──
  { placement: 'center', title: 'Meet the company that runs itself',
    body: "You didn't buy software — you hired a marketing team. In 90 seconds I'll show you how to spy on rivals, make ads, answer customers, and launch — the whole company." },

  // ── Act 1 · Your brand + the Brief ──
  { target: 'project-switcher', route: '/brief', placement: 'bottom', title: 'This is your brand',
    body: 'Everything — ads, competitors, reports, replies — is scoped to whoever’s selected here. Running several brands? Switch in one click.' },
  { target: 'brief-hero', route: '/brief', placement: 'bottom', title: 'Your Morning Brief',
    body: 'Every morning I read the night’s changes and hand you one page: what happened, what it means, and the few calls only you can make. Start here daily.' },
  { target: 'brief-composer', route: '/brief', placement: 'top', title: 'Talk to Mello anytime',
    body: 'Ask anything in plain language — “which ad is winning?”, “write me a hook”, “pause the losers” — and I answer (or act) from your real numbers.' },
  { placement: 'center', title: 'How credits work',
    body: 'One simple currency. The work spends credits — a few for an image ad, more for a video, a little to start spying a new rival or pull a deep report. Browsing what’s already loaded is free, your credits never expire, and you top up anytime — pay-as-you-go.' },

  // ── Act 2 · Spy a competitor ──
  { target: 'nav-library', route: '/discovery', placement: 'right', title: 'Now — let’s catch a competitor',
    body: 'This is Spy. Every ad your rivals are running, in one live feed, so you can copy what’s working before it burns out.' },
  { target: 'spy-search', route: '/discovery', placement: 'bottom', title: 'Search the whole ad library',
    body: 'Type a brand, a product, or an angle (“sensitive skin”, “% off”) and AI pulls every matching ad running right now across Meta.' },
  { target: 'spy-filters', route: '/discovery', placement: 'bottom', title: 'Filter down to the winners',
    body: 'Narrow by date, format (video / image / carousel), platform, or industry — and the “Winning ads” preset surfaces the proven, long-running ones.' },
  { target: 'spy-feed', route: '/discovery', placement: 'center', title: 'What each ad tells you',
    body: 'On every ad you see how long it’s been running, how many placements it’s reused, its full copy and call-to-action. A long run = it’s making them money. (Meta hides spend, so we rank by these public signals instead of guessing.)' },
  { target: 'spy-feed', route: '/discovery', placement: 'center', title: 'Steal it — the right way',
    body: 'See a winner? Hover it and hit “Remake”. I rebuild that exact ad — image or video — with YOUR product and brand swapped in. Their proven format, your store.' },
  { target: 'spy-add', route: '/discovery/brand-spy', placement: 'bottom', title: 'Watch one rival closely',
    body: 'To track a specific competitor, hit “Spy new brand” and paste their Facebook Ad Library link. I pull their whole ad archive and ping you the moment they launch something new.' },

  // ── Act 3 · Make ads ──
  { target: 'rail-create', placement: 'right', title: 'Make an ad — the + button',
    body: 'This is Create. Four ways to make an ad: remake a competitor’s winner, remake your OWN past ad, start a fresh one, or let me make ads for you every day on autopilot.' },
  { target: 'studio-composer', route: '/studio', placement: 'top', title: 'Studio — where ads get made',
    body: 'Tell me what you want in a sentence, pick image or video, and I generate it on your brand — your product, your colours, your voice. Tweak and regenerate until it’s right.' },

  // ── Act 4 · Customers ──
  { target: 'nav-inbox', route: '/inbox', placement: 'right', title: 'Your customers live here',
    body: 'Every DM and email lands in one inbox, sorted by what actually matters — refunds and complaints first, browsing questions later.' },
  { target: 'inbox-channels', route: '/inbox', placement: 'bottom', title: 'Connect your channels',
    body: 'Hit Connect on Instagram, WhatsApp, Messenger or email — one click each — and real customer messages start flowing into this inbox.' },
  { target: 'inbox-compose', route: '/inbox', placement: 'bottom', title: 'Replies, drafted for you',
    body: 'Try it: type a customer message here. I triage it and draft the reply for you to approve with one tap — nothing ever sends on its own.' },

  // ── Act 5 · Launch + measure ──
  { target: 'nav-ads', route: '/reports', placement: 'right', title: 'Run & measure your ads',
    body: 'This is Ads — your live Meta performance, read in plain English: what’s making money, what’s leaking, and exactly what to scale or cut.' },
  { target: 'ads-tabs', route: '/reports', placement: 'bottom', title: 'Reports, four ways',
    body: 'Reports (the story of your spend), Scale & Insights (where to put more), Leaderboard (your best ads), and Snapshots (frozen weekly proof).' },
  { target: 'm4-wizard', route: '/m4', placement: 'bottom', title: 'Launch, safely',
    body: 'Ready to go live? The M4 launcher walks you through pixel → creatives → audiences → budget → review, building your campaigns for you. Nothing spends until you confirm the budget.' },

  // ── Act 6 · Set up (the two connections that switch everything on) ──
  { target: 'connect-fb', route: '/connect/meta', placement: 'top', title: 'Connect your Facebook',
    body: 'This is the one that switches everything on — link your Meta ad account and your real spend, ROAS, reports and one-tap launching all come alive. It’s one click, right here. Do this first.' },
  { target: 'inbox-channels', route: '/inbox', placement: 'bottom', title: 'Connect your inbox',
    body: 'Then hook up where your customers talk to you — Instagram or WhatsApp is the fastest start. Hit Connect on any channel and their messages start landing here for you to answer.' },

  // ── Act 7 · Close ──
  { placement: 'center', title: 'That’s the whole company',
    body: 'It works while you sleep and pings you on Slack the moment something needs you. Spy, make, reply, launch — you’re running it now. Let’s go.' },
]

const CARD_W = 336

function measure(el: Element) { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height } }
type Rect = ReturnType<typeof measure>

export default function ProductTour() {
  const router = useRouter()
  const pathname = usePathname()
  const [active, setActive] = React.useState(false)
  const [idx, setIdx] = React.useState(0)
  const [rect, setRect] = React.useState<Rect | null>(null)
  const idxRef = React.useRef(0)
  idxRef.current = idx

  const start = React.useCallback(() => { setIdx(0); setActive(true) }, [])
  const finish = React.useCallback((completed: boolean) => {
    setActive(false)
    try { if (completed) localStorage.setItem(DONE_KEY, '1') } catch { /* ignore */ }
  }, [])

  // Triggers: ?tour=1 (force), first-ever visit (auto once, on /brief), and an app-wide event to replay.
  React.useEffect(() => {
    if (typeof window === 'undefined') return
    ;(window as any).startSelfmadeTour = start
    const onEvt = () => start()
    window.addEventListener('sf:starttour', onEvt)
    const params = new URLSearchParams(window.location.search)
    if (params.get('tour') === '1') {
      params.delete('tour')
      const qs = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
      setTimeout(start, 400)
    } else {
      let done = false
      try { done = localStorage.getItem(DONE_KEY) === '1' } catch { /* ignore */ }
      if (!done && window.location.pathname.startsWith('/brief')) setTimeout(start, 1200)
    }
    return () => window.removeEventListener('sf:starttour', onEvt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resolve each step: navigate if needed, then poll for the (persistent) target and measure it.
  React.useEffect(() => {
    if (!active) return
    const step = STEPS[idx]
    let cancelled = false
    setRect(null)   // drop the previous step's spotlight immediately so it can never linger (stale rect)
    if (step.route && pathname !== step.route) router.push(step.route)
    if (!step.target) return
    const started = Date.now()
    let settleUntil = 0
    // Rail icons resolve instantly; page-content anchors (search bars, channel rows) appear after the
    // route loads + fetches AND can shift as content streams in — so once found, keep re-measuring for a
    // short settle window so the spotlight tracks the element to its final position. Never found in time →
    // centered fallback, tour still advances.
    const tick = () => {
      if (cancelled) return
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) {
        const r = measure(el)
        if (r.width > 0 && r.height > 0) { setRect(r); if (!settleUntil) settleUntil = Date.now() + 1000 }
      }
      const done = settleUntil ? Date.now() > settleUntil : Date.now() - started > 4500
      if (!done) setTimeout(() => requestAnimationFrame(tick), 120)
      else if (!settleUntil) setRect(null)
    }
    tick()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx, pathname])

  // Keep the spotlight glued to the target on resize/scroll.
  React.useEffect(() => {
    if (!active) return
    const reflow = () => {
      const step = STEPS[idxRef.current]
      if (!step?.target) return
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) setRect(measure(el))
    }
    window.addEventListener('resize', reflow)
    window.addEventListener('scroll', reflow, true)
    return () => { window.removeEventListener('resize', reflow); window.removeEventListener('scroll', reflow, true) }
  }, [active])

  // Esc closes.
  React.useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(true)
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const next = React.useCallback(() => {
    setIdx(i => { if (i >= STEPS.length - 1) { finish(true); return i } return i + 1 })
  }, [finish])

  if (!active) return null
  const step = STEPS[idx]
  const isLast = idx === STEPS.length - 1
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  // A target bigger than ~55% of the screen (e.g. the whole ad feed) reads better as a plain centered
  // card over the visible page than as a giant spotlight hole.
  const bigTarget = !!rect && rect.width * rect.height > 0.55 * vw * vh
  const centered = step.placement === 'center' || !rect || bigTarget
  const pad = 8

  // Card position.
  let cardStyle: React.CSSProperties
  if (centered) {
    cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }
  } else if (step.placement === 'top') {
    const left = Math.min(Math.max(12, rect!.left), vw - CARD_W - 12)
    cardStyle = { left, top: Math.max(12, rect!.top - 232), bottom: 'auto' as any }
  } else if (step.placement === 'bottom') {
    const left = Math.min(Math.max(12, rect!.left), vw - CARD_W - 12)
    cardStyle = { left, top: Math.min(rect!.top + rect!.height + 14, vh - 240) }
  } else {
    // right of the target (rail icons live on the far left → plenty of room)
    const left = Math.min(rect!.left + rect!.width + 18, vw - CARD_W - 12)
    const top = Math.min(Math.max(12, rect!.top + rect!.height / 2 - 96), vh - 240)
    cardStyle = { left, top }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} aria-live="polite">
      {/* click-catcher so the tour is modal (the box-shadow dim below is visual only) */}
      {!centered && <div style={{ position: 'absolute', inset: 0 }} />}
      {/* dim + spotlight cut-out (box-shadow trick) */}
      {centered ? (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(12,18,12,0.62)', backdropFilter: 'blur(1px)' }} />
      ) : (
        <div style={{
          position: 'absolute', left: rect!.left - pad, top: rect!.top - pad,
          width: rect!.width + pad * 2, height: rect!.height + pad * 2, borderRadius: 14,
          boxShadow: '0 0 0 9999px rgba(12,18,12,0.62), 0 0 0 2px rgba(239,74,30,0.9)',
          transition: 'all .28s cubic-bezier(.4,0,.2,1)', pointerEvents: 'none',
        }} />
      )}

      {/* the tooltip card */}
      <div style={{
        position: 'absolute', width: CARD_W, maxWidth: 'calc(100vw - 24px)', background: '#fff',
        borderRadius: 16, boxShadow: '0 24px 60px rgba(12,18,12,0.30)', padding: '18px 18px 15px',
        fontFamily: 'Inter, system-ui, sans-serif', animation: 'sfTourIn .22s ease-out', ...cardStyle,
      }}>
        <button onClick={() => finish(true)} aria-label="Close tour" style={{
          position: 'absolute', top: 12, right: 12, border: 'none', background: 'transparent',
          cursor: 'pointer', color: '#9aa69a', fontSize: 17, lineHeight: 1, padding: 2,
        }}>✕</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
          <span style={{ width: 24, height: 24, borderRadius: 8, background: '#ef4a1e', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13, fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>S</span>
          <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: '#a2aca2' }}>The tour</span>
        </div>

        <div style={{ fontSize: 17, fontWeight: 800, color: '#141d15', lineHeight: 1.25, letterSpacing: '-.01em', marginBottom: 6 }}>{step.title}</div>
        <div style={{ fontSize: 13.5, color: '#4a5a48', lineHeight: 1.5, marginBottom: 15 }}>{step.body}</div>

        {/* progress dots */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 13 }}>
          {STEPS.map((_, i) => (
            <span key={i} style={{ height: 4, flex: 1, borderRadius: 100, background: i <= idx ? '#ef4a1e' : '#e7ebe4', transition: 'background .2s' }} />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {idx > 0 ? (
            <button onClick={() => setIdx(i => Math.max(0, i - 1))} style={btn('ghost')}>‹ Back</button>
          ) : (
            <button onClick={() => finish(true)} style={btn('ghost')}>Skip</button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#9aa69a', fontVariantNumeric: 'tabular-nums' }}>{idx + 1} / {STEPS.length}</span>
          <button onClick={next} style={btn('primary')}>{isLast ? 'Let’s go →' : 'Next ›'}</button>
        </div>
      </div>

      <style>{`@keyframes sfTourIn{from{opacity:0}to{opacity:1}}
        @media (prefers-reduced-motion: reduce){ [style*="sfTourIn"]{animation:none!important} }`}</style>
    </div>
  )
}

function btn(kind: 'primary' | 'ghost'): React.CSSProperties {
  if (kind === 'primary') return { background: '#ef4a1e', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 15px', fontSize: 13, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer' }
  return { background: 'transparent', color: '#6b7a68', border: 'none', borderRadius: 9, padding: '8px 10px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }
}
