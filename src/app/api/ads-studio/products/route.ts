/**
 * GET /api/ads-studio/products?domain=… — the store's real catalog (crawled from the site) for the
 * ads workspace Products screen. Returns product cards (title, image, price, url). Cached per active
 * brand (brand_kit.adsStudio.products, domain-stamped) so the workspace loads instantly after the first
 * build; a logged-out standalone visitor just gets a live crawl (uncached).
 */
import { NextRequest, NextResponse } from 'next/server'
import { crawlStore } from '@/lib/ads-studio/store'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { readAdsStudio, mergeAdsStudio, readSection, sectionPayload } from '@/lib/ads-studio/cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function activeBrand(): Promise<{ admin: any; brandId: string } | null> {
  try {
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return null
    const admin = createAdminClient() as any
    const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
    return brandId ? { admin, brandId } : null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const domain = (req.nextUrl.searchParams.get('domain') || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim()
  if (!domain || !domain.includes('.')) return NextResponse.json({ products: [], siteName: '' })
  const force = req.nextUrl.searchParams.get('force') === '1'
  const brand = await activeBrand()
  if (brand && !force) {
    const cached = readSection<{ siteName: string; products: any[] }>(await readAdsStudio(brand.admin, brand.brandId), 'products', domain)
    if (cached) return NextResponse.json({ ...cached, cached: true })
  }
  try {
    const ctx = await crawlStore(domain)
    const payload = { siteName: ctx.siteName, products: ctx.products }
    if (brand) await mergeAdsStudio(brand.admin, brand.brandId, { products: sectionPayload(domain, payload) })
    return NextResponse.json(payload)
  } catch (e: any) {
    return NextResponse.json({ products: [], error: String(e?.message || e).slice(0, 160) })
  }
}
