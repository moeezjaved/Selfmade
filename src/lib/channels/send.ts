/**
 * Outbound: push an approval or a report to whatever channels the founder has linked, and record a
 * channel_messages row so an inbound reply/click can resolve back to the right task (and can't be
 * replayed). Identity ↔ channel lookups all go through the admin client (service-role tables).
 */
import { slackPost, whatsappSend } from '@/lib/channels/providers'
import { formatApproval, formatReport } from '@/lib/channels/format'

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000   // a "yes" 2 days later shouldn't fire

export async function getIdentities(admin: any, userId: string, provider?: string) {
  let q = admin.from('channel_identities').select('*').eq('user_id', userId).eq('active', true)
  if (provider) q = q.eq('provider', provider)
  const { data } = await q
  return (data || []) as any[]
}

/** Send a pending task to the founder on every linked channel. Records one channel_messages per send. */
export async function sendApprovalToChannels(admin: any, userId: string, task: any): Promise<{ sent: number }> {
  const ids = await getIdentities(admin, userId)
  if (!ids.length) return { sent: 0 }
  const { text, slackBlocks } = formatApproval(task)
  const expires_at = new Date(Date.now() + APPROVAL_TTL_MS).toISOString()
  let sent = 0

  for (const id of ids) {
    if (id.provider === 'slack') {
      const channel = id.meta?.channel_id
      if (!channel) continue
      const r = await slackPost(channel, `Decision: ${task.title}`, slackBlocks)
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
export async function sendReportToChannels(admin: any, userId: string, brief: any): Promise<{ sent: number }> {
  const ids = await getIdentities(admin, userId)
  if (!ids.length) return { sent: 0 }
  const { text, slackBlocks } = formatReport(brief)
  let sent = 0
  for (const id of ids) {
    if (id.provider === 'slack' && id.meta?.channel_id) {
      const r = await slackPost(id.meta.channel_id, 'Your brief', slackBlocks)
      if (r.ok) { sent++; await admin.from('channel_messages').insert({ user_id: userId, provider: 'slack', external_id: r.ts, channel_ref: id.meta.channel_id, kind: 'report', status: 'sent' }) }
    } else if (id.provider === 'whatsapp') {
      const chatId = id.meta?.chat_id
      const r = await whatsappSend({ chatId, toAttendee: chatId ? undefined : id.external_id, text })
      if (r.ok) { sent++; await admin.from('channel_messages').insert({ user_id: userId, provider: 'whatsapp', external_id: r.id, channel_ref: r.chatId || chatId, kind: 'report', status: 'sent' }) }
    }
  }
  return { sent }
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
