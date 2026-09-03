/**
 * Publish a built page into the merchant's Shopify as a native Page (Online Store → Pages), reachable
 * at /pages/<handle>. Same Admin API path the GEO fact-sheet publisher uses. The page's body_html is
 * the self-contained HTML from assembleShopifyBody (font link + <style> + content).
 */
import { shopifyRest, tokenFor, type StoreRow } from '@/lib/shopify/client'

export async function publishBuilderPage(
  store: StoreRow,
  opts: { title: string; bodyHtml: string; published?: boolean },
): Promise<{ pageId: number; handle: string; url: string }> {
  const token = tokenFor(store)
  const created = await shopifyRest(store.shop_domain, token, 'pages.json', {
    method: 'POST',
    body: { page: { title: opts.title, body_html: opts.bodyHtml, published: opts.published !== false } },
  })
  const p = created?.page
  if (!p?.id) throw new Error('Shopify did not return the created page')
  return { pageId: p.id, handle: p.handle, url: `https://${store.shop_domain}/pages/${p.handle}` }
}
