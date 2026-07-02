import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/brands'

// Allow the public SEO surface (/brands), keep the app + admin + api out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/', '/brands'], disallow: ['/admin', '/api', '/discovery', '/login', '/signup'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
