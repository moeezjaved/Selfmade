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
    // When a brand is selected we filter on its exact page_id (a single Meta page
    // can run ads under several display names — partnership/branded-content ads).
    const pageId = (searchParams.get('pageId') || '').trim()
    const brandName = (searchParams.get('brandName') || '').trim()
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
    // Only show ads where we actually have a working R2 creative.
    // Hash alone is not enough — R2 upload may have failed even when hash exists.
    let baseQuery = admin
      .from('discovery_ads_index')
      .select('*', { count: 'exact' })
      .or('thumbnail_url.like.%r2.dev%,video_url.like.%r2.dev%')

    // Country filter — match against the ARRAY of countries the ad targeted
    // (covers multi-country ads correctly). Falls back to legacy 'country'
    // column for ads indexed before targeted_countries was added.
    if (country && country !== 'ALL') {
      baseQuery = baseQuery.or(
        `targeted_countries.cs.{${country}},country.eq.${country}`
      )
    }

    // Keyword search — OR across body, title, page_name, brand_categories
    if (q) {
      if (mode === 'brand') {
        // Exact page_id when we have it (captures every display name on that page);
        // PLUS affiliate ads — different pages whose ads drive to this brand's site,
        // tagged "aff:<pageId>" in seed_terms by the affiliate-discovery crawl.
        // Otherwise fall back to a fuzzy page_name match for typed brand searches.
        if (pageId) baseQuery = baseQuery.or(`page_id.eq.${pageId},seed_terms.cs.{aff:${pageId}}`)
        else baseQuery = baseQuery.ilike('page_name', `%${q}%`)
      } else {
        const words = q.trim().split(/\s+/).filter(w => w.length > 1).slice(0, 6)
        if (words.length > 0) {
          // Match: text fields (ilike) + brand_categories array (contains)
          // Searching "gymwear" finds ads where brand_categories has "gymwear"
          // even if the ad copy doesn't mention it.
          const orParts = words.flatMap(w => [
            `body.ilike.%${w}%`,
            `title.ilike.%${w}%`,
            `page_name.ilike.%${w}%`,
            `description.ilike.%${w}%`,
            `brand_categories.cs.{${w.toLowerCase()}}`,
          ])
          baseQuery = baseQuery.or(orParts.join(','))
        }
      }
    }

    // Filters
    if (status === 'ACTIVE') baseQuery = baseQuery.eq('is_active', true)
    if (status === 'INACTIVE') baseQuery = baseQuery.eq('is_active', false)
    if (format) baseQuery = baseQuery.eq('format', format)
    // Industry/category filter — match against either the AI-detected industries
    // OR the brand's explicit categories (set by indexer).
    if (industry) {
      baseQuery = baseQuery.or(
        `industries.cs.{${industry}},brand_categories.cs.{${industry}}`
      )
    }
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

    // Over-fetch so server-side dedup can return `limit` UNIQUE creatives per page
    const overFetchMultiplier = 5  // ~5x dedup ratio observed for popular brands
    const fetchLimit = limit * overFetchMultiplier
    const fetchOffset = offset * overFetchMultiplier
    baseQuery = baseQuery.range(fetchOffset, fetchOffset + fetchLimit - 1)
    const { data: keywordData, error: kwErr, count: kwCount } = await baseQuery

    if (kwErr) {
      return NextResponse.json({ ads: [], total: 0, totalInDB, source: 'indexed', searchMethod: 'error' })
    }

    // Server-side dedup by image_hash / video_hash so the discovery grid
    // shows one card per unique creative instead of repeating same image.
    const seenHashes = new Set<string>()
    const dedupedAds: any[] = []
    for (const ad of (keywordData || []) as any[]) {
      const key = ad.image_hash || ad.video_hash || `_${ad.ad_id}`
      if (seenHashes.has(key)) continue
      seenHashes.add(key)
      dedupedAds.push(ad)
      if (dedupedAds.length >= limit) break
    }

    ads = dedupedAds
    // Count distinct image AND video hashes matching the SAME filter as the search.
    // PostgREST caps each request at ~1000 rows, so for brand searches (bounded to
    // one advertiser's ads) we PAGINATE to count the full set — otherwise the total
    // undercounts (e.g. Mars Men showed 242 of its real ~331 unique creatives).
    const uniqSet = new Set<string>()
    const addHashes = (rows: any[]) => {
      for (const r of rows) {
        if (r.image_hash) uniqSet.add('i:' + r.image_hash)
        if (r.video_hash) uniqSet.add('v:' + r.video_hash)
      }
    }
    const countChunk = (off: number) => {
      let cq = admin
        .from('discovery_ads_index')
        .select('image_hash,video_hash')
        .or('thumbnail_url.like.%r2.dev%,video_url.like.%r2.dev%')
        .range(off, off + 999)
      if (country && country !== 'ALL') cq = cq.or(`targeted_countries.cs.{${country}},country.eq.${country}`)
      if (q && mode === 'brand') {
        if (pageId) cq = cq.or(`page_id.eq.${pageId},seed_terms.cs.{aff:${pageId}}`)
        else cq = cq.ilike('page_name', `%${q}%`)
      }
      return cq
    }
    if (q && mode === 'brand') {
      // bounded to one brand → paginate fully for an exact count
      for (let off = 0; off < 50_000; off += 1000) {
        const { data: chunk } = await countChunk(off)
        const rows = (chunk || []) as any[]
        addHashes(rows)
        if (rows.length < 1000) break
      }
    } else {
      const { data: chunk } = await countChunk(0)
      addHashes((chunk || []) as any[])
    }
    const uniqueHashCount = uniqSet.size
    total = uniqueHashCount || dedupedAds.length

    // ── Semantic re-ranking for multi-word queries (optional, enhances order) ──
    // Only attempt if we have results and OpenAI key — does NOT reduce result count.
    // SKIP for brand searches: semantic content-similarity wrongly drops most of a
    // brand's ads (e.g. "Mars Men" matched only 84 of 331 unique creatives) because
    // many ad copies don't semantically resemble the brand name.
    if (q && mode !== 'brand' && q.trim().split(/\s+/).length > 1 && process.env.OPENAI_API_KEY && ads.length > 1) {
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

    // ── Fetch carousel creatives for these ads in one batched call ─────
    const adIds = ads.map((a: any) => a.ad_id).filter(Boolean)
    let creativesByAd: Record<string, Array<{ position: number; asset_type: 'image' | 'video'; r2_url: string; hash: string | null }>> = {}
    if (adIds.length > 0) {
      const { data: creativesData } = await admin
        .from('discovery_creatives')
        .select('ad_id, position, asset_type, r2_url, hash')
        .in('ad_id', adIds)
        .order('asset_type', { ascending: true })  // images first, then videos
        .order('position', { ascending: true })
      creativesByAd = ((creativesData || []) as any[]).reduce((acc: any, c: any) => {
        if (!acc[c.ad_id]) acc[c.ad_id] = []
        acc[c.ad_id].push({
          position: c.position,
          asset_type: c.asset_type,
          r2_url: c.r2_url,
          hash: c.hash,
        })
        return acc
      }, {})
    }

    // ── Transform results ────────────────────────────────────
    const transformed = ads.map((ad: any) => ({
      id: ad.ad_id,
      pageId: ad.page_id,
      // When browsing a single brand by page_id:
      //  • the brand's OWN ads (same page_id) → normalize to the canonical brand
      //    name, so partnership ads captured under a partner's display name read
      //    as the brand (e.g. the stale "Chuck Liddell" name on Mars Men's page).
      //  • AFFILIATE ads (a DIFFERENT page driving to the brand's site) → keep
      //    their real page name (e.g. "New York Post") and flag them, so the card
      //    can badge "promotes <brand>".
      pageName: (pageId && brandName && ad.page_id === pageId) ? brandName : ad.page_name,
      isAffiliate: !!(pageId && ad.page_id !== pageId),
      affiliateOf: (pageId && ad.page_id !== pageId) ? (brandName || null) : null,
      body: ad.body,
      title: ad.title,
      caption: ad.caption,
      description: ad.description,
      snapshotUrl: ad.snapshot_url,
      thumbnailUrl: ad.thumbnail_url || null,
      videoUrl: ad.video_url || null,
      creatives: creativesByAd[ad.ad_id] || [],
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
