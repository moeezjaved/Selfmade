/**
 * Discovery DB Search — queries our own indexed ads database.
 * Uses pgvector semantic search first, falls back to PostgreSQL full-text search.
 * Also returns top brands for the query.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { searchParams } = request.nextUrl

    const q = (searchParams.get('q') || '').trim()
    const mode = searchParams.get('mode') || 'adcopy'
    const status = searchParams.get('status') || 'ALL'
    const platforms = searchParams.get('platforms') || ''
    const format = searchParams.get('format') || ''
    const industry = searchParams.get('industry') || ''
    const hookType = searchParams.get('hook_type') || ''
    const emotion = searchParams.get('emotion') || ''
    const angle = searchParams.get('angle') || ''
    const country = searchParams.get('country') || 'US'
    const sort = searchParams.get('sort') || 'recent'
    const days = parseInt(searchParams.get('days') || '0')
    const page = parseInt(searchParams.get('page') || '0')
    const limit = 40
    const offset = page * limit

    // Check how many ads we have in DB
    const { count: totalInDB } = await admin
      .from('discovery_ads_index')
      .select('*', { count: 'exact', head: true })

    if (!totalInDB || totalInDB < 10) {
      return NextResponse.json({ ads: [], total: 0, totalInDB: 0, source: 'empty' })
    }

    let ads: any[] = []
    let total = 0
    let searchMethod = 'keyword'

    // ── Build base query with ilike keyword search (fast, reliable) ──
    let baseQuery = admin.from('discovery_ads_index').select('*', { count: 'exact' })

    // Country filter
    if (country && country !== 'ALL') baseQuery = baseQuery.eq('country', country)

    // Keyword search — OR across body, title, page_name
    if (q) {
      if (mode === 'brand') {
        baseQuery = baseQuery.ilike('page_name', `%${q}%`)
      } else {
        // For each significant word, match against body OR title OR page_name
        const words = q.trim().split(/\s+/).filter(w => w.length > 1).slice(0, 6)
        if (words.length > 0) {
          // Build: body.ilike.%word%,title.ilike.%word%,page_name.ilike.%word%
          const orParts = words.flatMap(w => [
            `body.ilike.%${w}%`,
            `title.ilike.%${w}%`,
            `page_name.ilike.%${w}%`,
            `description.ilike.%${w}%`,
          ])
          baseQuery = baseQuery.or(orParts.join(','))
        }
      }
    }

    // Filters
    if (status === 'ACTIVE') baseQuery = baseQuery.eq('is_active', true)
    if (status === 'INACTIVE') baseQuery = baseQuery.eq('is_active', false)
    if (format) baseQuery = baseQuery.eq('format', format)
    if (industry) baseQuery = baseQuery.contains('industries', [industry])
    if (hookType) baseQuery = baseQuery.eq('hook_type', hookType)
    if (emotion) baseQuery = baseQuery.contains('emotion', [emotion])
    if (angle) baseQuery = baseQuery.eq('angle', angle)
    if (platforms) baseQuery = baseQuery.overlaps('platforms', platforms.split(','))
    // Time filter: only ads started within the last N days
    if (days > 0) {
      const sinceDate = new Date(Date.now() - days * 86400000).toISOString()
      baseQuery = baseQuery.gte('start_date', sinceDate)
    }

    // Sort
    if (sort === 'longest') baseQuery = baseQuery.order('days_running', { ascending: false })
    else if (sort === 'oldest') baseQuery = baseQuery.order('start_date', { ascending: true })
    else baseQuery = baseQuery.order('last_seen', { ascending: false })

    baseQuery = baseQuery.range(offset, offset + limit - 1)
    const { data: keywordData, error: kwErr, count: kwCount } = await baseQuery

    if (kwErr) {
      // If keyword search errors, return empty rather than crashing
      return NextResponse.json({ ads: [], total: 0, totalInDB, source: 'indexed', searchMethod: 'error' })
    }

    ads = keywordData || []
    total = kwCount || 0

    // ── Semantic re-ranking for multi-word queries (optional, enhances order) ──
    // Only attempt if we have results and OpenAI key — does NOT reduce result count
    if (q && q.trim().split(/\s+/).length > 1 && process.env.OPENAI_API_KEY && ads.length > 1) {
      try {
        const embRes = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: q.slice(0, 8000),
        })
        const queryEmbedding = embRes.data[0].embedding

        const { data: vectorResults, error: vecError } = await admin.rpc('search_ads_semantic', {
          query_embedding: queryEmbedding,
          match_threshold: 0.1,
          match_count: 200,
          filter_country: country === 'ALL' ? null : country,
          filter_active: status === 'ACTIVE' ? true : status === 'INACTIVE' ? false : null,
          filter_format: format || null,
          filter_industry: industry || null,
        })

        if (!vecError && vectorResults?.length >= ads.length) {
          // Semantic returned more/equal results — use it as primary
          ads = vectorResults.slice(offset, offset + limit)
          total = vectorResults.length
          searchMethod = 'semantic'
        }
      } catch {
        // Semantic failed — keep keyword results
      }
    }

    // ── Transform results ────────────────────────────────────
    const transformed = ads.map((ad: any) => ({
      id: ad.ad_id,
      pageId: ad.page_id,
      pageName: ad.page_name,
      body: ad.body,
      title: ad.title,
      caption: ad.caption,
      description: ad.description,
      snapshotUrl: ad.snapshot_url,
      thumbnailUrl: ad.thumbnail_url || null,
      videoUrl: ad.video_url || null,
      startDate: ad.start_date,
      stopDate: ad.stop_date,
      platforms: ad.platforms || [],
      languages: ad.languages || [],
      isActive: ad.is_active,
      daysRunning: ad.days_running,
      country: ad.country,
      format: ad.format,
      industries: ad.industries || [],
      themes: ad.themes || [],
      hookType: ad.hook_type,
      emotion: ad.emotion || [],
      angle: ad.angle,
      cta: ad.cta,
      tone: ad.tone,
      persona: ad.persona,
      desire: ad.desire,
      usp: ad.usp,
      aiClassified: ad.ai_classified,
      similarity: ad.similarity,
    }))

    return NextResponse.json({
      ads: transformed,
      total,
      page,
      hasMore: offset + limit < total,
      totalInDB,
      source: 'indexed',
      searchMethod,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
