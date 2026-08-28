/**
 * The "current project" — one brand selected app-wide via the sidebar switcher, remembered in a cookie
 * so EVERY surface (brief, inbox, …) scopes to the same brand without its own picker. An explicit
 * `?brand=` on the URL always wins (deep links); otherwise the cookie decides. '' / null = All brands.
 * The chosen id is always validated against the user's own brands so a stale cookie can't scope to
 * someone else's brand (or a deleted one).
 */
import { cookies } from 'next/headers'
import { BRAND_COOKIE } from '@/lib/brand/cookie'

export { BRAND_COOKIE }

/** Read the raw cookie value (server components / route handlers). Empty string when unset. */
export async function readBrandCookie(): Promise<string> {
  try { return (await cookies()).get(BRAND_COOKIE)?.value || '' } catch { return '' }
}

/** Resolve the active brand id for this user: explicit param → cookie → null, validated against the
 *  ORG's brands (one shared workspace — a member can select the owner's brand, not just their own). */
export async function resolveActiveBrandId(admin: any, userId: string, explicit?: string | null): Promise<string | null> {
  const raw = (explicit || '') || (await readBrandCookie())
  if (!raw) return null
  try {
    const { brandPoolUserIds } = await import('@/lib/org')
    const ids = await brandPoolUserIds(admin, userId).catch(() => [userId])
    const { data } = await admin.from('brands').select('id').in('user_id', ids).eq('id', raw).maybeSingle()
    return data ? String(raw) : null
  } catch { return null }
}

/**
 * For ACTION surfaces (audits, content generation, publish, ad remake) — return the ONE brand to act on.
 *   • A brand is explicitly selected → that brand.
 *   • Nothing selected but the user owns exactly ONE brand → that brand (a solo user's switcher shows
 *     their single brand even without a cookie; auto-scoping keeps everything working for them).
 *   • Nothing selected AND the user has 2+ brands ("All brands") → { brandId: null, needsSelection: true }
 *     so the caller can prompt "pick a brand" INSTEAD of silently defaulting to the newest one.
 * This is the guard that stops "All brands" from running an audit / generating content for a random brand.
 */
export async function resolveBrandForAction(admin: any, userId: string, explicit?: string | null): Promise<{ brandId: string | null; needsSelection: boolean }> {
  const selected = await resolveActiveBrandId(admin, userId, explicit).catch(() => null)
  if (selected) return { brandId: selected, needsSelection: false }
  try {
    const { brandPoolUserIds } = await import('@/lib/org')
    const ids = await brandPoolUserIds(admin, userId).catch(() => [userId])
    const { data } = await admin.from('brands').select('id').in('user_id', ids).order('created_at', { ascending: true }).limit(2)
    const rows = (data || []) as { id: string }[]
    if (rows.length === 1) return { brandId: String(rows[0].id), needsSelection: false }
    return { brandId: null, needsSelection: rows.length > 1 }
  } catch { return { brandId: null, needsSelection: false } }
}
