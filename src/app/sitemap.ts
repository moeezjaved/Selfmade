import type { MetadataRoute } from 'next'
import { getIndexableBrands, SITE_URL } from '@/lib/seo/brands'

// Single sitemap served at /sitemap.xml (what robots + GSC reference). We only index brands with
// >= SEO_MIN_ADS ads — a few thousand today, well under Google's 50K-per-sitemap cap. If that set
// ever grows past ~50K (post Foreplay import), switch back to generateSitemaps() chunking AND point
// robots/GSC at the /sitemap/0.xml index it produces.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const brands = await getIndexableBrands()
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/brands/directory`, changeFrequency: 'daily', priority: 0.8 },
    ...brands.map((b) => ({
      url: `${SITE_URL}/brands/${b.slug}`,
      changeFrequency: 'weekly' as const,
      priority: Math.min(0.9, 0.4 + Math.min(0.5, b.adCount / 200)),   // more ads → higher priority
    })),
  ]
  return entries.slice(0, 50000)
}
