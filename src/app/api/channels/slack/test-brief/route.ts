/**
 * Send yourself the Morning Brief on demand — the same composed DM the 06:00 cron sends, assembled from
 * the live brief intelligence (what changed → what I did → what needs you), with the top approval's real
 * button. Lets you see the flagship without waiting for tomorrow morning.
 *
 * POST /api/channels/slack/test-brief → { sent } | { error }
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getIdentities, isFounderChannel, sendReportToChannels } from '@/lib/channels/send'
import { assembleBrief } from '@/lib/brief/assemble'

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  const founderSlack = (await getIdentities(admin, user.id, 'slack')).filter(isFounderChannel)
  if (!founderSlack.length || !founderSlack.some((i: any) => i.meta?.channel_id)) {
    return NextResponse.json({ error: 'no_slack', message: 'Connect Slack first: Selfmade → Settings → Slack & WhatsApp.' }, { status: 400 })
  }

  try {
    const brief = await assembleBrief(admin, user.id, user.user_metadata || {}, {})
    const { sent, results } = await sendReportToChannels(admin, user.id, brief, {})
    return NextResponse.json({ sent, results })
  } catch (e: any) {
    return NextResponse.json({ error: 'compose_failed', message: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
