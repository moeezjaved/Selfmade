import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { orgMemberIds, allowedAdAccountIds } from '@/lib/org'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  // One shared workspace: the pool is every account connected by ANY member of the caller's org
  // (not just their own). Then scope to what THIS member is allowed to see (default-all). Solo users
  // (no org membership) just see their own accounts — unchanged behaviour.
  const { data: mem } = await admin.from('org_members')
    .select('org_id').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const userIds = mem?.org_id ? await orgMemberIds(admin, mem.org_id) : [user.id]

  const { data } = await admin
    .from('meta_accounts')
    .select('id,account_id,account_name,currency,is_primary,last_synced_at')
    .in('user_id', userIds.length ? userIds : [user.id])
    .eq('status', 'active')
    .order('is_primary', { ascending: false })

  let accounts = (data || []) as any[]
  const allowed = await allowedAdAccountIds(admin, user.id)
  if (!allowed.all) accounts = accounts.filter(a => allowed.ids.includes(a.account_id))

  return NextResponse.json({ accounts })
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

// Disconnect Meta: soft-deactivate all of this user's ad accounts (reversible —
// keeps history). They disappear from the picker + dashboard, which only read
// status='active'. Reconnecting re-activates whatever Meta still grants.
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin.from('meta_accounts')
    .update({ status: 'disconnected', is_primary: false })
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
