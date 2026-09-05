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
import { shopifyRest, tokenFor, hasThemeScopes, fetchAccessScopes, type StoreRow } from '@/lib/shopify/client'
import { buildThemeAssets, type PageKind } from './shopify-sections'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const numericId = (id: string | number): string => String(id).replace(/^.*\/(\d+)$/, '$1').replace(/[^0-9]/g, '')

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
  if (!hasThemeScopes((await fetchAccessScopes(store.shop_domain, token)).join(','))) return { url: '', sections: 0, themeId: 0, needsScopes: true }

  // Resolve the target theme — the one the merchant chose, else the published (main) theme.
  const themes = await shopifyRest(store.shop_domain, token, 'themes.json')
  const list = themes?.themes || []
  const theme = (opts.themeId ? list.find((t: any) => Number(t.id) === Number(opts.themeId)) : null) || list.find((t: any) => t.role === 'main') || list[0]
  if (!theme?.id) throw new Error('Could not find a theme to publish to.')

  const suffix = `sf-${opts.pageId.replace(/[^a-z0-9]/gi, '').slice(0, 10)}`
  // 'all products' → each product renders its own title/price/image (full dynamic); single-product keeps
  // the tailored copy/images but still gets a working Add-to-Cart form (cart).
  const dynamic = opts.kind === 'product' ? (opts.target === 'store' ? 'full' : 'cart') : 'none'
  const assets = buildThemeAssets({ pageId: opts.pageId, kind: opts.kind, css: opts.css, body: opts.body, templateSuffix: suffix, dynamic })

  // 'store' product publish → become the DEFAULT product template so every product uses it (no per-product suffix).
  const templateKey = (opts.kind === 'product' && opts.target === 'store') ? 'templates/product.json' : assets.templateKey

  const put = (key: string, value: string) => shopifyRest(store.shop_domain, token, `themes/${theme.id}/assets.json`, { method: 'PUT', body: { asset: { key, value } } })

  // Write CSS + sections FIRST, then the template last (so it references sections that already exist).
  await put(assets.cssKey, assets.cssValue)
  for (const s of assets.sections) { await put(s.key, s.value); await sleep(140) }   // gentle on the 2 req/s theme limit
  await put(templateKey, assets.templateValue)

  // Use the store's PRIMARY storefront domain for links — the myshopify domain 301-redirects to it and
  // drops ?preview_theme_id, which breaks draft-theme previews. shop.json's `domain` is the primary.
  let host = store.shop_domain
  try { const s = await shopifyRest(store.shop_domain, token, 'shop.json'); if (s?.shop?.domain) host = s.shop.domain } catch {}

  // Assign the template to the right products / surface, and compute a link back.
  let path = '/'
  if (opts.kind === 'product') {
    if (opts.target !== 'store') {
      const ids = (opts.productIds || []).map(numericId).filter(Boolean)
      for (const pid of ids) { await shopifyRest(store.shop_domain, token, `products/${pid}.json`, { method: 'PUT', body: { product: { id: Number(pid), template_suffix: suffix } } }).catch(() => {}); await sleep(140) }
      const first = ids[0] ? await shopifyRest(store.shop_domain, token, `products/${ids[0]}.json`).catch(() => null) : null
      if (first?.product?.handle) path = `/products/${first.product.handle}`
    } else {
      path = '/collections/all'
    }
  }

  const url = `https://${host}${path}`
  // On a draft theme, hand back a preview link on the PRIMARY domain (survives the redirect) + a theme-
  // editor deep link as the always-reliable fallback (renders even for unpublished products).
  const previewUrl = (opts.themeLive === false) ? `${url}${path.includes('?') ? '&' : '?'}preview_theme_id=${theme.id}` : undefined
  return { url, previewUrl, sections: assets.sections.length, themeId: Number(theme.id) }
}

/**
 * Reverse a theme publish when a page is deleted in Selfmade — otherwise its sections/templates linger in
 * the merchant's theme ("Edit code" + the customizer). We don't record WHICH theme a page went to, so we
 * clean every theme, deleting ONLY assets carrying this page's own `sf-<id>` slug (never other content):
 *   • sections/<slug>-*.liquid + assets/<slug>.css
 *   • product → templates/product.<suffix>.json, and reset template_suffix on the assigned product(s)
 *   • home    → strip only our sections out of templates/index.json (leaves the rest of the home intact)
 * Best-effort + idempotent: a missing asset / already-clean theme is a no-op.
 */
export async function unpublishFromThemes(store: StoreRow, pageId: string, kind: PageKind, opts: { productIds?: string[] } = {}): Promise<void> {
  const token = tokenFor(store)
  if (!hasThemeScopes((await fetchAccessScopes(store.shop_domain, token).catch(() => [])).join(','))) return
  const slug = `sf-${pageId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`
  const suffix = `sf-${pageId.replace(/[^a-z0-9]/gi, '').slice(0, 10)}`
  const themes = (await shopifyRest(store.shop_domain, token, 'themes.json').catch(() => null))?.themes || []
  const del = (themeId: number, key: string) => shopifyRest(store.shop_domain, token, `themes/${themeId}/assets.json?asset[key]=${encodeURIComponent(key)}`, { method: 'DELETE' }).catch(() => {})

  for (const t of themes) {
    const assets = (await shopifyRest(store.shop_domain, token, `themes/${t.id}/assets.json`).catch(() => null))?.assets || []
    const keys: string[] = assets.map((a: any) => a.key)
    for (const k of keys) {
      if (k.startsWith(`sections/${slug}-`) || k === `assets/${slug}.css` || k === `templates/product.${suffix}.json`) { await del(Number(t.id), k); await sleep(140) }
    }
    // Home: our sections replaced index.json — pull only ours back out so the rest of the home survives.
    if (kind === 'home' && keys.includes('templates/index.json')) {
      const raw = (await shopifyRest(store.shop_domain, token, `themes/${t.id}/assets.json?asset[key]=templates/index.json`).catch(() => null))?.asset?.value
      if (raw) {
        try {
          const idx = JSON.parse(raw); let changed = false
          for (const id of Object.keys(idx.sections || {})) { if (id.startsWith(slug)) { delete idx.sections[id]; changed = true } }
          if (Array.isArray(idx.order)) { const before = idx.order.length; idx.order = idx.order.filter((id: string) => !id.startsWith(slug)); if (idx.order.length !== before) changed = true }
          if (changed) { await shopifyRest(store.shop_domain, token, `themes/${t.id}/assets.json`, { method: 'PUT', body: { asset: { key: 'templates/index.json', value: JSON.stringify(idx, null, 2) } } }).catch(() => {}); await sleep(140) }
        } catch { /* leave index.json untouched if it doesn't parse */ }
      }
    }
    // Product: un-assign the custom template from the product(s) so they fall back to the default template.
    if (kind === 'product') {
      for (const pid of (opts.productIds || []).map(numericId).filter(Boolean)) {
        const p = await shopifyRest(store.shop_domain, token, `products/${pid}.json`).catch(() => null)
        if (p?.product && p.product.template_suffix === suffix) { await shopifyRest(store.shop_domain, token, `products/${pid}.json`, { method: 'PUT', body: { product: { id: Number(pid), template_suffix: null } } }).catch(() => {}); await sleep(140) }
      }
    }
  }
}
