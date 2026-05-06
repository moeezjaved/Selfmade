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
    let searchMethod = 'text'

    // ── Semantic vector search ──────────────────────────────
    if (q && process.env.OPENAI_API_KEY) {
      try {
        const embRes = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: q.slice(0, 8000),
        })
        const queryEmbedding = embRes.data[0].embedding

        // Use pgvector RPC for semantic search
        const { data: vectorResults, error: vecError } = await admin.rpc('search_ads_semantic', {
          query_embedding: queryEmbedding,
          match_threshold: 0.3,
          match_count: limit + offset,
          filter_country: country === 'ALL' ? null : country,
          filter_active: status === 'ACTIVE' ? true : status === 'INACTIVE' ? false : null,
          filter_format: format || null,
          filter_industry: industry || null,
        })

        if (!vecError && vectorResults?.length > 0) {
          ads = vectorResults.slice(offset, offset + limit)
          total = vectorResults.length
          searchMethod = 'semantic'
        }
      } catch (e) {
        // Fall through to text search
      }
    }

    // ── Full-text / filter search (fallback or no query) ────
    if (ads.length === 0) {
      let query = admin.from('discovery_ads_index').select('*', { count: 'exact' })

      // Country filter
      if (country && country !== 'ALL') query = query.eq('country', country)

      // Search by mode
      if (q) {
        if (mode === 'brand') {
          query = query.ilike('page_name', `%${q}%`)
        } else {
          // Full text search
          query = query.textSearch('search_vector', q.split(' ').join(' & '), { type: 'websearch' })
        }
      }

      // Filters
      if (status === 'ACTIVE') query = query.eq('is_active', true)
      if (status === 'INACTIVE') query = query.eq('is_active', false)
      if (format) query = query.eq('format', format)
      if (industry) query = query.contains('industries', [industry])
      if (hookType) query = query.eq('hook_type', hookType)
      if (emotion) query = query.contains('emotion', [emotion])
      if (angle) query = query.eq('angle', angle)
      if (platforms) query = query.overlaps('platforms', platforms.split(','))

      // Sort
      if (sort === 'longest') query = query.order('days_running', { ascending: false })
      else if (sort === 'oldest') query = query.order('start_date', { ascending: true })
      else query = query.order('last_seen', { ascending: false })

      query = query.range(offset, offset + limit - 1)

      const { data, error, count } = await query
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      ads = data || []
      total = count || 0
      searchMethod = 'fulltext'
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
