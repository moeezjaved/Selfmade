/**
 * Admin Brands API — manage brand crawl terms + show crawl state.
 *
 * GET    /api/admin/brands           — list all crawl terms + crawl state
 * POST   /api/admin/brands           — add a new brand to the crawl rotation
 * DELETE /api/admin/brands?id=XX     — remove a brand
 * PATCH  /api/admin/brands           — toggle is_active or trigger immediate re-crawl
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAdminToken } from '@/lib/admin/auth'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RECRAWL_INTERVAL_DAYS = 7

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Optional search: exact page_id (numeric) or name substring. Without it the list is
  // capped at PostgREST's 1000-row default ordered newest-first, so older brands are
  // invisible — search finds ANY brand by name/page_id. discovery_crawl_terms is small
  // (~27K rows) so an ilike here is cheap (unlike the 700K+ ads table).
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  // view filters (applied server-side so they cover ALL brands, not just the newest 1000):
  //   all (default) · top (highest ad count) · never (never crawled) · fully (deep-crawled) ·
  //   crawling (being crawled right now) · spy (priority-9 spied brands)
  const view = (req.nextUrl.searchParams.get('view') || 'all').trim()
  const CRAWLING_WINDOW_MS = 35 * 60 * 1000   // matches the claim lease — crawling_at within this = live now
  const crawlingCutoff = new Date(Date.now() - CRAWLING_WINDOW_MS).toISOString()

  // Views ranked by a STATE-table column (ad count / new-ads / in-progress / soft-gated) need the
  // page_ids pre-fetched from discovery_brand_crawl_state, then we pull those term rows.
  const STATE_VIEWS = ['top', 'new_ads', 'in_progress', 'soft_gated']
  let stateIds: string[] | null = null
  if (!q && STATE_VIEWS.includes(view)) {
    let sq = admin.from('discovery_brand_crawl_state').select('page_id')
    if (view === 'top') sq = sq.gt('ads_indexed', 0).order('ads_indexed', { ascending: false })
    else if (view === 'new_ads') sq = sq.gt('last_run_added', 0).order('last_run_added', { ascending: false })
    else if (view === 'in_progress') sq = sq.not('cursor', 'is', null).order('last_run_at', { ascending: false })
    else if (view === 'soft_gated') sq = sq.not('soft_gate_at', 'is', null).order('soft_gate_at', { ascending: false })
    const { data: st } = await sq.limit(300)
    stateIds = (st || []).map((s: any) => s.page_id)
  }

  let termsQuery = admin
    .from('discovery_crawl_terms')
    .select('id, term, term_type, page_id, category, categories, countries, industry, priority, is_active, follower_count, picture, website, notes, created_at, last_crawled_at, full_crawled_at, crawling_at')
    .or('term_type.eq.brand,page_id.not.is.null')
  if (q) {
    if (/^\d+$/.test(q)) termsQuery = termsQuery.eq('page_id', q)
    else termsQuery = termsQuery.ilike('term', `%${q}%`)
    termsQuery = termsQuery.order('created_at', { ascending: false }).limit(200)
  } else if (view === 'never') {
    termsQuery = termsQuery.is('last_crawled_at', null).order('created_at', { ascending: false }).limit(1000)
  } else if (view === 'fully') {
    termsQuery = termsQuery.not('full_crawled_at', 'is', null).order('full_crawled_at', { ascending: false }).limit(1000)
  } else if (view === 'crawling') {
    termsQuery = termsQuery.gte('crawling_at', crawlingCutoff).order('crawling_at', { ascending: false }).limit(1000)
  } else if (view === 'spy') {
    termsQuery = termsQuery.gte('priority', 9).order('crawling_at', { ascending: false, nullsFirst: false }).limit(1000)
  } else if (view === 'removed') {
    // Auto-removed empty brands (1-strike). Kept (soft-delete) so a human can Restore false-positives.
    termsQuery = termsQuery.eq('is_active', false).eq('notes', 'auto_removed_empty').order('last_crawled_at', { ascending: false }).limit(1000)
  } else if (STATE_VIEWS.includes(view)) {
    termsQuery = (stateIds && stateIds.length) ? termsQuery.in('page_id', stateIds).limit(1000) : termsQuery.eq('page_id', '__none__')
  } else {
    termsQuery = termsQuery.order('created_at', { ascending: false }).limit(1000)
  }

  // States fetch is resilient to migration 044 (soft_gate_at): try with the column, fall back
  // without it, so a Vercel deploy ahead of the migration can't break the whole page.
  const STATE_COLS = 'page_id, brand_name, cursor, ads_indexed, last_run_at, last_run_added, exhausted_at'
  let { data: states } = await admin.from('discovery_brand_crawl_state').select(STATE_COLS + ', soft_gate_at').order('last_run_at', { ascending: false })
  if (!states) ({ data: states } = await admin.from('discovery_brand_crawl_state').select(STATE_COLS).order('last_run_at', { ascending: false }))

  const [
    { data: terms },
    { count: totalTermsCount },
    { count: activeTermsCount },
    { count: brandsIndexedCount },
    { count: totalAdsCount },
    { count: neverCrawledCount },
    { count: fullyCrawledCount },
    { count: crawlingNowCount },
    { count: spyCount },
    { count: inProgressCount },
    { count: newAdsCount },
    { count: softGatedCount },
    { count: removedCount },
  ] = await Promise.all([
    termsQuery,
    // Accurate summary counts. The two list queries above are capped at PostgREST's
    // 1000-row default, so deriving stats from their .length froze every card at 1000.
    // These head:true COUNT queries return the real totals regardless of that cap.
    admin
      .from('discovery_crawl_terms')
      .select('*', { count: 'exact', head: true })
      .or('term_type.eq.brand,page_id.not.is.null'),
    admin
      .from('discovery_crawl_terms')
      .select('*', { count: 'exact', head: true })
      .or('term_type.eq.brand,page_id.not.is.null')
      .eq('is_active', true),
    admin
      .from('discovery_brand_crawl_state')
      .select('*', { count: 'exact', head: true })
      .gt('ads_indexed', 0),
    // Big table → 'planned' (planner estimate) so this never hits the statement timeout.
    admin
      .from('discovery_ads_index')
      .select('*', { count: 'planned', head: true }),
    // Per-view counts for the filter chips (cheap head:true on the small terms table).
    admin.from('discovery_crawl_terms').select('*', { count: 'exact', head: true })
      .or('term_type.eq.brand,page_id.not.is.null').is('last_crawled_at', null),
    admin.from('discovery_crawl_terms').select('*', { count: 'exact', head: true })
      .or('term_type.eq.brand,page_id.not.is.null').not('full_crawled_at', 'is', null),
    admin.from('discovery_crawl_terms').select('*', { count: 'exact', head: true })
      .or('term_type.eq.brand,page_id.not.is.null').gte('crawling_at', crawlingCutoff),
    admin.from('discovery_crawl_terms').select('*', { count: 'exact', head: true })
      .or('term_type.eq.brand,page_id.not.is.null').gte('priority', 9),
    // crawl_state-based view counts (in-progress = saved cursor, new-ads, soft-gated).
    admin.from('discovery_brand_crawl_state').select('*', { count: 'exact', head: true }).not('cursor', 'is', null),
    admin.from('discovery_brand_crawl_state').select('*', { count: 'exact', head: true }).gt('last_run_added', 0),
    admin.from('discovery_brand_crawl_state').select('*', { count: 'exact', head: true }).not('soft_gate_at', 'is', null),
    admin.from('discovery_crawl_terms').select('*', { count: 'exact', head: true })
      .or('term_type.eq.brand,page_id.not.is.null').eq('is_active', false).eq('notes', 'auto_removed_empty'),
  ])

  // Build a map: page_id → state
  const stateByPageId: Record<string, any> = {}
  for (const s of (states || []) as any[]) {
    stateByPageId[s.page_id] = s
  }

  // Per-brand ad count comes from the crawl state's ads_indexed (already fetched
  // above) — NOT a live per-brand DB query. At ~900 brands the old per-brand loop
  // hit ~530s and 504'd the gateway, and a grouped RPC with mode(page_name) blew
  // past the 60s statement_timeout. ads_indexed is the crawler's tracked count for
  // the page and is effectively free here.
  const adCountByPage: Record<string, { count: number; name: string }> = {}
  for (const s of (states || []) as any[]) {
    adCountByPage[s.page_id] = { count: Number(s.ads_indexed) || 0, name: s.brand_name || '' }
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
    // Crawl-lifecycle flags for the admin filter chips.
    const crawling_now = !!t.crawling_at && new Date(t.crawling_at).getTime() > now - CRAWLING_WINDOW_MS
    const fully_crawled = !!t.full_crawled_at
    const never_crawled = !t.last_crawled_at
    const is_spy = (t.priority ?? 5) >= 9
    const in_progress = !!state?.cursor
    const soft_gated = !!state?.soft_gate_at
    const new_ads_last_run = state?.last_run_added ?? 0
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
      brand_name: counts?.name || state?.brand_name || t.term,
      next_recrawl_at,
      status,
      crawling_now, fully_crawled, never_crawled, is_spy, in_progress, soft_gated, new_ads_last_run,
    }
  })
  // Re-apply ranking the STATE_VIEWS prefetch implied (the `.in()` term query loses that order).
  if (!q && view === 'top') enriched.sort((a: any, b: any) => (b.ad_count || 0) - (a.ad_count || 0))
  else if (!q && view === 'new_ads') enriched.sort((a: any, b: any) => (b.new_ads_last_run || 0) - (a.new_ads_last_run || 0))

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
      // Real counts (uncapped). Fall back to the capped array math only if a count
      // query returns null for some reason, so the cards never go blank.
      total_terms: totalTermsCount ?? (terms?.length || 0),
      active_terms: activeTermsCount ?? (terms || []).filter((t: any) => t.is_active).length,
      brands_indexed: brandsIndexedCount ?? Object.keys(adCountByPage).filter(k => adCountByPage[k].count > 0).length,
      total_ads: totalAdsCount ?? Object.values(adCountByPage).reduce((s, x) => s + x.count, 0),
      never_crawled: neverCrawledCount ?? 0,
      fully_crawled: fullyCrawledCount ?? 0,
      crawling_now: crawlingNowCount ?? 0,
      spy: spyCount ?? 0,
      in_progress: inProgressCount ?? 0,
      new_ads: newAdsCount ?? 0,
      soft_gated: softGatedCount ?? 0,
      removed: removedCount ?? 0,
    },
    view,
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  const pidStr = page_id ? String(page_id).trim() : ''
  if (pidStr && !/^\d+$/.test(pidStr)) return NextResponse.json({ error: 'page_id must be numeric (a Facebook page ID)' }, { status: 400 })
  if (pidStr) insert.page_id = pidStr

  // Dedup by page_id (term is unique but page_id is not — same advertiser under a different
  // name spelling would otherwise be crawled twice). Reject if this page_id already exists.
  if (insert.page_id) {
    const { data: dup } = await admin
      .from('discovery_crawl_terms')
      .select('term')
      .eq('page_id', insert.page_id)
      .neq('term', insert.term)
      .limit(1)
      .maybeSingle()
    if (dup) return NextResponse.json({ error: `Already tracked as "${dup.term}" (same page_id)` }, { status: 409 })
  }

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
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  if (!user && !(await isAdminToken())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await req.json()
  const { action, id, page_id, is_active, categories, industry } = body

  if (action === 'toggle' && id != null) {
    await admin.from('discovery_crawl_terms').update({ is_active }).eq('id', id)
    return NextResponse.json({ success: true })
  }

  // Restore an auto-removed (empty-bailed) brand: re-activate, clear the removal tag, and null
  // last_crawled_at so it re-enters the never-crawled priority for a fresh crawl. priority 7 gives
  // it a prompt retry ahead of the default pool.
  if (action === 'restore' && (id != null || page_id)) {
    const upd = { is_active: true, notes: null, last_crawled_at: null, priority: 7 }
    const target = admin.from('discovery_crawl_terms').update(upd)
    await (id != null ? target.eq('id', id) : target.eq('page_id', page_id))
    return NextResponse.json({ success: true, message: 'Restored — re-crawls on the next cron tick (≤15 min).' })
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
