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
        body: JSON.stringify({ asUserId: userId, sourceAdId: adId, brandId: chosen.id, productImages, productType, characterLook: 'match', notifySlack: true }),
      })
      started = r.ok
    } catch { started = false }
    const line = started
      ? `🎬 *On it — making our version of that ad.*\n_Cloning it for *${chosen.name}* with your product. A storyboard will be ready to review in <${APP}/studio|Studio> in a few minutes — nothing spends until you approve it._`
      : `⚠️ I couldn't start the remake here. Open it in <${APP}/discovery|Discovery> and hit *Remake ad*.`
    await slackRespond(responseUrl, line)
    return NextResponse.json({ ok: true })
  }

  // ── Customer trend: "Draft replies for all N" (value carries the topic, e.g. trend_shipping_37).
  //    Surfaces the replies already drafted at ingest for one-tap sending in the inbox — never sends
  //    from Slack (the inbox's "nothing sends on its own" rule). ──
  if (action.action_id === 'draft_replies') {
    const INTENTS = ['shipping', 'refund', 'price', 'complaint', 'question', 'other']
    const intent = INTENTS.find(k => String(taskId).includes(k)) || 'shipping'
    const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
    const { count } = await admin.from('customer_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('intent', intent).eq('direction', 'in').eq('status', 'pending')
    const n = count || 0
    const line = n
      ? `✍️ *${n} ${intent} repl${n === 1 ? 'y is' : 'ies are'} drafted and waiting.* Review and send each with one tap in your inbox — nothing sends on its own. <${APP}/inbox|Open the inbox →>`
      : `Your ${intent} messages are already handled — nothing waiting. <${APP}/inbox|Open the inbox →>`
    await slackRespond(responseUrl, line)
    return NextResponse.json({ ok: true })
  }

  // ── Customer trend: "Change promise to 3–7 days" (value = "3-7"). Writes the fact into the Company
  //    Brain (DNA) so every future reply + brief uses it. ──
  if (action.action_id === 'update_shipping_promise') {
    const val = String(action.value || '3-7').replace(/[^0-9-]/g, '') || '3-7'
    const pretty = val.replace('-', '–')
    const { brandPoolUserIds } = await import('@/lib/org')
    const poolIds = await brandPoolUserIds(admin, userId).catch(() => [userId])
    const { data: brand } = await admin.from('brands').select('id, name').in('user_id', poolIds).order('created_at', { ascending: false }).limit(1).maybeSingle()
    try {
      const { teachRule } = await import('@/lib/brain')
      await teachRule(admin, { userId, brandId: brand?.id || null, rule: `Shipping promise: we deliver in ${pretty} days — tell customers this timeframe.`, department: 'customer', source: 'slack' })
      await slackRespond(responseUrl, `✅ *Done — I'll promise ${pretty} days from now on.*${brand?.name ? ` (for ${brand.name})` : ''} It's in the Company Brain, so every customer reply and brief uses it.`)
    } catch (e: any) {
      await slackRespond(responseUrl, `⚠️ Couldn't save that just now — ${String(e?.message || e).slice(0, 100)}`)
    }
    return NextResponse.json({ ok: true })
  }

  // ── Creative launch (value = a creative_generations id). Launching is REAL ad spend on the founder's
  //    Meta account, so we never fire it blind: hand back a deep-link into the launcher, preloaded with
  //    the creative, where the founder sets a budget and confirms. M4's ?img= preload never auto-launches. ──
  if (action.action_id === 'creative_launch') {
    const genId = String(taskId)
    const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
    const { data: gen } = await admin.from('creative_generations')
      .select('id, image_url, media_type, status').eq('id', genId).eq('user_id', userId).maybeSingle()
    if (!gen || gen.status !== 'done' || !gen.image_url) {
      await slackRespond(responseUrl, "That creative isn't ready to launch yet — give it a moment, then try again.")
      return NextResponse.json({ ok: true })
    }
    const isVideo = gen.media_type === 'video'
    const url = isVideo ? `${APP}/studio` : `${APP}/m4?img=${encodeURIComponent(gen.image_url)}`
    await slackRespond(responseUrl, `🚀 Ready to launch`, [
      { type: 'section', text: { type: 'mrkdwn', text: `🚀 *Let's get this ${isVideo ? 'video ' : ''}ad live.*\nI'll open the launcher with it loaded — you set the budget and confirm. Nothing spends until you do.` } },
      { type: 'actions', elements: [{ type: 'button', style: 'primary', action_id: 'open_launcher', text: { type: 'plain_text', text: 'Set budget & launch →' }, url }] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Real Meta ad spend · nothing goes live until you set a budget and confirm in the launcher' }] },
    ])
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
