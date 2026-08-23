/**
 * Shopify product sync. Pulls the catalog (products + variants + SEO + image-alt coverage) into
 * shopify_products so the Catalog cluster can diff against the live store without hammering the Admin
 * API. GraphQL, cursor-paginated, bounded. Orders/revenue sync will land alongside this later.
 */
import { shopifyGraphql, tokenFor, type StoreRow } from '@/lib/shopify/client'

const PRODUCTS_QUERY = /* GraphQL */ `
  query Products($cursor: String) {
    products(first: 50, after: $cursor, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id handle title descriptionHtml productType vendor tags status
        seo { title description }
        images(first: 20) { nodes { altText } }
        variants(first: 100) { nodes { price } }
      }
    }
  }
`

export type SyncResult = { synced: number; pages: number; truncated: boolean }

/** Pull up to maxPages*50 products into the cache. Returns how many rows were upserted. */
export async function syncShopifyProducts(admin: any, store: StoreRow, maxPages = 20): Promise<SyncResult> {
  const token = tokenFor(store)
  let cursor: string | null = null
  let synced = 0, pages = 0, truncated = false

  for (;;) {
    const data: any = await shopifyGraphql(store.shop_domain, token, PRODUCTS_QUERY, { cursor })
    const conn = data?.products
    const nodes: any[] = conn?.nodes || []
    if (nodes.length) {
      const rows = nodes.map((n) => {
        const imgs: any[] = n.images?.nodes || []
        const variants: any[] = n.variants?.nodes || []
        const prices = variants.map((v) => Number(v.price)).filter((x) => Number.isFinite(x))
        return {
          store_id: store.id,
          brand_id: store.brand_id,
          user_id: store.user_id,
          gid: n.id,
          handle: n.handle || null,
          title: n.title || null,
          body_html: n.descriptionHtml || null,
          product_type: n.productType || null,
          vendor: n.vendor || null,
          tags: Array.isArray(n.tags) ? n.tags.join(', ') : (n.tags || null),
          status: (n.status || '').toLowerCase() || null,
          seo_title: n.seo?.title || null,
          seo_description: n.seo?.description || null,
          image_count: imgs.length,
          images_missing_alt: imgs.filter((im) => !im.altText || !String(im.altText).trim()).length,
          variant_count: variants.length,
          price_min: prices.length ? Math.min(...prices) : null,
          price_max: prices.length ? Math.max(...prices) : null,
          raw: n,
          synced_at: new Date().toISOString(),
        }
      })
      await admin.from('shopify_products').upsert(rows, { onConflict: 'store_id,gid' })
      synced += rows.length
    }
    pages++
    if (!conn?.pageInfo?.hasNextPage) break
    if (pages >= maxPages) { truncated = true; break }
    cursor = conn.pageInfo.endCursor
  }

  await admin.from('shopify_stores').update({ last_sync: new Date().toISOString() }).eq('id', store.id)
  return { synced, pages, truncated }
}

/** Quick catalog snapshot for the connect confirmation + Catalog agents' "what's weak" summary. */
export async function catalogHealth(admin: any, storeId: string): Promise<{
  products: number; missingSeoTitle: number; missingSeoDesc: number; imagesMissingAlt: number; drafts: number
}> {
  const { data } = await admin.from('shopify_products')
    .select('seo_title, seo_description, images_missing_alt, status').eq('store_id', storeId).limit(5000)
  const rows: any[] = data || []
  return {
    products: rows.length,
    missingSeoTitle: rows.filter((r) => !r.seo_title).length,
    missingSeoDesc: rows.filter((r) => !r.seo_description).length,
    imagesMissingAlt: rows.reduce((a, r) => a + (r.images_missing_alt || 0), 0),
    drafts: rows.filter((r) => r.status === 'draft').length,
  }
}
