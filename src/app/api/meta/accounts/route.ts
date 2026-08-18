import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { workspaceMemberIds, allowedAdAccountIds } from '@/lib/org'
import { resolvePrimary } from '@/lib/meta/audit'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient() as any
  // ISOLATION: the pool is every account connected by a member of the caller's ONE workspace org (the org
  // owned by their billing owner) — NOT the "newest org membership" (which, with cross-invited accounts,
  // pooled unrelated users' Facebook connections into the picker — a cross-account leak). Solo users just
  // see their own. Then scope to what THIS member is allowed to see (default-all).
  const userIds = await workspaceMemberIds(admin, user.id).catch(() => [user.id])

  const sel = (cols: string) => admin.from('meta_accounts').select(cols)
    .in('user_id', userIds.length ? userIds : [user.id]).eq('status', 'active').order('is_primary', { ascending: false })
  // brand_id may not exist yet (mig 142 not applied) — fall back to the base columns so the card never breaks.
  let { data, error } = await sel('id,account_id,account_name,currency,is_primary,last_synced_at,brand_id')
  if (error) ({ data } = await sel('id,account_id,account_name,currency,is_primary,last_synced_at'))

  let accounts = (data || []) as any[]
  const allowed = await allowedAdAccountIds(admin, user.id)
  if (!allowed.all) accounts = accounts.filter(a => allowed.ids.includes(a.account_id))

  // The full workspace pool BEFORE brand filtering — so a brand with no linked account can offer
  // "link one you already connected" instead of forcing a reconnect (the "Aura says Connect Meta even
  // though I already connected an account" case). Only account_id/name/brand_id — no tokens.
  const workspaceAccounts = accounts.map(a => ({ account_id: a.account_id, account_name: a.account_name, currency: a.currency, brand_id: ('brand_id' in a ? a.brand_id : null) }))

  // STRICT scope to the ACTIVE brand (project switcher): an account shows ONLY under the brand it's
  // linked to (meta_accounts.brand_id, mig 142). Unassigned accounts (brand_id null) show ONLY under
  // "All brands", NOT under every brand — matching competitors + the inbox. A brand with no linked
  // account shows an empty picker (correct: Hair ResQ has no account, so no ROY4/Aura account leaks in).
  let activeBrand: string | null = null
  try {
    const { resolveActiveBrandId } = await import('@/lib/brand/active')
    activeBrand = await resolveActiveBrandId(admin, user.id).catch(() => null)
    if (activeBrand && accounts.some(a => 'brand_id' in a)) {
      accounts = accounts.filter(a => a.brand_id === activeBrand)
    }
  } catch { /* brand scoping is best-effort — never break the account list */ }

  // De-dupe the primary flag in the RESPONSE (data drift can leave several rows is_primary=true).
  // Exactly one is_primary — the SAME deterministic account the audit engine scopes to — so the
  // brief card defaults to, and refreshes into, the identical account (no more €86 ↔ $687k flip).
  if (accounts.length) {
    const primary = resolvePrimary(accounts)
    accounts = accounts.map(a => ({ ...a, is_primary: a.account_id === primary?.account_id }))
  }

  return NextResponse.json({ accounts, workspaceAccounts, activeBrand })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { account_id } = body
  const admin = createAdminClient()

  // Assign this account to a brand (the "project" link) — brand_id null clears it. Scope to the WHOLE
  // workspace, not just the caller's own rows: the account is often connected by the OWNER while a member
  // (or the owner on a different session) does the linking. Matching only .eq(user_id,self) silently
  // updated ZERO rows for a shared account → "it still says link to a brand after a thousand times".
  if ('brand_id' in body) {
    const { workspaceMemberIds } = await import('@/lib/org')
    const poolIds = await workspaceMemberIds(admin, user.id).catch(() => [user.id])
    const acctBare = String(account_id || '').replace(/^act_/, '')
    await admin.from('meta_accounts').update({ brand_id: body.brand_id || null }).in('user_id', poolIds).eq('account_id', acctBare)
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
