/**
 * Top Brands — returns brands with most ads for a given search/category.
 * Powers the horizontal brand strip above search results (like Atria).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ brands: [] })

    const admin = createAdminClient()
    const { searchParams } = request.nextUrl
    const q = (searchParams.get('q') || '').trim()
    const industry = searchParams.get('industry') || ''
    const country = searchParams.get('country') || 'US'
    const status = searchParams.get('status') || 'ALL'

    // Use Supabase RPC to get top brands with ad counts
    const { data, error } = await admin.rpc('get_top_brands', {
      search_query: q || null,
      filter_industry: industry || null,
      filter_country: country === 'ALL' ? null : country,
      filter_active: status === 'ACTIVE' ? true : status === 'INACTIVE' ? false : null,
      result_limit: 12,
    })

    if (error || !data?.length) {
      // Fallback: simple group-by query
      let query = admin
        .from('discovery_ads_index')
        .select('page_id, page_name')

      if (q) query = query.or(`body.ilike.%${q}%,title.ilike.%${q}%,page_name.ilike.%${q}%`)
      if (country && country !== 'ALL') query = query.eq('country', country)
      if (industry) query = query.contains('industries', [industry])
      if (status === 'ACTIVE') query = query.eq('is_active', true)

      const { data: rawAds } = await query.limit(500)
      if (!rawAds?.length) return NextResponse.json({ brands: [] })

      // Count by page_id
      const counts: Record<string, { name: string; count: number }> = {}
      for (const ad of rawAds) {
        if (!ad.page_id) continue
        if (!counts[ad.page_id]) counts[ad.page_id] = { name: ad.page_name, count: 0 }
        counts[ad.page_id].count++
      }

      const brands = Object.entries(counts)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 12)
        .map(([pageId, { name, count }]) => ({ pageId, name, adCount: count, picture: null }))

      return NextResponse.json({ brands })
    }

    return NextResponse.json({
      brands: data.map((b: any) => ({
        pageId: b.page_id,
        name: b.page_name,
        adCount: b.ad_count,
        picture: null,
      }))
    })
  } catch (err: any) {
    return NextResponse.json({ brands: [] })
  }
}
