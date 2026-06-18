import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'

const V = process.env.META_API_VERSION || 'v20.0'

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

function transformAd(ad: any) {
  return {
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
    mediaType: ad.media_type || '',
    isActive: !ad.ad_delivery_stop_time,
    daysRunning: ad.ad_delivery_start_time
      ? Math.floor((Date.now() - new Date(ad.ad_delivery_start_time).getTime()) / 86400000)
      : 0,
  }
}

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

    const q = searchParams.get('q') || ''
    const mode = searchParams.get('mode') || 'adcopy'   // adcopy | brand | category
    const pageIds = searchParams.get('page_ids') || ''  // comma-separated page IDs for brand mode
    const country = searchParams.get('country') || metaAccount?.country || 'US'
    const platforms = searchParams.get('platforms') || ''
    const status = searchParams.get('status') || 'ALL'
    const sort = searchParams.get('sort') || 'recent'
    const after = searchParams.get('after') || ''
    const limit = 20

    // Must have either a query or page IDs
    if (!q.trim() && !pageIds.trim()) {
      return NextResponse.json({ ads: [], nextCursor: null, hasMore: false })
    }

    const params: Record<string, string> = {
      access_token: token,
      ad_reached_countries: JSON.stringify([country]),
      fields,
      limit: String(limit),
    }

    if (pageIds) {
      // Brand mode: search by specific page IDs
      params.search_page_ids = JSON.stringify(pageIds.split(',').map(id => id.trim()).filter(Boolean))
    } else if (q) {
      // Ad copy or category mode: keyword search
      params.search_terms = q
      if (sort === 'longest') params.search_type = 'KEYWORD_UNORDERED'
    }

    if (platforms) params.publisher_platforms = JSON.stringify(platforms.split(','))
    if (status === 'ACTIVE') params.ad_active_status = 'ACTIVE'
    if (status === 'INACTIVE') params.ad_active_status = 'INACTIVE'
    if (after) params.after = after
    if (sort === 'longest') params.ad_active_status = 'ACTIVE'

    // ── Brand mode: first resolve page IDs from name search ──
    if (mode === 'brand' && q && !pageIds) {
      const pagesUrl = `https://graph.facebook.com/${V}/pages/search?` + new URLSearchParams({
        q: q.trim(),
        fields: 'id',
        access_token: token,
        limit: '10',
      })
      const pagesRes = await fetch(pagesUrl)
      const pagesData = await pagesRes.json()
      const ids = (pagesData.data || []).map((p: any) => p.id)

      if (ids.length === 0) {
        return NextResponse.json({ ads: [], nextCursor: null, hasMore: false, note: 'No brands found with that name' })
      }

      // Replace search_terms with search_page_ids
      delete params.search_terms
      delete params.search_type
      params.search_page_ids = JSON.stringify(ids)
    }

    const url = `https://graph.facebook.com/${V}/ads_archive?` + new URLSearchParams(params)
    const res = await fetch(url)
    const data = await res.json()

    if (data.error) {
      console.log('META API ERROR:', JSON.stringify(data.error))
      return NextResponse.json({ error: `${data.error.message} (code: ${data.error.code}, type: ${data.error.type})` }, { status: 400 })
    }

    let ads = (data.data || []).map(transformAd)

    if (sort === 'longest') {
      ads = ads.sort((a: any, b: any) => b.daysRunning - a.daysRunning)
    }

    return NextResponse.json({
      ads,
      nextCursor: data.paging?.cursors?.after || null,
      hasMore: !!data.paging?.next,
      mode,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
