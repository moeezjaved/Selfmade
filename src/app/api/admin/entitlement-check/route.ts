/**
 * Admin diagnostic — GET /api/admin/entitlement-check?email=<member-email>
 * Runs the REAL entitlement-resolution chain for a user (the exact code the app runs) and reports why
 * they do or don't get a paid plan's features. Built to answer "why does this team member still hit the
 * upgrade wall on Ads/Campaigns/Reports?" — it shows their org memberships, the resolved billing owner,
 * the owner's live plan, and the final /api/credits/balance shape (plan the UpgradeGate keys off).
 * Read-only. Admin-cookie gated.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyAdminRequest } from '@/lib/admin/auth'
import { resolveBillingOwner } from '@/lib/org'
import { getBalance } from '@/lib/credits'
import { getPlanId } from '@/lib/entitlements'
import { planEntitlements } from '@/lib/plans'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!verifyAdminRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'email query param required' }, { status: 400 })

  const admin = createAdminClient() as any

  // 1) resolve the member's auth user by email (paginate — listUsers has no email filter)
  let member: any = null
  for (let page = 1; page <= 20 && !member; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    const users = data?.users || []
    member = users.find((u: any) => (u.email || '').toLowerCase() === email) || null
    if (users.length < 200) break
  }
  if (!member) return NextResponse.json({ error: `No auth user with email ${email}` }, { status: 404 })
  const memberId = member.id

  // 2) every org membership + that org's owner (this is what resolveBillingOwner walks)
  const { data: memRows } = await admin.from('org_members')
    .select('org_id, role, created_at').eq('user_id', memberId).order('created_at', { ascending: false })
  const orgIds = Array.from(new Set((memRows || []).map((r: any) => r.org_id).filter(Boolean)))
  const { data: orgs } = orgIds.length
    ? await admin.from('organizations').select('id, name, owner_id').in('id', orgIds)
    : { data: [] }
  const orgById = new Map<string, any>((orgs || []).map((o: any) => [o.id, o]))
  const ownerEmail = async (id: string) => { try { const { data } = await admin.auth.admin.getUserById(id); return data?.user?.email || id } catch { return id } }
  const memberships = await Promise.all((memRows || []).map(async (r: any) => {
    const o = orgById.get(r.org_id)
    return {
      org_id: r.org_id, org_name: o?.name || null, role: r.role, created_at: r.created_at,
      owner_id: o?.owner_id || null, owner_email: o?.owner_id ? await ownerEmail(o.owner_id) : null,
      is_own_org: o?.owner_id === memberId,
    }
  }))

  // 3) run the REAL resolver + balance the app uses
  const resolvedOwner = await resolveBillingOwner(admin, memberId)
  const resolvedOwnerEmail = await ownerEmail(resolvedOwner)
  const ownerPlanId = await getPlanId(admin, resolvedOwner)                 // what entitlements.ts sees
  const bal = await getBalance(admin, memberId)                            // what /api/credits/balance returns
  const ent = planEntitlements(bal.plan)                                    // what UpgradeGate evaluates

  // 4) verdict for the three gated surfaces
  const gated = { campaigns: !!(ent as any).campaigns, launch: !!(ent as any).launch, aiInsights: !!(ent as any).aiInsights }
  const passes = gated.campaigns && gated.launch
  const reason = passes
    ? 'OK — member resolves to a paid owner and gets the gated features.'
    : resolvedOwner === memberId
      ? 'FAIL — resolveBillingOwner returned the member THEMSELVES (no joined-team membership found). The member is not in the owner’s org_members, so they fall back to their own (Free) plan. Fix: ensure the invite was ACCEPTED (row in org_members for the owner’s org).'
      : `FAIL — member resolves to owner ${resolvedOwnerEmail}, but that owner’s plan is "${bal.plan}" which lacks the gated features. Fix: the owner must be on Creator+ (active, or cancelled-but-still-in-period).`

  return NextResponse.json({
    member: { id: memberId, email: member.email },
    memberships,
    resolved: { billing_owner_id: resolvedOwner, billing_owner_email: resolvedOwnerEmail, is_self: resolvedOwner === memberId, owner_plan_id: ownerPlanId },
    balance: { plan: bal.plan, balance: bal.balance, subscription_status: (bal as any).subscription_status, canceled: (bal as any).canceled, is_owner: (bal as any).is_owner },
    entitlements_evaluated_by_upgradegate: gated,
    verdict: { passes, reason },
  })
}
