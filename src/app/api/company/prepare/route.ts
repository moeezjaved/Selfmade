/**
 * POST /api/company/prepare — the coordinator's "prepare everything": Mello does the free prep across
 * departments (drafting customer replies) and returns what it prepared + what now needs the founder's
 * OK. Never spends money or credits — those stay behind explicit approval on the desk.
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { prepareEverything } from '@/lib/company/coordinator'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await prepareEverything(createAdminClient(), user.id)
  return NextResponse.json({ ok: true, ...result })
}
