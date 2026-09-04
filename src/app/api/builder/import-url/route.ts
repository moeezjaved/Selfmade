/**
 * POST /api/builder/import-url { url } → { product }
 *
 * Scrapes a product page from ANY website (Amazon, Etsy, Shopify, AliExpress, …) into a builder product
 * (title, price, images, description) so a page can be built from an external product — not just the
 * connected Shopify catalog. Extraction order, best-effort and resilient:
 *   1. Shopify fast-path — a /products/<handle> URL exposes clean JSON at <url>.json
 *   2. JSON-LD  <script type="application/ld+json"> Product schema (name, image[], offers.price, description)
 *   3. OpenGraph / Twitter / meta tags (og:title, og:image, product:price:amount, description)
 * Returns the best product we could assemble; 422 only if we can't even get a title.
 */
import { NextRequest, NextResponse } from 'next/server'
import { ProxyAgent } from 'undici'
import { createClient } from '@/lib/supabase/server'
import type { ImportedProduct } from '@/lib/builder/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// Residential-proxy (IPRoyal) fallback for bot-blocked sites (Amazon, some marketplaces). It is used
// ONLY for the HTML page fetch below — NEVER to download images or video (metered residential bandwidth):
// imported media is kept as plain URLs the shopper's own browser loads directly.
function buildProxyUrl(): string {
  if (process.env.BUILDER_SCRAPER_PROXY) return process.env.BUILDER_SCRAPER_PROXY
  const host = process.env.WORKER_PROXY_HOST, port = process.env.WORKER_PROXY_PORT || '12321'
  const user = process.env.WORKER_PROXY_USER, pass = process.env.WORKER_PROXY_PASS
  const country = (process.env.WORKER_PROXY_COUNTRY || 'us').toLowerCase()
  if (!host || !user || !pass) return ''
  // IPRoyal expects modifiers in the password field (verified format, matches admin/brands/preview).
  const sid = Math.random().toString(36).slice(2, 10)
  const stickyPass = `${pass}_session-${sid}_lifetime-5m_country-${country}`
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(stickyPass)}@${host}:${port}`
}
const PROXY_CONFIGURED = !!buildProxyUrl()

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ proxyConfigured: PROXY_CONFIGURED })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const raw = String(b?.url || '').trim()
  let url: URL
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { return NextResponse.json({ error: 'Enter a valid product URL.' }, { status: 400 }) }
  if (!/^https?:$/.test(url.protocol)) return NextResponse.json({ error: 'Only http(s) URLs are supported.' }, { status: 400 })

  try {
    // Core product data: Shopify's `.json` is the cleanest source when present.
    const shopify = await tryShopifyJson(url)

    // Always fetch the page HTML too — it carries the rich signals (rating, reviews, brand, video)
    // that the Shopify `.json` endpoint omits. Direct first; IPRoyal fallback for bot-blocked sites.
    let html = await fetchText(url.toString())
    let viaProxy = false
    if (!html && PROXY_CONFIGURED) { html = await fetchText(url.toString(), true); viaProxy = true }
    if (!shopify && !html) return NextResponse.json({ error: 'Could not load that page — check the link and try again.' }, { status: 502 })

    const fromLd = html ? fromJsonLd(html, url) : null
    const fromMeta = html ? fromMetaTags(html, url) : { title: undefined, price: undefined, description: undefined, images: [], brand: undefined, videos: [] }

    // Merge: Shopify core (if any) for title/price/images/description; page JSON-LD/meta for the
    // rich signals (rating, reviews, brand, video) that make the page land.
    const product: ImportedProduct = {
      title: shopify?.title || fromLd?.title || fromMeta.title || '',
      handle: shopify?.handle || '',
      price: shopify?.price || fromLd?.price || fromMeta.price || undefined,
      compareAtPrice: shopify?.compareAtPrice || fromLd?.compareAtPrice || undefined,
      description: shopify?.description || fromLd?.description || fromMeta.description || undefined,
      images: dedupe([...(shopify?.images || []), ...(fromLd?.images || []), ...(fromMeta.images || [])]).slice(0, 9),
      videos: dedupe([...(shopify?.videos || []), ...(fromLd?.videos || []), ...(fromMeta.videos || [])]).slice(0, 3),
      sku: shopify?.sku || fromLd?.sku || null,
      brand: shopify?.brand || fromLd?.brand || fromMeta.brand || undefined,
      rating: fromLd?.rating,                 // Shopify .json has no rating — always from page JSON-LD
      ratingCount: fromLd?.ratingCount,
      features: ((fromLd?.features && fromLd.features.length ? fromLd.features : (html ? featureBullets(html) : [])) || []).slice(0, 8),
      reviews: (fromLd?.reviews || []).slice(0, 8),
      sourceUrl: url.toString(),
    }
    product.image = product.images?.[0] || null
    if (!product.title) return NextResponse.json({ error: 'Could not read a product from that page. Try a direct product URL.' }, { status: 422 })
    return NextResponse.json({ product, viaProxy })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Import failed — try again.' }, { status: 502 })
  }
}

async function fetchText(u: string, viaProxy = false): Promise<string | null> {
  try {
    const opts: any = { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' }
    // Proxy is applied ONLY to this HTML fetch — never to any image/video. Fresh session per call.
    if (viaProxy) { const purl = buildProxyUrl(); if (purl) opts.dispatcher = new ProxyAgent(purl) }
    const r = await fetch(u, opts)
    if (!r.ok) return null
    return (await r.text()).slice(0, 2_500_000)
  } catch { return null }
}

/** Shopify product pages expose `<product-url>.json`. Detect /products/<handle> and pull it. */
async function tryShopifyJson(url: URL): Promise<ImportedProduct | null> {
  const m = url.pathname.match(/\/products\/([^/?#]+)/)
  if (!m) return null
  const jsonUrl = `${url.origin}/products/${m[1]}.json`
  try {
    const r = await fetch(jsonUrl, { headers: { 'user-agent': UA, accept: 'application/json' } })
    if (!r.ok) return null
    const p = (await r.json())?.product
    if (!p?.title) return null
    const images: string[] = Array.isArray(p.images) ? p.images.map((im: any) => String(im?.src || '')).filter(Boolean) : []
    const variants: any[] = Array.isArray(p.variants) ? p.variants : []
    const prices = variants.map((v) => Number(v?.price)).filter((n) => Number.isFinite(n))
    const comps = variants.map((v) => Number(v?.compare_at_price)).filter((n) => Number.isFinite(n) && n > 0)
    const minPrice = prices.length ? Math.min(...prices) : null
    const maxComp = comps.length ? Math.max(...comps) : null
    // Shopify `media` may carry videos (media_type 'video'/'external_video' → sources[].url).
    const videos: string[] = (Array.isArray(p.media) ? p.media : [])
      .filter((md: any) => /video/i.test(String(md?.media_type)))
      .map((md: any) => String((Array.isArray(md?.sources) ? md.sources[md.sources.length - 1]?.url : md?.external_video_url) || ''))
      .filter(Boolean)
    return {
      title: String(p.title),
      handle: String(p.handle || m[1]),
      price: minPrice != null ? String(minPrice) : undefined,
      compareAtPrice: maxComp != null && (minPrice == null || maxComp > minPrice) ? String(maxComp) : undefined,
      image: images[0] || null,
      images: images.slice(0, 9),
      videos: dedupe(videos).slice(0, 3),
      description: p.body_html ? stripHtml(String(p.body_html)).slice(0, 1200) : undefined,
      brand: p.vendor ? String(p.vendor).slice(0, 80) : undefined,
      sku: variants.find((v) => v?.sku)?.sku || null,
      sourceUrl: url.toString(),
    }
  } catch { return null }
}

interface LdResult {
  title?: string; price?: string; compareAtPrice?: string; description?: string; images?: string[]; videos?: string[]; sku?: string | null
  brand?: string; rating?: number; ratingCount?: number; features?: string[]; reviews?: { name?: string; rating?: number; body: string }[]
}

/** Pull a Product (and its real rating/reviews/brand/features) from any JSON-LD block on the page. */
function fromJsonLd(html: string, base: URL): LdResult | null {
  const blocks = Array.from(html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))
  for (const m of blocks) {
    let data: any
    try { data = JSON.parse(m[1].trim()) } catch { continue }
    const nodes = flattenLd(data)
    const prod = nodes.find((n) => matchesType(n, 'Product'))
    if (!prod) continue
    const offers = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers
    const price = offers?.price ?? offers?.lowPrice ?? offers?.highPrice
    const imgs = ([] as string[]).concat(prod.image || []).map((i: any) => absolutize(typeof i === 'string' ? i : i?.url, base)).filter(Boolean) as string[]
    const agg = prod.aggregateRating || {}
    const rating = Number(agg.ratingValue)
    const ratingCount = Number(agg.reviewCount ?? agg.ratingCount)
    const reviews = ([] as any[]).concat(prod.review || []).map((r: any) => ({
      name: typeof r?.author === 'string' ? r.author : (r?.author?.name || undefined),
      rating: r?.reviewRating?.ratingValue != null ? Number(r.reviewRating.ratingValue) : undefined,
      body: stripHtml(String(r?.reviewBody || r?.description || '')).slice(0, 320),
    })).filter((r) => r.body)
    const brand = typeof prod.brand === 'string' ? prod.brand : (prod.brand?.name || undefined)
    // Video: a VideoObject on the product, or any VideoObject node on the page.
    const vids = ([] as any[]).concat(prod.video || nodes.filter((n) => matchesType(n, 'VideoObject')))
      .map((v: any) => absolutize(v?.contentUrl || v?.url, base)).filter(Boolean) as string[]
    return {
      title: typeof prod.name === 'string' ? prod.name : undefined,
      price: price != null ? String(price) : undefined,
      compareAtPrice: offers?.priceSpecification?.price && Number(offers.priceSpecification.price) > Number(price) ? String(offers.priceSpecification.price) : undefined,
      description: typeof prod.description === 'string' ? stripHtml(prod.description).slice(0, 1200) : undefined,
      images: dedupe(imgs),
      videos: dedupe(vids).filter((u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u)),
      sku: prod.sku ? String(prod.sku) : null,
      brand: brand ? String(brand).slice(0, 80) : undefined,
      rating: Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : undefined,
      ratingCount: Number.isFinite(ratingCount) && ratingCount > 0 ? ratingCount : undefined,
      features: Array.isArray(prod.additionalProperty) ? prod.additionalProperty.map((p: any) => `${p?.name ? p.name + ': ' : ''}${p?.value || ''}`.trim()).filter(Boolean).slice(0, 8) : undefined,
      reviews,
    }
  }
  return null
}

/** Heuristic feature bullets when there's no structured list — the first meaty <li>s on the page. */
function featureBullets(html: string): string[] {
  const lis = Array.from(html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
    .map((m) => stripHtml(m[1]))
    .filter((t) => t.length >= 18 && t.length <= 160 && /[a-z]/i.test(t) && !/^\s*(home|shop|menu|cart|account|search|©|privacy|terms)/i.test(t))
  return dedupe(lis).slice(0, 8)
}

function fromMetaTags(html: string, base: URL): { title?: string; price?: string; description?: string; images?: string[]; brand?: string; videos?: string[] } {
  const meta = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')
    const m = html.match(re) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))
    return m ? decodeEntities(m[1]) : undefined
  }
  const ogImages = Array.from(html.matchAll(/<meta[^>]+(?:property|name)=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/gi))
    .map((m) => absolutize(decodeEntities(m[1]), base)).filter(Boolean) as string[]
  const title = meta('og:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] && decodeEntities(html.match(/<title[^>]*>([^<]+)<\/title>/i)![1]))
  const ogVideos = Array.from(html.matchAll(/<meta[^>]+(?:property|name)=["']og:video(?::(?:secure_)?url)?["'][^>]*content=["']([^"']+)["']/gi))
    .map((m) => absolutize(decodeEntities(m[1]), base)).filter((u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u))
  return {
    title: title ? title.trim().slice(0, 200) : undefined,
    price: meta('product:price:amount') || meta('og:price:amount'),
    description: (meta('og:description') || meta('description'))?.slice(0, 1200),
    images: dedupe(ogImages).slice(0, 9),
    brand: meta('og:brand') || meta('product:brand') || meta('og:site_name'),
    videos: dedupe(ogVideos).slice(0, 3),
  }
}

// ── helpers ──
function flattenLd(data: any): any[] {
  const out: any[] = []
  const walk = (d: any) => {
    if (!d) return
    if (Array.isArray(d)) return d.forEach(walk)
    if (typeof d === 'object') { out.push(d); if (d['@graph']) walk(d['@graph']) }
  }
  walk(data)
  return out
}
function matchesType(node: any, t: string): boolean {
  const ty = node?.['@type']
  return Array.isArray(ty) ? ty.includes(t) : ty === t
}
function absolutize(u: any, base: URL): string {
  const s = String(u || '').trim()
  if (!s) return ''
  try { return new URL(s, base).toString() } catch { return '' }
}
function dedupe(a: string[]): string[] { return Array.from(new Set(a.filter(Boolean))) }
function stripHtml(s: string): string { return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }
function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
}
