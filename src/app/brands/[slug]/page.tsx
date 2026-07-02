/**
 * /brands/[slug] — programmatic-SEO landing page for one brand.
 *
 * Targets "[brand] facebook ads" / "[brand] ad library" searches. Server-rendered (indexable), ISR
 * every 6h, static-generated for the top brands + on-demand for the rest. Thin-content guard: brands
 * with < MIN_INDEXABLE_ADS are rendered but noindex'd. Shows a free sample of ads + a signup gate —
 * the page is top-of-funnel; signup + the retention features convert and keep.
 */
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  resolveSlug, getBrandPage, getIndexableBrands, relatedBrands,
  SITE_URL, MIN_INDEXABLE_ADS, type BrandAd,
} from '@/lib/seo/brands'

export const revalidate = 21600          // 6h ISR
export const dynamicParams = true        // brands not in generateStaticParams render on-demand

const FREE_ADS = 9                        // shown ungated; the rest are behind the signup gate
const cdn = (url: string, w = 320) => url ? `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=${w}&q=72&output=webp` : ''
const thumbOf = (a: BrandAd) => { const c = a.creatives?.[0]; if (!c) return ''; return c.asset_type === 'video' ? (c.poster_url || '') : (c.r2_url || '') }
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

// Pre-render the top ~250 brands at build (keeps build fast + light on the DB, which is under drain
// load right now); the long tail generates on first hit via ISR.
export async function generateStaticParams() {
  const brands = await getIndexableBrands()
  return brands.slice(0, 250).map((b) => ({ slug: b.slug }))
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const ref = await resolveSlug(params.slug)
  if (!ref) return { title: 'Brand not found | Selfmade', robots: { index: false, follow: false } }
  const name = titleCase(ref.name)
  const year = 2026
  const indexable = ref.adCount >= MIN_INDEXABLE_ADS
  const page = await getBrandPage(ref)   // cached — reused by the component below
  return {
    title: `${name} Facebook Ads — See All ${ref.adCount.toLocaleString()} Ads (${year}) | Selfmade`,
    // Unique AI meta description if generated, else the templated one.
    description: page.content?.meta_description
      || `Browse ${name}'s Facebook & Instagram ads from the Meta Ad Library — ${ref.adCount.toLocaleString()} ads, active campaigns, and their longest-running winners. Free ad spy on Selfmade.`,
    alternates: { canonical: `${SITE_URL}/brands/${ref.slug}` },
    robots: indexable ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: {
      title: `${name} Facebook Ads (${year})`,
      description: `${ref.adCount.toLocaleString()} of ${name}'s ads from the Meta Ad Library — active campaigns + winners.`,
      url: `${SITE_URL}/brands/${ref.slug}`,
      type: 'website',
    },
  }
}

export default async function BrandSeoPage({ params }: { params: { slug: string } }) {
  const ref = await resolveSlug(params.slug)
  if (!ref) notFound()
  const page = await getBrandPage(ref)
  const name = titleCase(ref.name)
  const related = await relatedBrands(ref, page.niche)

  const freeAds = page.ads.slice(0, FREE_ADS)
  const lockedCount = Math.max(0, ref.adCount - freeAds.length)

  // Schema.org — CollectionPage + ItemList of the sample ads → rich results / better crawl understanding.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${name} Facebook Ads`,
    description: `${ref.adCount} ads from ${name} in the Meta Ad Library.`,
    url: `${SITE_URL}/brands/${ref.slug}`,
    about: { '@type': 'Organization', name },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: ref.adCount,
      itemListElement: freeAds.map((a, i) => ({
        '@type': 'ListItem', position: i + 1,
        item: { '@type': 'ImageObject', name: `${name} ad`, contentUrl: cdn(thumbOf(a), 600) },
      })),
    },
  }

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 20px 64px', fontFamily: 'system-ui, sans-serif', color: '#111' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Breadcrumb / nav */}
      <nav style={{ fontSize: 13, color: '#6b7280', marginBottom: 18 }}>
        <Link href="/" style={{ color: '#6b7280', textDecoration: 'none' }}>Selfmade</Link>
        {' › '}<Link href="/brands/directory" style={{ color: "#6b7280", textDecoration: "none" }}>Brands</Link>
        {' › '}<span style={{ color: '#111' }}>{name}</span>
      </nav>

      {/* Hero */}
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1, marginBottom: 10 }}>{page.content?.headline || `${name} Facebook Ads`}</h1>
        <p style={{ fontSize: 16, color: '#4b5563', maxWidth: 720, lineHeight: 1.5 }}>
          {page.content?.intro_md || (
            <>Every ad {name} is running on Facebook & Instagram, pulled live from the Meta Ad Library.
            See their active campaigns, creative angles, and longest-running winners — the ones that keep
            running because they convert.</>
          )}
        </p>
        <div style={{ display: 'flex', gap: 24, marginTop: 18, flexWrap: 'wrap' }}>
          <Stat label="Total ads" value={ref.adCount.toLocaleString()} />
          <Stat label="Currently active" value={page.activeCount ? `${page.activeCount}+` : '—'} />
          <Stat label="Longest running" value={page.longestRunningDays ? `${page.longestRunningDays} days` : '—'} />
          {page.niche && <Stat label="Niche" value={titleCase(page.niche)} />}
        </div>
      </header>

      {/* Ad grid — free sample */}
      {freeAds.length === 0 ? (
        <p style={{ color: '#6b7280' }}>Ads for this brand are being processed — check back soon.</p>
      ) : (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
          {freeAds.map((a) => {
            const img = cdn(thumbOf(a))
            return (
              <article key={a.ad_id} style={{ border: '1px solid #e6e6e6', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
                <div style={{ position: 'relative', aspectRatio: '1/1', background: '#f3f4f6' }}>
                  {img && <img src={img} alt={`${name} Facebook ad`} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {a.is_active && <span style={{ position: 'absolute', top: 8, left: 8, background: '#10b981', color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 999 }}>ACTIVE</span>}
                  {(a.days_running ?? 0) >= 30 && <span style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(17,17,17,0.82)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6 }}>{a.days_running}d</span>}
                </div>
                {a.body && <div style={{ padding: '10px 12px', fontSize: 12, color: '#4b5563', height: 56, overflow: 'hidden', lineHeight: 1.4 }}>{a.body}</div>}
              </article>
            )
          })}
        </section>
      )}

      {/* Signup gate */}
      {lockedCount > 0 && (
        <div style={{ marginTop: 28, padding: '28px 24px', borderRadius: 16, background: 'linear-gradient(180deg,#f0fdf4,#ffffff)', border: '1px solid #bbf7d0', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>See all {ref.adCount.toLocaleString()} of {name}'s ads</div>
          <p style={{ fontSize: 14, color: '#4b5563', maxWidth: 560, margin: '0 auto 16px' }}>
            Unlock the full ad library with filters, performance scores, save-to-boards, and get alerted the
            moment {name} launches a new ad. Free to start.
          </p>
          <Link href={`/login?next=/discovery/brand-spy/${ref.pageId}`}
            style={{ display: 'inline-block', background: '#111', color: '#fff', fontWeight: 700, fontSize: 15, padding: '12px 28px', borderRadius: 10, textDecoration: 'none' }}>
            Unlock {name}'s ads — free →
          </Link>
        </div>
      )}

      {/* Related brands — internal linking for crawl depth */}
      {related.length > 0 && (
        <section style={{ marginTop: 44 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14 }}>More brands to spy on</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {related.map((b) => (
              <Link key={b.pageId} href={`/brands/${b.slug}`}
                style={{ fontSize: 13, fontWeight: 600, color: '#1a3a1a', background: '#f3f4f6', padding: '7px 13px', borderRadius: 8, textDecoration: 'none' }}>
                {titleCase(b.name)} ads
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* SEO body copy — real content so the page isn't thin */}
      <section style={{ marginTop: 44, maxWidth: 760, fontSize: 15, lineHeight: 1.65, color: '#374151' }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#111', marginBottom: 10 }}>About {name}'s Facebook ad strategy</h2>
        <p>
          {name} is running {ref.adCount.toLocaleString()} ads across Facebook and Instagram right now.
          {page.longestRunningDays >= 30 ? ` Their longest-running ad has been live for ${page.longestRunningDays} days — a strong signal it's a proven winner, since advertisers kill ads that don't convert.` : ''}
          {' '}Use Selfmade to study their hooks, creative formats, and offers, then clone the winning
          structure for your own campaigns.
        </p>
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#111' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  )
}
