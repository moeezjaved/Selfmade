/**
 * POST /api/brain/reflect — the Company Brain's reflection loop (on-demand, "look for patterns").
 * Diffs what happened (learnings + customer signals) against what the founder believes (DNA) and
 * PROPOSES rule updates as inactive company_dna rows — they never take effect until approved.
 * Logic lives in src/lib/brain/reflect.ts so the nightly cron shares it exactly.
 *
 * Auth: cookie (Brain UI) OR Bearer CRON_SECRET + { userId } (nightly).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { runReflection } from '@/lib/brain/reflect'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const admin = createAdminClient()
  let userId: string | null = null
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) userId = user.id
  else if (process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`) {
    const b = await req.json().catch(() => ({})); userId = b.userId ? String(b.userId) : null
  }
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const res = await runReflection(admin, userId)
  return NextResponse.json(res)
}
