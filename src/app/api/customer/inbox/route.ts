/**
 * GET  /api/customer/inbox — the founder's priority-sorted customer inbox: open threads (High→Low), each
 *                            with its latest inbound message + Mello's suggested reply, plus intent rollup.
 * POST /api/customer/inbox — actions:
 *   { action:'simulate', body, from?, name?, brandId? }  → create an inbound, triage + draft it (test now).
 *   { action:'approve', messageId, reply? }              → record the (optionally edited) reply, mark replied.
 *   { action:'skip', messageId }                         → dismiss the draft.
 *
 * Nothing is ever sent to a customer automatically — approve records the outbound reply; the real
 * last-mile delivery (IG/WhatsApp via Unipile) attaches here once the channel is connected.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { triageMessage } from '@/lib/customer/triage'
import { draftOutbound, OUTBOUND_LABEL, type OutboundType } from '@/lib/customer/outbound'
import { recordLearning } from '@/lib/brain'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RANK: Record<string, number> = { high: 0, med: 1, low: 2 }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const { data: threads } = await admin.from('customer_threads').select('*')
    .eq('user_id', user.id).in('status', ['open', 'replied']).order('last_message_at', { ascending: false }).limit(100)
  const list = (threads || []) as any[]
  list.sort((a, b) => (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) || (b.last_message_at > a.last_message_at ? 1 : -1))

  // Attach each thread's latest inbound message (the one awaiting a reply) + its draft.
  const ids = list.map(t => t.id)
  const msgsByThread: Record<string, any> = {}
  if (ids.length) {
    const { data: msgs } = await admin.from('customer_messages').select('*')
      .in('thread_id', ids).eq('direction', 'in').order('created_at', { ascending: false })
    for (const m of (msgs || []) as any[]) if (!msgsByThread[m.thread_id]) msgsByThread[m.thread_id] = m
  }
  const threadsOut = list.map(t => ({ ...t, latest: msgsByThread[t.id] || null }))

  // Intent rollup across open threads — the "today's trends" view.
  const rollup: Record<string, number> = {}
  for (const t of list) if (t.status === 'open' && t.intent) rollup[t.intent] = (rollup[t.intent] || 0) + 1

  // Outbound proposals awaiting the founder's approval (Mello wants to reach out first).
  const { data: outMsgs } = await admin.from('customer_messages').select('*')
    .eq('user_id', user.id).eq('direction', 'out').eq('status', 'pending').order('created_at', { ascending: false }).limit(50)
  const outThreadIds = Array.from(new Set((outMsgs || []).map((m: any) => m.thread_id)))
  const outThreads: Record<string, any> = {}
  if (outThreadIds.length) {
    const { data: ot } = await admin.from('customer_threads').select('*').in('id', outThreadIds)
    for (const t of (ot || []) as any[]) outThreads[t.id] = t
  }
  const outbound = (outMsgs || []).map((m: any) => ({ ...m, thread: outThreads[m.thread_id] || null }))

  return NextResponse.json({ threads: threadsOut, rollup, outbound })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (action === 'simulate') {
    const text = String(body.body || '').trim()
    if (!text) return NextResponse.json({ error: 'A message is required.' }, { status: 400 })
    // Brand for grounding: the named one, else the founder's first brand.
    let brandId: string | null = body.brandId || null
    let brandName = ''
    if (brandId) { const { data } = await admin.from('brands').select('name').eq('id', brandId).eq('user_id', user.id).maybeSingle(); brandName = data?.name || '' }
    else { const { data } = await admin.from('brands').select('id,name').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle(); brandId = data?.id || null; brandName = data?.name || '' }

    const triage = await triageMessage(admin, user.id, { body: text, brand: brandName })
    const now = new Date().toISOString()
    const { data: thread } = await admin.from('customer_threads').insert({
      user_id: user.id, brand_id: brandId, channel: 'simulated',
      contact_ref: String(body.from || 'test-customer'), contact_name: String(body.name || 'Test Customer'),
      priority: triage.priority, intent: triage.intent, status: 'open', last_message_at: now,
    }).select().single()
    const { data: msg } = await admin.from('customer_messages').insert({
      thread_id: thread.id, user_id: user.id, direction: 'in', body: text,
      intent: triage.intent, priority: triage.priority, suggested_reply: triage.draft, status: 'pending',
    }).select().single()
    return NextResponse.json({ ok: true, thread: { ...thread, latest: msg } })
  }

  if (action === 'simulate_outbound') {
    const type = String(body.type || 'reengage') as OutboundType
    if (!OUTBOUND_LABEL[type]) return NextResponse.json({ error: 'Unknown outbound type.' }, { status: 400 })
    let brandId: string | null = body.brandId || null
    let brandName = ''
    if (brandId) { const { data } = await admin.from('brands').select('name').eq('id', brandId).eq('user_id', user.id).maybeSingle(); brandName = data?.name || '' }
    else { const { data } = await admin.from('brands').select('id,name').eq('user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle(); brandId = data?.id || null; brandName = data?.name || '' }
    const name = String(body.name || 'Test Customer')
    const product = String(body.product || '')
    const draft = await draftOutbound(admin, user.id, { type, name, brand: brandName, product })
    const now = new Date().toISOString()
    const { data: thread } = await admin.from('customer_threads').insert({
      user_id: user.id, brand_id: brandId, channel: 'simulated',
      contact_ref: String(body.from || 'test-customer'), contact_name: name,
      priority: 'med', intent: type, status: 'open', last_message_at: now,
    }).select().single()
    const { data: msg } = await admin.from('customer_messages').insert({
      thread_id: thread.id, user_id: user.id, direction: 'out', body: draft, intent: type, status: 'pending',
    }).select().single()
    return NextResponse.json({ ok: true, outbound: { ...msg, thread } })
  }

  if (action === 'approve' || action === 'skip') {
    const messageId = String(body.messageId || '')
    if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })
    const { data: msg } = await admin.from('customer_messages').select('*').eq('id', messageId).eq('user_id', user.id).maybeSingle()
    if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

    if (action === 'skip') {
      await admin.from('customer_messages').update({ status: 'skipped' }).eq('id', messageId)
      await admin.from('customer_threads').update({ status: 'skipped' }).eq('id', msg.thread_id)
      return NextResponse.json({ ok: true })
    }

    // approve: record the (optionally edited) message. Real delivery attaches when Unipile is on.
    const text = String(body.reply || (msg.direction === 'out' ? msg.body : msg.suggested_reply) || '').trim()
    if (!text) return NextResponse.json({ error: 'Nothing to send.' }, { status: 400 })
    const now = new Date().toISOString()
    if (msg.direction === 'out') {
      // An outbound proposal Mello wrote — approve = send it (record the edited body, mark sent).
      await admin.from('customer_messages').update({ status: 'sent', body: text }).eq('id', messageId)
    } else {
      // An inbound message — approve = send the reply (mark the inbound handled, log the outbound).
      await admin.from('customer_messages').update({ status: 'approved' }).eq('id', messageId)
      await admin.from('customer_messages').insert({ thread_id: msg.thread_id, user_id: user.id, direction: 'out', body: text, status: 'sent' })
    }
    await admin.from('customer_threads').update({ status: 'replied', last_message_at: now }).eq('id', msg.thread_id)
    // Teach the Customer Employee from what the founder actually approved.
    try { await recordLearning(admin, { userId: user.id, department: 'customer', event: `Approved a ${msg.direction === 'out' ? OUTBOUND_LABEL[msg.intent as OutboundType] || 'proactive' : (msg.intent || 'customer')} message`, result: text.slice(0, 300), source: 'founder', metric: { intent: msg.intent, direction: msg.direction } }) } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, delivered: false, note: 'Approved. Connect WhatsApp/Instagram in Settings to auto-deliver.' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
