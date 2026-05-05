import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Use app-level access token for Meta Ads Library (required by /ads_archive endpoint)
    const token = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      return NextResponse.json({ error: 'Meta app credentials not configured' }, { status: 500 })
    }

    // Still fetch meta account for default country preference
    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('country')
      .eq('user_id', user.id).eq('is_primary', true).single()

    const { searchParams } = request.nextUrl

    const q = searchParams.get('q') || ''
    const country = searchParams.get('country') || metaAccount?.country || 'US'
    const platforms = searchParams.get('platforms') || ''   // facebook,instagram
    const status = searchParams.get('status') || 'ALL'       // ALL | ACTIVE | INACTIVE
    const sort = searchParams.get('sort') || 'recent'        // recent | longest
    const after = searchParams.get('after') || ''
    const limit = 20

    const fields = [
      'id',
      'ad_creation_time',
      'ad_delivery_start_time',
      'ad_delivery_stop_time',
      'ad_creative_bodies',
      'ad_creative_link_titles',
      'ad_creative_link_captions',
      'ad_creative_link_descriptions',
      'ad_snapshot_url',
      'page_name',
      'page_id',
      'publisher_platforms',
      'languages',
    ].join(',')

    const params: Record<string, string> = {
      access_token: token,
      ad_type: 'ALL',
      ad_reached_countries: JSON.stringify([country]),
      fields,
      limit: String(limit),
    }

    if (q) params.search_terms = q
    if (platforms) params.publisher_platforms = JSON.stringify(platforms.split(','))
    if (status === 'ACTIVE') params.ad_active_status = 'ACTIVE'
    if (status === 'INACTIVE') params.ad_active_status = 'INACTIVE'
    if (after) params.after = after

    // Sorting
    if (sort === 'longest') {
      params.ad_active_status = 'ACTIVE'
      params.search_type = 'KEYWORD_UNORDERED'
    }

    const url = `https://graph.facebook.com/${V}/ads_archive?` + new URLSearchParams(params)
    const res = await fetch(url)
    const data = await res.json()

    if (data.error) {
      return NextResponse.json({ error: data.error.message }, { status: 400 })
    }

    // Transform ads
    let ads = (data.data || []).map((ad: any) => ({
      id: ad.id,
      pageId: ad.page_id,
      pageName: ad.page_name,
      body: ad.ad_creative_bodies?.[0] || '',
      title: ad.ad_creative_link_titles?.[0] || '',
      caption: ad.ad_creative_link_captions?.[0] || '',
      description: ad.ad_creative_link_descriptions?.[0] || '',
      snapshotUrl: ad.ad_snapshot_url,
      startDate: ad.ad_delivery_start_time,
      stopDate: ad.ad_delivery_stop_time || null,
      createdAt: ad.ad_creation_time,
      platforms: ad.publisher_platforms || [],
      languages: ad.languages || [],
      isActive: !ad.ad_delivery_stop_time,
      daysRunning: ad.ad_delivery_start_time
        ? Math.floor((Date.now() - new Date(ad.ad_delivery_start_time).getTime()) / 86400000)
        : 0,
    }))

    // Client-side sort for longest running
    if (sort === 'longest') {
      ads = ads.sort((a: any, b: any) => b.daysRunning - a.daysRunning)
    }

    return NextResponse.json({
      ads,
      nextCursor: data.paging?.cursors?.after || null,
      hasMore: !!data.paging?.next,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
