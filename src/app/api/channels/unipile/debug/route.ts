/**
 * GET /api/channels/unipile/debug — TEMP diagnostic.
 *   (no params)                     → Unipile accounts + your bound identities + recent inbox threads.
 *   ?send=<threadId>&text=hello     → actually attempts the reply and returns Unipile's RAW status+body,
 *                                     so we can see exactly why an Instagram reply isn't delivering.
 * Cookie-authed (self only). Remove after connect/outbound is verified.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DSN = () => {
  let d = (process.env.UNIPILE_DSN || '').trim().replace(/\/+$/, '')
  if (d && !/^https?:\/\//i.test(d)) d = `https://${d}`
  return d
}
const H = () => ({ 'content-type': 'application/json', accept: 'application/json', 'X-API-KEY': (process.env.UNIPILE_API_KEY || '').trim() })

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const url = req.nextUrl

  // ── Test-send mode: attempt the reply for a given thread and return Unipile's raw response ──
  const sendThread = url.searchParams.get('send')
  if (sendThread) {
    const text = url.searchParams.get('text') || 'Test from Mello 👋'
    const { data: t } = await admin.from('customer_threads').select('*').eq('id', sendThread).eq('user_id', user.id).maybeSingle()
    if (!t) return NextResponse.json({ error: 'thread not found' }, { status: 404 })
    const { data: chan } = await admin.from('channel_identities').select('external_id, meta, provider')
      .eq('user_id', user.id).eq('provider', t.channel).eq('active', true).maybeSingle()
    const accountId = chan?.meta?.unipile_account_id || chan?.external_id
    const attempts: any[] = []
    // Attempt A: reply into the stored chat (the correct path)
    if (t.chat_ref) {
      const r = await fetch(`${DSN()}/api/v1/chats/${encodeURIComponent(t.chat_ref)}/messages`, { method: 'POST', headers: H(), body: JSON.stringify({ text }) })
      attempts.push({ path: `chats/${t.chat_ref}/messages`, status: r.status, body: await r.json().catch(() => 'non-json') })
    }
    // Attempt B: start a chat by attendee (fallback)
    const r2 = await fetch(`${DSN()}/api/v1/chats`, { method: 'POST', headers: H(), body: JSON.stringify({ account_id: accountId, attendees_ids: [t.contact_ref], text }) })
    attempts.push({ path: 'chats (new by attendee)', status: r2.status, body: await r2.json().catch(() => 'non-json') })
    return NextResponse.json({ thread: { id: t.id, channel: t.channel, contact_ref: t.contact_ref, chat_ref: t.chat_ref }, accountId, attempts })
  }

  // ── Default: show state ──
  let unipile: any = null, fetchError: string | null = null
  try { unipile = await (await fetch(`${DSN()}/api/v1/accounts`, { headers: H() })).json() } catch (e: any) { fetchError = String(e?.message || e) }
  const { data: bound } = await admin.from('channel_identities').select('provider, external_id, active, meta').eq('user_id', user.id)
  const { data: threads } = await admin.from('customer_threads').select('id, channel, contact_ref, chat_ref, status, last_message_at').eq('user_id', user.id).order('last_message_at', { ascending: false }).limit(10)
  const { data: hooks } = await admin.from('unipile_webhook_log').select('kind, payload, created_at').order('created_at', { ascending: false }).limit(8)

  return NextResponse.json({ myUserId: user.id, dsn: DSN(), fetchError, unipileAccounts: unipile, boundInDb: bound || [], recentThreads: threads || [], recentWebhooks: hooks || [] })
}
