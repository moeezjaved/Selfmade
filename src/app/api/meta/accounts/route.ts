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

  const sel = (cols: string) => admin.from('meta_accounts').select(cols)
    .in('user_id', userIds.length ? userIds : [user.id]).eq('status', 'active').order('is_primary', { ascending: false })
  // brand_id may not exist yet (mig 142 not applied) — fall back to the base columns so the card never breaks.
  let { data, error } = await sel('id,account_id,account_name,currency,is_primary,last_synced_at,brand_id')
  if (error) ({ data } = await sel('id,account_id,account_name,currency,is_primary,last_synced_at'))

  let accounts = (data || []) as any[]
  const allowed = await allowedAdAccountIds(admin, user.id)
  if (!allowed.all) accounts = accounts.filter(a => allowed.ids.includes(a.account_id))

  // Scope to the ACTIVE brand (project switcher). An account assigned to a brand (meta_accounts.brand_id,
  // mig 142) shows only under that brand; unassigned accounts (brand_id null) are treated as shared and
  // show under every brand. "All brands" (no active brand) shows everything. This is why switching the
  // project at the top used to keep showing the same account — the list wasn't brand-scoped.
  try {
    const { resolveActiveBrandId } = await import('@/lib/brand/active')
    const activeBrand = await resolveActiveBrandId(admin, user.id).catch(() => null)
    if (activeBrand && accounts.some(a => 'brand_id' in a)) {
      const scoped = accounts.filter(a => !a.brand_id || a.brand_id === activeBrand)
      // Only apply the scope if it doesn't wipe the list to nothing (e.g. a brand with no linked/shared
      // account yet) — better to show all than to strand the founder with an empty account picker.
      if (scoped.length) accounts = scoped
    }
  } catch { /* brand scoping is best-effort — never break the account list */ }

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
