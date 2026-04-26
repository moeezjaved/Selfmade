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
    // First get pages with their access tokens
    const res = await fetch(
      `https://graph.facebook.com/${V}/me/accounts?` +
      new URLSearchParams({ 
        fields: 'id,name,category,fan_count,access_token,instagram_business_account,connected_instagram_account',
        access_token: token,
        limit: '20',
      })
    )
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)

    // For each page, get Instagram account using page access token
    const pages = await Promise.all((data.data || []).map(async (p: any) => {
      let instagram = null
      
      // Try with instagram_business_account first
      if (p.instagram_business_account?.id) {
        try {
          const igRes = await fetch(
            `https://graph.facebook.com/${V}/${p.instagram_business_account.id}?` +
            new URLSearchParams({ fields: 'id,name,username', access_token: p.access_token || token })
          )
          const igData = await igRes.json()
          if (!igData.error) instagram = { id: igData.id, name: igData.name, username: igData.username }
        } catch {}
      }

      // Fallback: try connected_instagram_account
      if (!instagram && p.connected_instagram_account?.id) {
        instagram = {
          id: p.connected_instagram_account.id,
          name: p.connected_instagram_account.name || 'Instagram',
          username: p.connected_instagram_account.username || 'instagram',
        }
      }

      // Fallback: try getting instagram via page token
      if (!instagram && p.access_token) {
        try {
          const igRes2 = await fetch(
            `https://graph.facebook.com/${V}/${p.id}?` +
            new URLSearchParams({ fields: 'instagram_business_account{id,name,username}', access_token: p.access_token })
          )
          const igData2 = await igRes2.json()
          if (igData2.instagram_business_account) {
            instagram = {
              id: igData2.instagram_business_account.id,
              name: igData2.instagram_business_account.name,
              username: igData2.instagram_business_account.username,
            }
          }
        } catch {}
      }

      return {
        id: p.id,
        name: p.name,
        category: p.category,
        fan_count: p.fan_count,
        instagram,
      }
    }))
    
    return NextResponse.json({ pages })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
