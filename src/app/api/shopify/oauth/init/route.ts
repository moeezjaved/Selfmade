/**
 * GET /api/shopify/oauth/init?shop=my-store.myshopify.com — start the one-click Connect Shopify flow.
 * Validates the shop, mints a CSRF nonce (httpOnly cookie), remembers the active brand, and redirects the
 * merchant to Shopify's authorize screen. The token comes back through /callback.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { normalizeShopDomain, isValidShopDomain } from '@/lib/shopify/client'
import { shopifyOAuthConfigured, buildAuthorizeUrl, newNonce, appBaseUrl } from '@/lib/shopify/oauth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login?next=/mission', req.url), 303)

  if (!shopifyOAuthConfigured()) {
    return NextResponse.redirect(new URL('/connect/shopify?status=unconfigured', appBaseUrl()), 303)
  }

  const shop = normalizeShopDomain(req.nextUrl.searchParams.get('shop') || '')
  if (!isValidShopDomain(shop)) {
    return NextResponse.redirect(new URL('/connect/shopify?status=badshop', appBaseUrl()), 303)
  }

  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)

  const nonce = newNonce()
  const res = NextResponse.redirect(buildAuthorizeUrl(shop, nonce), 303)
  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/', maxAge: 600 }
  res.cookies.set('sh_oauth_nonce', nonce, cookieOpts)
  res.cookies.set('sh_oauth_shop', shop, cookieOpts)
  res.cookies.set('sh_oauth_brand', brandId || '', cookieOpts)
  return res
}
