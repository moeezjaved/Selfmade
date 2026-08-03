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
import { whatsappSend } from '@/lib/channels/providers'
import { redeemCode, extractCode } from '@/lib/channels/link'
import { latestOpenApproval } from '@/lib/channels/send'
import { runTask } from '@/lib/mello/run-task'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const YES = /^\s*(y|yes|yep|yeah|ok|okay|go|approve|approved|do it|sure|haan|1)\b/i
const NO = /^\s*(n|no|nope|skip|stop|cancel|not now|nah|2)\b/i

function authed(req: NextRequest, url: URL): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET
  if (!secret) return true
  return req.headers.get('x-unipile-secret') === secret || url.searchParams.get('secret') === secret
}

/** Pull sender id / text / chat id out of Unipile's payload, defensively (shapes vary by version). */
function parseInbound(b: any): { sender?: string; text: string; chatId?: string; isInbound: boolean } {
  const msg = b?.message || b?.data || b
  const text = msg?.text ?? msg?.body ?? b?.text ?? ''
  const chatId = msg?.chat_id ?? msg?.chatId ?? b?.chat_id
  const sender = msg?.from?.attendee_provider_id ?? msg?.from?.id ?? msg?.sender?.attendee_provider_id
    ?? msg?.sender_id ?? msg?.attendee_provider_id ?? b?.from
  // Ignore our own outbound echoes / delivery receipts.
  const dir = b?.event || b?.type || msg?.direction || ''
  const isInbound = !/sent|delivery|read|outbound/i.test(String(dir)) && (msg?.is_sender === false || msg?.from_me === false || !!text)
  return { sender: sender ? String(sender) : undefined, text: String(text || ''), chatId: chatId ? String(chatId) : undefined, isInbound }
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  if (!authed(req, url)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const { sender, text, chatId, isInbound } = parseInbound(body)
  if (!isInbound || !sender) return NextResponse.json({ ok: true })   // ack non-actionable events

  const admin = createAdminClient()
  const reply = (t: string) => whatsappSend({ chatId, toAttendee: chatId ? undefined : sender, text: t }).catch(() => {})

  // Resolve sender → linked account.
  const { data: identity } = await admin.from('channel_identities')
    .select('*').eq('provider', 'whatsapp').eq('external_id', sender).eq('active', true).maybeSingle()

  // Not linked yet → the only thing we accept is a link code.
  if (!identity) {
    if (extractCode(text)) {
      const uid = await redeemCode(admin, text, 'whatsapp', sender, { chat_id: chatId, account_id: process.env.UNIPILE_WHATSAPP_ACCOUNT_ID }, sender)
      await reply(uid
        ? '✅ Connected. I’ll send your decisions here — reply YES to approve, NO to skip. Anytime.'
        : '⚠️ That code didn’t work (they expire in 15 min). Generate a fresh one in Selfmade → Settings → Channels.')
    } else {
      await reply('Hi — I’m Mello. To connect, open Selfmade → Settings → Channels, generate a code, and text it here.')
    }
    return NextResponse.json({ ok: true })
  }
  const userId = identity.user_id
  // Keep the chat id fresh for future outbound.
  if (chatId && identity.meta?.chat_id !== chatId) {
    await admin.from('channel_identities').update({ meta: { ...(identity.meta || {}), chat_id: chatId }, updated_at: new Date().toISOString() }).eq('id', identity.id)
  }

  // A code from an already-linked sender → just re-confirm.
  if (extractCode(text) && !YES.test(text) && !NO.test(text)) { await reply('You’re already connected ✅'); return NextResponse.json({ ok: true }) }

  const approval = await latestOpenApproval(admin, userId, 'whatsapp')
  if (!approval) { await reply('Nothing’s waiting on you right now — I’ll message when there is. 🌱'); return NextResponse.json({ ok: true }) }

  if (NO.test(text)) {
    if (approval.task_id) await admin.from('mello_tasks').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', approval.task_id)
    await admin.from('channel_messages').update({ status: 'skipped' }).eq('id', approval.id)
    await reply('Skipped — I’ll leave it. 👍')
    return NextResponse.json({ ok: true })
  }

  if (YES.test(text)) {
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

  // Unclear reply → nudge with the pending decision.
  await reply(`I’ve got one thing waiting: “${approval.task_id ? '' : ''}”. Reply YES to approve or NO to skip.`.replace('“”', 'a pending decision'))
  return NextResponse.json({ ok: true })
}
