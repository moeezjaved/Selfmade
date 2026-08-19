/**
 * Slack inbound: button taps (approve/skip) + the /selfmade <code> link command + URL verification.
 * Signature-verified (like the Stripe webhook). A tap resolves the Slack user → linked account →
 * the pending task, then runs the SAME executor the web uses. No parallel path.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { slackVerify, slackUpdate, slackRespond, slackOpenDm, slackPost, slackOpenView } from '@/lib/channels/providers'
import { redeemCode } from '@/lib/channels/link'
import { runTask } from '@/lib/mello/run-task'
import { decryptToken } from '@/lib/meta/client'
import { confirmMemory } from '@/lib/brain'
import { brainEditView } from '@/lib/channels/format'

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
            const out = await askMello(admin, identity.user_id, ev.text, { surface: 'slack' })
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

  // ── Modal submit: the Brain "Correct it" edit dialog. private_metadata carries {id, channel, ts}. ──
  if (payload.type === 'view_submission' && payload.view?.callback_id === 'brain_edit_save') {
    const su = payload.user?.id
    const { data: id2 } = await admin.from('channel_identities')
      .select('user_id, meta').eq('provider', 'slack').eq('external_id', su).eq('active', true).maybeSingle()
    if (id2) {
      let meta: any = {}; try { meta = JSON.parse(payload.view.private_metadata || '{}') } catch { /* */ }
      const newText = String(payload.view.state?.values?.content?.val?.value || '').trim()
      if (meta.id && newText) {
        // A correction is founder truth → store it and mark confirmed.
        await admin.from('mello_memory').update({ content: newText, status: 'confirmed' }).eq('id', meta.id).eq('user_id', id2.user_id)
        let bt: string | undefined; try { bt = (id2 as any).meta?.bot_token ? decryptToken((id2 as any).meta.bot_token) : undefined } catch { bt = undefined }
        if (meta.channel && meta.ts) await slackUpdate(meta.channel, meta.ts, 'Memory corrected', [{ type: 'section', text: { type: 'mrkdwn', text: `🧠 *Corrected & saved.*\n> ${newText}\n_I'll treat this as true from now on._` } }], bt)
      }
    }
    return NextResponse.json({ response_action: 'clear' })   // closes the modal
  }

  if (payload.type !== 'block_actions') return NextResponse.json({ ok: true })

  const action = payload.actions?.[0]
  const slackUserId = payload.user?.id
  const responseUrl = payload.response_url
  const channel = payload.channel?.id
  const ts = payload.message?.ts
  const triggerId = payload.trigger_id
  const taskId = action?.value

  // Resolve the Slack user → the linked account. No link → no action (security boundary).
  const { data: identity } = await admin.from('channel_identities')
    .select('user_id, meta').eq('provider', 'slack').eq('external_id', slackUserId).eq('active', true).maybeSingle()
  if (!identity) { await slackRespond(responseUrl, '⚠️ This Slack isn’t linked to a Selfmade account. Connect it from Selfmade → Settings.'); return NextResponse.json({ ok: true }) }
  const userId = identity.user_id
  let botToken: string | undefined
  try { botToken = (identity as any).meta?.bot_token ? decryptToken((identity as any).meta.bot_token) : undefined } catch { botToken = undefined }

  // ── Company Brain: confirm / correct / drop a proposed memory (value = mello_memory id). ──
  if (action.action_id === 'brain_confirm' || action.action_id === 'brain_reject') {
    const ok = await confirmMemory(admin, userId, String(taskId), action.action_id === 'brain_confirm' ? 'confirm' : 'reject')
    const line = action.action_id === 'brain_confirm'
      ? '🧠 *Locked in.* I’ll treat this as true — it’ll shape every brief, ad and rule from here.'
      : '🧠 _Dropped — I won’t remember that._'
    if (!ok) { await slackRespond(responseUrl, '⚠️ I can’t find that memory anymore.'); return NextResponse.json({ ok: true }) }
    if (channel && ts) await slackUpdate(channel, ts, 'Company Brain updated', [{ type: 'section', text: { type: 'mrkdwn', text: line } }], botToken)
    return NextResponse.json({ ok: true })
  }
  if (action.action_id === 'brain_edit') {
    const { data: mem } = await admin.from('mello_memory').select('id, content').eq('id', String(taskId)).eq('user_id', userId).maybeSingle()
    if (mem && triggerId) {
      const view = brainEditView(mem)
      view.private_metadata = JSON.stringify({ id: mem.id, channel, ts })   // so submit can update the card
      await slackOpenView(triggerId, view, botToken)
    }
    return NextResponse.json({ ok: true })
  }

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

  // ── Competitor "Make ours like this" (value = a discovery ad_id, NOT a task). Starts the REAL video
  //    clone as a DRAFT (status='analyzing' → worker → 'review') — charges nothing until the founder
  //    approves the storyboard. Swaps in the founder's own product photos. ──
  if (action.action_id === 'spy_remake') {
    const adId = String(taskId)
    // Pick a brand of the founder's that actually has product photos (Slack has no active-brand cookie;
    // a clone with no product to swap in is pointless).
    const { brandPoolUserIds } = await import('@/lib/org')
    const poolIds = await brandPoolUserIds(admin, userId).catch(() => [userId])
    const { data: brands } = await admin.from('brands').select('id, name, brand_type').in('user_id', poolIds).order('created_at', { ascending: false })
    let chosen: any = null, productImages: string[] = [], productType = 'product'
    for (const b of (brands || []) as any[]) {
      const { data: prods } = await admin.from('brand_products').select('image_urls').eq('brand_id', b.id)
      const imgs = (prods || []).flatMap((p: any) => Array.isArray(p.image_urls) ? p.image_urls : []).filter((s: any) => typeof s === 'string' && s.trim())
      if (imgs.length) { chosen = b; productImages = imgs.slice(0, 9); productType = b.brand_type || 'product'; break }
    }
    const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
    if (!chosen) {
      await slackRespond(responseUrl, `🎬 I can make our version — first add a product photo to a brand (<${APP}/brands|Brands>) so I can swap your product into the ad.`)
      return NextResponse.json({ ok: true })
    }
    let started = false
    try {
      const r = await fetch(`${APP}/api/discovery/clone-video`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-autopilot-secret': process.env.AUTOPILOT_SECRET || '' },
        body: JSON.stringify({ asUserId: userId, sourceAdId: adId, brandId: chosen.id, productImages, productType, characterLook: 'match' }),
      })
      started = r.ok
    } catch { started = false }
    const line = started
      ? `🎬 *On it — making our version of that ad.*\n_Cloning it for *${chosen.name}* with your product. A storyboard will be ready to review in <${APP}/studio|Studio> in a few minutes — nothing spends until you approve it._`
      : `⚠️ I couldn't start the remake here. Open it in <${APP}/discovery|Discovery> and hit *Remake ad*.`
    await slackRespond(responseUrl, line)
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
    // Rewrite the approval card into a receipt — the DM becomes a ledger (ask → decision → outcome).
    // Money moves note they're reversible for 24h and link the audit trail; failures say what to do next.
    const nb = updated.result?.newBudget
    const when = (() => { try { return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: process.env.BRIEF_TZ || 'Asia/Karachi' }).format(new Date()) } catch { return '' } })()
    const line = done
      ? `✅ *${task.title}* — done${nb ? ` · now at *$${nb}/day*` : ''}.\n_Approved via Slack${when ? ` at ${when}` : ''}.${nb ? ' Reversible for 24h — just say the word.' : ' I’m watching it.'}_`
      : `⚠️ *${task.title}*\n_${updated.error || 'That didn’t go through.'}${updated.needsApp ? ' Open it in the app to finish.' : ''}_`
    const receiptBlocks: any[] = [{ type: 'section', text: { type: 'mrkdwn', text: line } }]
    if (done) receiptBlocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '<https://tryselfmade.ai/reports|See it in the report> · <https://tryselfmade.ai/activity|activity log>' }] })
    if (channel && ts) await slackUpdate(channel, ts, done ? `${task.title} · done` : `${task.title} · needs attention`, receiptBlocks, botToken)
    else await slackRespond(responseUrl, line)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ ok: true })
}
