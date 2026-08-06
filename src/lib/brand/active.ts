/**
 * The "current project" — one brand selected app-wide via the sidebar switcher, remembered in a cookie
 * so EVERY surface (brief, inbox, …) scopes to the same brand without its own picker. An explicit
 * `?brand=` on the URL always wins (deep links); otherwise the cookie decides. '' / null = All brands.
 * The chosen id is always validated against the user's own brands so a stale cookie can't scope to
 * someone else's brand (or a deleted one).
 */
import { cookies } from 'next/headers'

export const BRAND_COOKIE = 'sf_brand'

/** Read the raw cookie value (server components / route handlers). Empty string when unset. */
export async function readBrandCookie(): Promise<string> {
  try { return (await cookies()).get(BRAND_COOKIE)?.value || '' } catch { return '' }
}

/** Resolve the active brand id for this user: explicit param → cookie → null, validated for ownership. */
export async function resolveActiveBrandId(admin: any, userId: string, explicit?: string | null): Promise<string | null> {
  const raw = (explicit || '') || (await readBrandCookie())
  if (!raw) return null
  try {
    const { data } = await admin.from('brands').select('id').eq('user_id', userId).eq('id', raw).maybeSingle()
    return data ? String(raw) : null
  } catch { return null }
}
