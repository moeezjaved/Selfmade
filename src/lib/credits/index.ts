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
  const { data, error } = await admin.rpc('reserve_credits', {
    p_user: userId, p_action: action, p_ref: refId ?? null,
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
  const { error } = await admin.rpc('grant_credits', { p_user: userId, p_credits: credits, p_ref: refId ?? null })
  if (error) throw new Error(error.message)
}

/** Current balance + plan + reset date (also lazily applies a due monthly reset). */
export async function getBalance(admin: SupabaseClient, userId: string) {
  await admin.rpc('ensure_monthly_reset', { p_user: userId })
  const { data } = await admin
    .from('user_profiles')
    .select('credits_balance, plan_id, credits_reset_at')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    balance: data?.credits_balance ?? 0,
    plan: data?.plan_id ?? 'trial',
    reset_at: data?.credits_reset_at ?? null,
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
