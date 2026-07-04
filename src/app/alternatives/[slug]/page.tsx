/**
 * Programmatic SEO — /alternatives/{competitor}: high-intent "X alternative" pages. Each reuses the
 * homepage value + comparison table with a UNIQUE, specific intro per competitor (Google penalizes
 * thin duplicates, so the intro + what-they-lack must be materially different per page). Server-
 * rendered, unique metadata. Unknown slug → 404.
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'

export const dynamic = 'force-static'
const LIME = '#dffe95', INK = '#0e1b12', GREEN = '#16a34a'

type Comp = { name: string; lacks: string; blurb: string; rows: [string, boolean][] }
const COMPETITORS: Record<string, Comp> = {
  atria: { name: 'Atria', lacks: 'creative generation — it surfaces winning ads and insights, but you still leave to design and produce them',
    blurb: 'Atria is a strong ad-intelligence and strategy tool, but it stops at insight — when it’s time to actually make the ad, you’re on your own. Selfmade closes that loop: discover the winner, then clone it onto your product or generate an original in your brand, and launch — without switching tools.',
    rows: [['Search millions of Meta ads', true], ['Performance & trend insights', true], ['1-click Clone onto your product', false], ['AI Ad Studio (generate originals)', false], ['Launch straight to Meta', false]] },
  foreplay: { name: 'Foreplay', lacks: 'AI creation and launch — it’s a best-in-class swipe file and organizer, not a maker',
    blurb: 'Foreplay is excellent for saving, tagging, and organizing ad inspiration into boards. But it’s a library, not a studio — it won’t turn a saved winner into your ad. Selfmade adds the missing half: clone or AI-generate the creative in your brand and push it live.',
    rows: [['Save & organize ad inspiration', true], ['Discovery across Meta ads', true], ['1-click Clone onto your product', false], ['AI Ad Studio (generate originals)', false], ['Mello AI strategist', false]] },
  motion: { name: 'Motion', lacks: 'ad discovery and creation — it’s a creative analytics/reporting tool for teams already running ads',
    blurb: 'Motion is built for analyzing creative performance once your ads are live — great for reporting, less for finding and making new winners. Selfmade sits earlier in the workflow: it finds what’s working across millions of ads and helps you produce your version fast.',
    rows: [['Creative reporting & analytics', true], ['Search millions of Meta ads', true], ['1-click Clone onto your product', false], ['AI Ad Studio (generate originals)', false], ['Trending by industry', false]] },
  gethookd: { name: 'GetHookd', lacks: 'the all-in-one create-and-launch workflow and a deep classified index',
    blurb: 'GetHookd is a budget ad-spy tool. Selfmade covers the same discovery and adds the parts that actually move revenue: a percentile-calibrated performance index, 1-click cloning, an AI studio, and Meta launch — one platform instead of a spy tool plus a designer.',
    rows: [['Ad spy / discovery', true], ['Performance scoring by percentile', false], ['1-click Clone onto your product', false], ['AI Ad Studio (generate originals)', false], ['Launch straight to Meta', false]] },
}
const KEYS = Object.keys(COMPETITORS)

export function generateStaticParams() { return KEYS.map((slug) => ({ slug })) }

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const c = COMPETITORS[params.slug]
  if (!c) return { title: 'Alternatives — Selfmade' }
  const title = `The best ${c.name} alternative — Selfmade`
  const description = `Looking for a ${c.name} alternative? Selfmade covers discovery like ${c.name}, then lets you clone or AI-generate the ad and launch — the whole workflow in one place.`
  return { title, description, alternates: { canonical: `/alternatives/${params.slug}` }, openGraph: { title, description } }
}

export default function AlternativePage({ params }: { params: { slug: string } }) {
  const c = COMPETITORS[params.slug]
  if (!c) notFound()
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: INK, minHeight: '100vh' }}>
      <nav style={{ borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/home">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 24, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: INK, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <header style={{ maxWidth: 820, margin: '0 auto', padding: '56px 24px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: '.06em' }}>{c.name} alternative</div>
        <h1 style={{ fontSize: 'clamp(30px,5vw,48px)', fontWeight: 800, letterSpacing: '-.02em', margin: '10px 0 16px' }}>The best <span style={{ fontStyle: 'italic', color: GREEN }}>{c.name} alternative</span></h1>
        <p style={{ fontSize: 17, color: '#4b5563', lineHeight: 1.65, maxWidth: 660, margin: '0 auto' }}>{c.blurb}</p>
        <div style={{ marginTop: 24 }}><Link href="/signup" style={{ background: INK, color: '#fff', padding: '13px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Try Selfmade free →</Link></div>
      </header>

      {/* comparison */}
      <section style={{ maxWidth: 720, margin: '30px auto', padding: '0 24px' }}>
        <h2 style={{ fontSize: 24, fontWeight: 800, textAlign: 'center', margin: '0 0 6px', letterSpacing: '-.02em' }}>Selfmade vs {c.name}</h2>
        <p style={{ textAlign: 'center', color: '#6b7280', margin: '0 0 22px', fontSize: 14.5 }}>Where {c.name} stops at <b>{c.lacks}</b>.</p>
        <div style={{ border: '1px solid #eef0ee', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px', background: '#fbfdfa', borderBottom: '1px solid #eef0ee', fontSize: 12.5, fontWeight: 800 }}>
            <div style={{ padding: '12px 16px' }} />
            <div style={{ padding: '12px 6px', textAlign: 'center', color: INK, background: LIME }}>Selfmade</div>
            <div style={{ padding: '12px 6px', textAlign: 'center', color: '#9ca3af' }}>{c.name}</div>
          </div>
          {c.rows.map(([label, comp], i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px', borderTop: i ? '1px solid #f2f4f1' : 'none', fontSize: 14 }}>
              <div style={{ padding: '13px 16px', color: '#374151', fontWeight: 500 }}>{label}</div>
              <div style={{ padding: '13px 6px', textAlign: 'center', background: 'rgba(223,254,149,.28)' }}><Mark on /></div>
              <div style={{ padding: '13px 6px', textAlign: 'center' }}><Mark on={comp} /></div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '30px 24px 20px' }}>
        <div style={{ background: `linear-gradient(135deg,${LIME},#a8e63d)`, borderRadius: 24, padding: '40px 32px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(24px,4vw,34px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 10px' }}>Switch from {c.name} in minutes</h2>
          <p style={{ color: 'rgba(14,27,18,.7)', margin: '0 0 20px', fontSize: 16 }}>Find winners, make them yours, and launch — free to start, no card.</p>
          <Link href="/signup" style={{ background: INK, color: '#fff', padding: '13px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Start for free →</Link>
        </div>
      </section>

      {/* sibling links */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 24px 60px', borderTop: '1px solid #f0f2ef' }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', margin: '20px 0 12px' }}>Compare Selfmade</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {KEYS.filter((k) => k !== params.slug).map((k) => (
            <Link key={k} href={`/alternatives/${k}`} style={{ fontSize: 13.5, color: '#374151', background: '#f6f8f5', border: '1px solid #eef0ee', borderRadius: 20, padding: '6px 13px', textDecoration: 'none' }}>{COMPETITORS[k].name} Alternative</Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function Mark({ on }: { on: boolean }) {
  return on
    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="3" style={{ display: 'inline' }}><path d="M20 6 9 17l-5-5" /></svg>
    : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cbd5cb" strokeWidth="3" style={{ display: 'inline' }}><path d="M18 6 6 18M6 6l12 12" /></svg>
}
