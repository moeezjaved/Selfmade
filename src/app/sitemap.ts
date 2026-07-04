import type { MetadataRoute } from 'next'
import { getPopulatedBrands, SITE_URL } from '@/lib/seo/brands'
import { getPublishedPosts } from '@/lib/blog'
import { createAdminClient } from '@/lib/supabase/server'

// Generate at RUNTIME, not at build. The Vercel build env returns empty from the DB (no service-role
// key at build), so a static sitemap captured an empty snapshot — no /ads or brand URLs. Runtime has
// full env + live data. force-dynamic also means the sitemap can NEVER time out the build again.
export const dynamic = 'force-dynamic'

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
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${SITE_URL}/brands/directory`, changeFrequency: 'daily', priority: 0.8 },
    ...ALTERNATIVES.map((s) => ({ url: `${SITE_URL}/alternatives/${s}`, lastModified: now, changeFrequency: 'monthly' as const, priority: 0.8 })),
  ]

  // Published blog posts.
  try {
    const posts = await getPublishedPosts()
    entries.push(...posts.map((p) => ({ url: `${SITE_URL}/blog/${p.slug}`, lastModified: p.published_at ? new Date(p.published_at) : now, changeFrequency: 'monthly' as const, priority: 0.7 })))
  } catch { /* blog table absent → skip */ }

  // /ads galleries — include only those with >= 6 real ads (matches each page's thin-content guard).
  // Use a cheap limit(6) EXISTENCE check, NOT count:'exact' — an exact count scans millions of rows
  // and times out under crawl/drain load (that's what left the sitemap empty). limit(6) stops after
  // 6 index hits. Niches come from niche_counts so the strings always match the data (like the pages).
  try {
    const admin = createAdminClient()
    const has6 = async (col: string, val: string) => {
      const { data } = await admin.from('discovery_ads_index').select('ad_id')
        .eq(col, val).eq('has_creative', true).gt('performance_score', 0).limit(6)
      return (data?.length || 0) >= 6
    }
    const mk = (path: string) => ({ url: `${SITE_URL}${path}`, lastModified: now, changeFrequency: 'daily' as const, priority: 0.7 })
    const { data: ncs } = await admin.from('niche_counts').select('niche')
    const niches = Array.from(new Set([...(ncs || []).map((r: any) => r.niche).filter(Boolean), ...INDUSTRIES])) as string[]
    const seen = new Set<string>()
    const [ind, fmt] = await Promise.all([
      Promise.all(niches.map(async (n) => {
        const s = toSlug(n); if (seen.has(s)) return null; seen.add(s)
        return (await has6('niche', n)) ? mk(`/ads/${s}`) : null
      })),
      Promise.all(FORMATS.map(async (h) => (await has6('hook_type', h)) ? mk(`/ads/format/${toSlug(h)}`) : null)),
    ])
    entries.push(...([...ind, ...fmt].filter(Boolean) as MetadataRoute.Sitemap))
  } catch { /* DB unreachable → still ship the rest */ }

  // Time-box the populated-brands lookup so a slow DB can NEVER hang the /sitemap.xml build step
  // again (Vercel kills the static worker at 60s → the whole deploy errors). On timeout we ship the
  // sitemap without brand URLs rather than fail the build; the next revalidation picks them up.
  const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
    Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))])
  const brands = await withTimeout(
    getPopulatedBrands().catch(() => [] as any[]),
    10000,
    [] as any[],
  )
  entries.push(...brands.map((b) => ({
    url: `${SITE_URL}/brands/${b.slug}`,
    changeFrequency: 'weekly' as const,
    priority: Math.min(0.9, 0.4 + Math.min(0.5, b.adCount / 200)),
  })))

  return entries.slice(0, 50000)
}
