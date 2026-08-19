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

  // Use a REAL pending scale suggestion (never fabricate a spend). Prefer the freshest still-actionable one.
  const pending = async () => (await admin.from('mello_tasks')
    .select('*')
    .eq('user_id', user.id).eq('kind', 'meta_scale').in('status', ['suggested', 'pending'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()).data

  let task = await pending()

  // None persisted? The “Scale it” cards on /reports are computed live and only become a task on click —
  // so run the SAME audit the nightly job runs (it upserts a meta_scale task for a real winner), then
  // re-read. This makes the founder actually receive the card instead of a "nothing to send" dead end.
  if (!task) {
    try {
      const { runMetaAudit } = await import('@/lib/meta/audit')
      await runMetaAudit(admin, user.id, { syncFirst: true })
      task = await pending()
    } catch (e: any) {
      return NextResponse.json({ error: 'audit_failed', message: `Couldn't check your campaigns: ${String(e?.message || e).slice(0, 140)}` }, { status: 500 })
    }
  }

  if (!task) {
    return NextResponse.json({
      error: 'no_scale_task',
      message: 'I checked your live campaigns and none is a clear winner worth scaling right now (needs strong ROAS + room to grow). Nothing sent — I only push a real move.',
    }, { status: 404 })
  }

  const { sent } = await sendApprovalToChannels(admin, user.id, task)
  return NextResponse.json({ sent, task: { id: task.id, title: task.title, newBudget: task.evidence?.newBudget } })
}
