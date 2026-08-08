/**
 * Slack inbound: button taps (approve/skip) + the /selfmade <code> link command + URL verification.
 * Signature-verified (like the Stripe webhook). A tap resolves the Slack user → linked account →
 * the pending task, then runs the SAME executor the web uses. No parallel path.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { slackVerify, slackUpdate, slackRespond, slackOpenDm, slackPost } from '@/lib/channels/providers'
import { redeemCode } from '@/lib/channels/link'
import { runTask } from '@/lib/mello/run-task'
import { decryptToken } from '@/lib/meta/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!slackVerify(raw, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'))) {
    return NextResponse.json({ error: 'bad signature' }, { status: 401 })
  }
  const ct = req.headers.get('content-type') || ''
  const admin = createAdminClient()

  // 1) Events API — URL verification + typed DMs to Mello (JSON body)
  if (ct.includes('application/json')) {
    const body = JSON.parse(raw || '{}')
    if (body.type === 'url_verification') return NextResponse.json({ challenge: body.challenge })

    if (body.type === 'event_callback') {
      // Ignore Slack retries so a slow answer doesn't post twice.
      if (req.headers.get('x-slack-retry-num')) return NextResponse.json({ ok: true })
      const ev = body.event || {}
      // Only plain user DMs (not the bot's own messages, edits, joins, etc.).
      if (ev.type === 'message' && !ev.bot_id && !ev.subtype && ev.channel_type === 'im' && ev.text) {
        const { data: identity } = await admin.from('channel_identities')
          .select('user_id, meta').eq('provider', 'slack').eq('external_id', ev.user).eq('active', true).maybeSingle()
        if (identity) {
          let botToken: string | undefined
          try { botToken = (identity as any).meta?.bot_token ? decryptToken((identity as any).meta.bot_token) : undefined } catch { botToken = undefined }
          // Rate-limit chat so a spammer can't run up the OpenAI bill (the web path already does this).
          const { isRateLimited } = await import('@/lib/rateLimit')
          if (await isRateLimited(identity.user_id)) { await slackPost(ev.channel, 'One moment — give me a few seconds and ask again.', undefined, botToken); return NextResponse.json({ ok: true }) }
          // Feed the Company Brain from the founder's Slack DMs (best-effort, non-blocking).
          try { const { brainIngest } = await import('@/lib/brain'); void brainIngest(admin, { userId: identity.user_id, source: 'slack', raw: ev.text }) } catch { /* best-effort */ }
          try {
            const { askMello } = await import('@/lib/mello/ask')
            const out = await askMello(admin, identity.user_id, ev.text)
            await slackPost(ev.channel, out.reply, undefined, botToken)
          } catch { await slackPost(ev.channel, 'I hit a snag — try me again in a moment.', undefined, botToken) }
        }
      }
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: true })
  }

  // Slack posts form-encoded for interactivity (payload=…) and slash commands (command=…).
  const params = new URLSearchParams(raw)

  // 2) Slash command: /selfmade SM-XXXXXX  → link this Slack user to the account
  if (params.get('command')) {
    const slackUserId = params.get('user_id') || ''
    const channelId = params.get('channel_id') || ''
    const text = params.get('text') || ''
    // Prefer a DM channel so approvals are private, not posted in a shared channel.
    const dm = await slackOpenDm(slackUserId)
    const uid = await redeemCode(admin, text, 'slack', slackUserId, { channel_id: dm || channelId, team_id: params.get('team_id') }, params.get('user_name') || undefined)
    return NextResponse.json({
      response_type: 'ephemeral',
      text: uid ? '✅ Connected. I’ll send your decisions and reports here — tap Approve and I act instantly.'
                : '⚠️ That code didn’t work. Generate a fresh one in Selfmade → Settings → Channels and try again (they expire in 15 min).',
    })
  }

  // 3) Interactivity: a button was tapped
  const payloadRaw = params.get('payload')
  if (!payloadRaw) return NextResponse.json({ ok: true })
  const payload = JSON.parse(payloadRaw)
  if (payload.type !== 'block_actions') return NextResponse.json({ ok: true })

  const action = payload.actions?.[0]
  const slackUserId = payload.user?.id
  const responseUrl = payload.response_url
  const channel = payload.channel?.id
  const ts = payload.message?.ts
  const taskId = action?.value

  // Resolve the Slack user → the linked account. No link → no action (security boundary).
  const { data: identity } = await admin.from('channel_identities')
    .select('user_id, meta').eq('provider', 'slack').eq('external_id', slackUserId).eq('active', true).maybeSingle()
  if (!identity) { await slackRespond(responseUrl, '⚠️ This Slack isn’t linked to a Selfmade account. Connect it from Selfmade → Settings.'); return NextResponse.json({ ok: true }) }
  const userId = identity.user_id
  let botToken: string | undefined
  try { botToken = (identity as any).meta?.bot_token ? decryptToken((identity as any).meta.bot_token) : undefined } catch { botToken = undefined }

  // Customer-message buttons (from a pushed inbox message) — approve/skip a customer reply from Slack.
  if (action.action_id === 'cust_approve' || action.action_id === 'cust_skip') {
    const messageId = String(taskId)
    if (action.action_id === 'cust_skip') {
      const { skipCustomerMessage } = await import('@/lib/customer/reply')
      await skipCustomerMessage(admin, userId, messageId)
      if (channel && ts) await slackUpdate(channel, ts, 'Skipped', [{ type: 'section', text: { type: 'mrkdwn', text: '_Skipped — I’ll leave it._' } }], botToken)
    } else {
      const { sendCustomerReply } = await import('@/lib/customer/reply')
      const r = await sendCustomerReply(admin, userId, messageId)
      if (channel && ts) await slackUpdate(channel, ts, r.note, [{ type: 'section', text: { type: 'mrkdwn', text: r.delivered ? '✅ *Replied* — sent to the customer.' : `⚠️ ${r.note}` } }], botToken)
    }
    return NextResponse.json({ ok: true })
  }

  const { data: task } = await admin.from('mello_tasks').select('*').eq('id', String(taskId)).eq('user_id', userId).maybeSingle()
  if (!task) { await slackRespond(responseUrl, '⚠️ I can’t find that task anymore — it may have expired.'); return NextResponse.json({ ok: true }) }

  if (action.action_id === 'skip') {
    await admin.from('mello_tasks').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', task.id)
    await admin.from('channel_messages').update({ status: 'skipped' }).eq('task_id', task.id).eq('provider', 'slack')
    if (channel && ts) await slackUpdate(channel, ts, `~${task.title}~  ·  skipped`, [{ type: 'section', text: { type: 'mrkdwn', text: `~*${task.title}*~\n_Skipped — I’ll leave it._` } }], botToken)
    return NextResponse.json({ ok: true })
  }

  if (action.action_id === 'approve') {
    if (task.status === 'done') { await slackRespond(responseUrl, '✅ Already done.'); return NextResponse.json({ ok: true }) }
    if (task.status === 'running') { await slackRespond(responseUrl, '⏳ Already working on it.'); return NextResponse.json({ ok: true }) }
    const { data: userRow } = await admin.auth.admin.getUserById(userId)
    const updated = await runTask(admin, { userId, email: userRow?.user?.email, source: 'slack' }, task)
    await admin.from('channel_messages').update({ status: updated.status === 'done' ? 'executed' : 'failed' }).eq('task_id', task.id).eq('provider', 'slack')
    const done = updated.status === 'done'
    const line = done
      ? `✅ *${task.title}*\n_Done.${updated.result?.newBudget ? ` Now at $${updated.result.newBudget}/day.` : ''} I’m watching it._`
      : `⚠️ *${task.title}*\n_${updated.error || 'That didn’t go through.'}${updated.needsApp ? ' Open it in the app to finish.' : ''}_`
    if (channel && ts) await slackUpdate(channel, ts, done ? `${task.title} · done` : `${task.title} · needs attention`, [{ type: 'section', text: { type: 'mrkdwn', text: line } }], botToken)
    else await slackRespond(responseUrl, line)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: true })
}
