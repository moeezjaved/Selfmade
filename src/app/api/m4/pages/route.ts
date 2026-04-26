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

    // For each page fetch Instagram using page token
    const pages = await Promise.all((data.data || []).map(async (p: any) => {
      let instagram = null
      const pageToken = p.access_token || token

      // Try all known Instagram fields
      try {
        const igRes = await fetch(
          `https://graph.facebook.com/${V}/${p.id}?` +
          new URLSearchParams({
            fields: 'instagram_business_account{id,username,name},connected_instagram_account{id,username,name}',
            access_token: pageToken,
          })
        )
        const igData = await igRes.json()
        console.log('IG data for', p.name, ':', JSON.stringify(igData))
        
        const ig = igData.instagram_business_account || igData.connected_instagram_account
        if (ig?.id) {
          instagram = { id: ig.id, username: ig.username || 'instagram', name: ig.name || ig.username }
        }
      } catch(e: any) { console.log('IG fetch error:', e.message) }

      return { id: p.id, name: p.name, category: p.category, fan_count: p.fan_count, instagram }
    }))
    
    return NextResponse.json({ pages })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
