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
      { data: industryStats },
      { count: classified },
      { count: withEmbedding },
    ] = await Promise.all([
      admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }),
      admin.from('discovery_index_state').select('*').eq('id', 'main').single(),
      admin.from('discovery_crawl_log').select('*').order('ran_at', { ascending: false }).limit(50),
      admin.from('discovery_crawl_terms').select('*').order('priority', { ascending: false }),
      // Count per industry (approximate via seed terms)
      admin.from('discovery_crawl_terms').select('category, ads_found'),
      admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).eq('ai_classified', true),
      admin.from('discovery_ads_index').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
    ])

    // Aggregate industry stats
    const industryMap: Record<string, number> = {}
    for (const t of industryStats || []) {
      industryMap[t.category] = (industryMap[t.category] || 0) + (t.ads_found || 0)
    }

    return NextResponse.json({
      totalAds,
      classified,
      withEmbedding,
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
    const { term, category, countries, priority } = body
    if (!term?.trim()) return NextResponse.json({ error: 'Term required' }, { status: 400 })
    const { data, error } = await admin.from('discovery_crawl_terms').insert({
      term: term.trim().toLowerCase(),
      category: category || 'General',
      countries: countries || ['US'],
      priority: priority || 5,
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
    const countries = [...new Set([...(term?.countries || []), country])]
    await admin.from('discovery_crawl_terms').update({ countries }).eq('id', id)
    return NextResponse.json({ success: true, countries })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
