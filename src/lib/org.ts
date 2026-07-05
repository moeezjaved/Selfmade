/**
 * Organization / team-seat helpers. One shared workspace per org. Every user belongs to exactly one
 * org (their own, auto-created as owner, until they accept an invite into another). Roles: owner,
 * admin, member. Seat limits come from the plan; paid overage is Stage 2 (billing).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlanId } from '@/lib/entitlements'

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

/** Seat usage for an org: members + pending invites vs the owner's plan limit. */
export async function getSeatInfo(admin: SupabaseClient, orgId: string, ownerId: string): Promise<{ used: number; limit: number; planId: string }> {
  const db = admin as any
  const planId = await getPlanId(admin, ownerId)
  const [{ count: members }, { count: pending }] = await Promise.all([
    db.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
    db.from('org_invites').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'pending'),
  ])
  return { used: (members || 0) + (pending || 0), limit: includedSeats(planId), planId }
}
