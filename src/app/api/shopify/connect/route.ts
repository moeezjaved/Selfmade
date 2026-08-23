/**
 * POST /api/shopify/connect — the BYO (bring-your-own) custom-app door to the Shopify Admin API,
 * mirroring /api/meta/connect-byo. No Partner-app review, no OAuth infra: the merchant creates a custom
 * app in their OWN store admin, grants the scopes, and pastes { shop, token }.
 *
 *   { shop, token, action:'validate' } → live-check against shop.json, return store + granted scopes
 *   { shop, token }                    → encrypt + save the store, first product sync, return catalog health
 *
 * GET → the currently-connected store for the active brand (no token echoed).
 *
 * Token is validated server-side, AES-encrypted via encryptToken, never logged, never returned. Rows land
 * in shopify_stores exactly like the (future) OAuth door — every downstream agent is door-agnostic.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import {
  normalizeShopDomain, isValidShopDomain, validateShopToken, encryptShopifyToken,
  resolveStore, SHOPIFY_REQUIRED_SCOPES, ShopifyError,
} from '@/lib/shopify/client'
import { syncShopifyProducts, catalogHealth } from '@/lib/shopify/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const store = await resolveStore(admin, user.id, brandId)
  if (!store) return NextResponse.json({ connected: false })
  const health = await catalogHealth(admin, store.id).catch(() => null)
  return NextResponse.json({
    connected: true,
    shop_domain: store.shop_domain,
    shop_name: store.shop_name,
    plan_name: store.plan_name,
    currency: store.currency,
    last_sync: (store as any).last_sync,
    health,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  const body = await req.json().catch(() => ({}))
  const shop = normalizeShopDomain(body.shop || '')
  const token = String(body.token || '').trim()
  const validateOnly = body.action === 'validate'

  if (!isValidShopDomain(shop)) {
    return NextResponse.json({ error: 'Enter your store URL, like my-store.myshopify.com' }, { status: 400 })
  }
  if (token.length < 20) {
    return NextResponse.json({ error: 'Paste the Admin API access token from your custom app (starts with shpat_).' }, { status: 400 })
  }

  // ── Live-validate: real store, real token, which scopes were granted? ──
  let info: Awaited<ReturnType<typeof validateShopToken>>
  try {
    info = await validateShopToken(shop, token)
  } catch (e: any) {
    const status = e instanceof ShopifyError ? e.status : 500
    const msg = status === 401 || status === 403
      ? 'That token was rejected. Check you copied the Admin API access token (not the API key/secret) and that the app is installed.'
      : `Couldn’t reach ${shop}: ${String(e?.message || e).slice(0, 140)}`
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const missingScopes = SHOPIFY_REQUIRED_SCOPES.filter((s) => info.scopes.length > 0 && !info.scopes.includes(s))

  if (validateOnly) {
    return NextResponse.json({
      ok: true, shop_domain: shop, shop_name: info.shop_name, plan_name: info.plan_name,
      currency: info.currency, scopes: info.scopes, missingScopes,
    })
  }

  // ── Save the store (encrypted token), scoped to the active brand ──
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const encrypted = encryptShopifyToken(token)
  const { data: saved, error } = await admin.from('shopify_stores').upsert({
    user_id: user.id,
    brand_id: brandId,
    shop_domain: shop,
    access_token: encrypted,
    scopes: info.scopes.join(','),
    shop_name: info.shop_name,
    plan_name: info.plan_name,
    currency: info.currency,
    door: 'byo',
    status: 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,shop_domain' }).select('*').single()

  if (error || !saved) {
    return NextResponse.json({ error: 'Connected, but couldn’t save the store. Try again.' }, { status: 500 })
  }

  // ── First sync so the founder sees real catalog numbers immediately ──
  let health: any = null, sync: any = null
  try {
    sync = await syncShopifyProducts(admin, saved, 20)
    health = await catalogHealth(admin, saved.id)
  } catch (e: any) {
    // store is saved; sync can be retried. Surface a soft note rather than failing the connect.
    return NextResponse.json({
      ok: true, shop_domain: shop, shop_name: info.shop_name, currency: info.currency,
      missingScopes, syncError: String(e?.message || e).slice(0, 140),
    })
  }

  return NextResponse.json({
    ok: true, shop_domain: shop, shop_name: info.shop_name, plan_name: info.plan_name,
    currency: info.currency, missingScopes, sync, health,
  })
}
