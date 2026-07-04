import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/brands'

// Allow the public SEO surface (/, /home, /ads, /alternatives, /brands) and keep the app + auth +
// api + query-string permutations out of the index. Query strings (filters/sort/tracking on
// discovery) are blocked to save crawl budget — our SEO pages use clean path-only URLs.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api', '/app/', '/discovery', '/account/', '/login', '/signup', '/onboarding', '/business-email-required', '/*?*'],
    }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
