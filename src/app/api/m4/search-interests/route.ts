import { NextRequest, NextResponse } from 'next/server'
import { resolveBrandScopedAccount } from '@/lib/meta/scope'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const META_API_VERSION = process.env.META_API_VERSION || 'v20.0'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q') || ''
  if (!q) return NextResponse.json({ interests: [] })

  const admin = createAdminClient()
  const account = await resolveBrandScopedAccount(admin, user.id)

  if (!account) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

  const token = decryptToken(account.access_token)

  const res = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/search?` +
    new URLSearchParams({ type: 'adinterest', q, limit: '10', access_token: token })
  )
  const data = await res.json()

  return NextResponse.json({
    interests: (data.data || []).map((i: any) => ({
      id: i.id,
      name: i.name,
      audience_size_lower_bound: i.audience_size_lower_bound,
      audience_size_upper_bound: i.audience_size_upper_bound,
      path: i.path || [],
      topic: i.topic || '',
    }))
  })
}
