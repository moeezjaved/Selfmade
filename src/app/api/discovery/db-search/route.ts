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
    const industry = searchParams.get('industry') || ''  // comma-separated for multi-select
    const theme = searchParams.get('theme') || ''        // comma-separated
    const language = searchParams.get('language') || ''  // comma-separated ISO codes
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
        // Topic/keyword search across 3 dimensions: ad copy, brand name, category.
        // Match the FULL PHRASE in text (so "hair loss" finds hair-loss ads, not
        // every ad with "hair" OR "loss"), plus the phrase/words as category tags
        // (so a "hair loss"-tagged ad surfaces even if those exact words aren't in
        // its copy). Phrase-first = precise, topic-relevant results.
        const phrase = q.trim()
        const words = phrase.split(/\s+/).filter(w => w.length > 1).slice(0, 6)
        const orParts = [
          `body.ilike.%${phrase}%`,
          `title.ilike.%${phrase}%`,
          `description.ilike.%${phrase}%`,
          `page_name.ilike.%${phrase}%`,
          `brand_categories.cs.{${phrase.toLowerCase()}}`,
          `industries.cs.{${phrase}}`,
          // AI topical tags — "hair loss" matches ads tagged hair loss even when the
          // copy says thinning/regrow/balding (4th search dimension).
          `topics.cs.{${phrase.toLowerCase()}}`,
          // each significant word as a category/topic tag too
          ...words.flatMap(w => [`brand_categories.cs.{${w.toLowerCase()}}`, `topics.cs.{${w.toLowerCase()}}`]),
        ]
        if (orParts.length > 0) baseQuery = baseQuery.or(orParts.join(','))
      }
    }

    // Filters
    if (status === 'ACTIVE') baseQuery = baseQuery.eq('is_active', true)
    if (status === 'INACTIVE') baseQuery = baseQuery.eq('is_active', false)
    if (format) baseQuery = baseQuery.eq('format', format)
    // Industry/category filter — match the AI/auto-detected industries OR the
    // brand's explicit admin categories. Multi-select = match ANY of the chosen.
    if (industry) {
      const inds = industry.split(',').map(s => s.trim()).filter(Boolean)
      const parts = inds.flatMap(i => [`industries.cs.{${i}}`, `brand_categories.cs.{${i}}`])
      if (parts.length) baseQuery = baseQuery.or(parts.join(','))
    }
    // Theme filter — server-side (was browser-only, so it only saw the loaded 40).
    if (theme) {
      const themes = theme.split(',').map(s => s.trim()).filter(Boolean)
      if (themes.length) baseQuery = baseQuery.overlaps('themes', themes)
    }
    // Language filter — ISO codes against the languages array.
    if (language) {
      const langs = language.split(',').map(s => s.trim()).filter(Boolean)
      if (langs.length) baseQuery = baseQuery.overlaps('languages', langs)
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
    else if (sort === 'recent') baseQuery = baseQuery.order('last_seen', { ascending: false })
    else {
      // 'recommended' (default, Atria-style): proven winners first — active ads
      // that have run the longest, then recency. Makes the feed feel curated
      // instead of a raw chronological dump.
      baseQuery = baseQuery
        .order('is_active', { ascending: false })
        .order('days_running', { ascending: false, nullsFirst: false })
        .order('last_seen', { ascending: false })
    }

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
    // Canonical brand name = most common page_name among the brand's OWN ads
    // (page_id === pageId). A page runs partnership/affiliate ads under other
    // names (e.g. Grüns's page also shows "Chelsea Handler"); the dominant name
    // is the real brand. Computed here so the grid labels every card with the
    // real name users search by — not whichever partnership ad sorted first.
    const nameFreq: Record<string, number> = {}
    const addHashes = (rows: any[]) => {
      for (const r of rows) {
        if (r.image_hash) uniqSet.add('i:' + r.image_hash)
        if (r.video_hash) uniqSet.add('v:' + r.video_hash)
        if (pageId && r.page_id === pageId && r.page_name) {
          const n = String(r.page_name).trim()
          if (n) nameFreq[n] = (nameFreq[n] || 0) + 1
        }
      }
    }
    const countChunk = (off: number) => {
      let cq = admin
        .from('discovery_ads_index')
        .select('image_hash,video_hash,page_id,page_name')
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
    // Most common page_name among the brand's own ads = the real brand name.
    const canonicalName = Object.entries(nameFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || brandName || ''

    // ── Semantic GAP-FILL for concept searches (additive, never replaces) ──
    // The literal keyword/topic match above is PRECISE but word-bound: "gym wear"
    // won't match an ad tagged "activewear"/"athleisure". So when the literal match
    // leaves the page short of a full screen, we top it up with ads that are CLOSE
    // BY MEANING (pgvector cosine on the query embedding). This is purely additive —
    // every exact match keeps its place; semantic only fills the empty slots. That
    // avoids the old replace-mode bug that capped "Mars Men" at 84 of 331 creatives.
    // SKIP brand mode (a brand's ad copy rarely resembles its own name semantically).
    if (q && mode !== 'brand' && ads.length < limit && process.env.OPENAI_API_KEY) {
      try {
        const embRes = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: q.slice(0, 8000),
        })
        const { data: vectorResults } = await admin.rpc('search_ads_semantic', {
          query_embedding: embRes.data[0].embedding,
          match_threshold: 0.22,         // loose absolute floor; relative floor applied below
          match_count: 240,
          filter_country: country === 'ALL' ? null : country,
          filter_active: status === 'ACTIVE' ? true : status === 'INACTIVE' ? false : null,
          filter_format: format || null,
          filter_industry: industry || null,
        })
        if (vectorResults?.length) {
          const rows = vectorResults as any[]
          // RELATIVE relevance floor: a fixed cosine cutoff is fragile across queries —
          // 0.3 is tight for "gym wear" but noise for "anti-aging serum". Anchor to the
          // best match for THIS query and keep only neighbours within `delta` of it.
          // (Falls back to the absolute RPC floor if the RPC doesn't return similarity.)
          const sims = rows.map(r => (typeof r.similarity === 'number' ? r.similarity : null))
                           .filter((s): s is number => s != null)
          const topSim = sims.length ? Math.max(...sims) : null
          const floor = topSim != null ? Math.max(0.27, topSim - 0.1) : null

          const haveIds = new Set(ads.map((a: any) => a.ad_id))
          const haveHashes = new Set(
            ads.map((a: any) => a.image_hash || a.video_hash).filter(Boolean)
          )
          // Slice by page offset so deeper pages get DIFFERENT semantic fillers
          // (results are similarity-ranked & stable for the same query → no repeats).
          let added = 0
          for (const v of rows.slice(offset)) {
            if (ads.length >= limit) break
            if (floor != null && typeof v.similarity === 'number' && v.similarity < floor) continue
            if (haveIds.has(v.ad_id)) continue
            const h = v.image_hash || v.video_hash
            if (h && haveHashes.has(h)) continue
            if (h) haveHashes.add(h)
            haveIds.add(v.ad_id)
            ads.push({ ...v, _semantic: true, _sim: v.similarity ?? null })
            added++
          }
          if (added > 0) {
            total += added
            searchMethod = 'hybrid'
          }
        }
      } catch {
        // Semantic failed (no key / RPC error) — keep the precise keyword results.
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

    // ── Provenance: why did each ad match? ───────────────────
    // Tag every result with the tier it came from — useful for debugging ranking
    // and for a future "related by meaning" UI label. Semantic fillers are flagged
    // at insert time; for lexical hits we reconstruct the reason cheaply from the row.
    const lc = q.toLowerCase()
    const matchReason = (ad: any): 'brand' | 'exact_keyword' | 'topic_tag' | 'semantic' | 'keyword' => {
      if (ad._semantic) return 'semantic'
      if (mode === 'brand') return 'brand'
      if (!lc) return 'keyword'
      const inText = [ad.body, ad.title, ad.description, ad.page_name]
        .some((f: any) => String(f || '').toLowerCase().includes(lc))
      if (inText) return 'exact_keyword'
      const tags = [...(ad.topics || []), ...(ad.brand_categories || []), ...(ad.industries || [])]
        .map((t: any) => String(t).toLowerCase())
      if (tags.some((t: string) => t.includes(lc) || lc.includes(t))) return 'topic_tag'
      return 'keyword'
    }

    // ── Transform results ────────────────────────────────────
    const transformed = ads.map((ad: any) => ({
      id: ad.ad_id,
      matchReason: matchReason(ad),
      similarity: ad._sim ?? null,
      pageId: ad.page_id,
      // When browsing a single brand by page_id:
      //  • the brand's OWN ads (same page_id) → normalize to the canonical brand
      //    name, so partnership ads captured under a partner's display name read
      //    as the brand (e.g. the stale "Chuck Liddell" name on Mars Men's page).
      //  • AFFILIATE ads (a DIFFERENT page driving to the brand's site) → keep
      //    their real page name (e.g. "New York Post") and flag them, so the card
      //    can badge "promotes <brand>".
      pageName: (pageId && ad.page_id === pageId) ? (canonicalName || ad.page_name) : ad.page_name,
      isAffiliate: !!(pageId && ad.page_id !== pageId),
      affiliateOf: (pageId && ad.page_id !== pageId) ? (canonicalName || brandName || null) : null,
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
