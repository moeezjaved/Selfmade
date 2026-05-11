/**
 * Brand Preview — fetch first N ads for a page_id WITHOUT saving anywhere.
 * Lets the admin verify it's the right brand before approving.
 *
 * GET /api/admin/brands/preview?page_id=129669023798560&limit=10
 */
import { NextRequest, NextResponse } from 'next/server'
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const pageId = req.nextUrl.searchParams.get('page_id')?.trim()
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '10'), 25)
  if (!pageId) return NextResponse.json({ error: 'page_id required' }, { status: 400 })

  const admin = createAdminClient()
  const token = await getMetaToken(admin)
  if (!token) return NextResponse.json({ error: 'No Meta token' }, { status: 503 })

  try {
    // Fetch page info first
    const pageParams = new URLSearchParams({
      fields: 'id,name,fan_count,picture.type(large),link,category,verification_status,website',
      access_token: token,
    })
    const pageRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?${pageParams}`, {
      signal: AbortSignal.timeout(8_000),
    })
    const page = pageRes.ok ? await pageRes.json() as any : null

    // Fetch sample ads
    const adsParams = new URLSearchParams({
      access_token: token,
      search_page_ids: pageId,
      ad_reached_countries: JSON.stringify(['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'IN', 'BR', 'MX']),
      ad_type: 'ALL',
      active_status: 'ALL',
      fields: 'id,ad_creative_bodies,ad_creative_link_titles,ad_snapshot_url,page_name,ad_delivery_start_time,ad_delivery_stop_time',
      limit: String(limit),
    })
    const adsRes = await fetch(`https://graph.facebook.com/v19.0/ads_archive?${adsParams}`, {
      signal: AbortSignal.timeout(15_000),
    })
    if (!adsRes.ok) {
      const detail = await adsRes.text()
      return NextResponse.json({
        error: `Meta API error: ${adsRes.status}`,
        detail: detail.slice(0, 500),
      }, { status: 502 })
    }
    const adsData = await adsRes.json() as any
    const ads = (adsData?.data || []).map((a: any) => ({
      ad_id: a.id,
      body: a.ad_creative_bodies?.[0] || '',
      title: a.ad_creative_link_titles?.[0] || '',
      page_name: a.page_name,
      snapshot_url: a.ad_snapshot_url,
      start_date: a.ad_delivery_start_time,
      stop_date: a.ad_delivery_stop_time,
      is_active: !a.ad_delivery_stop_time,
    }))

    return NextResponse.json({
      page: page ? {
        page_id: page.id,
        name: page.name,
        follower_count: page.fan_count,
        picture: page.picture?.data?.url,
        category: page.category,
        verified: page.verification_status === 'blue_verified' || page.verification_status === 'gray_verified',
        website: page.website,
        link: page.link,
      } : null,
      ads,
      total_returned: ads.length,
    })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
