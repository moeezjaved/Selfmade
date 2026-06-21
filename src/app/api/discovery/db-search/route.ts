/**
 * Discovery DB Search — queries our own indexed ads database.
 * Uses pgvector semantic search first, falls back to PostgreSQL full-text search.
 * Also returns top brands for the query.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import { expandQuery, matchTierWeight, matchTierReason, type Expansion } from '@/lib/search/concepts'

export const dynamic = 'force-dynamic'

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))

// ── Quality score for the Atria-style "Recommended" sort ──────────────────
// A flat ORDER BY can't BLEND signals — it just tiers them. This blends the
// signals that make a feed feel curated: longevity dominates (a long-running ad
// is a proven winner — the strongest signal), then active status, recency, and
// format. Applied in-process to the candidate window so we need no stored column
// or refresh cron yet; promote to a materialized score if the eval proves it out.
// Weights are deliberately at the top so they're tunable against precision@10.
const RANK_W = { longevity: 1.0, active: 3.0, recency: 2.0, video: 0.6 }
function qualityScore(ad: any): number {
  const days = Math.max(0, Number(ad.days_running) || 0)
  const longevity = Math.log1p(days)                 // 0..~5.9 (365 days)
  const active = ad.is_active ? 1 : 0
  let recency = 0                                     // 30-day half-life decay, 0..1
  const ls = ad.last_seen ? Date.parse(ad.last_seen) : NaN
  if (!Number.isNaN(ls)) {
    const ageDays = Math.max(0, (Date.now() - ls) / 86_400_000)
    recency = Math.exp(-ageDays / 30)
  }
  const hasVideo = (ad.format === 'Video' || ad.video_url || ad.video_hash) ? 1 : 0
  return RANK_W.longevity * longevity
       + RANK_W.active * active
       + RANK_W.recency * recency
       + RANK_W.video * hasVideo
}

export async function GET(request: NextRequest) {
  try {
    // Eval-harness bypass — ONLY active when SEARCH_EVAL_TOKEN is set in the env
    // (unset in production → this is dead code) AND the request carries the matching
    // token. Lets the search-eval harness measure precision@10 against the real route
    // without a user session. Never weakens prod auth: no token env, no bypass.
    const evalToken = process.env.SEARCH_EVAL_TOKEN
    const isEval = !!evalToken && request.headers.get('x-eval-token') === evalToken

    if (!isEval) {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
    const country = searchParams.get('country') || 'US'
    const sort = searchParams.get('sort') || 'recent'
    const days = parseInt(searchParams.get('days') || '0')
    const page = parseInt(searchParams.get('page') || '0')
    const limit = 40
    const offset = page * limit

    // ── GetHookd-parity filters (all additive; each is inert unless its param is
    // sent, so existing queries are byte-for-byte unchanged). Backed by the rollup
    // columns from migration 020. niche uses '|' as delimiter because niche names
    // themselves contain commas ("Baby, Kids & Maternity").
    const tiers = (searchParams.get('performance_scores') || searchParams.get('tiers') || '').split(',').map(s => s.trim()).filter(Boolean)
    const niches = (searchParams.get('niche') || '').split('|').map(s => s.trim()).filter(Boolean)
    const activeAdsMin = parseInt(searchParams.get('active_ads_count') || '0')
    const runTimeBuckets = (searchParams.get('run_time') || '').split(',').map(s => s.trim()).filter(Boolean)
    const ctaTypes = (searchParams.get('cta_type') || '').split('|').map(s => s.trim()).filter(Boolean)
    const minReuse = parseInt(searchParams.get('min_reuse') || '0')
    const hideBrands = (searchParams.get('hide_brands') || '').split(',').map(s => s.replace(/[^0-9]/g, '')).filter(Boolean)
    const adsPerBrand = parseInt(searchParams.get('ads_per_brand') || '0')  // 0 = default diversity cap
    // Creative-DNA filters (Phase C). hook/emotion/angle were single-value before;
    // now multi-select (comma). format_style/visual_style/cta_style are new.
    const csv = (k: string) => (searchParams.get(k) || '').split(',').map(s => s.trim()).filter(Boolean)
    const hookTypes = csv('hook_type'), emotions = csv('emotion'), angles = csv('angle')
    const formatStyles = csv('format_style'), visualStyles = csv('visual_style'), ctaStyles = csv('cta_style')
    const VALID_TIERS = new Set(['winning', 'optimized', 'growing', 'scaling', 'testing'])

    // Applied to BOTH the result query and the count query so the total stays honest.
    const applyHookdFilters = (query: any) => {
      const t = tiers.filter(x => VALID_TIERS.has(x))
      if (t.length) query = query.in('performance_tier', t)
      if (niches.length) query = query.in('niche', niches)
      if (activeAdsMin > 0) query = query.gte('brand_active_ads', activeAdsMin)
      if (minReuse > 0) query = query.gte('creative_reuse_count', minReuse)
      if (ctaTypes.length) query = query.in('cta', ctaTypes)
      // Creative-DNA filters (Phase C) — multi-select, applied to result AND count.
      if (hookTypes.length) query = query.in('hook_type', hookTypes)
      if (emotions.length) query = query.overlaps('emotion', emotions)
      if (angles.length) query = query.in('angle', angles)
      if (formatStyles.length) query = query.in('format_style', formatStyles)
      if (visualStyles.length) query = query.in('visual_style', visualStyles)
      if (ctaStyles.length) query = query.in('cta_style', ctaStyles)
      if (hideBrands.length) query = query.not('page_id', 'in', `(${hideBrands.join(',')})`)
      if (runTimeBuckets.length) {
        const groups = runTimeBuckets.map(b => {
          if (b.endsWith('+')) { const n = parseInt(b); return Number.isFinite(n) ? `days_running.gte.${n}` : '' }
          const [a, c] = b.split('-').map(x => parseInt(x))
          return (Number.isFinite(a) && Number.isFinite(c)) ? `and(days_running.gte.${a},days_running.lt.${c})` : ''
        }).filter(Boolean)
        if (groups.length) query = query.or(groups.join(','))
      }
      return query
    }

    // Check how many ads we have in DB (planner estimate — instant; exact count
    // seq-scans 95K rows and isn't worth it for a "do we have ads" gate).
    const { count: totalInDB } = await admin
      .from('discovery_ads_index')
      .select('*', { count: 'planned', head: true })

    if (!totalInDB || totalInDB < 10) {
      return NextResponse.json({ ads: [], total: 0, totalInDB: 0, source: 'empty' })
    }

    let ads: any[] = []
    let total = 0
    let searchMethod = 'keyword'
    // Reusable keyword OR-filter (non-brand mode) so the SAME match logic feeds
    // both the result query and the count query — otherwise the displayed total
    // drifts from what's actually shown.
    let keywordOr: string | null = null
    // Concept expansion (query-side synonym/sibling map) — empty for brand mode.
    let expansion: Expansion = { synonymTags: new Set(), relatedTags: new Set(), hit: false }

    // ── Build base query with ilike keyword search (fast, reliable) ──
    // Only show ads where we actually have a working R2 creative.
    // Hash alone is not enough — R2 upload may have failed even when hash exists.
    let baseQuery = admin
      .from('discovery_ads_index')
      // INNER-JOIN discovery_creatives in ONE query: enforces has-creative (covers
      // append-only ads with no thumbnail_url/hash on the index row) AND carries the
      // creatives for dedup + thumbnails, AND gives the has-creative total via
      // count:'planned' — replacing 3 sequential round-trips with one. The embed only
      // timed out before the (page_id,performance_score)/(page_id,days_running)
      // composite indexes existed (the brand sort scanned the whole score index);
      // with those in place it's sub-second. Brand mode must use page_id=eq (NOT the
      // seed_terms affiliate OR) — the unindexed array-contains makes the join 9s+.
      .select('*, discovery_creatives!inner(asset_type,position,r2_url,hash)', { count: 'planned' })

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
        // Exact page_id (captures every display name on that page). NOTE: the
        // seed_terms affiliate OR is intentionally dropped here — an array-contains on
        // the unindexed seed_terms forces a seq-scan that makes the inner-join embed
        // 9s+ (vs 0.3s for page_id=eq). Brand-affiliate ads are deferred until
        // seed_terms gets a GIN index. Otherwise fall back to a fuzzy page_name match.
        if (pageId) baseQuery = baseQuery.eq('page_id', pageId)
        else baseQuery = baseQuery.ilike('page_name', `%${q}%`)
      } else {
        // Topic/keyword search across 3 dimensions: ad copy, brand name, category.
        // Match the FULL PHRASE in text (so "hair loss" finds hair-loss ads, not
        // every ad with "hair" OR "loss"), plus the phrase/words as category tags
        // (so a "hair loss"-tagged ad surfaces even if those exact words aren't in
        // its copy). Phrase-first = precise, topic-relevant results.
        // Normalize the query into MATCH VARIANTS so multi-word and compound
        // forms are equivalent: "active wear" ⇄ "activewear". Topic/category tags
        // are stored as single lowercased tokens (e.g. "activewear"), and array
        // contains (`cs`) needs an EXACT element — so a two-word query must also
        // test its space-collapsed form or it misses the topic dimension entirely.
        // That was the "active wear → 40, activewear → 879" bug.
        // `clean` also strips chars that would break PostgREST or()/array syntax.
        const clean = (s: string) => s.replace(/[,(){}]/g, ' ').replace(/\s+/g, ' ').trim()
        const lcPhrase = clean(q).toLowerCase()
        const compound = lcPhrase.replace(/\s+/g, '')   // "active wear" → "activewear"
        const words = lcPhrase.split(/\s+/).filter(w => w.length > 1).slice(0, 6)
        // CONCEPT EXPANSION — map the query to its concept's real tags so e.g.
        // "thinning hair" reaches the stored "hair loss" tag (same concept) and
        // "hair growth" (related solution). Ranking keeps the solution ads below the
        // on-point ones. Mirrors the tag-side normalization (single concept source).
        expansion = expandQuery(q)
        const expandedTags = [...Array.from(expansion.synonymTags), ...Array.from(expansion.relatedTags)]
        // Text dimensions: phrase AND compound form against the copy.
        const textVariants = Array.from(new Set([lcPhrase, compound].filter(Boolean)))
        // Tag dimensions: phrase, compound, each significant word, AND expanded concept tags.
        const tagVariants = Array.from(new Set([lcPhrase, compound, ...words, ...expandedTags].filter(Boolean)))
        const orParts = [
          // Text dimension via FULL-TEXT SEARCH on the GIN-indexed search_vector
          // (body+title+description+page_name). Replaces 4× `ilike '%...%'` which
          // seq-scanned ~95K rows and blew Supabase's statement timeout → "No ads
          // found". plfts = plainto_tsquery, so multi-word ANDs the terms. ~0.6s.
          ...textVariants.map(v => `search_vector.plfts(english).${v}`),
          // AI topical/category tags (4th search dimension) — "active wear" now
          // hits the "activewear" topic via the compound variant.
          ...tagVariants.flatMap(v => [
            `brand_categories.cs.{${v}}`,
            `topics.cs.{${v}}`,
            `industries.cs.{${v}}`,
          ]),
        ]
        keywordOr = orParts.join(',')
        if (keywordOr) baseQuery = baseQuery.or(keywordOr)
      }
    }

    // Filters
    if (status === 'ACTIVE') baseQuery = baseQuery.eq('is_active', true)
    if (status === 'INACTIVE') baseQuery = baseQuery.eq('is_active', false)
    if (format) baseQuery = baseQuery.eq('format', format)
    // Industry/category filter. The old `industries` field (keyword auto-detect) is
    // unreliable (e.g. "Travel & Tourism" on a shampoo ad), so we also match the
    // accurate AI `topics` and admin `brand_categories` — by exact value AND by each
    // significant word of the industry name. So "Apparel & Accessories" matches ads
    // tagged topics {apparel} or {accessories}, keeping the filter consistent with the
    // (accurate) categories shown on the detail page. Multi-select = match ANY chosen.
    if (industry) {
      const STOP = new Set(['and', 'the', 'personal', 'care', 'for'])
      const inds = industry.split(',').map(s => s.trim()).filter(Boolean)
      const parts = inds.flatMap(i => {
        const lc = i.toLowerCase()
        const words = lc.split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w))
        return [
          `industries.cs.{${i}}`,
          `brand_categories.cs.{${lc}}`,
          `topics.cs.{${lc}}`,
          ...words.flatMap(w => [`topics.cs.{${w}}`, `brand_categories.cs.{${w}}`]),
        ]
      })
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
    if (platforms) baseQuery = baseQuery.overlaps('platforms', platforms.split(','))
    // Time filter: only ads started within the last N days
    if (days > 0) {
      const sinceDate = new Date(Date.now() - days * 86400000).toISOString()
      baseQuery = baseQuery.gte('start_date', sinceDate)
    }
    // GetHookd-parity filters (performance tier, niche, brand volume, run-time,
    // CTA, creative reuse, hide-brands) — rollup-backed, all additive.
    baseQuery = applyHookdFilters(baseQuery)

    // Sort
    if (sort === 'longest') baseQuery = baseQuery.order('days_running', { ascending: false })
    else if (sort === 'oldest') baseQuery = baseQuery.order('start_date', { ascending: true })
    else if (sort === 'recent') baseQuery = baseQuery.order('last_seen', { ascending: false })
    else if (sort === 'newest') baseQuery = baseQuery.order('start_date', { ascending: false, nullsFirst: false })
    else if (sort === 'performance') baseQuery = baseQuery.order('performance_score', { ascending: false }).order('is_active', { ascending: false })
    else if (sort === 'most_used') baseQuery = baseQuery.order('creative_reuse_count', { ascending: false })
    else if (sort === 'latest_added') baseQuery = baseQuery.order('indexed_at', { ascending: false })
    else if (sort === 'oldest_added') baseQuery = baseQuery.order('indexed_at', { ascending: true })
    else {
      // 'recommended' (default, Atria-style): proven winners first — active ads
      // that have run the longest, then recency. Makes the feed feel curated
      // instead of a raw chronological dump.
      baseQuery = baseQuery
        .order('is_active', { ascending: false })
        .order('days_running', { ascending: false, nullsFirst: false })
        .order('last_seen', { ascending: false })
    }

    // Page STRAIGHT THROUGH the has-creative results (the inner-join already filtered
    // to displayable ads), `limit` per page. CRITICAL: do NOT multiply the offset by
    // an over-fetch factor — that skipped (factor-1)*40 rows per page, so the grid
    // could only ever reach total/factor (the "only 315 of 1238" cap) AND deep pages
    // landed at huge offsets (row 1000+) that scan forever. A small per-page fetch
    // margin lets server-side dedup/cap trim within the page; the client cross-page-
    // dedups the rest by the hashes we expose. Brand mode has no per-brand cap, so it
    // needs no margin; keyword mode keeps a little for the cap. (Future: keyset
    // pagination to kill the deep-offset scan entirely.)
    const fetchMargin = (q && mode === 'brand') ? 1 : 2
    const fetchLimit = limit * fetchMargin
    const fetchOffset = offset                    // raw row offset — NOT multiplied
    baseQuery = baseQuery.range(fetchOffset, fetchOffset + fetchLimit - 1)
    const { data: keywordData, error: kwErr, count: kwCount } = await baseQuery

    if (kwErr) {
      return NextResponse.json({ ads: [], total: 0, totalInDB, source: 'indexed', searchMethod: 'error' })
    }

    // 'recommended' sort = MATCH-TIER first, then quality WITHIN a tier. Once concept
    // expansion is on, a single query produces several kinds of match — literal copy,
    // same-concept tag, related-concept (problem→solution) tag, semantic fill — and we
    // must never let a weaker match outrank a stronger one (a "hair growth" solution ad
    // jumping above an ad that literally says "thinning hair"). The hard tier dominates;
    // qualityScore (longevity-led) only orders ads within the same tier. Other sorts
    // keep the exact DB order the user asked for (recent/oldest/longest).
    const lcQ = q.toLowerCase()
    let candidateRows = (keywordData || []) as any[]
    if (sort === 'recommended') {
      candidateRows = candidateRows
        .map(a => ({ a, t: mode === 'brand' ? 0 : matchTierWeight(a, lcQ, expansion), s: qualityScore(a) }))
        .sort((x, y) => (y.t - x.t) || (y.s - x.s))
        .map(x => x.a)
    }

    // ── Dedup by the FIRST creative (from the embedded discovery_creatives) ─────
    // The inner-join already guaranteed every candidate has ≥1 creative. Sort each
    // ad's creatives images-first / position-asc so the FIRST is a STABLE dedup key —
    // the index row's "primary" hash is whichever creative was written last, so two
    // identical carousels got different keys and failed to dedup ("'It's been' 3×").
    type Cre = { position: number; asset_type: 'image' | 'video'; r2_url: string; hash: string | null }
    const sortCres = (cs: Cre[]) => cs.slice().sort((a, b) =>
      (a.asset_type === b.asset_type ? 0 : a.asset_type === 'image' ? -1 : 1) || (a.position - b.position))
    const creativesByAd: Record<string, Cre[]> = {}
    for (const ad of candidateRows) {
      const cs = (ad.discovery_creatives || []) as Cre[]
      if (cs.length) creativesByAd[ad.ad_id] = sortCres(cs)
    }

    // Server-side dedup by the first creative's hash, PLUS a per-brand cap for
    // diversity (one deep brand like Mars Men would otherwise flood the feed). No cap
    // in brand mode (you clicked a brand → you want all its ads).
    const MAX_PER_BRAND = (q && mode === 'brand') ? Infinity : (adsPerBrand > 0 ? adsPerBrand : 3)
    const seenHashes = new Set<string>()
    const perBrand: Record<string, number> = {}
    const dedupedAds: any[] = []
    for (const ad of candidateRows) {
      const cres = creativesByAd[ad.ad_id]
      if (!cres || !cres.length) continue
      const key = cres[0].hash || `_${ad.ad_id}`          // first creative = stable dedup key
      if (seenHashes.has(key)) continue
      if ((perBrand[ad.page_id] || 0) >= MAX_PER_BRAND) continue
      seenHashes.add(key)
      perBrand[ad.page_id] = (perBrand[ad.page_id] || 0) + 1
      dedupedAds.push(ad)
      if (dedupedAds.length >= limit) break
    }

    ads = dedupedAds
    // Total = the planner's estimate of has-creative ads matching (count:'planned'
    // from the inner-join main query) — instant, replaces the old multi-chunk count
    // pass. Falls back to the deduped page size if the planner returns null.
    total = kwCount || dedupedAds.length
    // Canonical brand name = most common page_name among the brand's OWN ads
    // (page_id === pageId) in the fetched window — a page runs partnership ads under
    // other names (e.g. Grüns's page also shows "Chelsea Handler"); the dominant one
    // is the real brand users searched.
    const nameFreq: Record<string, number> = {}
    for (const r of candidateRows) {
      if (pageId && r.page_id === pageId && r.page_name) {
        const n = String(r.page_name).trim()
        if (n) nameFreq[n] = (nameFreq[n] || 0) + 1
      }
    }
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
        const embRes = await getOpenAI().embeddings.create({
          model: 'text-embedding-3-small',
          input: q.slice(0, 8000),
        })
        const { data: vectorResults } = await admin.rpc('search_ads_semantic', {
          query_embedding: embRes.data[0].embedding,
          match_threshold: 0.32,         // raised: concept expansion now catches synonyms
                                         // precisely in the topic tier, so semantic only
                                         // fills genuine gaps — tighter floor cuts over-reach
                                         // (the anti-aging→Mars Men false positive).
          match_count: 240,
          filter_country: country === 'ALL' ? null : country,
          filter_active: status === 'ACTIVE' ? true : status === 'INACTIVE' ? false : null,
          filter_format: format || null,
          filter_industry: industry || null,
        })
        if (vectorResults?.length) {
          const rows = vectorResults as any[]
          // Semantic is GAP-FILL, not a fabricator. Two states:
          //  • There ARE real lexical/topic matches (an anchor) and the page is short →
          //    top up with neighbours close to the best match (RELATIVE floor). Its job.
          //  • There are ZERO lexical/topic matches → the page is empty and semantic is
          //    the ONLY content. This is exactly where it fabricates "confidently wrong"
          //    results (anti-aging serum → Mars Men, because we never crawled serums). So
          //    require a STRICT ABSOLUTE floor; if nothing clears it, return empty. An
          //    honest empty ("we may not cover this vertical") beats a wrong answer.
          const hadLexicalAnchor = ads.length > 0
          const sims = rows.map(r => (typeof r.similarity === 'number' ? r.similarity : null))
                           .filter((s): s is number => s != null)
          const topSim = sims.length ? Math.max(...sims) : null
          const floor = hadLexicalAnchor
            ? (topSim != null ? Math.max(0.36, topSim - 0.08) : null)  // top-up: relative
            : 0.5                                                       // no anchor: strict absolute

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

    // ── Top up creatives for semantic-fill ads ────────────────────────
    // Candidate ads already have their creatives in creativesByAd (fetched above for
    // dedup); the semantic gap-fill adds ads from a different RPC that aren't in there.
    const missingIds = ads.map((a: any) => a.ad_id).filter((id: string) => id && !creativesByAd[id])
    for (let i = 0; i < missingIds.length; i += 300) {
      const slice = missingIds.slice(i, i + 300)
      const { data: cd } = await admin
        .from('discovery_creatives')
        .select('ad_id, position, asset_type, r2_url, hash')
        .in('ad_id', slice)
        .order('asset_type', { ascending: true })
        .order('position', { ascending: true })
      for (const c of (cd || []) as any[]) {
        (creativesByAd[c.ad_id] ||= []).push({ position: c.position, asset_type: c.asset_type, r2_url: c.r2_url, hash: c.hash })
      }
    }

    // ── Transform results ────────────────────────────────────
    // matchReason = the same match TIER used for ranking (literal > exact_tag >
    // synonym > keyword > related > semantic), so provenance and ordering agree.
    const transformed = ads.map((ad: any) => {
      const cres = creativesByAd[ad.ad_id] || []
      const imgC = cres.find((c) => c.asset_type === 'image')
      const vidC = cres.find((c) => c.asset_type === 'video')
      return {
      id: ad.ad_id,
      matchReason: mode === 'brand' ? 'brand' : matchTierReason(ad, lcQ, expansion),
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
      thumbnailUrl: ad.thumbnail_url || imgC?.r2_url || vidC?.r2_url || null,
      videoUrl: ad.video_url || vidC?.r2_url || null,
      // Needed by the client's CROSS-PAGE dedup: the server dedups within a page,
      // but its offset is into the raw (non-deduped) rows, so page N re-encounters
      // creatives already shown on page N-1. The client filters those by hash — so
      // these MUST be the same first-creative hashes the server deduped on (prefer
      // discovery_creatives; fall back to the index row only for legacy ads).
      image_hash: imgC?.hash ?? ad.image_hash ?? null,
      video_hash: vidC?.hash ?? ad.video_hash ?? null,
      creatives: cres,
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
      topics: ad.topics || [],
      hookType: ad.hook_type,
      emotion: ad.emotion || [],
      angle: ad.angle,
      cta: ad.cta,
      tone: ad.tone,
      persona: ad.persona,
      desire: ad.desire,
      usp: ad.usp,
      aiClassified: ad.ai_classified,
      // rollup-backed (migration 020) — power tier badges + niche chips in the UI
      performanceScore: ad.performance_score ?? null,
      performanceTier: ad.performance_tier ?? null,
      niche: ad.niche ?? null,
      creativeReuseCount: ad.creative_reuse_count ?? 0,
      brandActiveAds: ad.brand_active_ads ?? 0,
      onScreenText: ad.on_screen_text ?? null,   // vision-recovered text (template-body fallback)
      }
    })

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
