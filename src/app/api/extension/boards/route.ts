/**
 * Boards for the extension popup's board picker. API-key (Bearer) authed. Returns the user's
 * personal boards + the team boards in their org, each with a save count — same visibility rules as
 * the web /api/discovery/boards, just keyed off the extension token instead of a session cookie.
 */
import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getUserOrg } from '@/lib/org'
import { userIdFromExtensionToken } from '@/lib/extension-auth'
import { corsJson, preflight } from '@/lib/cors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function OPTIONS() { return preflight() }

export async function GET(request: NextRequest) {
  const userId = await userIdFromExtensionToken(request)
  if (!userId) return corsJson({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any
  const org = await getUserOrg(admin, userId)

  // Team boards in the org + personal boards created by this user.
  const { data: boards } = await admin.from('discovery_boards')
    .select('id, name, emoji, visibility, created_by, org_id')
    .or(`and(org_id.eq.${org.orgId},visibility.eq.team),created_by.eq.${userId}`)
    .order('created_at', { ascending: false })

  // Collapse accidental same-named duplicate boards (e.g. "test-1" created 3×) so the picker isn't
  // cluttered with indistinguishable options. Ordered created_at desc → the first (newest) wins.
  const seenNames = new Set<string>()
  const deduped = (boards || []).filter((b: any) => {
    const key = String(b.name || '').trim().toLowerCase()
    if (seenNames.has(key)) return false
    seenNames.add(key)
    return true
  })

  return corsJson({
    boards: deduped.map((b: any) => ({
      id: b.id, name: b.name, emoji: b.emoji || '📋',
      visibility: b.visibility, isMine: b.created_by === userId,
    })),
  })
}
