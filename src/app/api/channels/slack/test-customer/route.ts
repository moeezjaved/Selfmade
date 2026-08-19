/**
 * Push a customer-trend card to the founder's Slack so you can see and tap "Draft replies" / "Change
 * promise." Picks the founder's busiest inbox topic from real customer_messages (with a verbatim quote).
 *
 * POST /api/channels/slack/test-customer → { sent, trend } | { error }
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendCustomerTrendToChannels, getIdentities, isFounderChannel } from '@/lib/channels/send'

export const dynamic = 'force-dynamic'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient() as any

  const founderSlack = (await getIdentities(admin, user.id, 'slack')).filter(isFounderChannel)
  if (!founderSlack.length || !founderSlack.some((i: any) => i.meta?.channel_id)) {
    return NextResponse.json({ error: 'no_slack', message: 'Connect Slack first: Selfmade → Settings → Slack & WhatsApp.' }, { status: 400 })
  }

  // Busiest topic among recent inbound customer messages, with a real quote to make it human.
  const { data: msgs } = await admin.from('customer_messages')
    .select('intent, body, created_at')
    .eq('user_id', user.id).eq('direction', 'in')
    .order('created_at', { ascending: false }).limit(300)
  const rows = (msgs || []) as any[]
  if (!rows.length) {
    return NextResponse.json({ error: 'no_messages', message: 'No customer messages yet — connect the inbox and let a few land, then try again.' }, { status: 404 })
  }
  const counts: Record<string, number> = {}
  for (const m of rows) { const k = m.intent || 'other'; counts[k] = (counts[k] || 0) + 1 }
  const intent = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
  const quote = rows.find(m => (m.intent || 'other') === intent && m.body)?.body || undefined
  const trend = { intent, count: counts[intent], quote }

  const { sent } = await sendCustomerTrendToChannels(admin, user.id, trend)
  return NextResponse.json({ sent, trend: { intent, count: counts[intent] } })
}
