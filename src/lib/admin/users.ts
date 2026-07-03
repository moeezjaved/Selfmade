/**
 * Reliable id → email lookup for admin pages.
 * PostgREST can't read the `auth` schema (`admin.schema('auth').from('users')` returns empty), so we
 * use the GoTrue admin API (listUsers) — the same surface as getUserById, which works. Paginated to
 * cover the whole user base; fine at our scale (a few pages of 1000).
 */
type AuthUser = { email: string; last_sign_in_at: string | null }

export async function getAuthUsers(admin: any): Promise<Map<string, AuthUser>> {
  const map = new Map<string, AuthUser>()
  try {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      const users = data?.users || []
      if (error || users.length === 0) break
      for (const u of users) map.set(u.id, { email: u.email || '', last_sign_in_at: u.last_sign_in_at || null })
      if (users.length < 1000) break
    }
  } catch { /* best-effort — callers fall back to id */ }
  return map
}
