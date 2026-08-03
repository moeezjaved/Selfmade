/**
 * GET /api/company/overview — the org, with each department's LIVE status computed from data we
 * already have (mello_tasks + learnings). This is the data layer for the company home screen (V3.1):
 * the org chart shows You → Mello → Marketing/Operations → departments, each with a status dot.
 *
 * Status, per live department:
 *   warning  — a recent failed task
 *   waiting  — a pending suggestion needing the founder
 *   working  — running now, or a learning in the last 48h
 *   finished — a task completed in the last 24h
 *   idle     — nothing lately
 * Non-live departments return 'hiring' (they appear on the chart and light up when their integration lands).
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { MELLO } from '@/lib/company/departments'
import { computeCompanyStatus } from '@/lib/company/status'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { departments } = await computeCompanyStatus(createAdminClient(), user.id)
  const waiting = departments.filter(d => d.status === 'waiting' || d.status === 'warning')
  return NextResponse.json({
    ceo: { name: (user.user_metadata as any)?.full_name || 'You', role: 'CEO' },
    chief: MELLO,
    departments,
    needsYou: waiting.length,
  })
}
