/**
 * Publish a built page into the store's THEME as native sections + a JSON template (see shopify-sections.ts),
 * so a product page replaces the real PDP and a home page replaces the store home — and every section is
 * reorderable/removable in Shopify's own customizer.
 *
 * Targeting (choose-at-publish):
 *   • product + 'this'/'selected' → templates/product.<suffix>.json, set template_suffix on those products
 *   • product + 'store'           → templates/product.json (the DEFAULT product template → every product)
 *   • home                        → templates/index.json (the store home)
 *
 * Safety: writes to the merchant-CHOSEN theme (the publish flow lets them pick a draft/backup theme), never
 * force-overwrites the live theme silently. Requires write_themes — checked first; callers prompt a
 * one-time reconnect when it's missing.
 */
import { shopifyRest, tokenFor, hasThemeScopes, type StoreRow } from '@/lib/shopify/client'
import { buildThemeAssets, type PageKind } from './shopify-sections'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const numericId = (id: string | number): string => String(id).replace(/^.*\/(\d+)$/, '$1').replace(/[^0-9]/g, '')

async function grantedScopes(store: StoreRow, token: string): Promise<string> {
  try { const sc = await shopifyRest(store.shop_domain, token, 'oauth/access_scopes.json'); return (sc?.access_scopes || []).map((x: any) => x.handle).join(',') } catch { return '' }
}

export type ThemeTarget = 'this' | 'selected' | 'store'
export type ThemePublishResult = { url: string; previewUrl?: string; sections: number; themeId: number; needsScopes?: boolean }

export async function publishToTheme(store: StoreRow, opts: {
  pageId: string
  kind: PageKind
  title: string
  css: string
  body: string
  target: ThemeTarget
  productIds?: string[]            // products to assign the custom template to (this/selected)
  themeId?: number | null          // which theme to write to (defaults to main/published)
  themeLive?: boolean
}): Promise<ThemePublishResult> {
  const token = tokenFor(store)
  if (!hasThemeScopes(await grantedScopes(store, token))) return { url: '', sections: 0, themeId: 0, needsScopes: true }

  // Resolve the target theme — the one the merchant chose, else the published (main) theme.
  const themes = await shopifyRest(store.shop_domain, token, 'themes.json')
  const list = themes?.themes || []
  const theme = (opts.themeId ? list.find((t: any) => Number(t.id) === Number(opts.themeId)) : null) || list.find((t: any) => t.role === 'main') || list[0]
  if (!theme?.id) throw new Error('Could not find a theme to publish to.')

  const suffix = `sf-${opts.pageId.replace(/[^a-z0-9]/gi, '').slice(0, 10)}`
  const assets = buildThemeAssets({ pageId: opts.pageId, kind: opts.kind, css: opts.css, body: opts.body, templateSuffix: suffix })

  // 'store' product publish → become the DEFAULT product template so every product uses it (no per-product suffix).
  const templateKey = (opts.kind === 'product' && opts.target === 'store') ? 'templates/product.json' : assets.templateKey

  const put = (key: string, value: string) => shopifyRest(store.shop_domain, token, `themes/${theme.id}/assets.json`, { method: 'PUT', body: { asset: { key, value } } })

  // Write CSS + sections FIRST, then the template last (so it references sections that already exist).
  await put(assets.cssKey, assets.cssValue)
  for (const s of assets.sections) { await put(s.key, s.value); await sleep(140) }   // gentle on the 2 req/s theme limit
  await put(templateKey, assets.templateValue)

  // Assign the template to the right products / surface, and compute a link back.
  let url = `https://${store.shop_domain}/`
  if (opts.kind === 'product') {
    if (opts.target !== 'store') {
      const ids = (opts.productIds || []).map(numericId).filter(Boolean)
      for (const pid of ids) { await shopifyRest(store.shop_domain, token, `products/${pid}.json`, { method: 'PUT', body: { product: { id: Number(pid), template_suffix: suffix } } }).catch(() => {}); await sleep(140) }
      const first = ids[0] ? await shopifyRest(store.shop_domain, token, `products/${ids[0]}.json`).catch(() => null) : null
      if (first?.product?.handle) url = `https://${store.shop_domain}/products/${first.product.handle}`
    } else {
      url = `https://${store.shop_domain}/collections/all`
    }
  }

  const previewUrl = (opts.themeId && opts.themeLive === false) ? `${url}${url.includes('?') ? '&' : '?'}preview_theme_id=${theme.id}` : undefined
  return { url, previewUrl, sections: assets.sections.length, themeId: Number(theme.id) }
}
