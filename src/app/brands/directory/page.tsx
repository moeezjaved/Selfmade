/**
 * /brands/directory — the public SEO hub. Links out to the top brand pages (internal linking → Google
 * crawls the tree deep + spreads link equity), and ranks for head terms like "facebook ad library".
 * (Lives at /brands/directory because /brands is the authenticated in-app brand catalog.)
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { getIndexableBrands, SITE_URL } from '@/lib/seo/brands'
import BrandSearch from './BrandSearch'

export const revalidate = 21600

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

export const metadata: Metadata = {
  title: 'Facebook Ad Library — Spy on Any Brand\'s Ads | Selfmade',
  description: 'Browse the Facebook & Instagram ads of thousands of brands from the Meta Ad Library. See active campaigns, winning creatives, and longest-running ads. Free ad spy on Selfmade.',
  alternates: { canonical: `${SITE_URL}/brands/directory` },
  robots: { index: true, follow: true },
}

export default async function BrandsHub() {
  const brands = await getIndexableBrands()
  const top = brands.slice(0, 600)

  return (
    <div style={{ background: '#ffffff', minHeight: '100vh' }}>
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 20px 64px', fontFamily: 'inherit', color: '#1a3a1a' }}>
      <h1 style={{ fontSize: 34, fontWeight: 800, marginBottom: 10, textAlign: 'center' }}>Search any brand's Facebook ads</h1>
      <p style={{ fontSize: 15, color: '#4b5563', maxWidth: 620, margin: '0 auto 22px', lineHeight: 1.5, textAlign: 'center' }}>
        Browse the live Facebook & Instagram ads of {brands.length.toLocaleString()}+ brands. Free.
      </p>

      <BrandSearch />

      <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1a3a1a', margin: '28px 0 12px' }}>Popular brands</h2>
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {top.map((b) => (
          <Link key={b.pageId} href={`/brands/${b.slug}`}
            style={{ fontSize: 13, fontWeight: 600, color: '#1a3a1a', background: '#f3f4f6', padding: '8px 13px', borderRadius: 8, textDecoration: 'none' }}>
            {titleCase(b.name)} <span style={{ color: '#9ca3af' }}>· {b.adCount}</span>
          </Link>
        ))}
      </section>
    </main>
    </div>
  )
}
