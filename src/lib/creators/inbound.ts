/**
 * Route an inbound message to the CREATOR pipeline when it's from a creator we've already contacted —
 * matched by the Unipile chat id, their email, or their handle. Keeps creator replies out of the Customer
 * Inbox and moves them to 'replied'. Best-effort: returns false (→ falls back to the customer inbox) on any
 * miss. Email is the reliable match (from-address); IG-DM matching lands once we store the chat id.
 */
export async function routeCreatorInbound(admin: any, ownerId: string, opts: { sender: string; chatId?: string; text: string; channel?: string; senderName?: string }): Promise<boolean> {
  const sender = String(opts.sender || '').trim()
  if (!sender && !opts.chatId) return false
  const handle = sender.replace(/^@/, '')
  const filters: string[] = []
  if (opts.chatId) filters.push(`chat_ref.eq.${opts.chatId}`)
  if (sender.includes('@') && sender.includes('.')) filters.push(`email.eq.${sender}`)
  if (handle && !handle.includes(',')) filters.push(`handle.eq.${handle}`)
  if (!filters.length) return false

  const { data } = await admin.from('creators').select('*').eq('user_id', ownerId)
    .in('stage', ['invited', 'replied', 'confirmed', 'details', 'shipped']).or(filters.join(',')).limit(1)
  const creator = (data || [])[0]
  if (!creator) return false

  await admin.from('creator_messages').insert({ creator_id: creator.id, user_id: ownerId, direction: 'in', body: opts.text, channel: opts.channel || null, status: 'sent' })
  const nextStage = creator.stage === 'invited' ? 'replied' : creator.stage
  await admin.from('creators').update({ stage: nextStage, ...(opts.chatId && !creator.chat_ref ? { chat_ref: opts.chatId } : {}), updated_at: new Date().toISOString() }).eq('id', creator.id)
  return true
}
