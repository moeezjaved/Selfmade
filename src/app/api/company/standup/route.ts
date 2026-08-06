/**
 * GET /api/company/standup — the Morning Standup: one grounded line per department for today, plus the
 * queued approvals "Prepare everything" would surface. Read-only; nothing is executed here.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { assembleStandup } from '@/lib/company/standup'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const firstName = ((user.user_metadata as any)?.full_name || '').split(' ')[0] || null
  const brandId = req.nextUrl.searchParams.get('brand') || undefined
  const standup = await assembleStandup(createAdminClient(), user.id, firstName, brandId)
  return NextResponse.json(standup)
}
