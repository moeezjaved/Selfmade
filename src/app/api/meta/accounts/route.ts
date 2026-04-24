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
