/**
 * GET /api/ads-studio/audiences?domain=… — detected market + AI target audiences for the ads workspace.
 * Crawls the store for hard signals (currency, payment, cities, language) and grounds an LLM on them so
 * the geography is READ off the site, not guessed. Cached per active brand (brand_kit.adsStudio.audiences,
 * domain-stamped) so the workspace is instant after the first build.
 */
import { NextRequest, NextResponse } from 'next/server'
import { crawlStore, generateAudiences } from '@/lib/ads-studio/store'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { isAppDomain } from '@/lib/domain-guard'
import { readAdsStudio, mergeAdsStudio, readSection, sectionPayload } from '@/lib/ads-studio/cache'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

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
  if (!domain || !domain.includes('.') || isAppDomain(domain)) return NextResponse.json({ market: '', audiences: [], signals: [] })
  const force = req.nextUrl.searchParams.get('force') === '1'
  const brand = await activeBrand()
  if (brand && !force) {
    const cached = readSection<{ siteName: string; market: string; audiences: any[]; signals: string[] }>(await readAdsStudio(brand.admin, brand.brandId), 'audiences', domain)
    if (cached) return NextResponse.json({ ...cached, cached: true })
  }
  try {
    const ctx = await crawlStore(domain)
    const { market, audiences } = await generateAudiences(ctx)
    const payload = { siteName: ctx.siteName, market, audiences, signals: ctx.signals }
    if (brand) await mergeAdsStudio(brand.admin, brand.brandId, { audiences: sectionPayload(domain, payload) })
    return NextResponse.json(payload)
  } catch (e: any) {
    return NextResponse.json({ market: '', audiences: [], signals: [], error: String(e?.message || e).slice(0, 160) })
  }
}
