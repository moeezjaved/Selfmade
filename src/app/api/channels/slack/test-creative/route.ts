/**
 * Push a "creative ready → launch" card to the founder's Slack (your most recent finished creative), so
 * you can see and tap "Launch my pick." Tapping hands you into the launcher preloaded with it.
 *
 * POST /api/channels/slack/test-creative → { sent, gen } | { error }
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendCreativeReadyToChannels, getIdentities, isFounderChannel } from '@/lib/channels/send'

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

  const { data: gen } = await admin.from('creative_generations')
    .select('id, image_url, media_type, brand_id, status')
    .eq('user_id', user.id).eq('status', 'done').not('image_url', 'is', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!gen) {
    return NextResponse.json({ error: 'no_creative', message: 'No finished creative yet — generate or clone an ad first, then try again.' }, { status: 404 })
  }
  if (gen.brand_id) {
    const { data: b } = await admin.from('brands').select('name').eq('id', gen.brand_id).maybeSingle()
    if (b?.name) (gen as any).brand_name = b.name
  }

  const { sent } = await sendCreativeReadyToChannels(admin, user.id, gen)
  return NextResponse.json({ sent, gen: { id: gen.id, media_type: gen.media_type } })
}
