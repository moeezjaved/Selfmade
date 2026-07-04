/**
 * Programmatic-SEO copy + schema helpers for the /ads gallery pages.
 * Rotating intro/outro variants (deterministically chosen per slug) avoid the "180 identical pages"
 * duplicate-content problem, and jsonLd() emits CollectionPage + ItemList + BreadcrumbList.
 */
const SITE = 'https://www.tryselfmade.ai'

/** Stable small hash of a string → 0..n-1 (same slug always maps to the same variant). */
export function hashIdx(s: string, n: number): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % n
}

export function monthYear(d = new Date()) { return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }

/** subject = "Skincare" (industry) or "Testimonial" (format); platform = "Meta". */
export function pickIntro(slug: string, subject: string, platform: string, count: number): string {
  const my = monthYear()
  const s = subject, p = platform
  const V = [
    `These are real ${s} ads running on ${p} right now — indexed by Selfmade and ranked by performance, not guesswork. Spot an angle that’s converting, clone it onto your product in one click, or generate an original in your brand with the AI Ad Studio. Updated ${my}.`,
    `Want to know what’s actually working in ${s} on ${p}? Below is a live feed of ${count}+ top-performing ${s} creatives, refreshed as new winners appear. Study the hooks, then clone or generate your own on-brand version in about 30 seconds — and launch straight to ${p}. Updated ${my}.`,
    `Stop starting ${s} ads from a blank canvas. Selfmade surfaces the ${s} ads winning on ${p} today, so you can learn from proven performers instead of guessing. Pick a winner, drop in your product, and let AI make it yours. Fresh as of ${my}.`,
    `Every great ${s} ad on ${p} started as a proven formula. Here’s a live library of what’s converting right now — track any competitor with Brand Spy, clone the best onto your product, or generate something new with the AI Ad Studio. Launch in minutes. Updated ${my}.`,
  ]
  return V[hashIdx(slug, V.length)]
}

export function pickOutro(slug: string, subject: string, platform: string): string {
  const my = monthYear()
  const s = subject, p = platform
  const V = [
    `Selfmade helps you find the best-performing ${s} ads on ${p} and turn them into your next winner. Explore a live library of top ${s} creatives updated ${my}, study the hooks and angles that are actually converting, and never start from a blank canvas again. With Brand Spy you can track any ${s} competitor, and with the AI Ad Studio you can clone or generate on-brand ads in about 30 seconds — then launch straight to ${p}. Start free with 50 credits.`,
    `Looking for ${s} ad inspiration that actually converts? This page pulls the top ${s} ads on ${p} straight from Selfmade’s index and ranks them by real performance. Save the winners, spy on the brands behind them, and use the AI Ad Studio to clone a proven ad onto your product or generate an original in your brand — no design team required. Refreshed ${my}. Start free with 50 credits.`,
    `The fastest way to make winning ${s} ads on ${p} is to start from what’s already working. Selfmade indexes millions of live ads, scores them by performance, and lets you clone or AI-generate your own version in minutes — then launch. Browse the ${s} winners above, updated ${my}, and build your next campaign on evidence instead of guesswork. Start free with 50 credits.`,
  ]
  return V[hashIdx(slug + '::outro', V.length)]
}

/** CollectionPage + ItemList + BreadcrumbList JSON-LD. Emit only when ads.length > 0. */
export function galleryJsonLd(opts: {
  path: string; name: string; description: string; platform: string; platformSlug: string
  category: string; categorySlug: string; count: number; isoDate: string
  ads: { adId: string; brand: string }[]
}) {
  const url = `${SITE}${opts.path}`
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage', '@id': `${url}#page`, url, name: opts.name, description: opts.description,
        dateModified: opts.isoDate, isPartOf: { '@id': `${SITE}/#website` },
        publisher: { '@type': 'Organization', name: 'Selfmade', url: `${SITE}/`, logo: `${SITE}/logo.png` },
      },
      {
        '@type': 'ItemList', name: opts.name, numberOfItems: opts.count,
        itemListElement: opts.ads.map((a, i) => ({
          '@type': 'ListItem', position: i + 1,
          item: { '@type': 'CreativeWork', name: `${a.brand} — ${opts.category} ad on ${opts.platform}`, url: `${url}#${a.adId}`, author: { '@type': 'Organization', name: a.brand } },
        })),
      },
      {
        '@type': 'BreadcrumbList', itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
          { '@type': 'ListItem', position: 2, name: 'Ad Examples', item: `${SITE}/ads` },
          { '@type': 'ListItem', position: 3, name: opts.platform, item: `${SITE}/ads` },
          { '@type': 'ListItem', position: 4, name: opts.category, item: url },
        ],
      },
    ],
  }
}
