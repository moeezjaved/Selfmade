/**
 * Programmatic SEO — /ads/{industry}: a public gallery of real winning ads in a niche, pulled live
 * from the discovery index. Unique, data-backed content (Google rewards this). Server-rendered for
 * SEO, ISR-cached, unique <title>/description, sibling links (internal-link mesh), sign-up CTA.
 * 0 ads → 404 (never ship thin/empty pages).
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'

export const revalidate = 3600   // refresh hourly (keeps "Updated" fresh + picks up new crawls)

const LIME = '#dffe95', INK = '#0e1b12'
const toSlug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const monthYear = () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
function img(url: string, w = 400) {
  if (!url) return ''
  if (/r2\.dev|r2\.cloudflarestorage|\/\/pub-|\/\/cdn\./.test(url)) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp`
}

/** Resolve the slug → canonical niche + its top ads. Cached per-request (shared by metadata + page). */
const getData = cache(async (category: string) => {
  const admin = createAdminClient()
  const { data: nc } = await admin.from('niche_counts').select('niche')
  const niches = (nc || []).map((r: any) => r.niche).filter(Boolean) as string[]
  const niche = niches.find((n) => toSlug(n) === category)
  if (!niche) return { niche: null, ads: [], siblings: niches }
  const { data } = await admin.from('discovery_ads_index')
    .select('ad_id, page_name, performance_score, discovery_creatives(asset_type,position,r2_url,poster_url)')
    .eq('niche', niche).eq('has_creative', true).gt('performance_score', 0)
    .order('performance_score', { ascending: false }).limit(48)
  const ads = (data || []).map((r: any) => {
    const c = (r.discovery_creatives || []).slice().sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
      .find((x: any) => (x.asset_type === 'video' ? x.poster_url : x.r2_url))
    return { adId: r.ad_id, brand: r.page_name || 'Brand', image: c ? (c.asset_type === 'video' ? c.poster_url : c.r2_url) : null, score: Number(r.performance_score) || 0 }
  }).filter((a: any) => a.image)
  return { niche, ads, siblings: niches }
})

export async function generateMetadata({ params }: { params: { category: string } }): Promise<Metadata> {
  const { niche, ads } = await getData(params.category)
  if (!niche) return { title: 'Ad examples — Selfmade' }
  const title = `Winning ${niche} Ads on Meta — ${monthYear()} | Selfmade`
  const description = `See the top-performing ${niche.toLowerCase()} ads running on Meta right now — real examples ranked by performance. Get ideas, then clone or generate your own with Selfmade.`
  return {
    title, description,
    alternates: { canonical: `/ads/${params.category}` },
    robots: ads.length < 6 ? { index: false, follow: true } : undefined,   // thin-content guard
    openGraph: { title, description, images: ads[0]?.image ? [img(ads[0].image, 800)] : [] },
  }
}

export default async function AdsCategoryPage({ params }: { params: { category: string } }) {
  const { niche, ads, siblings } = await getData(params.category)
  if (!niche || ads.length === 0) notFound()

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", background: '#fff', color: INK, minHeight: '100vh' }}>
      <nav style={{ borderBottom: '1px solid #f0f2ef' }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/home">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo.png" alt="Selfmade" style={{ height: 24, filter: 'brightness(0)' }} /></Link>
          <Link href="/signup" style={{ background: LIME, color: INK, padding: '9px 18px', borderRadius: 100, fontSize: 14, fontWeight: 800, textDecoration: 'none' }}>Start for free</Link>
        </div>
      </nav>

      <header style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px 24px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '.06em' }}>Ad examples · Updated {monthYear()}</div>
        <h1 style={{ fontSize: 'clamp(30px,5vw,46px)', fontWeight: 800, letterSpacing: '-.02em', margin: '8px 0 12px' }}>Winning {niche} ads on Meta</h1>
        <p style={{ fontSize: 17, color: '#4b5563', lineHeight: 1.6, maxWidth: 680 }}>
          The top-performing {niche.toLowerCase()} ads running on Meta right now — pulled live from {ads.length}+ real, spending campaigns and ranked by performance. Use them for inspiration, then <Link href="/signup" style={{ color: INK, fontWeight: 700 }}>clone or generate your own</Link> with Selfmade in minutes.
        </p>
      </header>

      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '12px 24px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 14 }}>
          {ads.map((a: any, i: number) => (
            <div key={a.adId} style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid #eef0ee', background: '#fff' }}>
              <div style={{ position: 'relative', aspectRatio: '3/4', background: '#0d120e' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img(a.image!, 360)} alt={`${niche} ad by ${a.brand}`} loading={i < 6 ? 'eager' : 'lazy'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <span style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(14,27,18,.7)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>🔥 {Math.round(a.score * 100)}</span>
              </div>
              <div style={{ padding: '9px 11px', fontSize: 12.5, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.brand}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '30px 24px' }}>
        <div style={{ background: `linear-gradient(135deg,${LIME},#a8e63d)`, borderRadius: 24, padding: '40px 32px', textAlign: 'center' }}>
          <h2 style={{ fontSize: 'clamp(24px,4vw,34px)', fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 10px' }}>Want ads like these for your brand?</h2>
          <p style={{ color: 'rgba(14,27,18,.7)', margin: '0 0 20px', fontSize: 16 }}>Clone any winner onto your product, or generate an original — free to start.</p>
          <Link href="/signup" style={{ background: INK, color: '#fff', padding: '13px 26px', borderRadius: 100, fontSize: 15, fontWeight: 800, textDecoration: 'none' }}>Start for free →</Link>
        </div>
      </section>

      {/* sibling internal links */}
      <section style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 24px 60px', borderTop: '1px solid #f0f2ef' }}>
        <div style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#9ca3af', margin: '20px 0 12px' }}>Winning ads by industry</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {siblings.filter((n) => n !== niche).map((n) => (
            <Link key={n} href={`/ads/${toSlug(n)}`} style={{ fontSize: 13.5, color: '#374151', background: '#f6f8f5', border: '1px solid #eef0ee', borderRadius: 20, padding: '6px 13px', textDecoration: 'none' }}>{n} Ads</Link>
          ))}
        </div>
      </section>
    </div>
  )
}
