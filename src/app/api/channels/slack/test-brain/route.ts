/**
 * Push a PROPOSED Company Brain fact to the founder's Slack DM on demand, so you can see and tap the
 * confirm/correct/drop card. Uses a REAL proposed memory (mello_memory.status='proposed'); if none is
 * waiting it seeds one observed pattern so the loop is testable. Confirming/dropping runs the same
 * confirmMemory() path the web uses — nothing is fabricated as truth, it stays 'proposed' until you say so.
 *
 * POST /api/channels/slack/test-brain → { sent, memory } | { error }
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendBrainProposalToChannels, getIdentities, isFounderChannel } from '@/lib/channels/send'
import { proposedMemories } from '@/lib/brain'

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

  // Prefer a real proposed memory the Brain already surfaced.
  let memory = (await proposedMemories(admin, user.id))[0]

  // None waiting → seed one observed pattern as 'proposed' so the confirm loop is testable. It stays a
  // PROPOSAL (never reasoned over as truth) until the founder taps confirm.
  if (!memory) {
    const { data: seeded } = await admin.from('mello_memory').insert({
      user_id: user.id,
      content: 'Thursday 9–10am converts about 2.4× the daily average — it looks like the best hour to spend.',
      category: 'audience',
      confidence: 60,
      status: 'proposed',
      source: 'system',
    }).select('id, content, category, confidence').maybeSingle()
    memory = seeded
  }

  if (!memory) return NextResponse.json({ error: 'seed_failed', message: 'Could not prepare a memory to send.' }, { status: 500 })

  const { sent } = await sendBrainProposalToChannels(admin, user.id, memory)
  return NextResponse.json({ sent, memory: { id: memory.id, content: memory.content } })
}
