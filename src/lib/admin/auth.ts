import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'

export function verifyAdminRequest(request: NextRequest): boolean {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false
  return request.cookies.get('admin_token')?.value === token
}

/**
 * Admin API auth via the `admin_token` cookie — the SAME login the /admin/* pages
 * use (set by /api/admin/auth, gated by middleware). Cookie-based so it works in
 * any route handler, including param-less `GET()`.
 *
 * Admin data APIs historically required a Supabase *user* session — a separate
 * login — so the whole panel silently 401'd whenever that user session lapsed,
 * even though the operator was still authenticated as admin. Routes now OR this
 * in: `if (!user && !(await isAdminToken())) return 401`, keeping `user` available
 * for any path that needs it while no longer depending on a parallel session.
 */
export async function isAdminToken(): Promise<boolean> {
  const token = process.env.ADMIN_TOKEN
  if (!token) return false
  const jar = await cookies()
  return jar.get('admin_token')?.value === token
}
