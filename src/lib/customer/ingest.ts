/**
 * Ingest one inbound customer message (from any connected channel — WhatsApp, Instagram, Messenger,
 * Telegram, email) into the Customer Inbox: resolve which founder owns the connected account, triage it
 * (priority + intent), draft a reply, and drop it in as a pending thread. Never auto-replies. Shared by
 * the Messaging webhook and the Mailing webhook so every channel lands the same way.
 */
import { triageMessage } from '@/lib/customer/triage'

export async function ingestCustomerMessage(admin: any, opts: { accountId?: string; sender: string; senderName?: string; text: string; channel?: string; chatId?: string }): Promise<boolean> {
  const { accountId, sender, senderName, text, chatId } = opts
  if (!accountId || !sender || !text) return false
  // Which founder owns the connected account this arrived on?
  const { data: chan } = await admin.from('channel_identities').select('*').eq('external_id', accountId).eq('active', true).maybeSingle()
  if (!chan || !chan.meta?.customer_channel) return false
  const ownerId = chan.user_id
  const channel = opts.channel || chan.provider   // whatsapp | instagram | messenger | telegram | email

  // If this is a reply from a creator we're already recruiting, route it to the Creators pipeline instead
  // of the Customer Inbox (best-effort; falls through on a miss).
  try {
    const { routeCreatorInbound } = await import('@/lib/creators/inbound')
    if (await routeCreatorInbound(admin, ownerId, { sender, chatId, text, channel, senderName })) return true
  } catch { /* fall through to the customer inbox */ }

  // The brand this channel serves (mig 143) — the thread + its triage/memory scope to it. Falls back to
  // the founder's first brand when the channel isn't linked yet.
  const brandId: string | null = chan.brand_id || null
  let brandName = ''
  try {
    const q = brandId
      ? admin.from('brands').select('name').eq('id', brandId).maybeSingle()
      : admin.from('brands').select('name').eq('user_id', ownerId).order('created_at', { ascending: true }).limit(1).maybeSingle()
    const { data } = await q; brandName = data?.name || ''
  } catch { /* ok */ }
  const tr = await triageMessage(admin, ownerId, { body: text, brand: brandName, brandId })
  const now = new Date().toISOString()

  let { data: thread } = await admin.from('customer_threads').select('*')
    .eq('user_id', ownerId).eq('channel', channel).eq('contact_ref', sender).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!thread) {
    const { data: created } = await admin.from('customer_threads').insert({
      user_id: ownerId, channel, contact_ref: sender, contact_name: senderName || null,
      priority: tr.priority, intent: tr.intent, status: 'open', last_message_at: now, chat_ref: chatId || null, brand_id: brandId,
    }).select().single()
    thread = created
  } else {
    await admin.from('customer_threads').update({ priority: tr.priority, intent: tr.intent, status: 'open', last_message_at: now, ...(chatId ? { chat_ref: chatId } : {}), ...(brandId && !thread.brand_id ? { brand_id: brandId } : {}) }).eq('id', thread.id)
  }
  const { data: inserted } = await admin.from('customer_messages').insert({
    thread_id: thread.id, user_id: ownerId, direction: 'in', body: text,
    intent: tr.intent, priority: tr.priority, suggested_reply: tr.draft, status: 'pending',
  }).select('id').single()

  // Push it to the founder's Slack/WhatsApp so they can approve from chat (not just the web inbox).
  try {
    if (inserted?.id) {
      const { pushCustomerMessage } = await import('@/lib/channels/send')
      await pushCustomerMessage(admin, ownerId, { messageId: inserted.id, contactName: senderName, channel, priority: tr.priority, intent: tr.intent, body: text, draft: tr.draft })
    }
  } catch { /* push is best-effort */ }
  return true
}
