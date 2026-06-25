/**
 * Top Picks — single pack detail. Returns the expert, the pack, and its ads (hydrated from the
 * corpus with creatives + each ad's Canva template URL).
 *
 * GATING: a 'free' pack (or one the user has purchased) returns ALL ads with their Canva links.
 * A 'paid'/'core' pack the user hasn't unlocked returns a PREVIEW (first few ads, no Canva link)
 * plus `locked: true` so the UI shows the buy wall.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createReadClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/lib/supabase/missing-table'

export const dynamic = 'force-dynamic'

const PREVIEW_COUNT = 6

const firstThumb = (cres: any[] = []) => {
  const img = cres.find((c) => c.asset_type === 'image')
  const vid = cres.find((c) => c.asset_type === 'video')
  return img?.poster_url || img?.r2_url || vid?.poster_url || vid?.r2_url || null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createReadClient()
  const { data: pack, error } = await admin
    .from('expert_packs')
    .select('*, experts(id, name, handle, avatar_url, bio)')
    .eq('id', packId)
    .eq('is_published', true)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (!pack) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Has the user unlocked it? Free packs are always open.
  let purchased = false
  if (pack.gate !== 'free') {
    const { data: pur } = await admin
      .from('expert_pack_purchases')
      .select('id').eq('user_id', user.id).eq('pack_id', packId).maybeSingle()
    purchased = !!pur
  }
  const unlocked = pack.gate === 'free' || purchased

  // Pack ads in order.
  const { data: packAds } = await admin
    .from('expert_pack_ads')
    .select('ad_id, canva_template_url, position')
    .eq('pack_id', packId)
    .order('position', { ascending: true })
  const ordered = (packAds || []) as any[]
  const visible = unlocked ? ordered : ordered.slice(0, PREVIEW_COUNT)

  // Hydrate visible ads from the corpus (brand, copy, dates, creative thumbnail).
  const ids = visible.map((r) => r.ad_id)
  const byId: Record<string, any> = {}
  if (ids.length) {
    const { data: corpus } = await admin
      .from('discovery_ads_index')
      .select('ad_id, page_id, page_name, body, title, start_date, stop_date, is_active, days_running, format, discovery_creatives(asset_type,position,r2_url,poster_url)')
      .in('ad_id', ids)
    for (const a of (corpus || []) as any[]) byId[a.ad_id] = a
  }

  const ads = visible
    .map((r) => {
      const a = byId[r.ad_id]
      if (!a) return null   // corpus re-index dropped it — skip silently
      return {
        adId: a.ad_id,
        pageId: a.page_id,
        pageName: a.page_name,
        body: a.body,
        title: a.title,
        startDate: a.start_date,
        stopDate: a.stop_date,
        isActive: a.is_active,
        daysRunning: a.days_running,
        format: a.format,
        thumbnail: firstThumb(a.discovery_creatives),
        // Canva link is the paid payload — only when unlocked.
        canvaUrl: unlocked ? (r.canva_template_url || null) : null,
      }
    })
    .filter(Boolean)

  return NextResponse.json({
    pack: {
      id: pack.id, title: pack.title, description: pack.description, cover_url: pack.cover_url,
      price_cents: pack.price_cents, original_price_cents: pack.original_price_cents,
      is_early_bird: pack.is_early_bird, gate: pack.gate,
      total_ads: ordered.length,
    },
    expert: pack.experts,
    ads,
    unlocked,
    locked: !unlocked,
    previewCount: unlocked ? ordered.length : Math.min(PREVIEW_COUNT, ordered.length),
  })
}
