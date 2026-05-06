import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account connected' }, { status: 400 })

    const userToken = decryptToken(metaAccount.access_token)
    const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
    const token = userToken || appToken

    const { searchParams } = request.nextUrl
    const pageId = searchParams.get('page_id')
    const after = searchParams.get('after') || ''
    const status = searchParams.get('status') || 'ALL'
    if (!pageId) return NextResponse.json({ error: 'page_id required' }, { status: 400 })

    const fields = [
      'id', 'ad_creation_time', 'ad_delivery_start_time', 'ad_delivery_stop_time',
      'ad_creative_bodies', 'ad_creative_link_titles', 'ad_creative_link_captions',
      'ad_creative_link_descriptions', 'ad_snapshot_url', 'page_name', 'page_id',
      'publisher_platforms', 'languages',
    ].join(',')

    const params: Record<string, string> = {
      access_token: token,
      ad_type: 'ALL',
      ad_reached_countries: JSON.stringify([metaAccount.country || 'US']),
      search_page_ids: JSON.stringify([pageId]),
      fields,
      limit: '50',
    }
    if (status === 'ACTIVE') params.ad_active_status = 'ACTIVE'
    if (after) params.after = after

    const url = `https://graph.facebook.com/${V}/ads_archive?` + new URLSearchParams(params)
    const res = await fetch(url)
    const data = await res.json()

    if (data.error) return NextResponse.json({ error: data.error.message }, { status: 400 })

    const ads = (data.data || []).map((ad: any) => ({
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
      platforms: ad.publisher_platforms || [],
      languages: ad.languages || [],
      mediaType: ad.media_type || '',
      isActive: !ad.ad_delivery_stop_time,
      daysRunning: ad.ad_delivery_start_time
        ? Math.floor((Date.now() - new Date(ad.ad_delivery_start_time).getTime()) / 86400000)
        : 0,
    }))

    return NextResponse.json({
      ads,
      nextCursor: data.paging?.cursors?.after || null,
      hasMore: !!data.paging?.next,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
