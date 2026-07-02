import type { MetadataRoute } from 'next'
import { getIndexableBrands, SITE_URL } from '@/lib/seo/brands'

// Chunked sitemaps — Google caps a single sitemap at 50K URLs, so we split the indexable brands into
// 45K chunks. Next auto-serves a sitemap INDEX at /sitemap.xml pointing to /sitemap/0.xml, /1.xml, …
const CHUNK = 45000

export async function generateSitemaps() {
  const brands = await getIndexableBrands()
  const n = Math.max(1, Math.ceil(brands.length / CHUNK))
  return Array.from({ length: n }, (_, id) => ({ id }))
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const brands = await getIndexableBrands()
  const slice = brands.slice(id * CHUNK, (id + 1) * CHUNK)
  const entries: MetadataRoute.Sitemap = slice.map((b) => ({
    url: `${SITE_URL}/brands/${b.slug}`,
    changeFrequency: 'weekly',
    priority: Math.min(0.9, 0.4 + Math.min(0.5, b.adCount / 200)),   // more ads → higher priority
  }))
  // Include the hub page in the first chunk.
  if (id === 0) entries.unshift({ url: `${SITE_URL}/brands`, changeFrequency: 'daily', priority: 0.8 })
  return entries
}
