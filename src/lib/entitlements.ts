/**
 * Server-side feature-gating (pricing spec §4.2). getEntitlements(ownerId) resolves a user's plan →
 * limits; the guard helpers return a structured upsell payload (never trust the client). Reads plan
 * from subscriptions (if present + active) else user_profiles.plan_id, normalized to a PlanId.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { planEntitlements, normalizePlan, nextPlan, firstPlanWith, PLAN_ORDER, type PlanEntitlements, type PlanId, type UpsellResponse } from '@/lib/plans'

export async function getPlanId(admin: SupabaseClient, ownerId: string): Promise<PlanId> {
  // Two sources can disagree: the Stripe-synced `subscriptions.plan` and the profile's `plan_id`
  // (what the Billing page shows + what admin grants set). If they mismatch (e.g. a mis-synced or
  // stale subscription still says "starter" while the profile is "business"), grant the MORE
  // generous of the two — never under-serve a paying/granted user. Was: subscription-wins, which
  // showed a Business user "Your Free plan includes 1 tracked brand".
  const [{ data: sub }, { data: prof }] = await Promise.all([
    admin.from('subscriptions').select('plan, status, current_period_end').eq('owner_id', ownerId).maybeSingle(),
    admin.from('user_profiles').select('plan_id').eq('user_id', ownerId).maybeSingle(),
  ])
  // A subscription entitles the user when it's active/trialing OR SOFT-CANCELLED but still inside the paid
  // period (cancel keeps access until current_period_end — the renewals cron drops it to Free after that).
  // Excluding 'canceled' here is what made a cancelled Creator lose access mid-period.
  const s: any = sub
  const subEntitled = !!s?.plan && (
    ['active', 'trialing'].includes(String(s.status)) ||
    (String(s.status) === 'canceled' && s.current_period_end && new Date(s.current_period_end) > new Date())
  )
  const subPlan = subEntitled ? normalizePlan(s.plan) : null
  const profPlan = (prof as any)?.plan_id ? normalizePlan((prof as any).plan_id) : null
  if (subPlan && profPlan) return PLAN_ORDER.indexOf(subPlan) >= PLAN_ORDER.indexOf(profPlan) ? subPlan : profPlan
  return subPlan || profPlan || 'free'
}

export async function getEntitlements(admin: SupabaseClient, ownerId: string): Promise<PlanEntitlements & { planId: PlanId }> {
  const planId = await getPlanId(admin, ownerId)
  return { ...planEntitlements(planId), planId }
}

/** Build a structured upsell response for a blocked action. */
export function upsell(planId: PlanId, limit: string, opts: { current?: number; max?: number | null; feature?: keyof PlanEntitlements; message?: string } = {}): UpsellResponse {
  const up = opts.feature ? firstPlanWith(opts.feature) : nextPlan(planId)   // null = already on the top plan
  const atLimit = !up
  return {
    error: 'plan_limit', limit, current: opts.current, max: opts.max, upgradeTo: up || planId, atLimit,
    message: opts.message || (atLimit
      ? `You've reached your plan's limit. Remove one to add another.`
      : `Your plan doesn't include this. Upgrade to ${up} to unlock.`),
  }
}

/** Gate a boolean feature (aiInsights, launch, campaigns, api, exports, canBuyCredits). Returns null
 *  if allowed, or a structured upsell to return as 402. */
export async function requireFeature(admin: SupabaseClient, ownerId: string, feature: 'aiInsights' | 'launch' | 'campaigns' | 'inbox' | 'api' | 'exports' | 'canBuyCredits'): Promise<UpsellResponse | null> {
  const ent = await getEntitlements(admin, ownerId)
  if (ent[feature]) return null
  const names: Record<string, string> = {
    aiInsights: 'AI Insights (Patterns)', launch: 'Launch Ads', campaigns: 'Campaigns & Reports',
    inbox: 'Customer Inbox', api: 'API / MCP access', exports: 'Exports', canBuyCredits: 'Credit top-ups',
  }
  return upsell(ent.planId, feature, { feature, message: `${names[feature] || feature} is available on the ${firstPlanWith(feature)} plan and up.` })
}

/** Gate a countable limit (brandSpy, seats, expressPulls). Returns null if under the cap, else an upsell. */
export async function requireUnder(admin: SupabaseClient, ownerId: string, limit: 'brandSpy' | 'seats' | 'expressPulls', current: number): Promise<UpsellResponse | null> {
  const ent = await getEntitlements(admin, ownerId)
  const max = (ent as any)[limit]
  if (max === Infinity || current < max) return null
  const noun = limit === 'brandSpy' ? 'tracked brands' : limit === 'seats' ? 'seats' : 'brand pulls per day'
  const higher = nextPlan(ent.planId)   // null = top visible plan → no upgrade to sell
  const tail = higher
    ? (limit === 'expressPulls' ? ' Upgrade for more, or try again tomorrow.' : ' Upgrade to add more.')
    : (limit === 'brandSpy' ? ' Remove one to track a new brand.' : limit === 'seats' ? ' Remove a member to free a seat.' : ' Try again tomorrow.')
  return upsell(ent.planId, limit, {
    current, max: max === Infinity ? null : max,
    message: `${higher ? `Your ${ent.label} plan includes ${max === Infinity ? 'unlimited' : max} ${noun}.` : `You've reached your ${ent.label} plan's ${max} ${noun}.`}${tail}`,
  })
}
