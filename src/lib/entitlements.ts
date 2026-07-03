/**
 * Server-side feature-gating (pricing spec §4.2). getEntitlements(ownerId) resolves a user's plan →
 * limits; the guard helpers return a structured upsell payload (never trust the client). Reads plan
 * from subscriptions (if present + active) else user_profiles.plan_id, normalized to a PlanId.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { planEntitlements, normalizePlan, nextPlan, firstPlanWith, type PlanEntitlements, type PlanId, type UpsellResponse } from '@/lib/plans'

export async function getPlanId(admin: SupabaseClient, ownerId: string): Promise<PlanId> {
  // Prefer an active subscription row; fall back to the profile's plan_id.
  const { data: sub } = await admin
    .from('subscriptions').select('plan, status')
    .eq('owner_id', ownerId).in('status', ['active', 'trialing']).maybeSingle()
  if ((sub as any)?.plan) return normalizePlan((sub as any).plan)
  const { data: prof } = await admin.from('user_profiles').select('plan_id').eq('user_id', ownerId).maybeSingle()
  return normalizePlan((prof as any)?.plan_id)
}

export async function getEntitlements(admin: SupabaseClient, ownerId: string): Promise<PlanEntitlements & { planId: PlanId }> {
  const planId = await getPlanId(admin, ownerId)
  return { ...planEntitlements(planId), planId }
}

/** Build a structured upsell response for a blocked action. */
export function upsell(planId: PlanId, limit: string, opts: { current?: number; max?: number | null; feature?: keyof PlanEntitlements; message?: string } = {}): UpsellResponse {
  const upgradeTo = opts.feature ? firstPlanWith(opts.feature) : (nextPlan(planId) || 'pro')
  return {
    error: 'plan_limit', limit, current: opts.current, max: opts.max, upgradeTo,
    message: opts.message || `Your plan doesn't include this. Upgrade to ${upgradeTo} to unlock.`,
  }
}

/** Gate a boolean feature (aiInsights, launch, campaigns, api, exports, canBuyCredits). Returns null
 *  if allowed, or a structured upsell to return as 402. */
export async function requireFeature(admin: SupabaseClient, ownerId: string, feature: 'aiInsights' | 'launch' | 'campaigns' | 'api' | 'exports' | 'canBuyCredits'): Promise<UpsellResponse | null> {
  const ent = await getEntitlements(admin, ownerId)
  if (ent[feature]) return null
  const names: Record<string, string> = {
    aiInsights: 'AI Insights (Patterns)', launch: 'Launch Ads', campaigns: 'Campaigns & Reports',
    api: 'API / MCP access', exports: 'Exports', canBuyCredits: 'Credit top-ups',
  }
  return upsell(ent.planId, feature, { feature, message: `${names[feature] || feature} is available on the ${firstPlanWith(feature)} plan and up.` })
}

/** Gate a countable limit (brandSpy, seats). Returns null if under the cap, else an upsell. */
export async function requireUnder(admin: SupabaseClient, ownerId: string, limit: 'brandSpy' | 'seats', current: number): Promise<UpsellResponse | null> {
  const ent = await getEntitlements(admin, ownerId)
  const max = ent[limit]
  if (max === Infinity || current < max) return null
  return upsell(ent.planId, limit, {
    current, max: max === Infinity ? null : max,
    message: `Your ${ent.label} plan includes ${max === Infinity ? 'unlimited' : max} ${limit === 'brandSpy' ? 'tracked brands' : 'seats'}. Upgrade to add more.`,
  })
}
