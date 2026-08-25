/**
 * Shopify Admin API client + brand-scoped store resolver. Door-agnostic: whether a store was connected
 * via the BYO custom-app token or (later) OAuth, every agent reaches it through resolveStore() and talks
 * to it through shopifyGraphql()/shopifyRest(). Tokens are AES-encrypted at rest (reusing the Meta
 * encryptToken) and decrypted only here, in memory, per request.
 */
import { encryptToken, decryptToken } from '@/lib/meta/client'

export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10'

// Scopes the custom app must be granted for the Catalog cluster + revenue/inventory to work.
export const SHOPIFY_REQUIRED_SCOPES = [
  'read_products', 'write_products',
  'read_orders',
  'read_inventory',
  'read_content', 'write_content',   // blog/pages for publish-to-blog
]

export type StoreRow = {
  id: string
  brand_id: string | null
  user_id: string
  shop_domain: string
  access_token: string   // encrypted in the row; decrypted by tokenFor()
  shop_name?: string | null
  plan_name?: string | null
  currency?: string | null
  status?: string | null
}

export { encryptToken as encryptShopifyToken }

/** Normalise whatever the user pastes ("https://my-store.myshopify.com/admin", "my-store") to a bare host. */
export function normalizeShopDomain(input: string): string {
  let s = String(input || '').trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '')
  if (!s) return ''
  if (!s.includes('.')) s = `${s}.myshopify.com`
  return s
}

export function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)
}

function apiBase(shop: string) {
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}`
}

/** Decrypt a store row's token for use this request. */
export function tokenFor(store: StoreRow): string {
  return decryptToken(store.access_token)
}

export class ShopifyError extends Error {
  status: number
  constructor(message: string, status = 500) { super(message); this.status = status }
}

/** Raw REST call. `path` is like 'shop.json' or 'products/123.json'. */
export async function shopifyRest(
  shop: string, token: string, path: string,
  init: { method?: string; body?: any } = {},
): Promise<any> {
  const url = `${apiBase(shop)}/${path.replace(/^\//, '')}`
  const r = await fetch(url, {
    method: init.method || 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  const json = text ? (() => { try { return JSON.parse(text) } catch { return { _raw: text } } })() : {}
  if (!r.ok) {
    const msg = json?.errors ? (typeof json.errors === 'string' ? json.errors : JSON.stringify(json.errors)) : `Shopify ${r.status}`
    throw new ShopifyError(msg, r.status)
  }
  return json
}

/** GraphQL Admin API call. Returns `data`; throws on top-level or userErrors. */
export async function shopifyGraphql(
  shop: string, token: string, query: string, variables?: Record<string, any>,
): Promise<any> {
  const url = `${apiBase(shop)}/graphql.json`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    signal: AbortSignal.timeout(25000),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) throw new ShopifyError(json?.errors ? JSON.stringify(json.errors) : `Shopify ${r.status}`, r.status)
  if (json.errors) throw new ShopifyError(Array.isArray(json.errors) ? json.errors.map((e: any) => e.message).join('; ') : String(json.errors), 400)
  return json.data
}

/** Live-validate a shop+token by reading the shop record. Returns identity + the granted scopes. */
export async function validateShopToken(shop: string, token: string): Promise<{
  shop_name: string; plan_name: string | null; currency: string | null; scopes: string[]
}> {
  const info = await shopifyRest(shop, token, 'shop.json')
  const s = info?.shop || {}
  let scopes: string[] = []
  try {
    const sc = await shopifyRest(shop, token, 'oauth/access_scopes.json')
    scopes = (sc?.access_scopes || []).map((x: any) => x.handle).filter(Boolean)
  } catch { /* older tokens may not expose this; not fatal */ }
  return {
    shop_name: s.name || shop,
    plan_name: s.plan_display_name || s.plan_name || null,
    currency: s.currency || null,
    scopes,
  }
}

/**
 * Resolve the Shopify store for a user's active (or explicit) brand. Brand-scoped and STRICT: when a
 * brand is active we never leak another brand's store. Falls back to the user's most recent active
 * store only when no brand context exists at all.
 */
export async function resolveStore(admin: any, userId: string, explicitBrand?: string | null): Promise<StoreRow | null> {
  const brandId = explicitBrand ?? null
  if (brandId) {
    const { data } = await admin.from('shopify_stores')
      .select('*').eq('user_id', userId).eq('brand_id', brandId).eq('status', 'active')
      .order('connected_at', { ascending: false }).limit(1)
    return (data && data[0]) || null
  }
  const { data } = await admin.from('shopify_stores')
    .select('*').eq('user_id', userId).eq('status', 'active')
    .order('connected_at', { ascending: false }).limit(1)
  return (data && data[0]) || null
}

/**
 * Seed a brand's `website` from its Shopify store domain when it has none. Brands created via the
 * Shopify door (not the website funnel) otherwise have an empty website, which strands the whole ads
 * studio — Brand Hub, Products, Audiences, Competitors all key off brands.website. The myshopify
 * domain is crawlable (Shopify serves the storefront there and redirects to any custom domain), and
 * the founder can override it later from the studio. Never overwrites an existing website.
 */
export async function seedBrandWebsite(admin: any, brandId: string | null, shopDomain: string): Promise<void> {
  if (!brandId || !shopDomain) return
  try {
    const { data: b } = await admin.from('brands').select('website').eq('id', brandId).maybeSingle()
    if (!String(b?.website || '').trim()) {
      await admin.from('brands').update({ website: shopDomain }).eq('id', brandId)
    }
  } catch { /* best-effort; connect still succeeds if this fails */ }
}
