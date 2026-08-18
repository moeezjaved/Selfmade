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
    const { allOrgMemberIds } = await import('@/lib/org')
    const ids = await allOrgMemberIds(admin, userId).catch(() => [userId])
    const { data } = await admin.from('brands').select('id').in('user_id', ids).eq('id', raw).maybeSingle()
    return data ? String(raw) : null
  } catch { return null }
}
