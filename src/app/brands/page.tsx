/**
 * /brands — the SEO hub. Links out to the top brand pages (internal linking → Google crawls the tree
 * deep + spreads link equity), and ranks for head terms like "facebook ad library" / "competitor ads".
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { getIndexableBrands, SITE_URL } from '@/lib/seo/brands'

export const revalidate = 21600

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

export const metadata: Metadata = {
  title: 'Facebook Ad Library — Spy on Any Brand\'s Ads | Selfmade',
  description: 'Browse the Facebook & Instagram ads of thousands of brands from the Meta Ad Library. See active campaigns, winning creatives, and longest-running ads. Free ad spy on Selfmade.',
  alternates: { canonical: `${SITE_URL}/brands` },
  robots: { index: true, follow: true },
}

export default async function BrandsHub() {
  const brands = await getIndexableBrands()
  const top = brands.slice(0, 600)

  return (
    <main style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 20px 64px', fontFamily: 'system-ui, sans-serif', color: '#111' }}>
      <h1 style={{ fontSize: 34, fontWeight: 800, marginBottom: 10 }}>Facebook Ad Library — spy on any brand</h1>
      <p style={{ fontSize: 16, color: '#4b5563', maxWidth: 720, lineHeight: 1.5, marginBottom: 28 }}>
        Browse the live Facebook & Instagram ads of {brands.length.toLocaleString()}+ brands. See what your
        competitors are running, which creatives are winning, and get alerted when they launch something new.
      </p>
      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {top.map((b) => (
          <Link key={b.pageId} href={`/brands/${b.slug}`}
            style={{ fontSize: 13, fontWeight: 600, color: '#1a3a1a', background: '#f3f4f6', padding: '8px 13px', borderRadius: 8, textDecoration: 'none' }}>
            {titleCase(b.name)} <span style={{ color: '#9ca3af' }}>· {b.adCount}</span>
          </Link>
        ))}
      </section>
    </main>
  )
}
