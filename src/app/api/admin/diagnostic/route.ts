/**
 * Diagnostic — answers "what do we ACTUALLY have in the database?"
 * Check if the indexer is the bottleneck before assuming the dedup is wrong.
 *
 * GET /api/admin/diagnostic?brand=Gymshark
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const brand = req.nextUrl.searchParams.get('brand') || 'Gymshark'

  // Run counts sequentially with error handling — parallel + exact COUNT
  // can time out on big tables. Use 'planned' (fast estimate) where possible.
  async function countQuery(builder: any): Promise<{ count: number | null; error: string | null }> {
    try {
      const { count, error } = await builder
      return { count: count ?? null, error: error?.message || null }
    } catch (e) {
      return { count: null, error: e instanceof Error ? e.message : String(e) }
    }
  }

  const totalAdsRes = await countQuery(admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }))
  const brandAdsRes = await countQuery(admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).ilike('page_name', `%${brand}%`))
  const brandActiveRes = await countQuery(admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).ilike('page_name', `%${brand}%`).eq('is_active', true))
  const brandInactiveRes = await countQuery(admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).ilike('page_name', `%${brand}%`).eq('is_active', false))
  const brandWithImageRes = await countQuery(admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).ilike('page_name', `%${brand}%`).like('thumbnail_url', '%r2.dev%'))
  const brandWithVideoRes = await countQuery(admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).ilike('page_name', `%${brand}%`).like('video_url', '%r2.dev%'))
  const brandWithAnyR2Res = await countQuery(admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).ilike('page_name', `%${brand}%`).or('thumbnail_url.like.%r2.dev%,video_url.like.%r2.dev%'))
  const brandWithImageHashRes = await countQuery(admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).ilike('page_name', `%${brand}%`).not('image_hash', 'is', null))

  const totalAds = totalAdsRes.count
  const brandAds = brandAdsRes.count
  const brandActive = brandActiveRes.count
  const brandInactive = brandInactiveRes.count
  const brandWithImage = brandWithImageRes.count
  const brandWithVideo = brandWithVideoRes.count
  const brandWithAnyR2 = brandWithAnyR2Res.count
  const brandWithImageHash = brandWithImageHashRes.count

  const errors = [totalAdsRes, brandAdsRes, brandActiveRes, brandInactiveRes, brandWithImageRes, brandWithVideoRes, brandWithAnyR2Res, brandWithImageHashRes]
    .map((r, i) => r.error ? { query: i, error: r.error } : null)
    .filter(Boolean)

  // Lightweight data samples
  const { data: hashSample } = await admin.from('discovery_ads_index').select('image_hash').ilike('page_name', `%${brand}%`).not('image_hash', 'is', null).limit(2000)
  const { data: countryBreakdown } = await admin.from('discovery_ads_index').select('country').ilike('page_name', `%${brand}%`).limit(2000)
  const { data: pageBreakdown } = await admin.from('discovery_ads_index').select('page_name, page_id').ilike('page_name', `%${brand}%`).limit(2000)

  // Count unique image hashes for this brand
  const uniqueImageHashes = new Set((hashSample || []).map((r: any) => r.image_hash).filter(Boolean))

  // Country breakdown
  const countries: Record<string, number> = {}
  for (const r of (countryBreakdown || []) as any[]) {
    const c = r.country || 'unknown'
    countries[c] = (countries[c] || 0) + 1
  }

  // Page breakdown (Meta sometimes has multiple page entities for the same brand)
  const pages: Record<string, { name: string; count: number }> = {}
  for (const r of (pageBreakdown || []) as any[]) {
    const k = r.page_id || 'no_page_id'
    if (!pages[k]) pages[k] = { name: r.page_name || 'unknown', count: 0 }
    pages[k].count++
  }

  return NextResponse.json({
    brand,
    totals: {
      all_ads_in_db: totalAds,
      ads_for_brand: brandAds,
      brand_active: brandActive,
      brand_inactive: brandInactive,
      brand_with_image: brandWithImage,
      brand_with_video: brandWithVideo,
      brand_with_any_r2: brandWithAnyR2,
      brand_with_image_hash: brandWithImageHash,
      unique_image_hashes_for_brand: uniqueImageHashes.size,
    },
    query_errors: errors.length > 0 ? errors : undefined,
    diagnosis: brandAds === 0
      ? `🚨 ZERO ads for "${brand}" in DB — crawler never indexed this brand`
      : (brandAds || 0) < 5000
      ? `⚠️ Only ${brandAds} ads for "${brand}". Meta Ads Library shows ~49K. Indexer is hitting MAX_BRAND_PAGES=60 cap (= 3,000 ads max per run). Fix: raise cap and re-crawl.`
      : `✅ ${brandAds} ads indexed for "${brand}" — looks healthy`,
    countries_for_brand: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 20),
    page_entities_for_brand: Object.entries(pages).sort((a, b) => b[1].count - a[1].count).slice(0, 20),
  })
}
