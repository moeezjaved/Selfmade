/**
 * Sales Assistant — the follow-up engine. Finds buying-intent conversations (someone asked about price/
 * buying) where WE had the last word and the customer went quiet for ~a day, and DRAFTS a warm follow-up
 * nudge — which lands in the founder's Outbound tab (+ Slack) to approve. Never auto-sends; capped at 2
 * follow-ups per thread so it's never spammy. This is "still thinking? happy to help" — the move that
 * quietly recovers sales. Auth: CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { draftOutbound } from '@/lib/customer/outbound'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const h = req.headers.get('authorization') || ''
  return h === `Bearer ${secret}` || req.nextUrl.searchParams.get('secret') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()

  // Cold buying-intent threads: we replied (status 'replied'), price intent, not converted, quiet ~20h+,
  // fewer than 2 follow-ups so far. Bounded per run.
  const cutoff = new Date(Date.now() - 20 * 3600 * 1000).toISOString()
  const { data: threads } = await admin.from('customer_threads')
    .select('id, user_id, channel, contact_ref, contact_name, brand_id, followups')
    .eq('status', 'replied').eq('intent', 'price').eq('converted', false)
    .lt('followups', 2).lt('last_message_at', cutoff).limit(50)

  let drafted = 0
  for (const t of (threads || []) as any[]) {
    try {
      // Skip if a follow-up is already pending for this thread (avoid stacking).
      const { data: pend } = await admin.from('customer_messages').select('id')
        .eq('thread_id', t.id).eq('direction', 'out').eq('status', 'pending').limit(1).maybeSingle()
      if (pend) continue

      let brandName = ''
      try { const { data } = await admin.from('brands').select('name').eq('id', t.brand_id).maybeSingle(); brandName = data?.name || '' } catch { /* ok */ }
      const draft = await draftOutbound(admin, t.user_id, { type: 'follow_up', name: t.contact_name || '', brand: brandName, brandId: t.brand_id || null })
      const { data: msg } = await admin.from('customer_messages').insert({
        thread_id: t.id, user_id: t.user_id, direction: 'out', body: draft, intent: 'follow_up', status: 'pending',
      }).select('id').single()
      await admin.from('customer_threads').update({ followups: (t.followups || 0) + 1 }).eq('id', t.id)

      // Nudge the founder in Slack/WhatsApp so they can approve the follow-up from chat.
      try {
        if (msg?.id) {
          const { pushCustomerMessage } = await import('@/lib/channels/send')
          await pushCustomerMessage(admin, t.user_id, { messageId: msg.id, contactName: t.contact_name, channel: t.channel, priority: 'med', intent: 'sales follow-up', body: 'They asked about buying, then went quiet.', draft })
        }
      } catch { /* push best-effort */ }
      drafted++
    } catch { /* skip one */ }
  }
  return NextResponse.json({ ok: true, considered: (threads || []).length, drafted })
}
