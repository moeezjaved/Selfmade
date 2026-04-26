import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'

const V = process.env.META_API_VERSION || 'v20.0'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: metaAccount } = await admin
    .from('meta_accounts').select('*')
    .eq('user_id', user.id).eq('is_primary', true).single()

  if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

  const token = decryptToken(metaAccount.access_token)

  try {
    const res = await fetch(
      `https://graph.facebook.com/${V}/me/accounts?` +
      new URLSearchParams({ 
        fields: 'id,name,category,fan_count,instagram_business_account{id,name,username,profile_picture_url}',
        access_token: token 
      })
    )
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)
    
    return NextResponse.json({ 
      pages: (data.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        fan_count: p.fan_count,
        instagram: p.instagram_business_account ? {
          id: p.instagram_business_account.id,
          name: p.instagram_business_account.name,
          username: p.instagram_business_account.username,
        } : null
      }))
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
