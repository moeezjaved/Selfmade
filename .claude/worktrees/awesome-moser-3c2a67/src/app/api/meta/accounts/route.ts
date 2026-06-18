import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('meta_accounts')
    .select('id,account_id,account_name,currency,is_primary,last_synced_at')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('is_primary', { ascending: false })

  return NextResponse.json({ accounts: data || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { account_id } = await request.json()
  const admin = createAdminClient()

  // Set all to not primary
  await admin.from('meta_accounts').update({ is_primary: false }).eq('user_id', user.id)
  // Set selected as primary
  await admin.from('meta_accounts').update({ is_primary: true }).eq('user_id', user.id).eq('account_id', account_id)

  return NextResponse.json({ success: true })
}
