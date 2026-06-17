/**
 * Admin Brands API — manage brand crawl terms + show crawl state.
 *
 * GET    /api/admin/brands           — list all crawl terms + crawl state
 * POST   /api/admin/brands           — add a new brand to the crawl rotation
 * DELETE /api/admin/brands?id=XX     — remove a brand
 * PATCH  /api/admin/brands           — toggle is_active or trigger immediate re-crawl
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const RECRAWL_INTERVAL_DAYS = 7

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const [
    { data: terms },
    { data: states },
  ] = await Promise.all([
    // Show only BRAND-type terms (not category/adcopy seeds).
    // A row counts as a brand if term_type='brand' OR it has a page_id.
    admin
      .from('discovery_crawl_terms')
      .select('id, term, term_type, page_id, category, categories, countries, industry, priority, is_active, follower_count, picture, website, notes, created_at')
      .or('term_type.eq.brand,page_id.not.is.null')
      .order('created_at', { ascending: false }),
    admin
      .from('discovery_brand_crawl_state')
      .select('page_id, brand_name, cursor, ads_indexed, last_run_at, last_run_added, exhausted_at')
      .order('last_run_at', { ascending: false }),
  ])

  // Per-brand ad count + canonical display name. A single Meta page runs ads
  // under several names (its own + partnership/affiliate ads, e.g. Grüns's page
  // also shows "Chelsea Handler"). The real brand name is the MOST COMMON
  // page_name on that page — not whichever ad we happen to sample first. We
  // fetch a sample of page_names per brand and take the mode. Run sequentially
  // (parallel times out) with 'estimated' count (fast on big tables).
  const adCountByPage: Record<string, { count: number; name: string }> = {}
  const tracked = (terms || []).filter((t: any) => t.page_id)
  for (const t of tracked) {
    try {
      const { data: sample, count, error } = await admin
        .from('discovery_ads_index')
        .select('page_name', { count: 'estimated' })
        .eq('page_id', t.page_id)
        .not('page_name', 'is', null)
        .limit(400)
      if (error) continue
      const freq: Record<string, number> = {}
      for (const r of (sample || []) as any[]) {
        const n = (r.page_name || '').trim()
        if (n) freq[n] = (freq[n] || 0) + 1
      }
      const canonical = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || ''
      adCountByPage[t.page_id] = { count: count || 0, name: canonical }
    } catch { /* skip on failure */ }
  }

  // Build a map: page_id → state
  const stateByPageId: Record<string, any> = {}
  for (const s of (states || []) as any[]) {
    stateByPageId[s.page_id] = s
  }

  // Combine: each brand term gets its state + ad count
  const now = Date.now()
  const enriched = (terms || []).map((t: any) => {
    const state = t.page_id ? stateByPageId[t.page_id] : null
    const counts = t.page_id ? adCountByPage[t.page_id] : null
    let next_recrawl_at: string | null = null
    let status = 'queued'
    if (state?.exhausted_at) {
      const next = new Date(new Date(state.exhausted_at).getTime() + RECRAWL_INTERVAL_DAYS * 86_400_000)
      next_recrawl_at = next.toISOString()
      status = next.getTime() > now ? 'exhausted_waiting' : 'ready_to_recrawl'
    } else if (state?.cursor) {
      status = 'in_progress'
    }
    return {
      ...t,
      state: state ? {
        last_run_at: state.last_run_at,
        ads_indexed: state.ads_indexed,
        last_run_added: state.last_run_added,
        exhausted_at: state.exhausted_at,
        in_progress: !!state.cursor,
      } : null,
      ad_count: counts?.count || 0,
      brand_name: counts?.name || t.term,
      next_recrawl_at,
      status,
    }
  })

  // Also collect any brands in state table that have NO term (lost track)
  const orphans = (states || [])
    .filter((s: any) => !terms?.some((t: any) => t.page_id === s.page_id))
    .map((s: any) => ({
      ...s,
      orphan: true,
      next_recrawl_at: s.exhausted_at
        ? new Date(new Date(s.exhausted_at).getTime() + RECRAWL_INTERVAL_DAYS * 86_400_000).toISOString()
        : null,
    }))

  return NextResponse.json({
    terms: enriched,
    orphans,
    summary: {
      total_terms: terms?.length || 0,
      active_terms: (terms || []).filter((t: any) => t.is_active).length,
      brands_indexed: Object.keys(adCountByPage).filter(k => adCountByPage[k].count > 0).length,
      total_ads: Object.values(adCountByPage).reduce((s, x) => s + x.count, 0),
    },
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json()
  const { term, page_id, term_type, category, countries, priority } = body

  if (!term?.trim()) return NextResponse.json({ error: 'term required' }, { status: 400 })

  const insert: Record<string, any> = {
    term: term.trim().toLowerCase(),
    term_type: term_type || 'brand',
    category: category || 'General',
    // Global default — many brands target outside US even if HQ'd there (e.g. Hims).
    // Meta's ad_reached_countries is an OR filter, so listing many countries just
    // returns more ads, not duplicates. Per-brand budget keeps cron tick fair.
    countries: countries || ['US','GB','CA','AU','DE','FR','IT','ES','NL','SE','PL','MX','BR','IN','JP','SG','AE','ZA'],
    priority: priority || 5,
    is_active: true,
  }
  if (page_id) insert.page_id = String(page_id).trim()

  const { data, error } = await admin
    .from('discovery_crawl_terms')
    .insert(insert)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ term: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await admin.from('discovery_crawl_terms').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ success: true })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json()
  const { action, id, page_id, is_active, categories, industry } = body

  if (action === 'toggle' && id != null) {
    await admin.from('discovery_crawl_terms').update({ is_active }).eq('id', id)
    return NextResponse.json({ success: true })
  }

  if (action === 'update_categories' && id != null && Array.isArray(categories)) {
    await (admin as any)
      .from('discovery_crawl_terms')
      .update({ categories: categories.map(c => String(c).trim().toLowerCase()).filter(Boolean) })
      .eq('id', id)
    return NextResponse.json({ success: true })
  }

  // Manual INDUSTRY override — authoritative for the brand, beats auto-detection.
  // Apply to the brand row AND immediately to all its ads so the change is live.
  if (action === 'update_industry' && id != null && page_id) {
    const ind = industry ? String(industry).trim() : null
    await (admin as any).from('discovery_crawl_terms').update({ industry: ind }).eq('id', id)
    await (admin as any).from('discovery_ads_index').update({ industries: ind ? [ind] : [] }).eq('page_id', page_id)
    return NextResponse.json({ success: true })
  }

  if (action === 'force_recrawl' && page_id) {
    // For brands that already have state: just clear cursor + exhausted_at
    // For brands with no state: insert fresh row (with NULL last_run_at so
    // the UI doesn't show a fake "2m ago")
    const { data: existing } = await (admin as any)
      .from('discovery_brand_crawl_state')
      .select('page_id')
      .eq('page_id', page_id)
      .maybeSingle()

    if (existing) {
      await (admin as any)
        .from('discovery_brand_crawl_state')
        .update({ cursor: null, exhausted_at: null })
        .eq('page_id', page_id)
    } else {
      await (admin as any)
        .from('discovery_brand_crawl_state')
        .insert({ page_id, cursor: null, exhausted_at: null })
    }

    // Reset last_crawled_at on the term so cron picks it first
    await (admin as any)
      .from('discovery_crawl_terms')
      .update({ last_crawled_at: null })
      .eq('page_id', page_id)

    return NextResponse.json({
      success: true,
      message: 'Queued at top of priority. Will crawl on next cron tick (≤15 min). If another big brand is currently crawling, may take 1-2 ticks.'
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
