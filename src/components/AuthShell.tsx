'use client'
/**
 * AuthShell — the shared split layout for /login and /signup: a full-bleed background VIDEO with a
 * legibility scrim + rotating testimonials + optional rating/SOC2 badge + logo walls on the left, and
 * the page's own auth form passed as {children} on the right. Collapses to the form only on narrow.
 *
 * TRUST below is the ONE place trust claims live — everything shown here is a factual promise to real
 * users, so it must be TRUE. Testimonials are marketing copy; swap in real, approved quotes.
 */
import { useState, useEffect } from 'react'

const TRUST = {
  video: '/login-bg.mp4',
  poster: '/login-bg.jpg',
  rating: null as null | { score: string; source: string },
  soc2: true,
  trustedByLabel: 'Trusted by 3,000+ teams',
  trustedLogos: [
    { name: 'Sevenly', src: '/logos/sevenly.svg' },
    { name: 'Ridge', src: '/logos/ridge.svg' },
    { name: 'Aura', src: '/logos/aura.svg' },
    { name: 'PLAUD', src: '/logos/plaud.svg' },
    { name: 'Virgin Teez', src: '/logos/virginteez.svg' },
    { name: 'Ejad Labs', src: '/logos/ejadlabs.svg' },
  ] as { name: string; src?: string }[],
  builtByLabel: 'Built by engineers from',
  builtByLogos: [
    { name: 'Meta', src: '/logos/meta.svg' },
    { name: 'TikTok', src: '/logos/tiktok.svg' },
    { name: 'Amazon', src: '/logos/amazon.svg' },
    { name: 'Microsoft', src: '/logos/microsoft.svg' },
  ] as { name: string; src?: string }[],
  testimonials: [
    { quote: 'Selfmade replaced my whole freelance stack. It writes, designs, and ships ads while I sleep — and the morning brief tells me exactly what to approve.', name: 'Sarah M.', role: 'Founder, DTC skincare' },
    { quote: 'It clones a competitor’s winning ad onto my product in minutes. What used to take my agency a week now happens overnight.', name: 'Daniel R.', role: 'Ecommerce owner' },
    { quote: 'The competitor spy is unreal — I wake up already knowing every ad my rivals launched. It’s a growth team that never sleeps.', name: 'Priya K.', role: 'Head of Growth' },
  ] as { quote: string; name: string; role: string }[],
}

export default function AuthShell({ children, maxWidth = 400 }: { children: React.ReactNode; maxWidth?: number }) {
  const [narrow, setNarrow] = useState(false)
  const [ti, setTi] = useState(0)

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth < 900)
    check(); window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])
  useEffect(() => {
    if (TRUST.testimonials.length < 2) return
    const t = setInterval(() => setTi(i => (i + 1) % TRUST.testimonials.length), 5500)
    return () => clearInterval(t)
  }, [])

  const t = TRUST.testimonials[ti]

  return (
    <div style={{ minHeight: '100vh', display: 'flex', fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff' }}>
      {!narrow && (
        <div style={{ flex: '1 1 52%', position: 'relative', overflow: 'hidden', color: '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '40px 44px' }}>
          <video autoPlay muted loop playsInline poster={TRUST.poster}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 0 }}>
            <source src={TRUST.video} type="video/mp4" />
          </video>
          <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(160deg, rgba(14,27,18,.55) 0%, rgba(14,27,18,.35) 45%, rgba(239,74,30,.35) 100%)' }} />

          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0) invert(1)' }} />
            {(TRUST.rating || TRUST.soc2) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                {TRUST.rating && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#ffcf4d', fontSize: 15, letterSpacing: 1 }}>★★★★★</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{TRUST.rating.score}</span>
                    <span style={{ fontSize: 12.5, opacity: .8 }}>· {TRUST.rating.source}</span>
                  </div>
                )}
                {TRUST.soc2 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.25)', borderRadius: 100, padding: '4px 12px' }}>
                    <span style={{ fontSize: 12 }}>🛡️</span><span style={{ fontSize: 12.5, fontWeight: 700 }}>SOC 2 certified</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ position: 'relative', zIndex: 2, maxWidth: 520 }}>
            {t && (
              <>
                <p style={{ fontSize: 22, lineHeight: 1.4, fontWeight: 600, letterSpacing: '-.01em', margin: 0, textShadow: '0 2px 12px rgba(0,0,0,.35)' }}>“{t.quote}”</p>
                <div style={{ marginTop: 16, fontSize: 14 }}><b>{t.name}</b><span style={{ opacity: .82 }}> — {t.role}</span></div>
                <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
                  {TRUST.testimonials.map((_, i) => (
                    <span key={i} onClick={() => setTi(i)} style={{ width: i === ti ? 22 : 7, height: 7, borderRadius: 6, background: i === ti ? '#fff' : 'rgba(255,255,255,.5)', cursor: 'pointer', transition: 'width .2s' }} />
                  ))}
                </div>
              </>
            )}
          </div>

          <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 18 }}>
            {TRUST.trustedByLabel && TRUST.trustedLogos.length > 0 && <LogoRow label={TRUST.trustedByLabel} logos={TRUST.trustedLogos} />}
            {TRUST.builtByLabel && TRUST.builtByLogos.length > 0 && <LogoRow label={TRUST.builtByLabel} logos={TRUST.builtByLogos} />}
          </div>
        </div>
      )}

      <div style={{ flex: narrow ? '1 1 100%' : '1 1 48%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 22px', background: '#fff' }}>
        <div style={{ width: '100%', maxWidth }}>
          {narrow && (/* eslint-disable-next-line @next/next/no-img-element */
            <img src="/logo.png" alt="Selfmade" style={{ height: 30, filter: 'brightness(0)', margin: '0 auto 26px', display: 'block' }} />
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

function LogoRow({ label, logos }: { label: string; logos: { name: string; src?: string }[] }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', opacity: .7, marginBottom: 10 }}>{label}</div>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'center' }}>
        {logos.map(l => l.src
          ? (/* eslint-disable-next-line @next/next/no-img-element */ <img key={l.name} src={l.src} alt={l.name} style={{ height: 22, opacity: .95, filter: 'brightness(0) invert(1)' }} />)
          : <span key={l.name} style={{ fontSize: 14, fontWeight: 800, opacity: .9 }}>{l.name}</span>)}
      </div>
    </div>
  )
}
