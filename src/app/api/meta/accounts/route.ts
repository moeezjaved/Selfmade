import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { orgMemberIds, allowedAdAccountIds } from '@/lib/org'
import { resolvePrimary } from '@/lib/meta/audit'

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
    .select('id,account_id,account_name,currency,is_primary,last_synced_at,brand_id')
    .in('user_id', userIds.length ? userIds : [user.id])
    .eq('status', 'active')
    .order('is_primary', { ascending: false })

  let accounts = (data || []) as any[]
  const allowed = await allowedAdAccountIds(admin, user.id)
  if (!allowed.all) accounts = accounts.filter(a => allowed.ids.includes(a.account_id))

  // De-dupe the primary flag in the RESPONSE (data drift can leave several rows is_primary=true).
  // Exactly one is_primary — the SAME deterministic account the audit engine scopes to — so the
  // brief card defaults to, and refreshes into, the identical account (no more €86 ↔ $687k flip).
  if (accounts.length) {
    const primary = resolvePrimary(accounts)
    accounts = accounts.map(a => ({ ...a, is_primary: a.account_id === primary?.account_id }))
  }

  return NextResponse.json({ accounts })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { account_id } = body
  const admin = createAdminClient()

  // Assign this account to a brand (the "project" link) — brand_id null clears it.
  if ('brand_id' in body) {
    await admin.from('meta_accounts').update({ brand_id: body.brand_id || null }).eq('user_id', user.id).eq('account_id', account_id)
    return NextResponse.json({ success: true })
  }

  // Otherwise: set this account as the primary.
  await admin.from('meta_accounts').update({ is_primary: false }).eq('user_id', user.id)
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
