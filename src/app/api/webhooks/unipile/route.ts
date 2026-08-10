/**
 * WhatsApp inbound via Unipile: the founder replies "yes" / "no" to an approval, or texts a link
 * code to connect. Resolves the sender → linked account → the most recent open approval, then runs
 * the SAME executor. WhatsApp has no buttons, so intent is parsed from free text.
 *
 * Auth: Unipile can attach a secret to its webhooks — set UNIPILE_WEBHOOK_SECRET and it's checked
 * from the `x-unipile-secret` header or `?secret=`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { whatsappSend, whatsappSelfTarget } from '@/lib/channels/providers'
import { extractCode } from '@/lib/channels/link'
import { latestOpenApproval } from '@/lib/channels/send'
import { runTask } from '@/lib/mello/run-task'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const YES = /^\s*(y|yes|yep|yeah|ok|okay|go|approve|approved|do it|sure|haan|1)\b/i
const NO = /^\s*(n|no|nope|skip|stop|cancel|not now|nah|2)\b/i

// Founder WhatsApp is OFF by default (briefs/approvals are Slack-only — a shared WhatsApp sender loops).
// While off, NO inbound WhatsApp message ever produces an outbound reply from us; we only ingest customer
// messages into the inbox silently. Mirrors FOUNDER_WHATSAPP in src/lib/channels/send.ts.
const FOUNDER_WHATSAPP = process.env.FOUNDER_WHATSAPP === '1' || process.env.FOUNDER_WHATSAPP === 'true'

// LOOP GUARD: substrings that only appear in MELLO'S OWN outbound messages. When the shared sender line
// posts into its "Message yourself" chat, Unipile re-delivers that message as an inbound webhook without
// flagging it as self-sent — so the bot would reply to itself forever. If the inbound text is one of our
// own messages echoed back, drop it. This is the primary defence against a runaway self-reply loop.
const MELLO_ECHO = [
  'I’m Mello', "I'm Mello", 'Connected. I’ll send your decisions', 'That code didn’t work',
  'You’re already connected', 'Skipped — I’ll leave it', 'Reply in Selfmade to send',
  'Overnight shift done', 'All handled. Nothing needs you', 'Generate a fresh one in Selfmade',
]
// Cache each Unipile account's OWN phone number so the self-message guard doesn't re-hit Unipile per event.
const selfNumCache = new Map<string, string | null>()
async function ownNumber(accountId?: string): Promise<string | null> {
  if (!accountId) return null
  if (selfNumCache.has(accountId)) return selfNumCache.get(accountId) || null
  const n = await whatsappSelfTarget(accountId).catch(() => null)
  selfNumCache.set(accountId, n)
  return n
}

function authed(req: NextRequest, url: URL): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET
  if (!secret) return true
  return req.headers.get('x-unipile-secret') === secret || url.searchParams.get('secret') === secret
}

/** Pull sender id / text / chat id / account out of Unipile's MESSAGING webhook, defensively. Real shape
 *  (verified): { event:'message_received', message:'hi', sender:{attendee_provider_id,attendee_name},
 *  chat_id, account_id, is_sender:false, timestamp }. `message` is the TEXT (a string), not an object. */
function parseInbound(b: any): { sender?: string; senderName?: string; text: string; chatId?: string; accountId?: string; isInbound: boolean } {
  const msg = (b?.message && typeof b.message === 'object') ? b.message : (b?.data && typeof b.data === 'object' ? b.data : b)
  const text = (typeof b?.message === 'string' ? b.message : '') || msg?.text || msg?.body || b?.text || b?.body || ''
  const chatId = b?.chat_id ?? msg?.chat_id ?? msg?.chatId ?? b?.provider_chat_id
  const s = b?.sender || msg?.sender || msg?.from || {}
  const sender = s?.attendee_provider_id ?? s?.attendee_id ?? s?.id ?? s?.attendee_public_identifier ?? msg?.sender_id ?? b?.from
  const senderName = s?.attendee_name ?? s?.name ?? b?.sender_name
  const accountId = b?.account_id ?? msg?.account_id
  const dir = String(b?.event || b?.type || msg?.direction || '')
  // Inbound = not our own message + not a receipt. is_sender:true means WE sent it.
  const isSenderMe = b?.is_sender === true || msg?.is_sender === true || b?.from_me === true
  const isInbound = !/sent|delivery|read/i.test(dir) && !isSenderMe && (/received/i.test(dir) || !!text)
  return { sender: sender ? String(sender) : undefined, senderName: senderName ? String(senderName) : undefined, text: String(text || ''), chatId: chatId ? String(chatId) : undefined, accountId: accountId ? String(accountId) : undefined, isInbound }
}


export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  if (!authed(req, url)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { sender, senderName, text, chatId, accountId, isInbound } = parseInbound(body)
  if (!isInbound || !sender) return NextResponse.json({ ok: true })   // ack non-actionable events

  // LOOP GUARD 1 — our own outbound echoed back (self-chat re-delivery). Never reply to Mello.
  if (text && MELLO_ECHO.some(s => text.includes(s))) return NextResponse.json({ ok: true, skipped: 'echo' })
  // LOOP GUARD 2 — message from the account's OWN number (a "Message yourself" event). Never act on it.
  const mine = await ownNumber(accountId)
  const senderDigits = String(sender).replace(/[^0-9]/g, '')
  if (mine && senderDigits.length >= 7 && (senderDigits.endsWith(mine.slice(-9)) || mine.endsWith(senderDigits.slice(-9)))) {
    return NextResponse.json({ ok: true, skipped: 'self' })
  }

  const admin = createAdminClient()
  const reply = (t: string) => whatsappSend({ chatId, toAttendee: chatId ? undefined : sender, text: t }).catch(() => {})

  // Resolve sender → the FOUNDER's linked account (their own number, from the code link).
  const { data: identity } = await admin.from('channel_identities')
    .select('*').eq('provider', 'whatsapp').eq('external_id', sender).eq('active', true).maybeSingle()

  // Not the founder → a CUSTOMER messaging a connected company channel. Land it in the inbox SILENTLY —
  // the founder replies from the app. We no longer auto-reply from here AT ALL: founder-WhatsApp connect
  // was removed, and the "Hi — I'm Mello… connect" onboarding reply (and code redemption) was the fuel for
  // the self-reply loop on the shared sender line. No inbound WhatsApp ever produces an unsolicited send.
  if (!identity) {
    const { ingestCustomerMessage } = await import('@/lib/customer/ingest')
    await ingestCustomerMessage(admin, { accountId, sender, senderName, text, chatId }).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  // A linked founder WhatsApp identity — only exists if founder WhatsApp was ever enabled. With founder
  // WhatsApp OFF (default), never send anything back over WhatsApp (approvals/chat live on Slack + the app).
  if (!FOUNDER_WHATSAPP) return NextResponse.json({ ok: true })

  const userId = identity.user_id
  // Keep the chat id fresh for future outbound.
  if (chatId && identity.meta?.chat_id !== chatId) {
    await admin.from('channel_identities').update({ meta: { ...(identity.meta || {}), chat_id: chatId }, updated_at: new Date().toISOString() }).eq('id', identity.id)
  }

  // A code from an already-linked sender → just re-confirm.
  if (extractCode(text) && !YES.test(text) && !NO.test(text)) { await reply('You’re already connected ✅'); return NextResponse.json({ ok: true }) }

  // yes/no ONLY act on a pending approval. Anything else is a normal chat with Mello.
  const approval = await latestOpenApproval(admin, userId, 'whatsapp')

  if (approval && NO.test(text)) {
    if (approval.task_id) await admin.from('mello_tasks').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', approval.task_id)
    await admin.from('channel_messages').update({ status: 'skipped' }).eq('id', approval.id)
    await reply('Skipped — I’ll leave it. 👍')
    return NextResponse.json({ ok: true })
  }

  if (approval && YES.test(text)) {
    const { data: task } = await admin.from('mello_tasks').select('*').eq('id', approval.task_id).eq('user_id', userId).maybeSingle()
    if (!task) { await reply('That one expired — I’ll resend next time.'); return NextResponse.json({ ok: true }) }
    if (task.status === 'done') { await reply('Already done ✅'); return NextResponse.json({ ok: true }) }
    const { data: userRow } = await admin.auth.admin.getUserById(userId)
    const updated = await runTask(admin, { userId, email: userRow?.user?.email, source: 'whatsapp' }, task)
    await admin.from('channel_messages').update({ status: updated.status === 'done' ? 'executed' : 'failed' }).eq('id', approval.id)
    await reply(updated.status === 'done'
      ? `✅ Done.${updated.result?.newBudget ? ` Now at $${updated.result.newBudget}/day.` : ''} I’m watching it.`
      : `⚠️ ${updated.error || 'That didn’t go through.'}${updated.needsApp ? ' Open it in the app to finish.' : ''}`)
    return NextResponse.json({ ok: true })
  }

  // Anything else → a normal conversation with Mello (his one brain, same as the app + Slack).
  // Rate-limit so chatter can't run up the OpenAI bill (parity with the web + Slack paths).
  const { isRateLimited } = await import('@/lib/rateLimit')
  if (await isRateLimited(userId)) { await reply('One moment — give me a few seconds and ask again.'); return NextResponse.json({ ok: true }) }
  // Feed the Company Brain from the founder's WhatsApp line (best-effort, non-blocking).
  try { const { brainIngest } = await import('@/lib/brain'); void brainIngest(admin, { userId, source: 'whatsapp', raw: text }) } catch { /* best-effort */ }
  try {
    const { askMello } = await import('@/lib/mello/ask')
    const out = await askMello(admin, userId, text)
    await reply(out.reply)
  } catch { await reply('I hit a snag pulling that together — try me again in a moment.') }
  return NextResponse.json({ ok: true })
}
