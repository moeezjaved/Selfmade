/**
 * Apply GEO crawlability/entity assets to a connected Shopify store (Phase C auto-apply):
 *   • fact_sheet → a published Shopify PAGE (crawlable entity/authority anchor).
 *   • schema     → JSON-LD injected into the MAIN theme's <head> (theme.liquid), wrapped in markers so it
 *                  is idempotent (never double-injected) and reversible.
 *   • llms_txt   → NOT supported: it must live at the site root (/llms.txt), which the Shopify Admin API
 *                  cannot serve. Callers surface an honest "copy it in manually" note instead.
 *
 * All writes go through the store's own connection (write_content for pages, write_themes for the theme).
 * Safe: schema injection is marker-wrapped + idempotent, so re-applying is a no-op and it can be removed.
 */
import { shopifyRest, tokenFor, type StoreRow } from '@/lib/shopify/client'

const SCHEMA_START = '<!-- SELFMADE_GEO_SCHEMA_START -->'
const SCHEMA_END = '<!-- SELFMADE_GEO_SCHEMA_END -->'

/** Publish the fact sheet as a Shopify Page. Returns the live URL. */
export async function publishFactSheetPage(store: StoreRow, opts: { title: string; bodyHtml: string }): Promise<{ pageId: number; url: string }> {
  const token = tokenFor(store)
  const created = await shopifyRest(store.shop_domain, token, 'pages.json', {
    method: 'POST',
    body: { page: { title: opts.title, body_html: opts.bodyHtml, published: true } },
  })
  const p = created?.page
  if (!p?.id) throw new Error('Shopify did not return the created page')
  const url = `https://${store.shop_domain}/pages/${p.handle}`
  return { pageId: p.id, url }
}

/** Pull the `<script type="application/ld+json">…</script>` block out of the schema asset's body. */
export function extractJsonLd(body: string): string {
  const m = /<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/i.exec(body || '')
  return m ? m[0] : ''
}

/**
 * Inject JSON-LD into the published theme's <head>. Idempotent: if our block already exists it's replaced,
 * not duplicated. Reversible: the block is marker-wrapped. Requires write_themes scope.
 */
export async function applySchemaToTheme(store: StoreRow, jsonLdScript: string): Promise<{ themeId: number; alreadyPresent: boolean }> {
  const token = tokenFor(store)
  const script = (jsonLdScript || '').trim()
  if (!script) throw new Error('No JSON-LD to apply')

  // Find the MAIN (published) theme.
  const themes = await shopifyRest(store.shop_domain, token, 'themes.json')
  const main = (themes?.themes || []).find((t: any) => t.role === 'main') || (themes?.themes || [])[0]
  if (!main?.id) throw new Error('Could not find the published theme')

  // Read layout/theme.liquid.
  const key = 'layout/theme.liquid'
  const assetRes = await shopifyRest(store.shop_domain, token, `themes/${main.id}/assets.json?asset[key]=${encodeURIComponent(key)}`)
  const current = String(assetRes?.asset?.value || '')
  if (!current || !/<\/head>/i.test(current)) throw new Error('Theme layout is missing a </head> — can’t inject safely')

  const block = `${SCHEMA_START}\n${script}\n${SCHEMA_END}`
  const alreadyPresent = current.includes(SCHEMA_START)

  // Replace an existing block (idempotent) or insert once, right before </head>.
  const next = alreadyPresent
    ? current.replace(new RegExp(`${escapeRe(SCHEMA_START)}[\\s\\S]*?${escapeRe(SCHEMA_END)}`), block)
    : current.replace(/<\/head>/i, `${block}\n</head>`)

  if (next === current) return { themeId: main.id, alreadyPresent }   // nothing changed → no write

  await shopifyRest(store.shop_domain, token, `themes/${main.id}/assets.json`, {
    method: 'PUT', body: { asset: { key, value: next } },
  })
  return { themeId: main.id, alreadyPresent }
}

/** Remove the injected schema block from the published theme (reverse of applySchemaToTheme). */
export async function removeSchemaFromTheme(store: StoreRow): Promise<boolean> {
  const token = tokenFor(store)
  const themes = await shopifyRest(store.shop_domain, token, 'themes.json')
  const main = (themes?.themes || []).find((t: any) => t.role === 'main') || (themes?.themes || [])[0]
  if (!main?.id) return false
  const key = 'layout/theme.liquid'
  const assetRes = await shopifyRest(store.shop_domain, token, `themes/${main.id}/assets.json?asset[key]=${encodeURIComponent(key)}`)
  const current = String(assetRes?.asset?.value || '')
  if (!current.includes(SCHEMA_START)) return false
  const next = current.replace(new RegExp(`\\n?${escapeRe(SCHEMA_START)}[\\s\\S]*?${escapeRe(SCHEMA_END)}\\n?`), '\n')
  await shopifyRest(store.shop_domain, token, `themes/${main.id}/assets.json`, { method: 'PUT', body: { asset: { key, value: next } } })
  return true
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
