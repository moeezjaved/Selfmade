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
import { createClient } from '@/lib/supabase/server'
import type { ImportedProduct } from '@/lib/builder/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

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
    // 1) Shopify fast-path — clean structured product JSON.
    const shopify = await tryShopifyJson(url)
    if (shopify) return NextResponse.json({ product: shopify })

    const html = await fetchText(url.toString())
    if (!html) return NextResponse.json({ error: 'Could not load that page — check the link and try again.' }, { status: 502 })

    const fromLd = fromJsonLd(html, url)
    const fromMeta = fromMetaTags(html, url)
    // Merge: JSON-LD is richest; fill gaps from meta.
    const product: ImportedProduct = {
      title: fromLd?.title || fromMeta.title || '',
      price: fromLd?.price || fromMeta.price || undefined,
      description: fromLd?.description || fromMeta.description || undefined,
      images: dedupe([...(fromLd?.images || []), ...(fromMeta.images || [])]).slice(0, 9),
      handle: '',
      sku: fromLd?.sku || null,
      sourceUrl: url.toString(),
    }
    product.image = product.images?.[0] || null
    if (!product.title) return NextResponse.json({ error: 'Could not read a product from that page. Try a direct product URL.' }, { status: 422 })
    return NextResponse.json({ product })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Import failed — try again.' }, { status: 502 })
  }
}

async function fetchText(u: string): Promise<string | null> {
  try {
    const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }, redirect: 'follow' })
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
    return {
      title: String(p.title),
      handle: String(p.handle || m[1]),
      price: prices.length ? String(Math.min(...prices)) : undefined,
      image: images[0] || null,
      images: images.slice(0, 9),
      description: p.body_html ? stripHtml(String(p.body_html)).slice(0, 1200) : undefined,
      sku: variants.find((v) => v?.sku)?.sku || null,
      sourceUrl: url.toString(),
    }
  } catch { return null }
}

/** Pull a Product from any JSON-LD block on the page. */
function fromJsonLd(html: string, base: URL): { title?: string; price?: string; description?: string; images?: string[]; sku?: string | null } | null {
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
    return {
      title: typeof prod.name === 'string' ? prod.name : undefined,
      price: price != null ? String(price) : undefined,
      description: typeof prod.description === 'string' ? stripHtml(prod.description).slice(0, 1200) : undefined,
      images: dedupe(imgs),
      sku: prod.sku ? String(prod.sku) : null,
    }
  }
  return null
}

function fromMetaTags(html: string, base: URL): { title?: string; price?: string; description?: string; images?: string[] } {
  const meta = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, 'i')
    const m = html.match(re) || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'))
    return m ? decodeEntities(m[1]) : undefined
  }
  const ogImages = Array.from(html.matchAll(/<meta[^>]+(?:property|name)=["']og:image(?::url)?["'][^>]*content=["']([^"']+)["']/gi))
    .map((m) => absolutize(decodeEntities(m[1]), base)).filter(Boolean) as string[]
  const title = meta('og:title') || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] && decodeEntities(html.match(/<title[^>]*>([^<]+)<\/title>/i)![1]))
  return {
    title: title ? title.trim().slice(0, 200) : undefined,
    price: meta('product:price:amount') || meta('og:price:amount'),
    description: (meta('og:description') || meta('description'))?.slice(0, 1200),
    images: dedupe(ogImages).slice(0, 9),
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
