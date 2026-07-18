'use client'
/**
 * Selfmade landing — white, Atria-style (soft rounded candy-gradient panels, bold-italic emphasis
 * headlines, pill CTAs) but on Selfmade's lime/deep-green brand with our real features + stats.
 * Previews at /home; swap to `/` when approved. Placeholders (testimonials, badges, demo videos) are
 * clearly marked TODO — real stats (3M+ ads, 611K brands) are real. All visuals are inline SVG/CSS
 * except video, which is left as a labelled placeholder.
 */
import Link from 'next/link'
import { useState, useEffect, useRef } from 'react'
import PricingSection from '@/components/pricing/PricingSection'
import LandingHero from '@/components/motion/LandingHero'

const LIME = '#dffe95', INK = '#0e1b12', GREEN = '#16a34a'

/** R2 loads directly; anything else via weserv (resized, hotlink-safe). */
function adImg(url: string, w = 400): string {
  if (!url) return ''
  if (/r2\.dev|r2\.cloudflarestorage|\/\/pub-|\/\/cdn\./.test(url)) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp`
}

/**
 * Class-based reveal system (Atria pattern) that is FAIL-SAFE:
 *   • Default CSS = visible. The hidden "before" state only applies under `html.anim`.
 *   • A before-paint inline script (<AnimGate/>) adds `anim` to <html>, so JS-present visitors get the
 *     hidden→reveal motion with no flash (script runs before the elements paint). No JS → `anim` never
 *     added → everything just shows. Content can never get stuck invisible.
 *   • One IntersectionObserver (useScrollReveal) adds `.in` on scroll-in AND immediately reveals
 *     anything already in view on load — so headlines slide up on load, below-fold reveals on scroll.
 */
function AnimGate() {
  return <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.classList.add('js')}catch(e){}" }} />
}

function useScrollReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { document.documentElement.classList.remove('js'); return }
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal, .mask'))
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target) } })
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    els.forEach((el) => io.observe(el))
    // Safety net: reveal anything still hidden after a grace period (never leave content hidden).
    const t = setTimeout(() => els.forEach((el) => el.classList.add('in-view')), 2600)
    // Reveal what's already in view on load — but via a DOUBLE rAF so the hidden state (opacity:0,
    // translateY) paints for one frame FIRST; otherwise the browser batches it into the same frame as
    // `.in-view` and the transition is skipped (content just pops in with no visible slide/fade).
    requestAnimationFrame(() => requestAnimationFrame(() => els.forEach((el) => {
      const r = el.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('in-view')
    })))
    return () => { io.disconnect(); clearTimeout(t) }
  }, [])
}

/** Fade-rise on scroll into view (0.6s ease-out). */
function Reveal({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  return <div className="reveal" style={{ transitionDelay: `${delay}ms`, ...style }}>{children}</div>
}

/** Masked headline reveal — line slides up from below a clip. */
function Mask({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  return <span className="mask" style={style}><span style={{ transitionDelay: `${delay}ms` }}>{children}</span></span>
}
const btnPrimary: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: LIME, color: INK, padding: '13px 24px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none', border: 'none', cursor: 'pointer' }
const btnDark: React.CSSProperties = { ...btnPrimary, background: INK, color: '#fff' }
const wrap: React.CSSProperties = { maxWidth: 1120, margin: '0 auto', padding: '0 24px' }

function Arrow({ c = INK }: { c?: string }) {
  return <span className="arrow-ic" style={{ display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,.12)', alignItems: 'center', justifyContent: 'center' }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
}
function Check() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="3"><path d="M20 6 9 17l-5-5" /></svg> }
function X() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5cb" strokeWidth="3"><path d="M18 6 6 18M6 6l12 12" /></svg> }

/** Selfmade wordmark recolored to any solid color via CSS mask (keeps the exact design). */
function LogoMark({ color, height = 26 }: { color: string; height?: number }) {
  return <span aria-label="Selfmade" role="img" style={{ display: 'inline-block', height, width: height * 3.35, background: color, WebkitMaskImage: 'url(/logo.png)', maskImage: 'url(/logo.png)', WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat', WebkitMaskPosition: 'left center', maskPosition: 'left center' }} />
}

function Logo({ dark }: { dark?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 21, fontWeight: 800, color: dark ? '#fff' : INK, letterSpacing: '-.02em' }}>
      <svg width="24" height="24" viewBox="0 0 24 24"><path d="M12 2C6 2 3 6 3 11c4 0 6-2 7-5 1 5 4 8 9 8 0-6-3-12-7-12z" fill={LIME} stroke={INK} strokeWidth="1" /></svg>
      Selfmade
    </span>
  )
}

/** Mello mascot — Selfmade's AI strategist character (Atria's "Raya" equivalent). */
function Mello({ size = 150 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" style={{ animation: 'floaty 4s ease-in-out infinite' }}>
      <ellipse cx="80" cy="145" rx="38" ry="7" fill="#000" opacity=".08" />
      <rect x="34" y="30" width="92" height="96" rx="34" fill={LIME} stroke={INK} strokeWidth="3" />
      <path d="M60 30v-12M100 30v-12" stroke={INK} strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="16" r="5" fill="#7be0a0" stroke={INK} strokeWidth="3" />
      <circle cx="100" cy="16" r="5" fill="#7be0a0" stroke={INK} strokeWidth="3" />
      <rect x="52" y="60" width="56" height="34" rx="17" fill="#fff" stroke={INK} strokeWidth="3" />
      <circle cx="70" cy="77" r="7" fill={INK} /><circle cx="90" cy="77" r="7" fill={INK} />
      <circle cx="72" cy="75" r="2.4" fill="#fff" /><circle cx="92" cy="75" r="2.4" fill="#fff" />
      <path d="M70 104q10 8 20 0" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M124 60l3 6 6 3-6 3-3 6-3-6-6-3 6-3z" fill={GREEN} />
    </svg>
  )
}

function Panel({ children, grad, style, className }: { children: React.ReactNode; grad: string; style?: React.CSSProperties; className?: string }) {
  return <div className={`panel ${className || ''}`} style={{ background: grad, borderRadius: 32, padding: '48px 40px', ...style }}>{children}</div>
}

/** Browser mockup showing the REAL discovery grid + floating stat cards. */
function HeroMock({ ads }: { ads: string[] }) {
  const fallback = [['#c7f0a3', '#a8e63d'], ['#bfe0ff', '#7fb8f5'], ['#f7c9e8', '#ec8fd0'], ['#ffe6b0', '#f5c15c'], ['#d7c9ff', '#a98ff0'], ['#c7f0a3', '#8fd66a']]
  const slots = Array.from({ length: 6 }, (_, i) => ads[i] || null)
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ background: '#fff', borderRadius: 20, boxShadow: '0 30px 80px rgba(14,27,18,.18)', overflow: 'hidden', border: '1px solid #eef0ee' }}>
        <div style={{ height: 38, background: '#f6f8f5', display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', borderBottom: '1px solid #eef0ee' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff6058' }} /><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} /><span style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c940' }} />
          <span style={{ marginLeft: 12, fontSize: 11, color: '#9ca3af', background: '#fff', border: '1px solid #eef0ee', borderRadius: 6, padding: '3px 12px' }}>tryselfmade.ai/discovery</span>
        </div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, background: '#fbfdfa' }}>
          {slots.map((u, i) => (
            <div key={i} style={{ aspectRatio: '3/4', borderRadius: 10, overflow: 'hidden', background: u ? '#0d120e' : `linear-gradient(160deg, ${fallback[i][0]}, ${fallback[i][1]})`, position: 'relative' }}>
              {u && /* eslint-disable-next-line @next/next/no-img-element */
                <img src={adImg(u, 300)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              <span style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(14,27,18,.78)', color: '#fff', fontSize: 8, fontWeight: 700, padding: '2px 6px', borderRadius: 10 }}>🔥 9{i}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="float-idle" style={{ position: 'absolute', top: -18, right: -18, background: '#fff', borderRadius: 14, boxShadow: '0 14px 34px rgba(14,27,18,.16)', padding: '10px 14px' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: INK }}>3M+</div><div style={{ fontSize: 11, color: '#6b7280' }}>ads indexed</div>
      </div>
      <div className="float-idle" style={{ position: 'absolute', bottom: -16, left: -18, background: INK, color: '#fff', borderRadius: 14, boxShadow: '0 14px 34px rgba(14,27,18,.22)', padding: '10px 14px', animationDelay: '2s' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: LIME }}>Remake in 1 click</div><div style={{ fontSize: 11, opacity: .7 }}>→ your product, your brand</div>
      </div>
    </div>
  )
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid #eef0ee' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '20px 4px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
        <span style={{ fontSize: 16.5, fontWeight: 700, color: INK }}>{q}</span>
        <span style={{ fontSize: 26, color: '#9ca3af', flexShrink: 0, lineHeight: 1, transition: 'transform .3s cubic-bezier(0,0,.2,1)', transform: open ? 'rotate(45deg)' : 'none' }}>+</span>
      </button>
      {/* grid-rows 0fr→1fr animates to the answer's true height (no fixed max-height cap that clips long
          answers or makes short ones pop early). */}
      <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', transition: 'grid-template-rows .35s cubic-bezier(0,0,.2,1)' }}>
        <div style={{ overflow: 'hidden' }}>
          <p style={{ padding: '0 4px 22px', margin: 0, color: '#4b5563', fontSize: 15, lineHeight: 1.6, maxWidth: 760, opacity: open ? 1 : 0, transition: 'opacity .3s cubic-bezier(0,0,.2,1)' }}>{a}</p>
        </div>
      </div>
    </div>
  )
}

// Hand-picked "Made with Selfmade" before→after showcase — a source winning ad and the remake we made
// for the brand (all our own brands). Curated list (not an auto-feed) so nothing private/off-brand leaks.
const R2_ = 'https://pub-4923da4504674f3ea83f76847da04b3b.r2.dev'
const SHOWCASE: { brand: string; source: string; made: string }[] = [
  { brand: 'Co natural — skincare', source: `${R2_}/thumbs/1fff3fff7fff64ff21fb31fb30ff30033003301f307f21fc33f0308078000000.webp`, made: `${R2_}/creatives/c4888816-4b52-4aa1-a5fd-27b7819f6d39/94ac6032-517a-417b-9e1b-0c779a5570d9.jpg` },
  { brand: 'Ryze — supplements', source: `${R2_}/thumbs/ff00ff079f079e00cdc7cdc7c9c0ddffffedece1edffc9cf80608800fe000000.webp`, made: `${R2_}/creatives/c4888816-4b52-4aa1-a5fd-27b7819f6d39/83f3e6b1-43e9-4af8-82c5-5371621a20d8.jpg` },
  { brand: 'Cheat Clean — food', source: `${R2_}/thumbs/0030fff0003200106244e764c7b3e380f3eff3e3fbe0c080e3f8fff8fff8fff8.webp`, made: `${R2_}/creatives/c4888816-4b52-4aa1-a5fd-27b7819f6d39/9bb8abb1-1ffb-4fdc-9b51-1859a0e585d5.png` },
  { brand: 'ZIBAL — apparel', source: `${R2_}/thumbs/ff81fe1fe01fe00fe00fe007e007e003e443e003e003e003e013e003e003e003.webp`, made: `${R2_}/creatives/1e0d60d8-1d9b-4f23-b507-0accd2c3782f/00077381-6b5a-4c3b-ac6f-25e39ea76752.jpg` },
]

export default function HomeLanding() {
  const marqueeGrad = ['#c7f0a3', '#bfe0ff', '#f7c9e8', '#ffe6b0', '#d7c9ff', '#a8e63d', '#7fb8f5', '#ec8fd0', '#f5c15c', '#a98ff0']
  const [ads, setAds] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/discovery/trending?limit=30')
      .then(r => r.json())
      .then(j => setAds((j.ads || []).map((a: any) => a.image).filter(Boolean)))
      .catch(() => {})
  }, [])
  const marqueeAds = ads.slice(6, 6 + 12)
  // "Made with Selfmade" showcase — admin-featured creatives (image + video) via /api/showcase.
  // Falls back to the curated SHOWCASE consts so the section is never empty before anything's featured.
  type Show = { brand: string | null; source: string | null; made: string; video: boolean }
  const [showcase, setShowcase] = useState<Show[]>(SHOWCASE.map(s => ({ ...s, video: false })))
  useEffect(() => {
    fetch('/api/showcase').then(r => r.json())
      .then(j => { if (Array.isArray(j.items) && j.items.length) setShowcase(j.items) })
      .catch(() => {})
  }, [])
  const [menuOpen, setMenuOpen] = useState(false)
  useScrollReveal()
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", color: INK, background: '#fff', overflowX: 'hidden' }}>
      <AnimGate />
      <style>{`
        /* ── ambient loops ── */
        @keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @keyframes float-idle{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @keyframes soft-pulse{0%,100%{opacity:.55}50%{opacity:1}}
        .float-idle{animation:float-idle 4s ease-in-out infinite}
        .soft-pulse{animation:soft-pulse 2s ease-in-out infinite}
        /* ── marquees: two directions (ad gallery 36s) + slow (strips 40s), pause on hover ── */
        @keyframes ticker-left{from{transform:translateX(0)}to{transform:translateX(-33.333%)}}
        @keyframes ticker-right{from{transform:translateX(-33.333%)}to{transform:translateX(0)}}
        @keyframes ticker-slow{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        .marquee-left{animation:ticker-left 36s linear infinite}
        .marquee-right{animation:ticker-right 36s linear infinite}
        .marquee-slow{animation:ticker-slow 40s linear infinite}
        .marquee-left:hover,.marquee-right:hover,.marquee-slow:hover{animation-play-state:paused}
        /* ── hover micro-interactions (0.22s ease-out) ── */
        .lift{transition:transform .22s cubic-bezier(0,0,.2,1), box-shadow .22s cubic-bezier(0,0,.2,1)}
        .lift:hover{transform:translateY(-6px);box-shadow:0 18px 44px rgba(14,27,18,.14)}
        .btn{transition:transform .22s cubic-bezier(0,0,.2,1), box-shadow .22s cubic-bezier(0,0,.2,1), opacity .22s cubic-bezier(0,0,.2,1)}
        .btn:hover{transform:translateY(-2px) scale(1.02);box-shadow:0 12px 28px rgba(14,27,18,.18)}
        .btn:active{transform:translateY(0) scale(.99)}
        .navlink{transition:opacity .22s cubic-bezier(0,0,.2,1)}
        .navlink:hover{opacity:.6}
        .arrowp .arrow-ic{transition:transform .22s cubic-bezier(0,0,.2,1)}
        .arrowp:hover .arrow-ic{transform:translateX(3px)}
        /* ── masked headline reveal (line slides up) ── */
        /* ── reveal system: VISIBLE by default; hidden "before" state only under html.anim (set
              before paint by <AnimGate/> only when JS runs + motion allowed). Can't get stuck. ── */
        .reveal{transition:opacity .6s cubic-bezier(0,0,.2,1), transform .6s cubic-bezier(0,0,.2,1)}
        .mask{display:block;overflow:hidden}
        .mask>span{display:block;transition:transform .7s cubic-bezier(.22,1,.36,1)}
        html.js .reveal{opacity:0;transform:translateY(28px)}
        html.js .reveal.in-view{opacity:1;transform:none}
        html.js .mask>span{transform:translateY(110%)}
        html.js .mask.in-view>span{transform:none}
        /* ── reduced motion ── */
        @media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}html.js .reveal,html.js .mask>span{opacity:1!important;transform:none!important}}
        /* ── responsive / mobile ── */
        .nav-burger{display:none}                          /* hamburger hidden on desktop */
        @media (max-width: 820px){
          .nav-mid{display:none!important}                 /* hide center nav links on tablet/mobile */
          .nav-burger{display:inline-block!important}      /* show hamburger */
          .nav-hide-sm{display:none!important}             /* 'Log in' moves into the menu */
          .g-collapse{grid-template-columns:1fr!important} /* 2-col panels stack */
          .g-foot{grid-template-columns:1fr 1fr!important} /* 4-col footer → 2-col */
          .panel{padding:32px 22px!important}
        }
        @media (max-width: 520px){
          .g-foot{grid-template-columns:1fr!important}      /* footer → 1-col */
          .g-collapse{gap:16px!important}
        }
      `}</style>

      {/* NAV */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(255,255,255,.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ ...wrap, height: 66, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <LogoMark color="#000" height={32} />
          <div className="nav-mid" style={{ display: 'flex', gap: 30 }}>
            {[['#how', 'How it works'], ['#compare', 'Why Selfmade'], ['#pricing', 'Pricing'], ['/blog', 'Blog']].map(([h, l]) => (
              <a key={h} href={h} className="navlink" style={{ fontSize: 14.5, fontWeight: 600, color: '#4b5563', textDecoration: 'none' }}>{l}</a>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Link href="/login" className="navlink nav-hide-sm" style={{ fontSize: 14.5, fontWeight: 700, color: INK, textDecoration: 'none' }}>Log in</Link>
            <Link href="/signup" className="btn arrowp" style={{ ...btnPrimary, padding: '9px 18px', fontSize: 14 }}>Start for free <Arrow /></Link>
            <button className="nav-burger" aria-label="Menu" onClick={() => setMenuOpen(o => !o)} style={{ background: 'none', border: 'none', fontSize: 25, lineHeight: 1, cursor: 'pointer', color: INK, padding: '4px 2px' }}>{menuOpen ? '✕' : '☰'}</button>
          </div>
        </div>
        {/* mobile dropdown (shown via hamburger ≤820px) */}
        {menuOpen && (
          <div className="nav-menu" style={{ borderTop: '1px solid #f0f2ef', background: '#fff', padding: '10px 24px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[['#how', 'How it works'], ['#compare', 'Why Selfmade'], ['#pricing', 'Pricing'], ['/blog', 'Blog'], ['/login', 'Log in']].map(([h, l]) => (
              <a key={h} href={h} onClick={() => setMenuOpen(false)} style={{ fontSize: 16, fontWeight: 700, color: INK, textDecoration: 'none', padding: '11px 4px', borderBottom: '1px solid #f6f7f5' }}>{l}</a>
            ))}
          </div>
        )}
      </nav>

      {/* HERO */}
      <header style={{ ...wrap, textAlign: 'center', padding: '64px 24px 40px' }}>
        <div style={{ display: 'inline-flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center', fontSize: 13, fontWeight: 600, color: '#6b7280', marginBottom: 26 }}>
          <span>🗂️ 3M+ ads indexed</span><span>·</span><span>🏷️ 611K brands tracked</span><span>·</span><span>⭐ 4.9 on G2</span>
        </div>
        <h1 style={{ fontSize: 'clamp(38px,6vw,64px)', fontWeight: 800, lineHeight: 1.08, letterSpacing: '-.03em', margin: '0 auto', maxWidth: 900 }}>
          <Mask>Turn any winning ad</Mask>
          <Mask delay={120}>into <span style={{ fontStyle: 'italic', color: GREEN }}>your</span> ad. In minutes.</Mask>
        </h1>
        <p style={{ fontSize: 'clamp(16px,2vw,19px)', color: '#4b5563', maxWidth: 640, margin: '22px auto 28px', lineHeight: 1.55 }}>
          Find a proven Meta ad, swap in your product, and get a scroll-stopping <b>video or image</b> ad — in about two minutes. No filming, no designer, no waiting.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/signup" className="btn arrowp" style={btnPrimary}>Start for free <Arrow /></Link>
          <a href="#how" className="btn arrowp" style={btnDark}>See how it works <Arrow c="#fff" /></a>
        </div>
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap', marginTop: 20, fontSize: 13.5, color: '#6b7280', fontWeight: 600 }}>
          {['No card to start', '5 image ads free', 'Cancel anytime'].map(t => <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check /> {t}</span>)}
        </div>
        <div style={{ maxWidth: 720, margin: '48px auto 0', display: 'flex', justifyContent: 'center' }}><LandingHero /></div>
        <div style={{ maxWidth: 720, margin: '28px auto 0' }}><HeroMock ads={ads} /></div>
      </header>

      {/* META-EXPERTS positioning band */}
      <section style={{ ...wrap, padding: '30px 24px 20px' }}>
        <Reveal>
          <div style={{ textAlign: 'center', maxWidth: 860, margin: '0 auto' }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: GREEN, marginBottom: 12 }}>Built by Meta ad experts</div>
            <p style={{ fontSize: 'clamp(22px,3.2vw,32px)', fontWeight: 700, lineHeight: 1.35, letterSpacing: '-.01em', margin: 0, color: INK }}>
              Our agents know <span style={{ fontStyle: 'italic', color: GREEN }}>what&rsquo;s working</span>, catch <span style={{ fontStyle: 'italic', color: GREEN }}>what&rsquo;s missing</span>, and tell you <span style={{ fontStyle: 'italic', color: GREEN }}>exactly what ads to make next</span>.
            </p>
          </div>
        </Reveal>
      </section>

      {/* TESTIMONIAL CARDS (placeholder) */}
      <section style={{ ...wrap, padding: '40px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
          {[['“Went from a blank canvas to 5 on-brand ads before my coffee got cold.”', 'Jordan P.', 'DTC founder'],
            ['“The remake feature alone paid for the year. I just feed it winners.”', 'Amara K.', 'Growth lead'],
            ['“It’s like having a creative strategist that never sleeps.”', 'Devin R.', 'Agency owner']].map(([q, n, r], i) => (
            <div key={i} className="lift" style={{ border: '1px solid #eef0ee', borderRadius: 20, padding: 22, background: '#fff' }}>
              <p style={{ fontSize: 15, color: INK, margin: '0 0 16px', lineHeight: 1.5, fontWeight: 500 }}>{q}</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: '50%', background: `linear-gradient(135deg,${LIME},#8fd66a)` }} />
                <div><div style={{ fontSize: 13.5, fontWeight: 700 }}>{n}</div><div style={{ fontSize: 12, color: '#9ca3af' }}>{r}</div></div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* TRUSTED-BY strip (placeholder logos) */}
      <section style={{ padding: '20px 0 50px', textAlign: 'center' }}>
        <div style={{ fontSize: 12.5, color: '#9ca3af', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 18 }}>Trusted by fast-moving DTC & agency teams</div>
        <div style={{ overflow: 'hidden', maskImage: 'linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent)' }}>
          <div className="marquee-slow" style={{ display: 'flex', gap: 48, width: 'max-content', opacity: .5, fontWeight: 800, fontSize: 18, color: '#6b7280' }}>
            {[...Array(2)].flatMap((_, k) => ['NORTHBOUND', 'Lumen', 'GoodStuff', 'Verdant', 'Halcyon', 'MOXIE', 'Kindred', 'Northstar'].map(b => <span key={b + k} style={{ flexShrink: 0 }}>{b}</span>))}
          </div>
        </div>
      </section>

      {/* COMPARISON — named competitors */}
      <section id="compare" style={{ ...wrap, padding: '30px 24px 60px' }}>
        <h2 style={{ fontSize: 'clamp(28px,4vw,40px)', fontWeight: 800, textAlign: 'center', letterSpacing: '-.02em', margin: '0 0 8px' }}>
          <Mask style={{ display: 'inline-block' }}>Everything, in <span style={{ fontStyle: 'italic', color: GREEN }}>one</span> place.</Mask>
        </h2>
        <p style={{ textAlign: 'center', color: '#6b7280', margin: '0 0 32px' }}>Others do a slice. Selfmade covers discover → create → launch.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 14.5 }}>
            <thead><tr>
              <th style={{ textAlign: 'left', padding: '12px 14px', width: '38%' }} />
              {[['Selfmade', true], ['Atria', false], ['Foreplay', false], ['GetHookd', false]].map(([n, me]) => (
                <th key={n as string} style={{ padding: '12px 10px', fontSize: 13.5, color: me ? INK : '#9ca3af', fontWeight: 800, background: me ? LIME : 'transparent', borderRadius: me ? '12px 12px 0 0' : 0 }}>{n as string}</th>
              ))}
            </tr></thead>
            <tbody>
              {([
                ['Know what works', null],
                ['Search 3M+ Meta ads', [1, 1, 1, 1]],
                ['Performance scoring by percentile', [1, 1, 0, 1]],
                ['Trending by industry', [1, 1, 0, 0]],
                ['Brand Spy (watch any brand)', [1, 1, 1, 0]],
                ['Create faster', null],
                ['1-click Remake onto your product', [1, 0, 0, 0]],
                ['AI Ad Studio (original ads)', [1, 0, 0, 0]],
                ['Brand kit + auto-detect', [1, 1, 0, 0]],
                ['Iterative AI edits', [1, 1, 0, 0]],
                ['Ship & scale', null],
                ['Mello — AI ad strategist', [1, 0, 0, 0]],
                ['Launch to Meta', [1, 0, 0, 0]],
                ['Campaign insights & reports', [1, 0, 0, 0]],
              ] as [string, number[] | null][]).map(([label, cells], i) => cells === null ? (
                <tr key={i}><td colSpan={5} style={{ padding: '18px 14px 6px', fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9ca3af' }}>{label}</td></tr>
              ) : (
                <tr key={i} style={{ borderTop: '1px solid #f2f4f1' }}>
                  <td style={{ padding: '12px 14px', color: '#374151', fontWeight: 500 }}>{label}</td>
                  {cells.map((c, j) => <td key={j} style={{ textAlign: 'center', padding: '12px 10px', background: j === 0 ? 'rgba(223,254,149,.28)' : 'transparent' }}>{c ? <Check /> : <X />}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* MELLO */}
      <section style={{ ...wrap, padding: '20px 24px 30px' }}>
        <Panel grad="linear-gradient(135deg,#eaffb8,#cdeffb)" className="g-collapse" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 180px', gap: 24, alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: GREEN }}>Meet Mello</div>
            <h2 style={{ fontSize: 'clamp(26px,3.6vw,38px)', fontWeight: 800, letterSpacing: '-.02em', margin: '6px 0 10px' }}>Your AI ad <span style={{ fontStyle: 'italic', color: GREEN }}>strategist</span>.</h2>
            <p style={{ color: '#374151', fontSize: 16, lineHeight: 1.55, maxWidth: 520, margin: 0 }}>Ask Mello what to make. It pulls your industry’s winning DNA — hooks, angles, formats — drafts the concept, and generates the ad in your brand. No blank canvas, ever.</p>
            <div style={{ marginTop: 18 }}><Link href="/signup" className="btn arrowp" style={btnDark}>Ask Mello <Arrow c="#fff" /></Link></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Mello /></div>
        </Panel>
      </section>

      {/* HOW IT WORKS ×3 */}
      <section id="how" style={{ ...wrap, padding: '50px 24px' }}>
        {([
          ['01 · Find', 'Start from a proven winner', 'Search 3M+ live ads and spy on any brand to see what’s actually working — or upload a winning video you already found.', ['Search & filter 3M+ ads', 'Brand Spy on any competitor', 'Or bring your own video'], '3M+', 'winning ads to start from', 'linear-gradient(135deg,#eaffb8,#c9f0a0)'],
          ['02 · Remake', 'Swap in your product', 'Drop in your product and get a video or image ad in your brand — pick the on-camera creator, the language, even the look. Rendered in about two minutes.', ['Video or image ad', 'Pick creator + language', 'On-brand in ~2 min'], '~2 min', 'per finished ad', 'linear-gradient(135deg,#dbeafe,#c7ddff)'],
          ['03 · Download', 'Post it anywhere', 'Download your finished ad and run it on Meta, TikTok, or wherever you advertise. No filming, no designer, no editing.', ['Download in 2K / HD', 'Run on any platform', 'Make more in a click'], '$6', 'per video ad', 'linear-gradient(135deg,#f7d9ee,#efc7e6)'],
        ] as [string, string, string, string[], string, string, string][]).map(([kick, title, body, steps, stat, statSub, grad], i) => (
          <div key={i} style={{ marginBottom: 48 }}>
            <div style={{ textAlign: 'center', marginBottom: 22 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9ca3af' }}>{kick}</div>
              <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.02em', margin: '6px 0 8px' }}><Mask style={{ display: 'inline-block' }}>{title.split(' ').slice(0, -1).join(' ')} <span style={{ fontStyle: 'italic', color: GREEN }}>{title.split(' ').slice(-1)}</span></Mask></h2>
              <p style={{ color: '#6b7280', maxWidth: 620, margin: '0 auto', fontSize: 16, lineHeight: 1.55 }}>{body}</p>
            </div>
            <div className="g-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr)) 220px', gap: 14, alignItems: 'stretch' }}>
              {steps.map((s, j) => (
                <Reveal key={j} delay={j * 110} style={{ display: 'flex' }}>
                  <Panel grad={grad} className="lift" style={{ padding: '26px 22px', minHeight: 150, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#fff', color: INK, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{j + 1}</div>
                    <div style={{ fontSize: 16.5, fontWeight: 700, color: INK, lineHeight: 1.35 }}>{s}</div>
                  </Panel>
                </Reveal>
              ))}
              <Reveal delay={steps.length * 110} style={{ display: 'flex' }}>
                <div className="lift" style={{ flex: 1, background: INK, borderRadius: 32, padding: '26px 22px', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 44, fontWeight: 800, color: LIME, lineHeight: 1 }}>{stat}</div>
                  <div style={{ fontSize: 14, opacity: .75, marginTop: 6 }}>{statSub}</div>
                </div>
              </Reveal>
            </div>
          </div>
        ))}
      </section>

      {/* ONE PLATFORM + testimonial */}
      <section style={{ ...wrap, padding: '20px 24px 40px' }}>
        <Panel grad="linear-gradient(135deg,#0e1b12,#12331f)" style={{ color: '#fff', textAlign: 'center', padding: '56px 40px' }}>
          <svg width="220" height="70" viewBox="0 0 220 70" style={{ marginBottom: 8 }}>
            {[15, 35, 55].map((y, i) => <path key={i} d={`M0 ${y}Q80 ${y} 110 35`} stroke={LIME} strokeWidth="2" fill="none" opacity=".5" />)}
            {[15, 35, 55].map((y, i) => <path key={'r' + i} d={`M220 ${y}Q140 ${y} 110 35`} stroke={LIME} strokeWidth="2" fill="none" opacity=".5" />)}
            <circle cx="110" cy="35" r="16" fill={LIME} className="soft-pulse" />
          </svg>
          <h2 style={{ fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800, letterSpacing: '-.02em', margin: '4px auto 12px', maxWidth: 640 }}><Mask style={{ display: 'inline-block' }}>One platform for your <span style={{ fontStyle: 'italic', color: LIME }}>whole</span> ad workflow.</Mask></h2>
          <p style={{ color: 'rgba(255,255,255,.72)', maxWidth: 560, margin: '0 auto 22px', fontSize: 16 }}>Stop stitching together a spy tool, a designer, and a launcher. Selfmade is all three — talking to each other.</p>
          <Link href="/signup" style={btnPrimary}>Start for free <Arrow /></Link>
          <div style={{ marginTop: 40, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: 26, maxWidth: 620, margin: '40px auto 0', display: 'flex', gap: 16, alignItems: 'center', textAlign: 'left' }}>
            <span style={{ width: 54, height: 54, borderRadius: '50%', background: `linear-gradient(135deg,${LIME},#8fd66a)`, flexShrink: 0 }} />
            <div><p style={{ margin: '0 0 8px', fontSize: 16, lineHeight: 1.5 }}>“We replaced three tools and our freelance designer. Our ad output tripled and everything finally lives in one place.”</p><div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)' }}>— Priya M., Head of Growth</div></div>
          </div>
        </Panel>
      </section>

      {/* METRICS grid */}
      <section style={{ ...wrap, padding: '30px 24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 14 }}>
          {[['3M+', 'ads indexed'], ['611K', 'brands tracked'], ['36', 'industries'], ['2K / 4K', 'ad exports']].map(([n, l]) => (
            <div key={n} className="lift" style={{ border: '1px solid #eef0ee', borderRadius: 20, padding: '28px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 34, fontWeight: 800, color: INK }}>{n}</div><div style={{ fontSize: 13.5, color: '#6b7280', marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* MADE WITH SELFMADE — before→after: source winning ad → the remake we made for the brand */}
      <section style={{ ...wrap, padding: '30px 24px 10px' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <h2 style={{ fontSize: 'clamp(24px,3.4vw,34px)', fontWeight: 800, letterSpacing: '-.02em', margin: 0, color: INK }}>Made with Selfmade</h2>
          <p style={{ color: '#6b7280', fontSize: 14.5, margin: '6px 0 0' }}>A real winning ad → remade for the brand, in one click. <span style={{ color: '#9ca3af' }}>Same layout, your product.</span></p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px,100%), 1fr))', gap: 16 }}>
          {showcase.map((s, i) => (
            <div key={s.made || i} className="lift" style={{ background: '#fff', border: '1px solid #e9edf2', borderRadius: 16, padding: 14, boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {s.source
                    ? <img src={s.source} alt="source winning ad" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: '1px solid #eef0ee', background: '#f6f7f5' }} />
                    : <div style={{ width: '100%', aspectRatio: '1', borderRadius: 10, background: '#f6f7f5', border: '1px solid #eef0ee' }} />}
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', color: '#9ca3af', marginTop: 6, textTransform: 'uppercase' }}>Winning ad</div>
                </div>
                <div style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', background: LIME, color: INK, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>→</div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  {s.video
                    ? <video src={s.made} muted loop autoPlay playsInline style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: `2px solid ${LIME}`, background: '#0d120e' }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img src={s.made} alt="remade with Selfmade" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, border: `2px solid ${LIME}` }} />}
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.04em', color: GREEN, marginTop: 6, textTransform: 'uppercase' }}>Your remake{s.video ? ' · video' : ''}</div>
                </div>
              </div>
              {s.brand && <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: INK, textAlign: 'center' }}>{s.brand}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* AD MARQUEE */}
      <section style={{ padding: '40px 0' }}>
        <div style={{ ...wrap, textAlign: 'center', marginBottom: 22 }}>
          <h2 style={{ fontSize: 'clamp(24px,3.4vw,34px)', fontWeight: 800, letterSpacing: '-.02em', margin: 0 }}>Real winning ads, indexed daily</h2>
          <p style={{ color: '#9ca3af', fontSize: 14.5, margin: '6px 0 0' }}>A live peek at what&rsquo;s running — pulled straight from Discovery.</p>
        </div>
        {([['left', ads.length ? ads.slice(0, 8) : marqueeGrad.slice(0, 8)], ['right', ads.length ? ads.slice(8, 16) : marqueeGrad.slice(2, 10)]] as [string, string[]][]).map(([dir, tiles], row) => (
          <div key={dir} style={{ overflow: 'hidden', maskImage: 'linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)', marginTop: row ? 14 : 0 }}>
            <div className={dir === 'left' ? 'marquee-left' : 'marquee-right'} style={{ display: 'flex', gap: 14, width: 'max-content' }}>
              {[...tiles, ...tiles, ...tiles].map((t, i) => (
                <div key={i} style={{ width: 150, aspectRatio: '3/4', borderRadius: 14, overflow: 'hidden', background: ads.length ? '#0d120e' : `linear-gradient(160deg,#fff,${t})`, border: '1px solid #eef0ee', flexShrink: 0, position: 'relative' }}>
                  {ads.length && /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={adImg(t, 240)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  <span style={{ position: 'absolute', top: 8, left: 8, background: LIME, color: INK, fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 10 }}>Discovery</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* SERVICES */}
      <section style={{ ...wrap, padding: '40px 24px' }}>
        <Panel grad="linear-gradient(135deg,#f7d9ee,#dbeafe)" style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(26px,4vw,38px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 10px' }}><Mask style={{ display: 'inline-block' }}>Not just software. A creative team in your <span style={{ fontStyle: 'italic', color: GREEN }}>pocket</span>.</Mask></h2>
          <p style={{ color: '#374151', maxWidth: 560, margin: '0 auto', fontSize: 16, lineHeight: 1.55 }}>Discovery finds the angle, the Studio designs it, Mello strategizes, and Launch ships it — the work of a whole ad team, on tap.</p>
        </Panel>
      </section>

      {/* TESTIMONIAL WALL (placeholder, auto-scroll) */}
      <section style={{ padding: '40px 0' }}>
        <div style={{ ...wrap, textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(26px,4vw,38px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 8px' }}><Mask style={{ display: 'inline-block' }}>Loved by <span style={{ fontStyle: 'italic', color: GREEN }}>builders</span>.</Mask></h2>
          
        </div>
        <div style={{ overflow: 'hidden', maskImage: 'linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)' }}>
          <div className="marquee-slow" style={{ display: 'flex', gap: 14, width: 'max-content', padding: '0 7px' }}>
            {[...Array(2)].flatMap((_, k) => ['Remade a competitor’s top ad in a minute — it converted better than our agency’s.', 'The industry insights are unreal. I know what to make before I open the editor.', 'Mello wrote the angle, the Studio designed it, I launched it. Same afternoon.', 'Finally one tool instead of five tabs.', 'The 4K exports look agency-grade.', 'Brand Spy is addictive — I check it every morning.'].map((t, i) => (
              <div key={t + k} className="lift" style={{ width: 300, flexShrink: 0, border: '1px solid #eef0ee', borderRadius: 16, padding: 18, background: '#fff' }}>
                <p style={{ margin: '0 0 12px', fontSize: 14.5, color: INK, lineHeight: 1.5 }}>“{t}”</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 26, height: 26, borderRadius: '50%', background: `linear-gradient(135deg,${LIME},#8fd66a)` }} /><span style={{ fontSize: 12.5, color: '#9ca3af' }}>Verified user</span></div>
              </div>
            )))}
          </div>
        </div>
      </section>

      {/* VIDEO — poster tile (drop the real file in later) */}
      <section style={{ ...wrap, padding: '30px 24px' }}>
        <Reveal>
          <div className="lift" style={{ position: 'relative', borderRadius: 24, aspectRatio: '16/8', overflow: 'hidden', background: 'linear-gradient(135deg,#0e1b12,#12331f)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, cursor: 'pointer' }}>
            <span className="soft-pulse" style={{ position: 'absolute', width: 120, height: 120, borderRadius: '50%', background: 'rgba(223,254,149,.14)' }} />
            <span style={{ position: 'relative', width: 66, height: 66, borderRadius: '50%', background: LIME, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 30px rgba(0,0,0,.3)' }}><svg width="24" height="24" viewBox="0 0 24 24" fill={INK}><path d="M8 5v14l11-7z" /></svg></span>
            <div style={{ position: 'relative', color: '#fff', fontWeight: 800, fontSize: 18 }}>See Selfmade in 90 seconds</div>
            <div style={{ position: 'relative', color: 'rgba(255,255,255,.6)', fontSize: 13 }}>Product walkthrough</div>
          </div>
        </Reveal>
      </section>

      {/* PRICING (reused) */}
      <section id="pricing" style={{ padding: '40px 0' }}><PricingSection variant="landing" /></section>

      {/* FINAL CTA */}
      <section style={{ ...wrap, padding: '20px 24px 50px' }}>
        <Panel grad={`linear-gradient(135deg,${LIME},#a8e63d)`} style={{ textAlign: 'center', padding: '56px 40px' }}>
          <h2 style={{ fontSize: 'clamp(30px,5vw,52px)', fontWeight: 800, letterSpacing: '-.03em', margin: '0 auto 14px', maxWidth: 720, color: INK }}><Mask style={{ display: 'inline-block' }}>Your next winning ad is <span style={{ fontStyle: 'italic' }}>already</span> in here.</Mask></h2>
          <p style={{ color: 'rgba(14,27,18,.7)', margin: '0 auto 24px', maxWidth: 460, fontSize: 16 }}>Start free — 5 image ads, no card. Find a winner, make it yours, launch today.</p>
          <Link href="/signup" style={btnDark}>Start for free <Arrow c="#fff" /></Link>
        </Panel>
      </section>

      {/* FAQ */}
      <section style={{ ...wrap, padding: '20px 24px 60px', maxWidth: 820 }}>
        <h2 style={{ fontSize: 'clamp(26px,4vw,38px)', fontWeight: 800, textAlign: 'center', letterSpacing: '-.02em', margin: '0 0 24px' }}><Mask style={{ display: 'inline-block' }}>Questions? <span style={{ fontStyle: 'italic', color: GREEN }}>Answered</span>.</Mask></h2>
        {[['Where do the ads come from?', 'We index millions of real, running ads from the Meta Ad Library — so you’re learning from ads with actual spend behind them, not mockups.'],
          ['Do I need design skills?', 'No. Remake a proven ad onto your product with one click, or describe what you want and the AI Ad Studio generates it in your brand — no editor required.'],
          ['Will the ads match my brand?', 'Yes. Set a Brand Kit (colors, fonts, logo, products) once — or let Selfmade auto-detect it from your site — and every generation stays on-brand.'],
          ['How does pricing work?', 'No credits, no math — you pay for what you make. An image ad is $0.15 and a video ad is $6. Start free with 5 image ads (no card), buy as you go, or subscribe for unlimited images plus a monthly batch of videos. See the pricing section above.'],
          ['Can I launch ads from Selfmade?', 'Yes — connect Meta and push creatives straight to your ad account, then track performance in Campaigns & Reports.'],
          ['Is my data private?', 'Your brands, products, and creatives are yours alone and never shared.']].map(([q, a]) => <FAQItem key={q} q={q} a={a} />)}
      </section>

      {/* FOOTER — Atria-style programmatic-SEO link farm */}
      <SeoFooter />
    </div>
  )
}

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

function FootCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#111', marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'grid', gap: 2 }}>
        {links.map(l => <a key={l.label} href={l.href} className="navlink" style={{ color: '#6b7280', fontSize: 13.5, textDecoration: 'none', padding: '3px 0' }}>{l.label}</a>)}
      </div>
    </div>
  )
}

function SeoFooter() {
  // All competitors now have real /alternatives/[slug] comparison pages.
  const alternatives = ['Atria', 'Foreplay', 'Motion', 'GetHookd', 'AdCreative.ai', 'Minea', 'BigSpy', 'PiPiADS', 'Dropispy', 'AdSpy', 'PowerAdSpy', 'Meta Ad Library']
  const industries = ['Skincare', 'Supplements', 'Beauty', 'Apparel', 'Fitness', 'Health & Wellness', 'Hair Care', 'Pets', 'Home Goods', 'Food & Beverage', 'Jewelry', 'Baby & Kids', 'Personal Care', 'Cosmetics', 'Fragrance', 'Footwear', 'Accessories', 'Electronics']
  // Ad-format pages driven by the classifier's real hook_type taxonomy (/ads/format/[slug]).
  const formats = ['Testimonial', 'Before & After', 'Unboxing', 'Social Proof', 'Question', 'Educational', 'Story', 'Announcement', 'Urgency', 'Discount', 'Us vs Them', 'Pain Point']
  const cta: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, background: LIME, color: INK, padding: '11px 20px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }
  return (
    <footer style={{ marginTop: 40 }}>
      {/* top: brand + product/company + start CTA (white) */}
      <div style={{ background: '#fbfdfa', borderTop: '1px solid #eef0ee' }}>
        <div style={{ ...wrap, padding: '52px 24px 40px' }}>
          <div className="g-foot" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) repeat(2,minmax(0,1fr)) minmax(0,1.2fr)', gap: 28 }}>
            <div>
              <LogoMark color="#000" height={38} />
              <p style={{ color: '#6b7280', fontSize: 14, lineHeight: 1.6, maxWidth: 280, marginTop: 12 }}>Find winning ads, make them yours, and launch — the whole ad workflow in one place.</p>
            </div>
            <FootCol title="Product" links={[['Discovery', '/discovery'], ['Brand Spy', '/discovery/brand-spy'], ['Trending', '/trending'], ['AI Ad Studio', '/creative-studio'], ['Launch Ads', '/m4'], ['API & MCP', '/mcp'], ['Pricing', '#pricing']].map(([label, href]) => ({ label, href }))} />
            <FootCol title="Company" links={[['Blog', '/blog'], ['About', '/about'], ['Contact', '/contact'], ['Privacy', '/privacy'], ['Terms', '/terms']].map(([label, href]) => ({ label, href }))} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 8 }}>Start free today</div>
              <p style={{ color: '#6b7280', fontSize: 13.5, margin: '0 0 12px', maxWidth: 260 }}>5 image ads free, no card. Find a winner and make it yours.</p>
              <Link href="/signup" className="btn arrowp" style={cta}>Start for free <Arrow /></Link>
            </div>
          </div>

          {/* SEO grids */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 32, marginTop: 44, paddingTop: 36, borderTop: '1px solid #eef0ee' }}>
            <FootCol title="Selfmade alternatives" links={alternatives.map(a => ({ label: `${a} Alternative`, href: `/alternatives/${slug(a)}` }))} />
            <FootCol title="Winning Meta ads by industry" links={industries.map(i => ({ label: `${i} Ads`, href: `/ads/${slug(i)}` }))} />
            <FootCol title="Winning ad formats" links={formats.map(f => ({ label: `${f} Ads`, href: `/ads/format/${slug(f)}` }))} />
          </div>
        </div>
      </div>

      {/* black band: legal + giant wordmark */}
      <div style={{ background: INK, color: '#fff' }}>
        <div style={{ ...wrap, padding: '22px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <a href="#" aria-label="LinkedIn" className="navlink" style={{ color: '#fff', display: 'inline-flex' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3zM10 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05C21.4 8.65 22 11 22 14.2V21h-4v-6c0-1.43-.03-3.27-2-3.27-2 0-2.3 1.56-2.3 3.17V21h-4z" /></svg></a>
            <a href="#" aria-label="X" className="navlink" style={{ color: '#fff', display: 'inline-flex' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L6 22H2.9l7.5-8.6L2.5 2h6.6l4.5 6.7L18.9 2zm-1.1 18h1.7L7.3 3.8H5.5z" /></svg></a>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,.6)' }}>Selfmade, Inc. © {new Date().getFullYear()} All rights reserved.</p>
          <div style={{ display: 'flex', gap: 22 }}>
            <a href="/privacy" className="navlink" style={{ color: 'rgba(255,255,255,.75)', fontSize: 13, textDecoration: 'none' }}>Privacy</a>
            <a href="/terms" className="navlink" style={{ color: 'rgba(255,255,255,.75)', fontSize: 13, textDecoration: 'none' }}>Terms</a>
          </div>
        </div>
        <div style={{ overflow: 'hidden', padding: '0 24px 20px' }}>
          <LogoMark color="rgba(255,255,255,.12)" height={110} />
        </div>
      </div>
    </footer>
  )
}
