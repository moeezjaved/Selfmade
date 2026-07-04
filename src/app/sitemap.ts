import type { MetadataRoute } from 'next'
import { getPopulatedBrands, SITE_URL } from '@/lib/seo/brands'
import { createAdminClient } from '@/lib/supabase/server'

// Single sitemap served at /sitemap.xml (what robots + GSC reference). Includes: the marketing
// landing, the 12 competitor /alternatives pages (always live), the live /ads galleries (industry +
// format, only when they have >= 6 real ads — never list thin pages), and the /brands directory set.
// Capped under Google's 50K-per-sitemap limit.

const toSlug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const ALTERNATIVES = ['atria', 'foreplay', 'motion', 'gethookd', 'adcreative-ai', 'minea', 'bigspy', 'pipiads', 'dropispy', 'adspy', 'poweradspy', 'meta-ad-library']
const INDUSTRIES = ['Skincare', 'Supplements', 'Beauty', 'Apparel', 'Fitness', 'Health & Wellness', 'Hair Care', 'Pets', 'Home Goods', 'Food & Beverage', 'Jewelry', 'Baby & Kids', 'Personal Care', 'Cosmetics', 'Fragrance', 'Footwear', 'Accessories', 'Electronics']
const FORMATS = ['Question', 'Before & After', 'Testimonial', 'Story', 'Announcement', 'Educational', 'Urgency', 'Discount', 'Unboxing', 'Us vs Them', 'Social Proof', 'Pain Point']

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/home`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/brands/directory`, changeFrequency: 'daily', priority: 0.8 },
    ...ALTERNATIVES.map((s) => ({ url: `${SITE_URL}/alternatives/${s}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.8 })),
  ]

  // /ads galleries — include only those with >= 6 real ads (matches each page's thin-content guard).
  try {
    const admin = createAdminClient()
    const live = async (col: string, val: string, path: string) => {
      const { count } = await admin.from('discovery_ads_index').select('ad_id', { count: 'exact', head: true })
        .eq(col, val).eq('has_creative', true).gt('performance_score', 0)
      return (count || 0) >= 6 ? { url: `${SITE_URL}${path}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 } : null
    }
    const [ind, fmt] = await Promise.all([
      Promise.all(INDUSTRIES.map((n) => live('niche', n, `/ads/meta/${toSlug(n)}`))),
      Promise.all(FORMATS.map((h) => live('hook_type', h, `/ads/meta/format/${toSlug(h)}`))),
    ])
    entries.push(...([...ind, ...fmt].filter(Boolean) as MetadataRoute.Sitemap))
  } catch { /* DB unreachable → still ship the rest */ }

  const brands = await getPopulatedBrands().catch(() => [] as { slug: string; adCount: number }[])
  entries.push(...brands.map((b) => ({
    url: `${SITE_URL}/brands/${b.slug}`,
    changeFrequency: 'weekly' as const,
    priority: Math.min(0.9, 0.4 + Math.min(0.5, b.adCount / 200)),
  })))

  return entries.slice(0, 50000)
}
