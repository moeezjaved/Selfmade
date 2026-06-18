/**
 * Brand detail API — aggregates all ads for a brand (page_id) from our indexed DB.
 * Powers the brand drawer: Creatives, Hooks, Ad copy, Headlines, Landing pages,
 * Personas, Ad angles, USPs, Desires, Emotions, Themes tabs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { searchParams } = request.nextUrl
    const pageId = searchParams.get('page_id')
    const days = parseInt(searchParams.get('days') || '0')

    if (!pageId) return NextResponse.json({ error: 'page_id required' }, { status: 400 })

    const sinceDate = days > 0
      ? new Date(Date.now() - days * 86400000).toISOString()
      : null

    let query = admin
      .from('discovery_ads_index')
      .select('ad_id, page_id, page_name, body, title, caption, description, snapshot_url, start_date, stop_date, is_active, days_running, format, thumbnail_url, video_url, platforms, hook_type, emotion, angle, cta, tone, persona, desire, usp, themes, industries, country, last_seen, ai_classified')
      .eq('page_id', pageId)
      .order('last_seen', { ascending: false })
      .limit(1000)

    if (sinceDate) query = query.gte('start_date', sinceDate)

    const { data: ads, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const allAds = ads || []

    if (!allAds.length) {
      return NextResponse.json({
        brand: { page_id: pageId, page_name: '', total_ads: 0, active_ads: 0, first_seen: null, last_seen: null, with_creative: 0, video_ads: 0, avg_days_running: 0 },
        creatives: [], adCopies: [], headlines: [], hooks: [], angles: [],
        emotions: [], themes: [], personas: [], usps: [], desires: [], landingPages: [],
      })
    }

    // ── Brand stats ──────────────────────────────────────────────
    const activeAds = allAds.filter((a: any) => a.is_active)
    const withCreative = allAds.filter((a: any) => a.thumbnail_url || a.video_url)
    const videoAds = allAds.filter((a: any) => a.format === 'Video' || a.video_url)
    const dates = allAds.map((a: any) => a.start_date).filter(Boolean).sort()

    const brand = {
      page_id: pageId,
      page_name: allAds[0]?.page_name || '',
      total_ads: allAds.length,
      active_ads: activeAds.length,
      first_seen: dates[0] || null,
      last_seen: allAds[0]?.last_seen || null,
      with_creative: withCreative.length,
      video_ads: videoAds.length,
      avg_days_running: Math.round(allAds.reduce((s: number, a: any) => s + (a.days_running || 0), 0) / allAds.length),
    }

    // ── Aggregate AI classifications ─────────────────────────────
    const hookMap: Record<string, { count: number; examples: { id: string; body: string; thumb: string | null }[] }> = {}
    const angleMap: Record<string, number> = {}
    const emotionMap: Record<string, number> = {}
    const themeMap: Record<string, number> = {}
    const personaMap: Record<string, number> = {}
    const uspMap: Record<string, number> = {}
    const desireMap: Record<string, number> = {}

    for (const ad of allAds) {
      if (ad.hook_type) {
        if (!hookMap[ad.hook_type]) hookMap[ad.hook_type] = { count: 0, examples: [] }
        hookMap[ad.hook_type].count++
        if (hookMap[ad.hook_type].examples.length < 3 && ad.body) {
          hookMap[ad.hook_type].examples.push({ id: ad.ad_id, body: ad.body.slice(0, 160), thumb: ad.thumbnail_url || null })
        }
      }
      if (ad.angle) angleMap[ad.angle] = (angleMap[ad.angle] || 0) + 1
      for (const e of (ad.emotion || [])) emotionMap[e] = (emotionMap[e] || 0) + 1
      for (const t of (ad.themes || [])) themeMap[t] = (themeMap[t] || 0) + 1
      if (ad.persona) personaMap[ad.persona] = (personaMap[ad.persona] || 0) + 1
      if (ad.usp) uspMap[ad.usp] = (uspMap[ad.usp] || 0) + 1
      if (ad.desire) desireMap[ad.desire] = (desireMap[ad.desire] || 0) + 1
    }

    const sortMap = (map: Record<string, number>) =>
      Object.entries(map).sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }))

    return NextResponse.json({
      brand,
      creatives: allAds.slice(0, 80),
      adCopies: allAds
        .filter((a: any) => a.body)
        .map((a: any) => ({ id: a.ad_id, text: a.body, isActive: a.is_active, date: a.start_date, snapshot_url: a.snapshot_url, thumb: a.thumbnail_url }))
        .slice(0, 300),
      headlines: allAds
        .filter((a: any) => a.title)
        .map((a: any) => ({ id: a.ad_id, text: a.title, isActive: a.is_active, date: a.start_date, snapshot_url: a.snapshot_url }))
        .slice(0, 300),
      hooks: Object.entries(hookMap)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([type, data]) => ({ type, ...data })),
      angles: sortMap(angleMap),
      emotions: sortMap(emotionMap),
      themes: sortMap(themeMap),
      personas: sortMap(personaMap).slice(0, 30),
      usps: sortMap(uspMap).slice(0, 30),
      desires: sortMap(desireMap).slice(0, 30),
      landingPages: [], // future: scrape ad destination URLs
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
