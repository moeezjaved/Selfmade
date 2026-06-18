import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const q = searchParams.get('q') || ''
  if (!q.trim() || q.trim().length < 2) return NextResponse.json({ pages: [] })

  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ pages: [] })

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()

    if (!metaAccount) return NextResponse.json({ pages: [] })

    const userToken = decryptToken(metaAccount.access_token)
    const appToken = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`
    const token = userToken || appToken
    const country = metaAccount.country || 'US'

    // 1. Search Meta pages
    const pagesUrl = `https://graph.facebook.com/${V}/pages/search?` + new URLSearchParams({
      q: q.trim(),
      fields: 'id,name,picture{url},fan_count,category',
      access_token: token,
      limit: '6',
    })
    const pagesRes = await fetch(pagesUrl)
    const pagesData = await pagesRes.json()

    if (pagesData.error) {
      console.log('Pages search error:', pagesData.error.message)
      return NextResponse.json({ pages: [] })
    }

    const rawPages = (pagesData.data || []) as any[]
    if (!rawPages.length) return NextResponse.json({ pages: [] })

    // 2. Fetch ad counts for each page in parallel from the Ads Library
    const adCounts = await Promise.all(
      rawPages.map(async (p: any) => {
        try {
          const adsUrl = `https://graph.facebook.com/${V}/ads_archive?` + new URLSearchParams({
            access_token: token,
            search_page_ids: JSON.stringify([p.id]),
            ad_reached_countries: JSON.stringify([country]),
            fields: 'id',
            limit: '50',
          })
          const adsRes = await fetch(adsUrl)
          const adsData = await adsRes.json()
          if (adsData.error) return 0
          // Count returned ads — not exact total but a good proxy
          const count = (adsData.data || []).length
          // If there's a next page, it means 50+ ads — flag it
          const hasMore = !!adsData.paging?.next
          return hasMore ? '50+' : count
        } catch {
          return 0
        }
      })
    )

    const pages = rawPages.map((p: any, i: number) => ({
      pageId: p.id,
      name: p.name,
      picture: p.picture?.data?.url || null,
      fanCount: p.fan_count || 0,
      category: p.category || '',
      adCount: adCounts[i],
    }))

    return NextResponse.json({ pages })
  } catch (err: any) {
    return NextResponse.json({ pages: [] })
  }
}
