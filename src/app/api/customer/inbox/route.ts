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
import { resolveActiveBrandId } from '@/lib/brand/active'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RANK: Record<string, number> = { high: 0, med: 1, low: 2 }

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  // The active project: explicit ?brand= wins, else the app-wide `sf_brand` cookie (sidebar switcher).
  const brandId = (await resolveActiveBrandId(admin, user.id, req.nextUrl.searchParams.get('brand'))) || undefined

  let tq = admin.from('customer_threads').select('*')
    .eq('user_id', user.id).in('status', ['open', 'replied']).order('last_message_at', { ascending: false }).limit(100)
  // STRICT per-brand inbox (mig 143): a specific brand shows ONLY its own threads. UNASSIGNED threads
  // (brand_id null — a channel not yet linked to a brand) show only under "All brands", NOT under every
  // brand. The old `OR brand_id IS NULL` leaked another brand's customers (e.g. Aura's WhatsApp threads,
  // ingested before that channel was tagged) into Hair ResQ's inbox.
  if (brandId) tq = tq.eq('brand_id', brandId)
  const { data: threads } = await tq
  const list = (threads || []) as any[]
  list.sort((a, b) => (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) || (b.last_message_at > a.last_message_at ? 1 : -1))
  // Brand names for the per-thread chip.
  const brandMap: Record<string, string> = {}
  try { const { data: bs } = await admin.from('brands').select('id, name').eq('user_id', user.id); for (const b of (bs || []) as any[]) brandMap[String(b.id)] = b.name } catch { /* ok */ }

  // Attach each thread's latest inbound message (the one awaiting a reply) + its draft.
  const ids = list.map(t => t.id)
  const msgsByThread: Record<string, any> = {}
  if (ids.length) {
    const { data: msgs } = await admin.from('customer_messages').select('*')
      .in('thread_id', ids).eq('direction', 'in').order('created_at', { ascending: false })
    for (const m of (msgs || []) as any[]) if (!msgsByThread[m.thread_id]) msgsByThread[m.thread_id] = m
  }
  const threadsOut = list.map(t => ({ ...t, latest: msgsByThread[t.id] || null, brand_name: t.brand_id ? (brandMap[String(t.brand_id)] || null) : null }))

  // Intent rollup across open threads — the "today's trends" view.
  const rollup: Record<string, number> = {}
  for (const t of list) if (t.status === 'open' && t.intent) rollup[t.intent] = (rollup[t.intent] || 0) + 1

  // Attribution — this month: how many messages the Customer Employee handled + sales it's credited with.
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
  const since = monthStart.toISOString()
  // Brand-scope the stats too: this brand's thread ids (customer_messages has no brand_id of its own).
  let brandThreadIds: string[] | null = null
  if (brandId) {
    const { data: bt } = await admin.from('customer_threads').select('id').eq('user_id', user.id).eq('brand_id', brandId)
    brandThreadIds = ((bt || []) as any[]).map((t: any) => String(t.id))
  }
  let handledQ = admin.from('customer_messages').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('direction', 'out').eq('status', 'sent').gte('created_at', since)
  if (brandThreadIds) handledQ = brandThreadIds.length ? handledQ.in('thread_id', brandThreadIds) : handledQ.eq('thread_id', '00000000-0000-0000-0000-000000000000')
  const { count: handled } = await handledQ
  let wonQ = admin.from('customer_threads').select('sale_value').eq('user_id', user.id).eq('converted', true).gte('converted_at', since)
  if (brandId) wonQ = wonQ.eq('brand_id', brandId)
  const { data: won } = await wonQ
  const sales = (won || []).length
  const revenue = (won || []).reduce((s: number, t: any) => s + (Number(t.sale_value) || 0), 0)
  const stats = { handled: handled || 0, sales, revenue }

  // Outbound proposals awaiting the founder's approval (Mello wants to reach out first).
  const { data: outMsgs } = await admin.from('customer_messages').select('*')
    .eq('user_id', user.id).eq('direction', 'out').eq('status', 'pending').order('created_at', { ascending: false }).limit(50)
  const outThreadIds = Array.from(new Set((outMsgs || []).map((m: any) => m.thread_id)))
  const outThreads: Record<string, any> = {}
  if (outThreadIds.length) {
    const { data: ot } = await admin.from('customer_threads').select('*').in('id', outThreadIds)
    for (const t of (ot || []) as any[]) outThreads[t.id] = t
  }
  let outbound = (outMsgs || []).map((m: any) => ({ ...m, thread: outThreads[m.thread_id] || null }))
  // Strict per-brand: only this brand's outbound proposals (its threads); unassigned show under All brands.
  if (brandId) outbound = outbound.filter((m: any) => m.thread?.brand_id === brandId)

  return NextResponse.json({ threads: threadsOut, rollup, outbound, stats })
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
    const draft = await draftOutbound(admin, user.id, { type, name, brand: brandName, product, brandId })
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

  if (action === 'mark_sale') {
    const threadId = String(body.threadId || '')
    if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 })
    const converted = body.converted !== false
    const amount = Number(body.amount)
    await admin.from('customer_threads').update({
      converted, sale_value: Number.isFinite(amount) && amount > 0 ? amount : null,
      converted_at: converted ? new Date().toISOString() : null,
    }).eq('id', threadId).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'skip') {
    const messageId = String(body.messageId || '')
    if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })
    const { skipCustomerMessage } = await import('@/lib/customer/reply')
    const r = await skipCustomerMessage(admin, user.id, messageId)
    return NextResponse.json(r.ok ? { ok: true } : { error: 'Message not found' }, { status: r.ok ? 200 : 404 })
  }

  if (action === 'approve') {
    const messageId = String(body.messageId || '')
    if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })
    const { sendCustomerReply } = await import('@/lib/customer/reply')
    const r = await sendCustomerReply(admin, user.id, messageId, body.reply)
    if (!r.ok) return NextResponse.json({ error: r.note }, { status: r.error === 'not_found' ? 404 : 400 })
    return NextResponse.json({ ok: true, delivered: r.delivered, note: r.note })
  }

  if (action === 'assign_channel') {
    // Link a connected customer channel to a brand — messages that arrive on it become that brand's threads.
    const provider = String(body.provider || '')
    if (!provider) return NextResponse.json({ error: 'provider required' }, { status: 400 })
    const brandId = body.brandId || null
    await admin.from('channel_identities').update({ brand_id: brandId })
      .eq('user_id', user.id).eq('provider', provider).eq('active', true)
    // Separate-channel-per-brand model: the channel IS the brand, so adopt its existing UNASSIGNED
    // conversations too (never restamp threads already tagged to a brand). Only when linking (not clearing).
    let moved = 0
    if (brandId) {
      const { data: mv } = await admin.from('customer_threads').update({ brand_id: brandId })
        .eq('user_id', user.id).eq('channel', provider).is('brand_id', null).select('id')
      moved = (mv || []).length
    }
    return NextResponse.json({ ok: true, moved })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
