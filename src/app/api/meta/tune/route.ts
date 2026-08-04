import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyTune } from '@/lib/meta/tune'

/**
 * POST /api/meta/tune { metaCampaignId, apply, newDailyBudget } — founder-confirmed "Target them" /
 * "Review placements" from the brief. Thin wrapper over applyTune (shared with the task runner, so a
 * Slack/WhatsApp approve does the identical safe duplicate-and-tune). Never auto-runs.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const r = await applyTune(createAdminClient(), user.id, { metaCampaignId: body.metaCampaignId, apply: body.apply, newDailyBudget: body.newDailyBudget })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, campaign: r.campaign, newCampaign: r.newCampaign, newDailyBudget: r.newDailyBudget, apply: r.apply })
}
