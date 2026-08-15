/**
 * Organization / team-seat helpers. One shared workspace per org. Every user belongs to exactly one
 * org (their own, auto-created as owner, until they accept an invite into another). Roles: owner,
 * admin, member. Seat limits come from the plan; paid overage is Stage 2 (billing).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlanId } from '@/lib/entitlements'
import { planEntitlements, nextPlan } from '@/lib/plans'

export type Role = 'owner' | 'admin' | 'member'
export type OrgCtx = { orgId: string; name: string; ownerId: string; role: Role }

// Included seats per plan (paid overage added in Stage 2). Keyed by normalized PlanId.
// Included seats — MUST match the /pricing table (source of truth customers buy against).
const SEATS: Record<string, number> = { free: 1, starter: 1, pro: 3, business: 10, enterprise: 25 }
export function includedSeats(planId: string): number { return SEATS[planId] ?? 1 }
export const canManage = (role: Role) => role === 'owner' || role === 'admin'

/** The caller's org + role. Lazily creates a personal org (owner) the first time. */
export async function getUserOrg(admin: SupabaseClient, userId: string): Promise<OrgCtx> {
  const db = admin as any
  // newest membership wins → accepting a team invite switches you into that team.
  // Two plain queries (no PostgREST FK-embed, which can fail before the relationship cache warms).
  const { data: m } = await db.from('org_members')
    .select('role, org_id')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (m?.org_id) {
    const { data: o } = await db.from('organizations').select('id, name, owner_id').eq('id', m.org_id).maybeSingle()
    if (o) return { orgId: o.id, name: o.name, ownerId: o.owner_id, role: m.role as Role }
  }
  // none yet → create the user's own org
  const { data: org } = await db.from('organizations').insert({ owner_id: userId, name: 'My Team' }).select().single()
  await db.from('org_members').insert({ org_id: org.id, user_id: userId, role: 'owner' })
  return { orgId: org.id, name: org.name, ownerId: userId, role: 'owner' }
}

/**
 * Resolve the BILLING account for a user: the owner of the org they belong to (so a whole team
 * draws from ONE shared credit pool + plan — "credits pool at org level"). Read-only and side-effect
 * free (unlike getUserOrg, it never lazily creates an org), so it's safe to call on every credit op.
 * A solo user with no membership resolves to themselves — no behaviour change.
 */
export async function resolveBillingOwner(admin: SupabaseClient, userId: string): Promise<string> {
  const db = admin as any
  const { data: m } = await db.from('org_members')
    .select('org_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (m?.org_id) {
    const { data: o } = await db.from('organizations').select('owner_id').eq('id', m.org_id).maybeSingle()
    if (o?.owner_id) return o.owner_id as string
  }
  return userId
}

/** All user_ids in an org (members). Used to gather the org's shared Meta ad-account pool. */
export async function orgMemberIds(admin: SupabaseClient, orgId: string): Promise<string[]> {
  const { data } = await (admin as any).from('org_members').select('user_id').eq('org_id', orgId)
  return (data || []).map((m: any) => m.user_id as string)
}

/**
 * The org's shared Meta ad-account POOL: every active account connected by any member. One shared
 * workspace ⇒ the team draws from the same set of connected accounts (not just each person's own).
 */
export async function orgAdAccounts(admin: SupabaseClient, orgId: string): Promise<Array<{ account_id: string; account_name: string | null }>> {
  const ids = await orgMemberIds(admin, orgId)
  if (!ids.length) return []
  const { data } = await (admin as any).from('meta_accounts')
    .select('account_id, account_name, user_id, status').in('user_id', ids).eq('status', 'active')
  // de-dupe by account_id (same account could be connected twice)
  const seen = new Map<string, { account_id: string; account_name: string | null }>()
  for (const a of (data || []) as any[]) if (a.account_id && !seen.has(a.account_id)) seen.set(a.account_id, { account_id: a.account_id, account_name: a.account_name ?? null })
  return Array.from(seen.values())
}

/**
 * The set of account_ids a user MAY see. Default-all: owner/admin (or a member with no explicit
 * assignment) → the whole org pool. A member WITH assignment rows → exactly those (∩ pool).
 * Returns { all: true } when unrestricted so callers can skip filtering entirely.
 */
export async function allowedAdAccountIds(admin: SupabaseClient, userId: string): Promise<{ all: boolean; ids: string[] }> {
  const db = admin as any
  const { data: m } = await db.from('org_members')
    .select('org_id, role').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!m?.org_id || m.role === 'owner' || m.role === 'admin') return { all: true, ids: [] }
  const { data: rows } = await db.from('org_member_ad_accounts').select('account_id').eq('org_id', m.org_id).eq('user_id', userId)
  const assigned = (rows || []).map((r: any) => r.account_id as string)
  if (!assigned.length) return { all: true, ids: [] }   // no explicit assignment → sees all (default-all)
  return { all: false, ids: assigned }
}

/** Seat usage for an org: members + pending invites vs the owner's plan limit. */
export async function getSeatInfo(admin: SupabaseClient, orgId: string, ownerId: string): Promise<{ used: number; limit: number; planId: string; planLabel: string; included: number; extra: number; canUpgrade: boolean; purchasable: boolean }> {
  const db = admin as any
  const planId = await getPlanId(admin, ownerId)
  const [{ count: members }, { count: pending }, { data: sub }] = await Promise.all([
    db.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    db.from('org_invites').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
    db.from('subscriptions').select('extra_seats').eq('owner_id', ownerId).maybeSingle(),
  ])
  const included = includedSeats(planId)
  const extra = Math.max(0, (sub as any)?.extra_seats ?? 0)   // paid overage
  // Customer-facing plan name ('starter' internal id IS "Creator"). canUpgrade is false on the top
  // plan (nothing above Creator for a normal user). purchasable = extra paid seats are actually wired
  // (Stripe seat SKU); this app bills via PayPal so it's usually off → hide the broken add-seat flow.
  const planLabel = planEntitlements(planId).label
  const canUpgrade = nextPlan(planId) !== null
  // Paid extra seats aren't purchasable yet — billing runs on PayPal and the Stripe seat flow dead-ends
  // ("Couldn't update seats"). Force OFF so the Team tab never shows a broken "+ Add seats" button; a
  // single-seat plan (Creator) just says so. Flip this on when seat purchase is actually wired.
  const purchasable = false
  return { used: (members || 0) + (pending || 0), limit: included + extra, planId, planLabel, included, extra, canUpgrade, purchasable }
}
