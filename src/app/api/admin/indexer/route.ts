/**
 * Admin Indexer API — stats, term management, manual trigger
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const action = request.nextUrl.searchParams.get('action') || 'stats'

  if (action === 'stats') {
    const [
      { count: totalAds },
      { data: state },
      { data: recentLog },
      { data: terms },
      { data: adIndustries },
      { count: classified },
      { count: withEmbedding },
      { count: withThumbnail },
    ] = await Promise.all([
      admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }),
      admin.from('discovery_index_state').select('*').eq('id', 'main').single(),
      admin.from('discovery_crawl_log').select('*').order('ran_at', { ascending: false }).limit(50),
      admin.from('discovery_crawl_terms').select('*').order('priority', { ascending: false }),
      // Fetch industries array from actual ads — sample up to 5000 rows
      admin.from('discovery_ads_index').select('industries').not('industries', 'is', null).limit(5000),
      admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).eq('ai_classified', true),
      admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
      admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).not('thumbnail_url', 'is', null),
    ])

    // Count each industry across all indexed ads
    const industryMap: Record<string, number> = {}
    for (const row of adIndustries || []) {
      for (const ind of row.industries || []) {
        if (ind) industryMap[ind] = (industryMap[ind] || 0) + 1
      }
    }

    return NextResponse.json({
      totalAds,
      classified,
      withEmbedding,
      withThumbnail,
      lastRunAt: state?.last_run_at,
      termsProcessedLast: state?.terms_processed || [],
      recentLog: recentLog || [],
      terms: terms || [],
      industryStats: Object.entries(industryMap).sort((a, b) => b[1] - a[1]),
    })
  }

  if (action === 'terms') {
    const { data } = await admin.from('discovery_crawl_terms').select('*').order('priority', { ascending: false })
    return NextResponse.json({ terms: data || [] })
  }

  // Returns ads indexed/updated since a given ISO timestamp — used to
  // show the crawl results preview after a manual run
  if (action === 'recent_ads') {
    const since = request.nextUrl.searchParams.get('since')
    let query = admin
      .from('discovery_ads_index')
      .select('ad_id, page_id, page_name, body, title, platforms, is_active, thumbnail_url, snapshot_url, start_date, days_running, format, industries, last_seen')
      .order('last_seen', { ascending: false })
      .limit(120)
    if (since) query = query.gte('last_seen', since)
    const { data } = await query
    return NextResponse.json({ ads: data || [] })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const body = await request.json()
  const { action } = body

  if (action === 'add_term') {
    const { term, category, countries, priority, term_type } = body
    if (!term?.trim()) return NextResponse.json({ error: 'Term required' }, { status: 400 })
    const { data, error } = await admin.from('discovery_crawl_terms').insert({
      term: term.trim().toLowerCase(),
      category: category || 'General',
      countries: countries || ['US'],
      priority: priority || 5,
      term_type: term_type || 'adcopy',
      is_active: true,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ term: data })
  }

  if (action === 'toggle_term') {
    const { id, is_active } = body
    await admin.from('discovery_crawl_terms').update({ is_active }).eq('id', id)
    return NextResponse.json({ success: true })
  }

  if (action === 'delete_term') {
    const { id } = body
    await admin.from('discovery_crawl_terms').delete().eq('id', id)
    return NextResponse.json({ success: true })
  }

  if (action === 'add_country') {
    const { id, country } = body
    const { data: term } = await admin.from('discovery_crawl_terms').select('countries').eq('id', id).single()
    const countries = Array.from(new Set([...(term?.countries || []), country]))
    await admin.from('discovery_crawl_terms').update({ countries }).eq('id', id)
    return NextResponse.json({ success: true, countries })
  }

  if (action === 'seed_terms') {
    // Pre-built starter library — covers ad copy, brands, and categories
    const SEED_TERMS = [
      // ── Brand terms (crawls ALL ads from these pages) ──────────
      { term: 'gymshark',     category: 'Fitness',   countries: ['US','GB'], priority: 8, term_type: 'brand' },
      { term: 'nike',         category: 'Sports',    countries: ['US','GB'], priority: 8, term_type: 'brand' },
      { term: 'sephora',      category: 'Beauty',    countries: ['US'],      priority: 8, term_type: 'brand' },
      { term: 'lululemon',    category: 'Fitness',   countries: ['US','CA'], priority: 7, term_type: 'brand' },
      { term: 'skims',        category: 'Fashion',   countries: ['US'],      priority: 7, term_type: 'brand' },
      { term: 'hims',         category: 'Health',    countries: ['US'],      priority: 7, term_type: 'brand' },
      { term: 'dropbox',      category: 'Tech',      countries: ['US'],      priority: 6, term_type: 'brand' },
      { term: 'notion',       category: 'Tech',      countries: ['US'],      priority: 6, term_type: 'brand' },
      { term: 'duolingo',     category: 'Education', countries: ['US'],      priority: 6, term_type: 'brand' },
      { term: 'allbirds',     category: 'Fashion',   countries: ['US'],      priority: 6, term_type: 'brand' },
      // ── Category terms (broad keyword expansion) ───────────────
      { term: 'fashion',      category: 'Fashion',   countries: ['US','GB'], priority: 7, term_type: 'category' },
      { term: 'beauty',       category: 'Beauty',    countries: ['US'],      priority: 7, term_type: 'category' },
      { term: 'fitness',      category: 'Fitness',   countries: ['US'],      priority: 7, term_type: 'category' },
      { term: 'health',       category: 'Health',    countries: ['US'],      priority: 6, term_type: 'category' },
      { term: 'food',         category: 'Food',      countries: ['US'],      priority: 6, term_type: 'category' },
      { term: 'tech',         category: 'Tech',      countries: ['US'],      priority: 6, term_type: 'category' },
      { term: 'finance',      category: 'Finance',   countries: ['US'],      priority: 6, term_type: 'category' },
      { term: 'education',    category: 'Education', countries: ['US'],      priority: 6, term_type: 'category' },
      { term: 'ecommerce',    category: 'E-commerce',countries: ['US'],      priority: 5, term_type: 'category' },
      { term: 'pets',         category: 'Pets',      countries: ['US'],      priority: 5, term_type: 'category' },
      // ── Ad Copy terms (keyword in ad body text) ────────────────
      { term: 'shop now',     category: 'E-commerce',countries: ['US'],      priority: 8, term_type: 'adcopy' },
      { term: 'free shipping',category: 'E-commerce',countries: ['US'],      priority: 8, term_type: 'adcopy' },
      { term: 'limited offer',category: 'E-commerce',countries: ['US'],      priority: 7, term_type: 'adcopy' },
      { term: 'skin care',    category: 'Beauty',    countries: ['US'],      priority: 7, term_type: 'adcopy' },
      { term: 'weight loss',  category: 'Fitness',   countries: ['US'],      priority: 7, term_type: 'adcopy' },
      { term: 'learn online', category: 'Education', countries: ['US'],      priority: 6, term_type: 'adcopy' },
      { term: 'free trial',   category: 'Tech',      countries: ['US'],      priority: 6, term_type: 'adcopy' },
      { term: 'get started',  category: 'General',   countries: ['US'],      priority: 6, term_type: 'adcopy' },
      { term: 'before after', category: 'Health',    countries: ['US'],      priority: 5, term_type: 'adcopy' },
      { term: 'as seen on',   category: 'General',   countries: ['US'],      priority: 5, term_type: 'adcopy' },
    ]

    // Fetch existing terms to avoid duplicates
    const { data: existing } = await admin.from('discovery_crawl_terms').select('term, term_type')
    const existingKeys = new Set((existing || []).map((t: any) => `${t.term}:${t.term_type}`))

    const toInsert = SEED_TERMS
      .filter(t => !existingKeys.has(`${t.term}:${t.term_type}`))
      .map(t => ({ ...t, is_active: true }))

    if (!toInsert.length) return NextResponse.json({ success: true, added: 0, message: 'All seed terms already exist' })

    const { data: inserted, error } = await admin.from('discovery_crawl_terms').insert(toInsert).select()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, added: inserted?.length || 0 })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
