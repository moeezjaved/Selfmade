/**
 * GET  /api/creators            — the pipeline: creators grouped by stage + counts (+ ?id= for one creator
 *                                  with its full conversation).
 * POST /api/creators            — actions:
 *   draft_offer { ids[], offerType, offerDetails }  → draft an invite per creator (pending, for approval)
 *   send { messageIds[] }                            → approve + send the drafted invites (email if we can,
 *                                                       else marked so the founder copies it) → stage invited
 *   draft_reply { id }                               → draft the next reply (collects address once agreed)
 *   send_reply { messageId }                         → approve + send a drafted reply
 *   skip_message { messageId }                       → drop a draft
 *   simulate_reply { id, body }                      → drop in a fake inbound (test the flow now) → replied
 *   set_offer { id, offerType, offerDetails }        → set the offer on a creator
 *   advance { id, stage }                            → move a creator along the pipeline
 *   save_details { id, ship_name, ship_address, ship_phone } → capture shipping details → stage details
 *   generate_script { id }                           → write the UGC brief, grounded in winning angles
 *   delete { id }
 * Nothing is ever sent to a creator without the founder approving it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { draftCreatorOffer, draftCreatorReply, type OfferType } from '@/lib/creators/outreach'
import { generateCreatorScript } from '@/lib/creators/script'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const STAGES = ['sourced', 'invited', 'replied', 'confirmed', 'details', 'shipped', 'received', 'declined']

async function brandName(admin: any, userId: string, brandId?: string | null): Promise<string> {
  try {
    if (brandId) { const { data } = await admin.from('brands').select('name').eq('id', brandId).maybeSingle(); if (data?.name) return data.name }
    const { data } = await admin.from('brands').select('name').eq('user_id', userId).order('created_at', { ascending: true }).limit(1).maybeSingle()
    return data?.name || ''
  } catch { return '' }
}

/** Try to actually send to a creator (email-first). Returns whether it was delivered + a note. */
async function sendToCreator(admin: any, userId: string, creator: any, text: string): Promise<{ delivered: boolean; note: string }> {
  // Email is the safe channel — send from the founder's connected email account if we have both.
  if (creator.email) {
    try {
      const { data: acct } = await admin.from('channel_identities').select('external_id, meta')
        .eq('user_id', userId).eq('provider', 'email').eq('active', true).limit(1).maybeSingle()
      const accountId = acct?.meta?.unipile_account_id || acct?.external_id
      if (accountId) {
        const { unipileSendEmail } = await import('@/lib/channels/providers')
        const r = await unipileSendEmail(String(accountId), { to: creator.email, subject: 'Quick collab idea 💛', text })
        if (r.ok) return { delivered: true, note: 'Emailed' }
      }
    } catch { /* fall through to manual */ }
  }
  return { delivered: false, note: 'Ready to send — copy it into your DM/email' }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const { data: creator } = await admin.from('creators').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
    if (!creator) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const { data: messages } = await admin.from('creator_messages').select('*').eq('creator_id', id).order('created_at', { ascending: true })
    return NextResponse.json({ creator, messages: messages || [] })
  }

  const { data: creators } = await admin.from('creators').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(500)
  const list = (creators || []) as any[]
  const counts: Record<string, number> = {}
  for (const s of STAGES) counts[s] = 0
  for (const c of list) counts[c.stage] = (counts[c.stage] || 0) + 1
  // Pending drafts waiting on approval (invites + replies).
  const { count: pending } = await admin.from('creator_messages').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('direction', 'out').eq('status', 'pending')
  return NextResponse.json({ creators: list, counts, pending: pending || 0 })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  const getCreator = async (id: string) => (await admin.from('creators').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()).data

  if (action === 'draft_offer') {
    const ids: string[] = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : [])
    if (!ids.length) return NextResponse.json({ error: 'no creators' }, { status: 400 })
    const offerType = (['gifted', 'paid', 'affiliate'].includes(body.offerType) ? body.offerType : 'gifted') as OfferType
    const offerDetails = String(body.offerDetails || '')
    let drafted = 0
    for (const id of ids) {
      const c = await getCreator(id); if (!c) continue
      const brand = await brandName(admin, user.id, c.brand_id)
      const text = await draftCreatorOffer(admin, user.id, { handle: c.handle, name: c.full_name, brand, type: offerType, details: offerDetails, bio: c.bio, category: c.category })
      await admin.from('creators').update({ offer_type: offerType, offer_details: offerDetails, updated_at: new Date().toISOString() }).eq('id', id)
      // Replace any existing pending invite so re-drafting doesn't stack.
      await admin.from('creator_messages').delete().eq('creator_id', id).eq('direction', 'out').eq('status', 'pending')
      await admin.from('creator_messages').insert({ creator_id: id, user_id: user.id, direction: 'out', body: text, channel: c.email ? 'email' : 'instagram', status: 'pending' })
      drafted++
    }
    return NextResponse.json({ ok: true, drafted })
  }

  if (action === 'send') {
    const messageIds: string[] = Array.isArray(body.messageIds) ? body.messageIds : (body.messageId ? [body.messageId] : [])
    // Allow "send all pending" when only ids are given.
    let msgs: any[] = []
    if (messageIds.length) { const { data } = await admin.from('creator_messages').select('*').in('id', messageIds).eq('user_id', user.id).eq('status', 'pending'); msgs = data || [] }
    else if (Array.isArray(body.ids)) { const { data } = await admin.from('creator_messages').select('*').in('creator_id', body.ids).eq('user_id', user.id).eq('direction', 'out').eq('status', 'pending'); msgs = data || [] }
    let sent = 0, delivered = 0
    for (const m of msgs) {
      const c = await getCreator(m.creator_id); if (!c) continue
      const text = body.overrides?.[m.id] || m.body
      const r = await sendToCreator(admin, user.id, c, text)
      await admin.from('creator_messages').update({ status: 'sent', body: text }).eq('id', m.id)
      const nextStage = c.stage === 'sourced' ? 'invited' : c.stage
      await admin.from('creators').update({ stage: nextStage, last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', c.id)
      sent++; if (r.delivered) delivered++
    }
    return NextResponse.json({ ok: true, sent, delivered })
  }

  if (action === 'skip_message') {
    const messageId = String(body.messageId || '')
    if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })
    await admin.from('creator_messages').update({ status: 'skipped' }).eq('id', messageId).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'draft_reply') {
    const id = String(body.id || ''); const c = await getCreator(id); if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const { data: history } = await admin.from('creator_messages').select('direction, body').eq('creator_id', id).order('created_at', { ascending: true })
    const brand = await brandName(admin, user.id, c.brand_id)
    const needDetails = c.stage === 'confirmed' && !(c.ship_address)
    const text = await draftCreatorReply(admin, user.id, { brand, stage: c.stage, history: (history || []) as any, offerType: c.offer_type || undefined, offerDetails: c.offer_details || undefined, needDetails })
    await admin.from('creator_messages').delete().eq('creator_id', id).eq('direction', 'out').eq('status', 'pending')
    const { data: msg } = await admin.from('creator_messages').insert({ creator_id: id, user_id: user.id, direction: 'out', body: text, channel: c.email ? 'email' : 'instagram', status: 'pending' }).select('id').single()
    return NextResponse.json({ ok: true, messageId: msg?.id, text })
  }

  if (action === 'send_reply') {
    const messageId = String(body.messageId || '')
    const { data: m } = await admin.from('creator_messages').select('*').eq('id', messageId).eq('user_id', user.id).maybeSingle()
    if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const c = await getCreator(m.creator_id); if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const text = body.text || m.body
    const r = await sendToCreator(admin, user.id, c, text)
    await admin.from('creator_messages').update({ status: 'sent', body: text }).eq('id', messageId)
    await admin.from('creators').update({ last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', c.id)
    return NextResponse.json({ ok: true, delivered: r.delivered, note: r.note })
  }

  if (action === 'simulate_reply') {
    const id = String(body.id || ''); const c = await getCreator(id); if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const text = String(body.body || 'Yes, I’d love to! Tell me more 😊')
    await admin.from('creator_messages').insert({ creator_id: id, user_id: user.id, direction: 'in', body: text, channel: c.email ? 'email' : 'instagram', status: 'sent' })
    const nextStage = ['sourced', 'invited'].includes(c.stage) ? 'replied' : c.stage
    await admin.from('creators').update({ stage: nextStage, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'set_offer') {
    const id = String(body.id || '')
    const offerType = (['gifted', 'paid', 'affiliate'].includes(body.offerType) ? body.offerType : 'gifted')
    await admin.from('creators').update({ offer_type: offerType, offer_details: String(body.offerDetails || ''), updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'advance') {
    const id = String(body.id || ''); const stage = String(body.stage || '')
    if (!STAGES.includes(stage)) return NextResponse.json({ error: 'bad stage' }, { status: 400 })
    await admin.from('creators').update({ stage, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'save_details') {
    const id = String(body.id || '')
    await admin.from('creators').update({
      ship_name: String(body.ship_name || '').trim() || null,
      ship_address: String(body.ship_address || '').trim() || null,
      ship_phone: String(body.ship_phone || '').trim() || null,
      stage: 'details', updated_at: new Date().toISOString(),
    }).eq('id', id).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'generate_script') {
    const id = String(body.id || ''); const c = await getCreator(id); if (!c) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const brand = await brandName(admin, user.id, c.brand_id)
    const script = await generateCreatorScript(admin, user.id, { brand })
    await admin.from('creators').update({ script, updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true, script })
  }

  if (action === 'delete') {
    const id = String(body.id || '')
    await admin.from('creators').delete().eq('id', id).eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
