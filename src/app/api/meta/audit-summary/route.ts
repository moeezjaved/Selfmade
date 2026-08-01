/**
 * GET /api/meta/audit-summary?accountId=<act_id>
 * Powers the Morning Brief's Facebook Ads card + its account switcher. Grades the chosen account from
 * the already-synced DB (fast, no Graph sync) and adds today's live account-level spend. No writes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { auditAccount } from '@/lib/meta/audit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const accountId = req.nextUrl.searchParams.get('accountId') || undefined
  const range = req.nextUrl.searchParams.get('range') || 'last_30d'
  try {
    const admin = createAdminClient()
    const r = await auditAccount(admin, user.id, accountId, range)
    return NextResponse.json(r || { accounts: [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed', accounts: [] }, { status: 200 })
  }
}
