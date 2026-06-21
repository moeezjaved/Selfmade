/**
 * Single ad detail — fetches one ad + its carousel creatives.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: ad, error } = await admin
    .from('discovery_ads_index')
    .select('*')
    .eq('ad_id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!ad) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: creatives } = await admin
    .from('discovery_creatives')
    .select('position, asset_type, r2_url, hash')
    .eq('ad_id', params.id)
    .order('asset_type', { ascending: true })
    .order('position', { ascending: true })

  return NextResponse.json({
    ad: {
      id: (ad as any).ad_id,
      pageId: (ad as any).page_id,
      pageName: (ad as any).page_name,
      body: (ad as any).body,
      title: (ad as any).title,
      caption: (ad as any).caption,
      description: (ad as any).description,
      snapshotUrl: (ad as any).snapshot_url,
      // creative-queue Phase 2: prefer discovery_creatives (the drain no longer writes
      // thumbnail_url/video_url back to the ads table), fall back to legacy columns.
      thumbnailUrl: (creatives || []).find((c: any) => c.asset_type === 'image')?.r2_url || (ad as any).thumbnail_url,
      videoUrl: (creatives || []).find((c: any) => c.asset_type === 'video')?.r2_url || (ad as any).video_url,
      creatives: creatives || [],
      startDate: (ad as any).start_date,
      stopDate: (ad as any).stop_date,
      platforms: (ad as any).platforms || [],
      languages: (ad as any).languages || [],
      isActive: (ad as any).is_active,
      daysRunning: (ad as any).days_running,
      country: (ad as any).country,
      format: (ad as any).format,
      industries: (ad as any).industries || [],
      topics: (ad as any).topics || [],
      // AI classification (powers the accurate category + Scripts/Clone context)
      hookType: (ad as any).hook_type,
      angle: (ad as any).angle,
      persona: (ad as any).persona,
      usp: (ad as any).usp,
      aiClassified: (ad as any).ai_classified,
      cta: (ad as any).cta,
      mediaType: (ad as any).media_type,
    },
  })
}
