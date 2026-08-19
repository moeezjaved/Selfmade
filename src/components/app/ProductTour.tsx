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

type Step = { target?: string; route?: string; title: string; body: string; placement?: 'right' | 'bottom' | 'center' }

const DONE_KEY = 'sf_tour_v1_done'

const STEPS: Step[] = [
  { placement: 'center', title: 'Meet the company that runs itself',
    body: "You didn't buy software — you hired a marketing team. Here's a 60-second tour of who does what, and how to point them." },
  { target: 'project-switcher', route: '/brief', placement: 'bottom', title: 'This is your brand',
    body: 'Everything — ads, competitors, reports, replies — is scoped to whoever’s selected here. Running several brands? Switch in one click.' },
  { target: 'nav-home', route: '/brief', title: 'Your Morning Brief',
    body: 'Every morning: what changed overnight, what it means, and the few decisions only you can make. This is where you start your day.' },
  { target: 'nav-mello', route: '/mello', title: 'Mello — your AI CEO',
    body: 'Ask anything about your ads, rivals or customers, and tell it to act. Every answer is grounded in your real numbers, not guesses.' },
  { target: 'nav-library', route: '/discovery', title: 'Spy on competitors',
    body: 'Every ad your rivals are running, decoded — so you can copy the winning formula before it saturates.' },
  { target: 'nav-studio', route: '/studio', title: 'Studio makes your ads',
    body: 'Turn any winning ad into yours — your product, your brand, image or video — in a couple of taps.' },
  { target: 'nav-ads', route: '/reports', title: 'Your ads, read for you',
    body: 'Real Meta spend, ROAS and exactly what to scale or cut — not just charts. The whole account, in plain English.' },
  { target: 'nav-inbox', route: '/inbox', title: 'Customer Inbox',
    body: 'Every customer message, triaged with a reply already drafted. You approve — nothing sends on its own.' },
  { target: 'rail-create', title: 'Make something now',
    body: 'Whenever inspiration strikes, this is Create — a fresh ad, a clone of a winner, or a video, any time.' },
  { placement: 'center', title: 'That’s the whole company',
    body: 'It works while you sleep and pings you on Slack the moment something needs you. Ready to run it?' },
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
    if (step.route && pathname !== step.route) router.push(step.route)
    if (!step.target) { setRect(null); return }
    const started = Date.now()
    const tick = () => {
      if (cancelled) return
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      if (el) { setRect(measure(el)); return }
      if (Date.now() - started < 1800) requestAnimationFrame(tick)
      else setRect(null)   // never found → centered fallback, tour still advances
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
  const centered = step.placement === 'center' || !rect
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const pad = 8

  // Card position.
  let cardStyle: React.CSSProperties
  if (centered) {
    cardStyle = { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }
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
