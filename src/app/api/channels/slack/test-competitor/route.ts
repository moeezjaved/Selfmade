/**
 * Push a "competitor ad worth answering" card to the founder's Slack, so you can see and tap "Make ours
 * like this." Prefers a real ad from a competitor the founder is watching (followed_brands), and only
 * picks ads that have a VIDEO creative so the remake button actually has something to clone.
 *
 * POST /api/channels/slack/test-competitor → { sent, ad } | { error }
 */
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sendCompetitorAdToChannels, getIdentities, isFounderChannel } from '@/lib/channels/send'

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

  // Which competitor pages is the founder watching?
  const { data: followed } = await admin.from('followed_brands').select('page_id').eq('user_id', user.id)
  const pageIds = Array.from(new Set((followed || []).map((f: any) => f.page_id).filter(Boolean)))

  // Find an ad (from a watched competitor, else any recent) that has a VIDEO creative to clone.
  const pickAd = async (fromWatched: boolean) => {
    let q = admin.from('discovery_ads_index')
      .select('ad_id, page_name, days_running, discovery_creatives(asset_type, poster_url, r2_url, position)')
      .order('days_running', { ascending: false }).limit(30)
    if (fromWatched && pageIds.length) q = q.in('page_id', pageIds)
    const { data } = await q
    for (const a of (data || []) as any[]) {
      const crs = Array.isArray(a.discovery_creatives) ? a.discovery_creatives : []
      const vid = crs.find((c: any) => c.asset_type === 'video')
      const poster = vid?.poster_url || crs.find((c: any) => c.poster_url)?.poster_url || crs.find((c: any) => c.r2_url)?.r2_url || null
      if (vid) return { ad_id: a.ad_id, page_name: a.page_name, days_running: a.days_running, poster_url: poster }
    }
    return null
  }

  const ad = (pageIds.length ? await pickAd(true) : null) || await pickAd(false)
  if (!ad) {
    return NextResponse.json({ error: 'no_ad', message: 'No competitor video ad on hand to remake. Watch a competitor in Discovery first (Spy → follow a brand).' }, { status: 404 })
  }

  const { sent } = await sendCompetitorAdToChannels(admin, user.id, ad)
  return NextResponse.json({ sent, ad: { ad_id: ad.ad_id, page_name: ad.page_name } })
}
