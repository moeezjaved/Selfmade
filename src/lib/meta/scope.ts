/**
 * Org-scoped Meta ad-account access (Seats Stage 2).
 *
 * One shared workspace: a user should see every account connected by ANY member of their org
 * (not just their own), then narrowed to the accounts an owner/admin assigned them (default-all).
 * These helpers replace the old `meta_accounts … .eq('user_id', self)` pattern in user-facing routes
 * so members can actually use the org's connected accounts, bounded by their assignment.
 *
 * Do NOT use these for crawler-token lookups (admin/*, indexer) — those legitimately key on user_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { workspaceMemberIds, allowedAdAccountIds } from '@/lib/org'

/** The user_ids whose connected accounts form this user's visible pool: the members of their ONE
 *  workspace org (owner + real teammates). NOT a union across every org they were ever added to — that
 *  leaked ad accounts from stray/other orgs into the picker ("3 connected accounts I didn't add"). */
async function poolUserIds(admin: SupabaseClient, userId: string): Promise<string[]> {
  return workspaceMemberIds(admin, userId).catch(() => [userId])
}

/**
 * All Meta ad accounts this user may use, org-wide + scoped to their assignment.
 * Drop-in for `.from('meta_accounts').select('*').eq('user_id', self).eq('status','active')`.
 * Returns full rows, primary-first.
 */
export async function scopedMetaAccounts(admin: SupabaseClient, userId: string): Promise<any[]> {
  const userIds = await poolUserIds(admin, userId)
  const { data } = await (admin as any).from('meta_accounts')
    .select('*').in('user_id', userIds).eq('status', 'active').order('is_primary', { ascending: false })
  let rows = (data || []) as any[]
  const allowed = await allowedAdAccountIds(admin, userId)
  if (!allowed.all) rows = rows.filter(a => allowed.ids.includes(a.account_id))
  return rows
}

/**
 * Resolve ONE account the user is allowed to use. Pass an account_id to require that specific one
 * (returns null if not in scope); omit it to get the primary (or first) allowed account.
 * Replaces the `.eq('user_id', self).eq('account_id', X)` / `.eq('is_primary', true)` ownership checks.
 */
export async function resolveScopedAccount(admin: SupabaseClient, userId: string, accountId?: string | null): Promise<any | null> {
  const rows = await scopedMetaAccounts(admin, userId)
  if (accountId) return rows.find(a => a.account_id === accountId) ?? null
  return rows.find(a => a.is_primary) ?? rows[0] ?? null
}

/**
 * Resolve the Meta account for the user's ACTIVE BRAND (multi-brand founders connect a DIFFERENT
 * Facebook per brand — ROY 1 → Aura, Senayan City Mall → Hair ResQ). If the active brand has an
 * account linked (meta_accounts.brand_id, mig 142), use THAT account and its OWN token. Only when no
 * brand is active (All-brands view) or the brand has nothing linked do we fall back to the org-scoped
 * primary. Every write path (the whole M4 create flow) MUST use this — otherwise an image uploads to
 * Hair ResQ's account while the campaign is created on Aura's primary, and Meta returns "The related
 * resource does not exist". Mirrors what meta/audit-summary + meta/opportunities already do.
 */
export async function resolveBrandScopedAccount(admin: SupabaseClient, userId: string, explicitBrand?: string | null, opts?: { strict?: boolean }): Promise<any | null> {
  try {
    const { resolveActiveBrandId } = await import('@/lib/brand/active')
    const brandId = await resolveActiveBrandId(admin, userId, explicitBrand).catch(() => null)
    if (brandId) {
      const rows = await scopedMetaAccounts(admin, userId)
      const linked = rows.find(a => a.brand_id === brandId)
      if (linked) return linked
      // A brand IS active but has NOTHING linked. In strict mode (read/report surfaces like the
      // Campaigns page) return null so the UI shows an empty "connect an ad account for THIS brand"
      // state instead of silently borrowing another brand's account.
      if (opts?.strict) return null
      // Non-strict (write/seed): only borrow the primary when NO account is linked to ANY brand (pure
      // legacy single-account user). Once the user has linked accounts per brand, a brand with none must
      // NOT borrow another brand's account — that's the "one account shows under all brands" leak.
      if (rows.some(a => a.brand_id)) return null
    }
  } catch { /* fall through to primary */ }
  return resolveScopedAccount(admin, userId)
}
