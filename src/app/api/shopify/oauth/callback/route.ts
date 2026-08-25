/**
 * GET /api/shopify/oauth/callback — Shopify redirects here after the merchant approves. We verify the
 * HMAC (proves the redirect is really from Shopify), the state nonce (CSRF), and the shop, then exchange
 * the code for a lasting token, encrypt + save the store (door='oauth'), run the first sync, and bounce
 * the merchant back into the app. Same shopify_stores row shape as the BYO door — downstream is unchanged.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  normalizeShopDomain, isValidShopDomain, validateShopToken, encryptShopifyToken, seedBrandWebsite,
} from '@/lib/shopify/client'
import { verifyHmac, exchangeCodeForToken, appBaseUrl } from '@/lib/shopify/oauth'
import { syncShopifyProducts } from '@/lib/shopify/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function fail(reason: string) {
  return NextResponse.redirect(new URL(`/connect/shopify?status=error&why=${encodeURIComponent(reason)}`, appBaseUrl()), 303)
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const shop = normalizeShopDomain(params.get('shop') || '')
  const code = params.get('code') || ''
  const state = params.get('state') || ''

  if (!isValidShopDomain(shop) || !code) return fail('badparams')
  if (!verifyHmac(params)) return fail('hmac')

  // CSRF: the state must match the nonce we set at init, and the shop must match too.
  const cookieNonce = req.cookies.get('sh_oauth_nonce')?.value || ''
  const cookieShop = req.cookies.get('sh_oauth_shop')?.value || ''
  const cookieBrand = req.cookies.get('sh_oauth_brand')?.value || ''
  if (!cookieNonce || state !== cookieNonce) return fail('state')
  if (cookieShop && cookieShop !== shop) return fail('shopmismatch')

  // Must be a logged-in Selfmade user (the callback is a top-level nav, so first-party cookies are sent).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent('/connect/shopify?status=retry')}`, req.url), 303)

  // Exchange the code for a lasting token.
  let token: string
  try { token = (await exchangeCodeForToken(shop, code)).access_token } catch { return fail('exchange') }

  // Read identity + granted scopes for the row.
  let info: Awaited<ReturnType<typeof validateShopToken>>
  try { info = await validateShopToken(shop, token) } catch { return fail('validate') }

  const admin = createAdminClient() as any
  const { data: saved } = await admin.from('shopify_stores').upsert({
    user_id: user.id,
    brand_id: cookieBrand || null,
    shop_domain: shop,
    access_token: encryptShopifyToken(token),
    scopes: info.scopes.join(','),
    shop_name: info.shop_name,
    plan_name: info.plan_name,
    currency: info.currency,
    door: 'oauth',
    status: 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,shop_domain' }).select('*').single()

  // Seed the brand's website from the store domain so the ads studio can learn the brand from the site.
  if (saved) await seedBrandWebsite(admin, cookieBrand || saved.brand_id || null, shop)

  // First sync (best-effort; the store is already saved).
  if (saved) { try { await syncShopifyProducts(admin, saved, 20) } catch { /* retryable */ } }

  const res = NextResponse.redirect(new URL('/connect/shopify?status=connected', appBaseUrl()), 303)
  // Clear the one-shot cookies.
  for (const c of ['sh_oauth_nonce', 'sh_oauth_shop', 'sh_oauth_brand']) res.cookies.set(c, '', { path: '/', maxAge: 0 })
  return res
}
