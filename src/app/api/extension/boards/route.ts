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

  return corsJson({
    boards: (boards || []).map((b: any) => ({
      id: b.id, name: b.name, emoji: b.emoji || '📋',
      visibility: b.visibility, isMine: b.created_by === userId,
    })),
  })
}
