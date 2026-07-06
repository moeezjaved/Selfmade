/**
 * /ads — the Ad Examples hub. Ranks for broad terms ("Meta ad examples", "winning ad library") and
 * is the internal-link mesh into every live category + format page. Server-rendered, ISR. Only links
 * LIVE pages (>=6 ads) so there are no dead/thin links.
 */
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'

export const revalidate = 3600
const LIME = '#dffe95', INK = '#0e1b12', GREEN = '#16a34a'
const MIN = 6
const toSlug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const HOOKS = ['Question', 'Before & After', 'Testimonial', 'Story', 'Announcement', 'Educational', 'Urgency', 'Discount', 'Unboxing', 'Us vs Them', 'Social Proof', 'Pain Point']

export const metadata: Metadata = {
  title: 'Ad Examples Library — Winning Meta Ads by Category | Selfmade',
  description: "Browse thousands of real, high-performing Meta ads by category and format. Find what's working, clone the winners, and launch your own with Selfmade. Start free.",
  alternates: { canonical: '/ads' },
}

async function getLive() {
  const admin = createAdminClient()
  const count = async (col: string, val: string) => {
    const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true })
      .eq(col, val).eq('has_creative', true).gt('performance_score', 0)
    return count || 0
  }
  const { data: nc } = await admin.from('niche_counts').select('niche').limit(200)
  const niches = Array.from(new Set((nc || []).map((r: any) => r.niche).filter(Boolean))) as string[]
  const inds = (await Promise.all(niches.map(async (n) => ({ label: n, url: `/ads/${toSlug(n)}`, ads: await count('niche', n) }))))
    .filter((x) => x.ads >= MIN).sort((a, b) => b.ads - a.ads)
  const fmts = (await Promise.all(HOOKS.map(async (h) => ({ label: h, url: `/ads/format/${toSlug(h)}`, ads: await count('hook_type', h) }))))
    .filter((x) => x.ads >= MIN).sort((a, b) => b.ads - a.ads)
  return { inds, fmts }
}

function Grid({ title, items }: { title: string; items: { label: string; url: string }[] }) {
  if (!items.length) return null
  return (
    <section style={{ maxWidth: 1120, margin: '0 auto', padding: '10px 24px 26px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: '-.02em', margin: '18px 0 14px' }}>{title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(220px,100%), 1fr))', gap: 10 }}>
        {items.map((it) => (
          <Link key={it.url} href={it.url} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #eef0ee', borderRadius: 12, padding: '14px 16px', textDecoration: 'none', color: INK, fontWeight: 700, fontSize: 15, background: '#fff' }}>
            {it.label} <span style={{ color: GREEN }}>→</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

export default async function AdsHub() {
  const { inds, fmts } = await getLive()
  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: INK, minHeight: '100vh' }}>
      <nav style={{ borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 24, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: INK, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <header style={{ maxWidth: 820, margin: '0 auto', padding: '52px 24px 20px' }}>
        <h1 style={{ fontSize: 'clamp(30px,5vw,48px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 14px' }}>Winning ad examples, by category.</h1>
        <p style={{ fontSize: 17, color: '#4b5563', lineHeight: 1.6 }}>
          Explore real ads that are running and performing right now — pulled straight from Selfmade&rsquo;s 3M+ ad index and organized by category and format. Pick your niche to see what&rsquo;s working today, then <Link href="/signup" style={{ color: INK, fontWeight: 700 }}>clone a winner onto your product</Link> or generate your own on-brand ad in about 30 seconds.
        </p>
      </header>

      <Grid title="Winning Meta ads by industry" items={inds} />
      <Grid title="Winning ads by format" items={fmts} />

      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 24px' }}>
        <div style={{ background: `linear-gradient(135deg,${LIME},#a8e63d)`, borderRadius: 24, padding: '40px 32px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(24px,4vw,34px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 10px' }}>Find a winner, make it yours, launch today.</h2>
          <Link href="/signup" style={{ background: INK, color: '#fff', padding: '13px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Start for free →</Link>
        </div>
      </section>

      <section style={{ maxWidth: 820, margin: '0 auto', padding: '20px 24px 60px' }}>
        <p style={{ fontSize: 15, color: '#6b7280', lineHeight: 1.7 }}>
          Selfmade indexes millions of real Meta ads so you never have to start from a blank canvas. Whether you sell skincare, supplements, apparel, or software, you can study the hooks and angles converting in your category, track any competitor with Brand Spy, and turn proven formulas into finished, on-brand ads with the AI Ad Studio — then launch straight to your ad account. Browse a category above to get started, free with 50 credits.
        </p>
      </section>
    </div>
  )
}
