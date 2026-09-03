/**
 * Page Builder — product source. The wizard picks ONE real product from the merchant's connected
 * Shopify store; every generated page is grounded in it (title, price, images, description). We read the
 * catalog from the synced `shopify_products` cache (fast, brand-scoped) for the picker, and fetch the
 * single chosen product LIVE from the Admin API when we need its full images + description (the sync
 * doesn't store image URLs). No store connected → { products: [], noStore: true } so the route can prompt
 * the founder to connect Shopify.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { resolveStore, tokenFor, shopifyRest, shopifyGraphql, type StoreRow } from '@/lib/shopify/client'

export interface BuilderProduct { id: string; title: string; handle: string; price: string; image: string | null; sku: string | null }

/** "PKR 2,499" — currency code + grouped number, from the store currency + the product's min price. */
function priceLabel(currency: string | null | undefined, amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return ''
  const n = Number(amount)
  const num = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${(currency || '').trim()} ${num}`.trim()
}

const numericId = (gid: string): string => String(gid || '').split('/').pop() || String(gid || '')

/**
 * List the connected store's products for the builder's product picker. Pulls from the synced catalog
 * (active products only), optionally filtered by a title query, then best-effort enriches each with its
 * featured image via a single live GraphQL call. Returns noStore:true when no Shopify store is connected.
 */
export async function listBuilderProducts(
  userId: string,
  args: { q?: string; brandId?: string | null },
): Promise<{ products: BuilderProduct[]; noStore?: boolean }> {
  const admin = createAdminClient()
  const store = await resolveStore(admin, userId, args.brandId ?? null)
  if (!store) return { products: [], noStore: true }

  let query = admin.from('shopify_products')
    .select('gid, handle, title, price_min, status')
    .eq('store_id', store.id).eq('status', 'active')
  const q = (args.q || '').trim()
  if (q) query = query.ilike('title', `%${q}%`)
  const { data } = await query.order('title', { ascending: true }).limit(48)
  const rows: any[] = data || []

  const products: BuilderProduct[] = rows.map((r) => ({
    id: String(r.gid),
    title: String(r.title || ''),
    handle: String(r.handle || ''),
    price: priceLabel(store.currency, r.price_min),
    image: null,
    sku: null,
  }))

  // Best-effort: fetch featured images for the shown products in ONE call (sync stores no image URLs).
  await enrichFeaturedImages(store, products).catch(() => { /* thumbnails are optional */ })
  return { products }
}

/** One live GraphQL `nodes(ids)` call → set each product's featured image url. Mutates `products`. */
async function enrichFeaturedImages(store: StoreRow, products: BuilderProduct[]): Promise<void> {
  const ids = products.map((p) => p.id).filter((id) => id.startsWith('gid://'))
  if (!ids.length) return
  const token = tokenFor(store)
  const data = await shopifyGraphql(
    store.shop_domain, token,
    /* GraphQL */ `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id featuredImage { url } } } }`,
    { ids },
  )
  const byId = new Map<string, string>()
  for (const n of (data?.nodes || [])) { if (n?.id && n?.featuredImage?.url) byId.set(String(n.id), String(n.featuredImage.url)) }
  for (const p of products) { const u = byId.get(p.id); if (u) p.image = u }
}

/**
 * Fetch ONE product with everything a page needs — full image list, description and SKU — LIVE from the
 * Admin API (the sync caches no image URLs). `productId` may be a gid or a numeric id. Returns null if no
 * store is connected or the product can't be read.
 */
export async function getBuilderProduct(
  userId: string,
  productId: string,
  brandId?: string | null,
): Promise<(BuilderProduct & { description?: string; images?: string[] }) | null> {
  const admin = createAdminClient()
  const store = await resolveStore(admin, userId, brandId ?? null)
  if (!store) return null

  const num = numericId(productId)
  if (!num) return null
  let p: any
  try {
    const res = await shopifyRest(store.shop_domain, tokenFor(store), `products/${num}.json`)
    p = res?.product
  } catch { return null }
  if (!p?.id) return null

  const images: string[] = Array.isArray(p.images) ? p.images.map((im: any) => String(im?.src || '')).filter(Boolean) : []
  const variants: any[] = Array.isArray(p.variants) ? p.variants : []
  const prices = variants.map((v) => Number(v?.price)).filter((n) => Number.isFinite(n))
  const minPrice = prices.length ? Math.min(...prices) : null
  const sku = variants.find((v) => v?.sku)?.sku ? String(variants.find((v) => v?.sku).sku) : null
  const description = p.body_html ? String(p.body_html).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200) : undefined

  return {
    id: String(p.admin_graphql_api_id || `gid://shopify/Product/${p.id}`),
    title: String(p.title || ''),
    handle: String(p.handle || ''),
    price: priceLabel(store.currency, minPrice),
    image: images[0] || null,
    sku,
    description,
    images,
  }
}
