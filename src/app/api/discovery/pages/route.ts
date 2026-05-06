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

    // Search Meta pages
    const url = `https://graph.facebook.com/${V}/pages/search?` + new URLSearchParams({
      q: q.trim(),
      fields: 'id,name,picture{url},fan_count,category',
      access_token: token,
      limit: '6',
    })
    const res = await fetch(url)
    const data = await res.json()

    if (data.error) {
      console.log('Pages search error:', data.error.message)
      return NextResponse.json({ pages: [] })
    }

    const pages = (data.data || []).map((p: any) => ({
      pageId: p.id,
      name: p.name,
      picture: p.picture?.data?.url || null,
      fanCount: p.fan_count || 0,
      category: p.category || '',
    }))

    return NextResponse.json({ pages })
  } catch (err: any) {
    return NextResponse.json({ pages: [] })
  }
}
