/**
 * Publish a built page into the merchant's Shopify as a native Page (Online Store → Pages), reachable
 * at /pages/<handle>. Same Admin API path the GEO fact-sheet publisher uses. The page's body_html is
 * the self-contained HTML from assembleShopifyBody (font link + <style> + content).
 */
import { shopifyRest, tokenFor, type StoreRow } from '@/lib/shopify/client'

export async function publishBuilderPage(
  store: StoreRow,
  opts: {
    title: string
    bodyHtml: string
    published?: boolean
    /** the theme the user chose to publish under (from /api/builder/themes) */
    themeId?: number | null
    /** true when the chosen theme is the live/main theme */
    themeLive?: boolean
  },
): Promise<{ pageId: number; handle: string; url: string; previewUrl?: string }> {
  const token = tokenFor(store)
  // A Shopify content Page is store-wide (the theme only wraps it in its header/footer). It must be
  // published to be viewable at all, so we always publish it; the theme choice decides which link we
  // hand back — the plain /pages/<handle> (live theme) or a ?preview_theme_id= link for a draft theme.
  const created = await shopifyRest(store.shop_domain, token, 'pages.json', {
    method: 'POST',
    body: { page: { title: opts.title, body_html: opts.bodyHtml, published: opts.published !== false } },
  })
  const p = created?.page
  if (!p?.id) throw new Error('Shopify did not return the created page')
  const url = `https://${store.shop_domain}/pages/${p.handle}`
  // When a non-live theme was chosen, give a link that renders the page under THAT theme, so the
  // merchant can preview/stage it on a draft/backup theme before making that theme live.
  const previewUrl = opts.themeId && opts.themeLive === false
    ? `${url}?preview_theme_id=${opts.themeId}`
    : undefined
  return { pageId: p.id, handle: p.handle, url, previewUrl }
}
