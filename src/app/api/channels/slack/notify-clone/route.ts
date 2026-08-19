/**
 * The video-clone worker calls this (server-to-server, shared secret) when a Slack-started clone reaches
 * a milestone, so Mello DMs the founder — completing the "tap in Slack → I'll ping you when it's ready"
 * loop. Slack posting + per-workspace token decryption stay HERE (never duplicated on the droplet).
 *
 * POST /api/channels/slack/notify-clone
 *   headers: x-autopilot-secret
 *   body: { asUserId, jobId, stage: 'review' | 'done' }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getIdentities, isFounderChannel } from '@/lib/channels/send'
import { slackPost } from '@/lib/channels/providers'
import { formatCloneReady } from '@/lib/channels/format'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-autopilot-secret')
  if (!secret || !process.env.AUTOPILOT_SECRET || secret !== process.env.AUTOPILOT_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const userId = String(body.asUserId || '')
  const jobId = String(body.jobId || '')
  const stage = body.stage === 'done' ? 'done' : 'review'
  if (!userId || !jobId) return NextResponse.json({ error: 'asUserId and jobId required' }, { status: 400 })

  const admin = createAdminClient() as any
  const { data: job } = await admin.from('creative_generations')
    .select('id, user_id, status, image_url, source_ad_id, clone_meta')
    .eq('id', jobId).eq('user_id', userId).maybeSingle()
  if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })
  // Only ping for clones that actually asked for it (started from Slack) — never surprise a web-only user.
  if (job.clone_meta?.notify_source !== 'slack') return NextResponse.json({ sent: 0, skipped: 'not_slack_sourced' })

  // Best-effort: label the DM with the competitor's page name.
  if (job.source_ad_id) {
    const { data: ad } = await admin.from('discovery_ads_index').select('page_name').eq('ad_id', job.source_ad_id).maybeSingle()
    if (ad?.page_name) (job as any).source_page_name = ad.page_name
  }

  const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
  const { text, slackBlocks } = formatCloneReady(job, stage, APP)
  const ids = (await getIdentities(admin, userId, 'slack')).filter(isFounderChannel)
  let sent = 0
  for (const id of ids) {
    const channel = id.meta?.channel_id
    if (!channel) continue
    let botToken: string | undefined
    try { botToken = id.meta?.bot_token ? decryptToken(id.meta.bot_token) : undefined } catch { botToken = undefined }
    const r = await slackPost(channel, text, slackBlocks, botToken)
    if (r.ok) sent++
  }
  return NextResponse.json({ sent })
}
