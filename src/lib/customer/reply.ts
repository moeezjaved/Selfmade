/**
 * Approve/skip a customer message — shared by the web inbox AND the Slack buttons, so a founder can
 * handle a customer from either place. Sends the reply into the real conversation (chat id) and records
 * the outbound. Attribution: every sent reply is one the Customer Employee handled (counted in stats).
 */
import { recordLearning } from '@/lib/brain'

export async function skipCustomerMessage(admin: any, userId: string, messageId: string): Promise<{ ok: boolean }> {
  const { data: msg } = await admin.from('customer_messages').select('thread_id').eq('id', messageId).eq('user_id', userId).maybeSingle()
  if (!msg) return { ok: false }
  await admin.from('customer_messages').update({ status: 'skipped' }).eq('id', messageId)
  await admin.from('customer_threads').update({ status: 'skipped' }).eq('id', msg.thread_id)
  return { ok: true }
}

export async function sendCustomerReply(admin: any, userId: string, messageId: string, replyText?: string): Promise<{ ok: boolean; delivered: boolean; note: string; error?: string }> {
  const { data: msg } = await admin.from('customer_messages').select('*').eq('id', messageId).eq('user_id', userId).maybeSingle()
  if (!msg) return { ok: false, delivered: false, note: 'Message not found', error: 'not_found' }

  const text = String(replyText || (msg.direction === 'out' ? msg.body : msg.suggested_reply) || '').trim()
  if (!text) return { ok: false, delivered: false, note: 'Nothing to send.', error: 'empty' }
  const now = new Date().toISOString()

  if (msg.direction === 'out') {
    await admin.from('customer_messages').update({ status: 'sent', body: text }).eq('id', messageId)
  } else {
    await admin.from('customer_messages').update({ status: 'approved' }).eq('id', messageId)
    await admin.from('customer_messages').insert({ thread_id: msg.thread_id, user_id: userId, direction: 'out', body: text, status: 'sent' })
  }
  await admin.from('customer_threads').update({ status: 'replied', last_message_at: now }).eq('id', msg.thread_id)

  // Real delivery into the existing conversation.
  let delivered = false
  let note = 'Approved. Connect a channel in Settings to auto-deliver.'
  try {
    const { data: thread } = await admin.from('customer_threads').select('channel, contact_ref, chat_ref').eq('id', msg.thread_id).maybeSingle()
    if (thread && thread.channel !== 'simulated' && thread.contact_ref) {
      const { data: chan } = await admin.from('channel_identities').select('external_id, meta').eq('user_id', userId).eq('provider', thread.channel).eq('active', true).maybeSingle()
      const accountId = chan?.meta?.unipile_account_id || chan?.external_id
      if (accountId) {
        if (thread.channel === 'email') {
          const { unipileSendEmail } = await import('@/lib/channels/providers')
          const r = await unipileSendEmail(String(accountId), { to: thread.contact_ref, subject: 'Re: your message', text })
          delivered = !!r.ok; note = r.ok ? 'Email sent ✓' : `Saved, but sending failed: ${r.error || 'unknown'}`
        } else {
          const { unipileSend, resolveChatId } = await import('@/lib/channels/providers')
          let chatId = thread.chat_ref || undefined
          if (!chatId && thread.contact_ref) {
            const resolved = await resolveChatId(String(accountId), thread.contact_ref)
            if (resolved) { chatId = resolved; await admin.from('customer_threads').update({ chat_ref: resolved }).eq('id', msg.thread_id) }
          }
          const r = await unipileSend(String(accountId), { chatId, toAttendee: thread.contact_ref, text })
          delivered = !!r.ok; note = r.ok ? 'Sent ✓' : `Saved, but delivery failed: ${r.error || 'unknown'}`
        }
      }
    } else if (thread?.channel === 'simulated') { note = 'Approved ✓ (test — not sent)' }
  } catch { /* delivery best-effort */ }

  try { await recordLearning(admin, { userId, department: 'customer', event: `Approved a ${msg.intent || 'customer'} reply`, result: text.slice(0, 300), source: 'founder', metric: { intent: msg.intent, delivered } }) } catch { /* ok */ }
  return { ok: true, delivered, note }
}
