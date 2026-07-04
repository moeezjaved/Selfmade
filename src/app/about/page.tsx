import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { absolute: 'About Selfmade — Find, Clone & Launch Winning Ads' },
  description: 'Selfmade turns 3M+ proven Meta ads into your next winner — discover what’s working, clone or generate your own with AI, and launch. Learn what we’re building.',
  alternates: { canonical: '/about' },
}
const LIME = '#dffe95', INK = '#0e1b12', GREEN = '#16a34a'

export default function About() {
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: INK, minHeight: '100vh' }}>
      <nav style={{ borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 24, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: INK, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '56px 24px 80px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: '.06em' }}>About</div>
        <h1 style={{ fontSize: 'clamp(30px,5vw,44px)', fontWeight: 800, letterSpacing: '-.02em', margin: '10px 0 18px' }}>The whole ad workflow, in one place.</h1>
        <div style={{ fontSize: 16.5, color: '#374151', lineHeight: 1.75 }}>
          <p>Selfmade is an ad-intelligence platform built by Meta ad experts. We index millions of real, running ads from the Meta Ad Library, score them by performance, and give you everything you need to turn a proven winner into your own launched ad — without stitching together a spy tool, a designer, and a launcher.</p>
          <p><b>Discover</b> what’s working: search 3M+ ads, spy on any brand, and see what’s trending in your industry. <b>Create</b> in minutes: clone a winning ad onto your product with one click, or generate an original in your brand with the AI Ad Studio. <b>Launch &amp; scale</b>: push straight to Meta, track performance, and let Mello — your AI strategist — suggest what to make next.</p>
          <p>Our goal is simple: no one should start an ad from a blank canvas when millions of proven formulas already exist. Selfmade turns that library into your unfair advantage.</p>
        </div>
        <div style={{ marginTop: 28 }}>
          <Link href="/signup" style={{ background: INK, color: '#fff', padding: '13px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Start for free →</Link>
        </div>
        <p style={{ marginTop: 28, fontSize: 14, color: '#6b7280' }}>Questions? <Link href="/contact" style={{ color: INK, fontWeight: 700 }}>Contact us</Link>.</p>
      </div>
    </div>
  )
}
