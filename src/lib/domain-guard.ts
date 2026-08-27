/**
 * Shared guard so audit/crawl endpoints never operate on Selfmade's OWN site (or localhost) — which is
 * what happens when a brand has no real store/website connected and the domain falls back to the app URL.
 * Canonicalized from the original guard in lib/seo/crawl-audit.ts so every audit route reuses one check.
 */
export function isAppDomain(input: string | null | undefined): boolean {
  const host = String(input || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').trim().toLowerCase()
  if (!host) return false
  return /(^|\.)tryselfmade\.ai$|(^|\.)selfmade\.(ai|com)$|(^|\.)vercel\.app$|localhost|127\.0\.0\.1/.test(host)
}

/** Standard message when a user hasn't connected a real store. */
export const CONNECT_STORE_NOTE = 'Connect your store first — I work on YOUR site, not Selfmade. Connect Shopify (or set your real store URL), then re-run.'
