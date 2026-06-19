/**
 * Preview ads for a seed term — see what auto-discovery would find
 * WITHOUT saving anything. Lets admin verify the term before activating it.
 *
 * GET /api/admin/seeds/preview?term=gymwear&country=US&limit=10
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function getMetaToken(admin: any): Promise<string | null> {
  const { data: accounts } = await admin
    .from('meta_accounts')
    .select('access_token')
    .eq('is_primary', true)
    .limit(1)
  if (accounts?.[0]?.access_token) {
    try {
      const t = decryptToken(accounts[0].access_token)
      if (t) return t
    } catch { /* ignore */ }
  }
  return process.env.META_APP_TOKEN || process.env.META_ACCESS_TOKEN || null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const term = req.nextUrl.searchParams.get('term')?.trim()
  const country = req.nextUrl.searchParams.get('country') || 'US'
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '10'), 25)
  if (!term) return NextResponse.json({ error: 'term required' }, { status: 400 })

  const admin = createAdminClient()
  const token = await getMetaToken(admin)
  if (!token) return NextResponse.json({ error: 'No Meta token' }, { status: 503 })

  try {
    const params = new URLSearchParams({
      access_token: token,
      search_terms: term,
      ad_reached_countries: JSON.stringify([country]),
      ad_type: 'ALL',
      active_status: 'ALL',
      fields: 'id,page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,ad_delivery_start_time,ad_delivery_stop_time',
      limit: String(limit),
    })

    const res = await fetch(`https://graph.facebook.com/v19.0/ads_archive?${params}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const detail = await res.text()
      return NextResponse.json({
        error: `Meta API error: ${res.status}`,
        detail: detail.slice(0, 500),
      }, { status: 502 })
    }
    const data = await res.json() as any
    const ads = (data?.data || []).map((a: any) => ({
      ad_id: a.id,
      page_id: a.page_id,
      page_name: a.page_name,
      body: a.ad_creative_bodies?.[0] || '',
      title: a.ad_creative_link_titles?.[0] || '',
      snapshot_url: a.ad_snapshot_url,
      start_date: a.ad_delivery_start_time,
      is_active: !a.ad_delivery_stop_time,
    }))

    // Group ads by brand to show which brands this seed would surface
    const brandsMap = new Map<string, { page_id: string; page_name: string; ad_count: number; sample_ads: any[] }>()
    for (const ad of ads) {
      const k = ad.page_id || 'unknown'
      if (!brandsMap.has(k)) {
        brandsMap.set(k, {
          page_id: ad.page_id,
          page_name: ad.page_name,
          ad_count: 0,
          sample_ads: [],
        })
      }
      const b = brandsMap.get(k)!
      b.ad_count++
      if (b.sample_ads.length < 3) b.sample_ads.push(ad)
    }
    const brands = Array.from(brandsMap.values()).sort((a, b) => b.ad_count - a.ad_count)

    return NextResponse.json({
      term,
      country,
      total_ads_returned: ads.length,
      unique_brands: brands.length,
      brands,
      ads,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
