/**
 * Outbound: push an approval or a report to whatever channels the founder has linked, and record a
 * channel_messages row so an inbound reply/click can resolve back to the right task (and can't be
 * replayed). Identity ↔ channel lookups all go through the admin client (service-role tables).
 */
import { slackPost, whatsappSend, whatsappSelfTarget } from '@/lib/channels/providers'
import { formatApproval, formatReport } from '@/lib/channels/format'
import { decryptToken } from '@/lib/meta/client'
import { computeCompanyStatus } from '@/lib/company/status'
import { runMetaAudit } from '@/lib/meta/audit'

/** The workspace bot token for this identity (OAuth installs store their own, encrypted); env fallback. */
const botTokenFor = (id: any): string | undefined => {
  try { return id?.meta?.bot_token ? decryptToken(id.meta.bot_token) : undefined } catch { return undefined }
}

/**
 * WhatsApp send args for a founder identity.
 *
 * Two delivery models, auto-selected:
 *  1. DEDICATED SENDER (preferred) — when UNIPILE_WHATSAPP_ACCOUNT_ID is set to a Selfmade-owned line
 *     that is NOT the founder's own number, send FROM that line TO the founder's number. It arrives as
 *     an INCOMING message → the founder's phone actually notifies.
 *  2. QR SELF-SEND (fallback) — no dedicated sender: send FROM the founder's own connected account into
 *     their "Message yourself" chat. Delivers, but WhatsApp never notifies you of your own messages.
 *
 * Either way we resolve + cache the founder's own number (self_target) so we don't re-hit Unipile.
 */
async function waSendArgs(admin: any, userId: string, id: any): Promise<{ chatId?: string; toAttendee?: string; accountId?: string }> {
  const ownAccount = id.meta?.unipile_account_id || id.external_id
  // The founder's OWN WhatsApp number — recipient of the ping (model 1) or the self-chat target (model 2).
  let founderNum: string | undefined = id.meta?.self_target || (ownAccount ? (await whatsappSelfTarget(ownAccount)) || undefined : undefined)
  if (founderNum && founderNum !== id.meta?.self_target) {
    await admin.from('channel_identities').update({ meta: { ...(id.meta || {}), self_target: founderNum } })
      .eq('user_id', userId).eq('provider', 'whatsapp').eq('external_id', id.external_id).then(() => {}, () => {})
  }

  // Model 1: dedicated Selfmade sender line, distinct from the founder's own number → notifying DM.
  // Start the chat by the founder's number (attendees_ids); Unipile reuses the existing thread.
  const sender = process.env.UNIPILE_WHATSAPP_ACCOUNT_ID
  if (sender && sender !== ownAccount && founderNum) {
    return { toAttendee: founderNum, accountId: sender }
  }

  // Model 2: QR self-send fallback (silent, but delivers).
  const chatId = id.meta?.chat_id
  if (chatId) return { chatId, accountId: ownAccount }
  return { toAttendee: founderNum, accountId: ownAccount }
}

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000   // a "yes" 2 days later shouldn't fire

// Founder briefs/approvals/pings go to SLACK ONLY by default. A shared WhatsApp sender loops too easily
// (see the self-reply incident) and WhatsApp never notifies a self-send anyway. Set FOUNDER_WHATSAPP=1 to
// opt WhatsApp founder-delivery back in. This flag governs ONLY founder-directed sends — it does NOT touch
// customer WhatsApp: inbound (webhook → inbox) and founder-initiated customer replies keep working.
const FOUNDER_WHATSAPP = process.env.FOUNDER_WHATSAPP === '1' || process.env.FOUNDER_WHATSAPP === 'true'

/** Which of the founder's linked identities should a founder message (brief/approval/ping) go to? */
export function isFounderChannel(i: any): boolean {
  if (i.provider === 'slack') return i.meta?.customer_channel !== true   // founder Slack, never a customer Slack
  if (i.provider === 'whatsapp') return FOUNDER_WHATSAPP && i.meta?.founder_tool === true   // off unless opted in
  return false
}

export async function getIdentities(admin: any, userId: string, provider?: string) {
  let q = admin.from('channel_identities').select('*').eq('user_id', userId).eq('active', true)
  if (provider) q = q.eq('provider', provider)
  const { data } = await q
  return (data || []) as any[]
}

/** Send a pending task to the founder on every linked channel. Records one channel_messages per send. */
export async function sendApprovalToChannels(admin: any, userId: string, task: any): Promise<{ sent: number }> {
  // Founder comms ONLY — key on the founder_tool flag, NOT the provider. A customer WhatsApp (Aura's
  // inbox line) is also provider 'whatsapp', so the old `provider === 'whatsapp'` filter made customer
  // lines self-notify with founder approvals. Founder channels = founder_tool WhatsApp + founder Slack.
  const ids = (await getIdentities(admin, userId)).filter(isFounderChannel)
  if (!ids.length) return { sent: 0 }
  const { text, slackBlocks } = formatApproval(task)
  const expires_at = new Date(Date.now() + APPROVAL_TTL_MS).toISOString()
  let sent = 0

  for (const id of ids) {
    if (id.provider === 'slack') {
      const channel = id.meta?.channel_id
      if (!channel) continue
      const r = await slackPost(channel, `Decision: ${task.title}`, slackBlocks, botTokenFor(id))
      if (r.ok) {
        sent++
        await admin.from('channel_messages').insert({
          user_id: userId, provider: 'slack', external_id: r.ts, channel_ref: channel,
          kind: 'approval', task_id: task.id, status: 'sent', expires_at,
        })
      }
    } else if (id.provider === 'whatsapp') {
      const wa = await waSendArgs(admin, userId, id)
      const chatId = wa.chatId
      const r = await whatsappSend({ ...wa, text })
      if (r.ok) {
        sent++
        // Remember the chat so future replies land in-thread.
        if (r.chatId && r.chatId !== chatId) {
          await admin.from('channel_identities').update({ meta: { ...(id.meta || {}), chat_id: r.chatId }, updated_at: new Date().toISOString() }).eq('id', id.id)
        }
        await admin.from('channel_messages').insert({
          user_id: userId, provider: 'whatsapp', external_id: r.id, channel_ref: r.chatId || chatId,
          kind: 'approval', task_id: task.id, status: 'sent', expires_at,
        })
      }
    }
  }
  return { sent }
}

/**
 * Push a PROPOSED Company Brain fact to the founder's Slack for confirmation. The brain buttons
 * (brain_confirm / brain_edit / brain_reject) carry the mello_memory id, and the interactivity handler
 * calls confirmMemory() — the same confirm/reject path the web uses. Slack-only (the confirm card is
 * button-native); WhatsApp founders get nothing here, keeping their line for urgent one-liners.
 */
export async function sendBrainProposalToChannels(admin: any, userId: string, memory: any): Promise<{ sent: number }> {
  const { formatBrainProposal } = await import('@/lib/channels/format')
  const ids = (await getIdentities(admin, userId, 'slack')).filter(isFounderChannel)
  if (!ids.length) return { sent: 0 }
  const { text, slackBlocks } = formatBrainProposal(memory)
  const expires_at = new Date(Date.now() + APPROVAL_TTL_MS).toISOString()
  let sent = 0
  for (const id of ids) {
    const channel = id.meta?.channel_id
    if (!channel) continue
    const r = await slackPost(channel, text, slackBlocks, botTokenFor(id))
    if (r.ok) {
      sent++
      await admin.from('channel_messages').insert({
        user_id: userId, provider: 'slack', external_id: r.ts, channel_ref: channel,
        kind: 'brain_proposal', task_id: null, status: 'sent', expires_at,
      }).then(() => {}, () => {})
    }
  }
  return { sent }
}

/**
 * Push a competitor ad worth answering to the founder's Slack, as the Analyst. "Make ours like this"
 * (spy_remake) starts the real video clone. Slack-only (image accessory + button-native).
 */
export async function sendCompetitorAdToChannels(admin: any, userId: string, ad: any): Promise<{ sent: number }> {
  const { formatCompetitorAd } = await import('@/lib/channels/format')
  const ids = (await getIdentities(admin, userId, 'slack')).filter(isFounderChannel)
  if (!ids.length) return { sent: 0 }
  const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
  const { text, slackBlocks } = formatCompetitorAd(ad, APP)
  let sent = 0
  for (const id of ids) {
    const channel = id.meta?.channel_id
    if (!channel) continue
    // Post as the Analyst (per-message byline on the one app).
    const r = await slackPost(channel, text, slackBlocks, botTokenFor(id))
    if (r.ok) sent++
  }
  return { sent }
}

/** Push a finished creative to the founder's Slack with a launch deep-link. Slack-only. */
export async function sendCreativeReadyToChannels(admin: any, userId: string, gen: any): Promise<{ sent: number }> {
  const { formatCreativeReady } = await import('@/lib/channels/format')
  const ids = (await getIdentities(admin, userId, 'slack')).filter(isFounderChannel)
  if (!ids.length) return { sent: 0 }
  const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
  const { text, slackBlocks } = formatCreativeReady(gen, APP)
  let sent = 0
  for (const id of ids) {
    const channel = id.meta?.channel_id
    if (!channel) continue
    const r = await slackPost(channel, text, slackBlocks, botTokenFor(id))
    if (r.ok) sent++
  }
  return { sent }
}

/** Push a customer-conversation trend to the founder's Slack (Support Lead). Slack-only. */
export async function sendCustomerTrendToChannels(admin: any, userId: string, trend: { intent: string; count: number; ratio?: number; quote?: string }): Promise<{ sent: number }> {
  const { formatCustomerTrend } = await import('@/lib/channels/format')
  const ids = (await getIdentities(admin, userId, 'slack')).filter(isFounderChannel)
  if (!ids.length) return { sent: 0 }
  const APP = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://www.tryselfmade.ai').replace(/\/$/, '')
  const { text, slackBlocks } = formatCustomerTrend(trend, APP)
  let sent = 0
  for (const id of ids) {
    const channel = id.meta?.channel_id
    if (!channel) continue
    const r = await slackPost(channel, text, slackBlocks, botTokenFor(id))
    if (r.ok) sent++
  }
  return { sent }
}

/** Send a read-only report (brief) to every linked channel. */
export async function sendReportToChannels(admin: any, userId: string, brief: any, opts: { brandId?: string | null; brandLabel?: string } = {}): Promise<{ sent: number; results?: Array<{ provider: string; kind?: string; ok: boolean; error?: string }> }> {
  // Founder comms ONLY — the brief must reach the founder's own Slack/WhatsApp (founder_tool), NEVER a
  // connected CUSTOMER channel. A customer WhatsApp (Aura's inbox line) shares provider 'whatsapp', so we
  // key on the founder_tool flag, not the provider — otherwise Hair ResQ's brief leaked to Aura's customers.
  const ids = (await getIdentities(admin, userId)).filter(isFounderChannel)
  if (!ids.length) return { sent: 0 }
  // Ground the report in the SAME live account state the brief shows: the brief computes moves on
  // page-load (fetchLiveOpportunities) but writes nothing, while tasks are only written by the audit.
  // Running the audit here (idempotent, week-keyed upserts) closes that gap so the report's decision
  // matches "What Mello would do" instead of saying "nothing needs you" while the brief has moves.
  try { await runMetaAudit(admin, userId) } catch { /* report still sends without a fresh audit */ }
  // The overnight-shift report is grounded in the live company status + the top pending decision.
  const { departments, tasks } = await computeCompanyStatus(admin, userId, opts.brandId)
  const pending = (tasks as any[]).find(t => t.status === 'suggested') || null
  let { text, slackBlocks } = formatReport(brief, departments, pending)
  // Per-brand delivery: label which brand this section is about (founders running multiple brands).
  if (opts.brandLabel) {
    text = `— ${opts.brandLabel} —\n${text}`
    slackBlocks = [{ type: 'context', elements: [{ type: 'mrkdwn', text: `*${opts.brandLabel}*` }] }, ...(Array.isArray(slackBlocks) ? slackBlocks : [])]
  }
  // The report renders the top decision WITH its Approve button, so it counts as delivering that
  // approval — record it so pushNewApprovals doesn't then send the same task again as a lone card.
  const expires_at = new Date(Date.now() + APPROVAL_TTL_MS).toISOString()
  let sent = 0
  const results: Array<{ provider: string; kind?: string; ok: boolean; error?: string }> = []
  for (const id of ids) {
    if (id.provider === 'slack' && id.meta?.channel_id) {
      const r = await slackPost(id.meta.channel_id, 'Your brief', slackBlocks, botTokenFor(id))
      results.push({ provider: 'slack', ok: !!r.ok, error: r.ok ? undefined : (r.error || 'slack send failed'), channel: id.meta.channel_id, team: id.meta?.team_id || null, ts: r.ts || null } as any)
      if (r.ok) {
        sent++
        await admin.from('channel_messages').insert({ user_id: userId, provider: 'slack', external_id: r.ts, channel_ref: id.meta.channel_id, kind: 'report', status: 'sent' })
        if (pending) await admin.from('channel_messages').insert({ user_id: userId, provider: 'slack', external_id: r.ts, channel_ref: id.meta.channel_id, kind: 'approval', task_id: pending.id, status: 'sent', expires_at }).then(() => {}, () => {})
      }
    } else if (id.provider === 'slack') {
      results.push({ provider: 'slack', ok: false, error: 'no channel_id (re-add Slack)' })
    } else if (id.provider === 'whatsapp') {
      // QR model: send FROM the founder's own account into their "Message yourself" chat (see waSendArgs).
      const wa = await waSendArgs(admin, userId, id)
      const chatId = wa.chatId
      const r = await whatsappSend({ ...wa, text })
      results.push({ provider: 'whatsapp', kind: id.meta?.founder_tool ? 'founder' : (id.meta?.customer_channel ? 'customer' : '?'), ok: !!r.ok, error: r.ok ? undefined : (r.error || 'whatsapp send failed'), sentTo: wa.chatId ? `chat:${wa.chatId}` : (wa.toAttendee ? `num:${wa.toAttendee}` : 'unresolved'), msgId: r.id || null, resChat: r.chatId || null } as any)
      if (r.ok) {
        sent++
        await admin.from('channel_messages').insert({ user_id: userId, provider: 'whatsapp', external_id: r.id, channel_ref: r.chatId || chatId, kind: 'report', status: 'sent' })
        if (pending) await admin.from('channel_messages').insert({ user_id: userId, provider: 'whatsapp', external_id: r.id, channel_ref: r.chatId || chatId, kind: 'approval', task_id: pending.id, status: 'sent', expires_at }).then(() => {}, () => {})
      }
    }
  }
  return { sent, results }
}

/**
 * Auto-push: send any PENDING task that hasn't already been pushed to a channel. Called after the
 * nightly audit so Approve cards appear in Slack/WhatsApp on their own. Deduped by channel_messages
 * (a task already sent as an approval is never re-sent), and a no-op for users with no linked channel.
 */
export async function pushNewApprovals(admin: any, userId: string): Promise<{ pushed: number }> {
  const { data: tasks } = await admin.from('mello_tasks').select('*')
    .eq('user_id', userId).eq('status', 'suggested').order('created_at', { ascending: false }).limit(10)
  if (!tasks?.length) return { pushed: 0 }
  const ids = (tasks as any[]).map(t => t.id)
  const { data: sent } = await admin.from('channel_messages').select('task_id').eq('kind', 'approval').in('task_id', ids)
  const already = new Set((sent || []).map((m: any) => m.task_id))
  let pushed = 0
  for (const t of tasks as any[]) {
    if (already.has(t.id)) continue
    const r = await sendApprovalToChannels(admin, userId, t)
    if (r.sent > 0) pushed++
  }
  return { pushed }
}

/** Push a new customer message to the founder's Slack (+ WhatsApp) with Approve/Skip buttons, so they can
 *  handle it from chat. Only fires for the founder's OWN comms channels (never a connected customer one). */
export async function pushCustomerMessage(admin: any, userId: string, m: { messageId: string; contactName?: string; channel: string; priority?: string; intent?: string; body: string; draft: string; brandLabel?: string }): Promise<void> {
  const ids = await getIdentities(admin, userId)
  // Founder_tool flag ONLY — a customer WhatsApp (Aura's inbox line) is also provider 'whatsapp', so the
  // old `provider === 'whatsapp'` filter made the customer line notify ITSELF about its own incoming
  // messages ("Message yourself"). Notify the founder's line (17828220679) / founder Slack, never a customer one.
  const founderChans = ids.filter(isFounderChannel)
  if (!founderChans.length) return
  const PRI: Record<string, string> = { high: '🔴 HIGH', med: '🟡 MEDIUM', low: '🟢 LOW' }
  // One founder line covers every brand → always lead with the brand so "which brand?" is never ambiguous.
  const head = `${m.brandLabel ? `🏷️ *${m.brandLabel}* · ` : ''}💬 *New ${m.channel} message*${m.priority ? ` · ${PRI[m.priority] || m.priority}` : ''}${m.intent ? ` · ${m.intent}` : ''}`
  const bodyTxt = `${head}\n*From ${m.contactName || 'a customer'}:*\n> ${m.body}\n\n*Mello's draft:*\n_${m.draft}_`
  const slackBlocks = [
    { type: 'section', text: { type: 'mrkdwn', text: bodyTxt } },
    { type: 'actions', block_id: `cust_${m.messageId}`, elements: [
      { type: 'button', action_id: 'cust_approve', style: 'primary', text: { type: 'plain_text', text: 'Approve & send' }, value: m.messageId },
      { type: 'button', action_id: 'cust_skip', text: { type: 'plain_text', text: 'Skip' }, value: m.messageId },
    ] },
  ]
  for (const id of founderChans) {
    if (id.provider === 'slack' && id.meta?.channel_id) await slackPost(id.meta.channel_id, `New ${m.channel} message`, slackBlocks, botTokenFor(id)).catch(() => {})
    else if (id.provider === 'whatsapp') { const wa = await waSendArgs(admin, userId, id); await whatsappSend({ ...wa, text: `${bodyTxt}\n\nReply in Selfmade to send.` }).catch(() => {}) }
  }
}

/** The most recent still-open approval for this user on a channel — what a free-text "yes" resolves to. */
export async function latestOpenApproval(admin: any, userId: string, provider: string) {
  const { data } = await admin.from('channel_messages')
    .select('*').eq('user_id', userId).eq('provider', provider).eq('kind', 'approval').eq('status', 'sent')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return null
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    await admin.from('channel_messages').update({ status: 'expired' }).eq('id', data.id)
    return null
  }
  return data
}
