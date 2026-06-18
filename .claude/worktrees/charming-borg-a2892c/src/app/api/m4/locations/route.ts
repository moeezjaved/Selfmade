import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const q = request.nextUrl.searchParams.get('q') || ''
    if (q.length < 2) return NextResponse.json({ results: [] })

    const admin = createAdminClient()
    const { data: metaAccount } = await admin
      .from('meta_accounts').select('*')
      .eq('user_id', user.id).eq('is_primary', true).single()
    if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

    const token = decryptToken(metaAccount.access_token)

    const res = await fetch(
      `https://graph.facebook.com/${V}/search?` + new URLSearchParams({
        type: 'adgeolocation',
        q,
        location_types: JSON.stringify(['country', 'city', 'region']),
        limit: '10',
        access_token: token,
      })
    )
    const data = await res.json()

    const results = (data.data || []).map((loc: any) => ({
      key: loc.key,
      name: loc.name,
      type: loc.type,
      country_code: loc.country_code,
      country_name: loc.country_name,
      region: loc.region,
    }))

    return NextResponse.json({ results })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
