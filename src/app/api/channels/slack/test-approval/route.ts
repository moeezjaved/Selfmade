/**
 * Push a REAL budget-scale approval to the founder's Slack DM on demand — so you can see and tap the
 * upgraded card without waiting for the nightly audit. It reuses the same objects as the automatic flow:
 * an existing pending `meta_scale` mello_task → sendApprovalToChannels → your Slack. Approving it in Slack
 * runs the identical runTask/scaleCampaignBudget path the web app uses (it really does scale the budget).
 *
 * POST /api/channels/slack/test-approval  → { sent, task } | { error }
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendApprovalToChannels, getIdentities, isFounderChannel } from '@/lib/channels/send'

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  // Must have a linked founder Slack first — otherwise there's nowhere to send it.
  const founderSlack = (await getIdentities(admin, user.id, 'slack')).filter(isFounderChannel)
  if (!founderSlack.length || !founderSlack.some((i: any) => i.meta?.channel_id)) {
    return NextResponse.json({ error: 'no_slack', message: 'Connect Slack first: Selfmade → Settings → Slack & WhatsApp.' }, { status: 400 })
  }

  // Use a REAL pending scale suggestion the audit already produced (never fabricate a spend). Prefer the
  // freshest still-actionable one.
  const { data: task } = await admin.from('mello_tasks')
    .select('*')
    .eq('user_id', user.id).eq('kind', 'meta_scale').in('status', ['suggested', 'pending'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (!task) {
    return NextResponse.json({
      error: 'no_scale_task',
      message: 'No pending budget-scale suggestion right now. One appears after the nightly audit finds a winner worth scaling — or open /reports and the “Scale it” card seeds one.',
    }, { status: 404 })
  }

  const { sent } = await sendApprovalToChannels(admin, user.id, task)
  return NextResponse.json({ sent, task: { id: task.id, title: task.title, newBudget: task.evidence?.newBudget } })
}
