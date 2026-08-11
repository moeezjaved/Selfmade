/**
 * Credit middleware — thin TS wrappers over the atomic Postgres functions
 * (reserve/commit/refund/grant in migration 018). The locking + balance math
 * lives in plpgsql so concurrent actions can't double-spend; this layer just
 * translates errors and shapes results.
 *
 * Every metered AI endpoint follows: reserve → call model → commit(metadata)
 *                                              ↘ on any failure → refund.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveBillingOwner } from '@/lib/org'
import { normalizePlan, PLAN_ORDER } from '@/lib/plans'
// NOTE: "free unlimited images for subscribers" (pricing v2) lives in the DB reserve_credits function
// (migration 102), NOT here — because some routes call the RPC directly and would bypass an app-layer
// check. reserve_credits returns a real 0-credit committed tx for subscriber image actions, so commit/
// refund below work unchanged.

export class InsufficientCreditsError extends Error {
  constructor(public need: number, public have: number) {
    super(`insufficient_credits: need ${need}, have ${have}`)
    this.name = 'InsufficientCreditsError'
  }
}

export interface ReservedTx {
  id: string
  user_id: string
  action_type: string
  delta: number
  balance_after: number
  status: string
}

/** Reserve credits BEFORE the model call. Throws InsufficientCreditsError (402-mappable)
 *  or a generic Error. Returns the reserved transaction (keep txId for commit/refund). */
export async function reserveCredits(
  admin: SupabaseClient, userId: string, action: string, refId?: string,
): Promise<ReservedTx> {
  // Charge the ORG's shared wallet (owner), not the individual member — one team, one credit pool.
  const owner = await resolveBillingOwner(admin, userId)
  const { data, error } = await admin.rpc('reserve_credits', {
    p_user: owner, p_action: action, p_ref: refId ?? null,
  })
  if (error) {
    const msg = error.message || ''
    if (msg.includes('insufficient_credits')) {
      const m = msg.match(/need=(\d+),have=(\d+)/)
      throw new InsufficientCreditsError(m ? +m[1] : 0, m ? +m[2] : 0)
    }
    throw new Error(msg || 'reserve_credits failed')
  }
  // rpc returning a SETOF/row → supabase returns an array or the row; normalize.
  return (Array.isArray(data) ? data[0] : data) as ReservedTx
}

/** Finalize a reserved tx + record real cost for margin tracking. */
export async function commitCredits(
  admin: SupabaseClient, txId: string, metadata: Record<string, any> = {},
): Promise<void> {
  const { error } = await admin.rpc('commit_credits', { p_tx: txId, p_metadata: metadata })
  if (error) throw new Error(error.message)
}

/** Give credits back on failure. Idempotent — safe to call in a catch even if unsure. */
export async function refundCredits(admin: SupabaseClient, txId: string): Promise<void> {
  const { error } = await admin.rpc('refund_credits', { p_tx: txId })
  if (error) throw new Error(error.message)
}

/** Grant top-up credits (after a verified Stripe pack purchase). */
export async function grantCredits(
  admin: SupabaseClient, userId: string, credits: number, refId?: string,
): Promise<void> {
  // Top-ups land in the org's shared wallet (owner) so the whole team can spend them.
  const owner = await resolveBillingOwner(admin, userId)
  const { error } = await admin.rpc('grant_credits', { p_user: owner, p_credits: credits, p_ref: refId ?? null })
  if (error) throw new Error(error.message)
}

/** Current balance + plan + reset date (also lazily applies a due monthly reset). */
export async function getBalance(admin: SupabaseClient, userId: string) {
  // Members see the ORG's shared balance (owner's wallet + plan), not their own empty one.
  const owner = await resolveBillingOwner(admin, userId)
  await admin.rpc('ensure_monthly_reset', { p_user: owner })
  const [{ data: prof }, { data: wallet }, { data: sub }] = await Promise.all([
    admin.from('user_profiles').select('credits_balance, plan_id, credits_reset_at, subscription_status, trial_ends_at').eq('user_id', owner).maybeSingle(),
    admin.from('credit_wallets').select('plan_credits_balance, topup_credits_balance, plan_credits_reset_at').eq('owner_id', owner).maybeSingle(),
    admin.from('subscriptions').select('stripe_subscription_id, status, plan').eq('owner_id', owner).maybeSingle(),
  ])
  const plan_credits = (wallet as any)?.plan_credits_balance ?? 0
  const topup_credits = (wallet as any)?.topup_credits_balance ?? 0
  // A trial is only REAL when an actual Stripe subscription is trialing. A stale profile
  // status='trialing' with no subscription (legacy signups) must NOT surface the "pay now to
  // unlock" CTA — it can only fail with "no subscription". Gate on a real Stripe sub id.
  const realTrial = (prof as any)?.subscription_status === 'trialing'
    && !!(sub as any)?.stripe_subscription_id
    && ((sub as any)?.status ? (sub as any).status === 'trialing' : true)
  // Plan can live in TWO places that disagree: the Stripe-synced `subscriptions.plan` (what the Billing
  // page reads → "Selfmade Creator · Active") and `user_profiles.plan_id`. This used to return ONLY the
  // profile plan_id, so a paying Creator whose profile row wasn't synced showed as "Free" everywhere the
  // brief/onboarding read getBalance (the "You're on Free / Free tracks 1 competitor" bug). Match
  // getPlanId: take the MORE GENEROUS of the two active sources — never under-serve a paying user.
  const subActive = (sub as any)?.plan && ['active', 'trialing'].includes(String((sub as any)?.status || ''))
  const subPlan = subActive ? normalizePlan((sub as any).plan) : null
  const profPlan = (prof as any)?.plan_id ? normalizePlan((prof as any).plan_id) : null
  const plan = (subPlan && profPlan)
    ? (PLAN_ORDER.indexOf(subPlan) >= PLAN_ORDER.indexOf(profPlan) ? subPlan : profPlan)
    : (subPlan || profPlan || 'free')
  return {
    balance: wallet ? plan_credits + topup_credits : (prof?.credits_balance ?? 0),
    plan_credits, topup_credits,
    plan,
    reset_at: (wallet as any)?.plan_credits_reset_at ?? prof?.credits_reset_at ?? null,
    // Trial state — powers the "full credits unlock at trial end / pay now" messaging.
    trialing: realTrial,
    trial_ends_at: realTrial ? ((prof as any)?.trial_ends_at ?? null) : null,
  }
}

/** Look up an action's credit cost (for pre-action "this costs N credits" prompts). */
export async function getActionCost(admin: SupabaseClient, action: string): Promise<number | null> {
  const { data } = await admin
    .from('credit_pricing')
    .select('credits')
    .eq('action_type', action)
    .eq('is_active', true)
    .maybeSingle()
  return data?.credits ?? null
}

/**
 * Convenience wrapper: reserve → run → commit / refund. Use for endpoints that
 * don't need to stream partial progress. `run` receives the reserved txId so it
 * can stash it on a job row if needed.
 */
export async function withCredits<T>(
  admin: SupabaseClient, userId: string, action: string,
  run: (txId: string) => Promise<{ result: T; metadata?: Record<string, any> }>,
  refId?: string,
): Promise<T> {
  const tx = await reserveCredits(admin, userId, action, refId)
  try {
    const { result, metadata } = await run(tx.id)
    await commitCredits(admin, tx.id, metadata ?? {})
    return result
  } catch (e) {
    await refundCredits(admin, tx.id).catch(() => {})
    throw e
  }
}
