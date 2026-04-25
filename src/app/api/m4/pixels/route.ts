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
    .from('meta_accounts')
    .select('*')
    .eq('user_id', user.id)
    .eq('is_primary', true)
    .single()

  if (!metaAccount) return NextResponse.json({ error: 'No Meta account' }, { status: 400 })

  const token = decryptToken(metaAccount.access_token)
  const accountId = `act_${metaAccount.account_id}`

  try {
    const res = await fetch(
      `https://graph.facebook.com/${V}/${accountId}/adspixels?` +
      new URLSearchParams({
        fields: 'id,name,code,creation_time,last_fired_time,stats',
        access_token: token,
      })
    )
    const data = await res.json()
    if (data.error) throw new Error(data.error.message)

    return NextResponse.json({
      pixels: (data.data || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        last_fired: p.last_fired_time,
        active: !!p.last_fired_time,
      }))
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
