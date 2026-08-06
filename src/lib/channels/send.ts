/**
 * Outbound: push an approval or a report to whatever channels the founder has linked, and record a
 * channel_messages row so an inbound reply/click can resolve back to the right task (and can't be
 * replayed). Identity ↔ channel lookups all go through the admin client (service-role tables).
 */
import { slackPost, whatsappSend } from '@/lib/channels/providers'
import { formatApproval, formatReport } from '@/lib/channels/format'
import { decryptToken } from '@/lib/meta/client'
import { computeCompanyStatus } from '@/lib/company/status'
import { runMetaAudit } from '@/lib/meta/audit'

/** The workspace bot token for this identity (OAuth installs store their own, encrypted); env fallback. */
const botTokenFor = (id: any): string | undefined => {
  try { return id?.meta?.bot_token ? decryptToken(id.meta.bot_token) : undefined } catch { return undefined }
}

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000   // a "yes" 2 days later shouldn't fire

export async function getIdentities(admin: any, userId: string, provider?: string) {
  let q = admin.from('channel_identities').select('*').eq('user_id', userId).eq('active', true)
  if (provider) q = q.eq('provider', provider)
  const { data } = await q
  return (data || []) as any[]
}

/** Send a pending task to the founder on every linked channel. Records one channel_messages per send. */
export async function sendApprovalToChannels(admin: any, userId: string, task: any): Promise<{ sent: number }> {
  // Founder comms only — approvals never go to a connected customer channel.
  const ids = (await getIdentities(admin, userId)).filter((i: any) => !i.meta?.customer_channel)
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
      const chatId = id.meta?.chat_id
      const toAttendee = chatId ? undefined : id.external_id
      const r = await whatsappSend({ chatId, toAttendee, text })
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

/** Send a read-only report (brief) to every linked channel. */
export async function sendReportToChannels(admin: any, userId: string, brief: any, opts: { brandId?: string | null; brandLabel?: string } = {}): Promise<{ sent: number }> {
  // Founder comms only — the brief must reach the founder's own Slack/WhatsApp, NEVER a connected
  // customer channel (a Unipile customer WhatsApp shares provider 'whatsapp').
  const ids = (await getIdentities(admin, userId)).filter((i: any) => !i.meta?.customer_channel)
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
  for (const id of ids) {
    if (id.provider === 'slack' && id.meta?.channel_id) {
      const r = await slackPost(id.meta.channel_id, 'Your brief', slackBlocks, botTokenFor(id))
      if (r.ok) {
        sent++
        await admin.from('channel_messages').insert({ user_id: userId, provider: 'slack', external_id: r.ts, channel_ref: id.meta.channel_id, kind: 'report', status: 'sent' })
        if (pending) await admin.from('channel_messages').insert({ user_id: userId, provider: 'slack', external_id: r.ts, channel_ref: id.meta.channel_id, kind: 'approval', task_id: pending.id, status: 'sent', expires_at }).then(() => {}, () => {})
      }
    } else if (id.provider === 'whatsapp') {
      const chatId = id.meta?.chat_id
      const r = await whatsappSend({ chatId, toAttendee: chatId ? undefined : id.external_id, text })
      if (r.ok) {
        sent++
        await admin.from('channel_messages').insert({ user_id: userId, provider: 'whatsapp', external_id: r.id, channel_ref: r.chatId || chatId, kind: 'report', status: 'sent' })
        if (pending) await admin.from('channel_messages').insert({ user_id: userId, provider: 'whatsapp', external_id: r.id, channel_ref: r.chatId || chatId, kind: 'approval', task_id: pending.id, status: 'sent', expires_at }).then(() => {}, () => {})
      }
    }
  }
  return { sent }
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
export async function pushCustomerMessage(admin: any, userId: string, m: { messageId: string; contactName?: string; channel: string; priority?: string; intent?: string; body: string; draft: string }): Promise<void> {
  const ids = await getIdentities(admin, userId)
  const founderChans = ids.filter((i: any) => (i.provider === 'slack' || i.provider === 'whatsapp') && !i.meta?.customer_channel)
  if (!founderChans.length) return
  const PRI: Record<string, string> = { high: '🔴 HIGH', med: '🟡 MEDIUM', low: '🟢 LOW' }
  const head = `💬 *New ${m.channel} message*${m.priority ? ` · ${PRI[m.priority] || m.priority}` : ''}${m.intent ? ` · ${m.intent}` : ''}`
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
    else if (id.provider === 'whatsapp') { const chatId = id.meta?.chat_id; await whatsappSend({ chatId, toAttendee: chatId ? undefined : id.external_id, text: `${bodyTxt}\n\nReply in Selfmade to send.` }).catch(() => {}) }
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
