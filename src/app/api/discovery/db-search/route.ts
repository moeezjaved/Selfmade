/**
 * Discovery DB Search — queries our own indexed ads database.
 * Uses pgvector semantic search first, falls back to PostgreSQL full-text search.
 * Also returns top brands for the query.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createReadClient, createAdminClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import { expandQuery, matchTierWeight, matchTierReason, type Expansion } from '@/lib/search/concepts'

export const dynamic = 'force-dynamic'
// Let a cold/uncached query finish instead of dying at the 10s default — a killed function never
// runs the snapshot write-through, so the feed could never warm itself out of the slow state.
export const maxDuration = 60

let _openai: OpenAI | null = null
const getOpenAI = () => (_openai ||= new OpenAI({ apiKey: process.env.OPENAI_API_KEY! }))

// ── Instant-feed cache ────────────────────────────────────────────────────
// db-search returns PUBLIC ad data — identical for every signed-in user — so the response can be
// cached by its raw query string. Under heavy DB write load (the rollup/drain writing the very
// table the feed reads), the first paint was stuck on skeletons; this serves repeat loads (the
// default feed especially) from memory in <5ms instead of re-running the contended query. Short
// TTL keeps it fresh; per warm serverless instance (cold starts just repopulate); size-bounded.
type FeedHit = { at: number; body: any }
const FEED_CACHE = new Map<string, FeedHit>()
const FEED_TTL = 180_000   // 3 min — public ad data; a few min stale is invisible for search UX

// Query-embedding cache: the OpenAI embedding for a given search term is deterministic, so cache it and
// skip the ~200-400ms network round-trip on repeat searches of the same term (across cache-miss pages
// and filter combos). Bounded; per warm instance.
type EmbHit = { at: number; vec: number[] }
const EMB_CACHE = new Map<string, EmbHit>()
const EMB_TTL = 30 * 60_000   // 30 min — a term's embedding never changes
async function embedQuery(openai: OpenAI, q: string): Promise<number[]> {
  const key = q.slice(0, 8000)
  const hit = EMB_CACHE.get(key)
  if (hit && Date.now() - hit.at < EMB_TTL) return hit.vec
  const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: key })
  const vec = res.data[0].embedding as number[]
  if (EMB_CACHE.size > 500) EMB_CACHE.clear()
  EMB_CACHE.set(key, { at: Date.now(), vec })
  return vec
}

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

    let userId: string | null = null
    if (!isEval) {
      const supabase = await createClient()
      // PERF: use the LOCAL session (decoded from the cookie, no network) instead of getUser()
      // (which POSTs to the Supabase auth server ~300-500ms). Middleware already validated the JWT
      // via getUser() for this exact request, so re-validating here was pure redundant latency on
      // every search. getSession is sufficient for this soft gate — actual data reads use the
      // admin/replica client and the request is already authenticated upstream.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      userId = session.user.id
    }

    const admin = createReadClient()   // serving reads → replica when SUPABASE_READ_URL set
    const { searchParams } = request.nextUrl

    // Instant-feed cache hit — public ad data, so skip the (possibly contended) DB round-trips.
    const _cacheKey = searchParams.toString()
    if (!isEval) {
      const _hit = FEED_CACHE.get(_cacheKey)
      if (_hit && Date.now() - _hit.at < FEED_TTL) {
        return NextResponse.json({ ..._hit.body, cached: true })
      }
    }

    let q = (searchParams.get('q') || '').trim()
    let corrected: string | null = null   // set when a typo is auto-corrected (e.g. "supplemnet" → "Supplements")
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
    // Default ALL — we crawl worldwide and the country selector was removed from the
    // UI, so defaulting to US silently hid every non-US ad (e.g. hims runs heavily on
    // forhims.co.uk → ~1255 US vs ~2959 worldwide).
    const country = searchParams.get('country') || 'ALL'
    const sort = searchParams.get('sort') || 'recent'
    const days = parseInt(searchParams.get('days') || '0')
    // "launched in the last N days" cutoff — shared by the main query AND the semantic gap-fill below
    // so both honour the window (the semantic RPC has no date param → we filter its rows in-process).
    const sinceDate = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : null
    const page = parseInt(searchParams.get('page') || '0')

    // Free-plan discovery cap (spec §4.2): Free sees ~3 pages/query. Only look up the plan past the
    // boundary so the common fast path stays unchanged. Returns an empty page + upsell flag → the
    // feed stops loading and the client can nudge to upgrade.
    if (!isEval && userId && page >= 3) {
      const { getEntitlements } = await import('@/lib/entitlements')
      const { createAdminClient } = await import('@/lib/supabase/server')
      const ent = await getEntitlements(createAdminClient(), userId)
      if (ent.discoveryPages !== null && page >= ent.discoveryPages) {
        return NextResponse.json({ ads: [], hasMore: false, capped: true, upgradeTo: 'starter', message: `Free plan shows ${ent.discoveryPages} pages per search. Upgrade for unlimited results.` })
      }
    }
    // 60 (was 40): a fuller first paint so the grid fills a tall screen before the scroll sentinel
    // is in view — no premature "loading more". fetchLimit = 120-row window → ~75-90 unique/page.
    const limit = 60
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
    // Hoisted so the semantic gap-fill can honour these too (its RPC has no such params).
    const themeList = theme ? theme.split(',').map(s => s.trim()).filter(Boolean) : []
    const langList = language ? language.split(',').map(s => s.trim()).filter(Boolean) : []
    const platformList = platforms ? platforms.split(',').map(s => s.trim()).filter(Boolean) : []
    // Filters the semantic RPC (search_ads_semantic) can't express because it doesn't return those
    // columns (performance tier, niche, brand-volume, reuse count, style-DNA). When any is active we
    // skip the semantic gap-fill entirely so it can't sneak past them; the rest we filter in-process.
    const semanticBlind = tiers.length > 0 || niches.length > 0 || activeAdsMin > 0 || minReuse > 0
      || formatStyles.length > 0 || visualStyles.length > 0 || ctaStyles.length > 0
    const overlap = (a: any, b: string[]) => Array.isArray(a) && a.some((x: string) => b.includes(x))
    const inRunTime = (dr: number) => runTimeBuckets.length === 0 || runTimeBuckets.some(b => {
      if (b.endsWith('+')) { const n = parseInt(b); return Number.isFinite(n) && dr >= n }
      const [a, c] = b.split('-').map(x => parseInt(x)); return Number.isFinite(a) && Number.isFinite(c) && dr >= a && dr < c
    })
    // A semantic-fill row must satisfy every filter whose column the RPC returns (days/cta/hook/
    // emotion/angle/hide-brands/theme/language/platform/run-time), mirroring the main query.
    const passesSemantic = (v: any) => {
      // "Last N days" = days_running ≤ N (mirrors the main query; see the recency note above).
      if (days > 0 && (Number(v.days_running) ?? 999999) > days) return false
      if (ctaTypes.length && !ctaTypes.includes(v.cta)) return false
      if (hookTypes.length && !hookTypes.includes(v.hook_type)) return false
      if (emotions.length && !overlap(v.emotion, emotions)) return false
      if (angles.length && !angles.includes(v.angle)) return false
      if (hideBrands.length && hideBrands.includes(String(v.page_id))) return false
      if (themeList.length && !overlap(v.themes, themeList)) return false
      if (langList.length && !overlap(v.languages, langList)) return false
      if (platformList.length && !overlap(v.platforms, platformList)) return false
      if (runTimeBuckets.length && !inRunTime(Number(v.days_running) || 0)) return false
      return true
    }

    // ── Persistent feed snapshot (instant cold loads under write load) ──────────
    // The bare default feed (no query / no filters / page 0) is the hottest path and the one that
    // sits on skeletons while the rollup+drain write discovery_ads_index. A cron refreshes a
    // snapshot row every few minutes; serving it skips the live (contended) query entirely. Keyed
    // by sort only — a FIXED key, robust to param-string drift (unlike the in-memory cache). The
    // read is best-effort: if the table doesn't exist yet (pre-migration) it falls through to live.
    const fresh = searchParams.get('fresh') === '1'   // cron sets this to force a live recompute
    // Snapshot the first 3 pages (0–2) of the bare feed so the user has ~180 cards instantly and
    // the eager prefetch (page 1–2) is instant too — no "loading more" wait. Keyed per page.
    const isBareFeed = !q && page <= 2 && !pageId && status === 'ALL' && !platforms && !format &&
      !industry && !theme && !language && country === 'ALL' && days === 0 &&
      tiers.length === 0 && niches.length === 0 && activeAdsMin === 0 && runTimeBuckets.length === 0 &&
      ctaTypes.length === 0 && minReuse === 0 && hideBrands.length === 0 && adsPerBrand === 0 &&
      hookTypes.length === 0 && emotions.length === 0 && angles.length === 0 &&
      formatStyles.length === 0 && visualStyles.length === 0 && ctaStyles.length === 0
    const snapKey = `feed:default:${sort}:${page}`
    if (isBareFeed && !fresh) {
      try {
        const { data: snapRows } = await admin.from('discovery_feed_cache').select('payload, updated_at').eq('key', snapKey).limit(1)
        const snap = snapRows?.[0]
        if (snap && Date.now() - new Date(snap.updated_at).getTime() < 6 * 60_000) {
          return NextResponse.json({ ...snap.payload, cached: 'snapshot' })
        }
      } catch { /* table not present yet → fall through to the live query */ }
    }

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
    // Set when the keyword OR is built — feeds the ranked search_ads_v2 RPC fast path.
    let rpcArgs: { p_q: string; p_tags: string[] } | null = null

    // ── Build base query with ilike keyword search (fast, reliable) ──
    // Only show ads where we actually have a working R2 creative.
    // Hash alone is not enough — R2 upload may have failed even when hash exists.
    let baseQuery = admin
      .from('discovery_ads_index')
      // PRE-COMPUTED has-creative flag (migration 052) instead of a discovery_creatives!inner JOIN.
      // The inner join enforced "only ads with a creative" by scanning discovery_creatives for every
      // candidate. Fine when matches have creatives — but for a term whose (expanded) match set is
      // broad and mostly un-drained (e.g. "nike"), it scanned the whole set hunting for a qualifying
      // page and blew the 8s statement timeout. `has_creative` (indexed boolean) makes that an
      // INSTANT filter. We still EMBED discovery_creatives (LEFT, not inner) to carry creatives for
      // dedup + thumbnails — but only for the ≤80 rows we return, so it's cheap.
      // count=exact for brand mode (page_id=eq is indexed → accurate); keyword/browse stay 'planned'.
      .select('*, discovery_creatives(asset_type,position,r2_url,hash,width,height,poster_url)',
        { count: (q && mode === 'brand') ? 'exact' : 'planned' })
      .eq('has_creative', true)

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
      if (/^\d{8,}$/.test(q)) {
        // The query IS a Meta page_id (e.g. pasted from Following/a chip whose name hadn't resolved).
        // Match it directly so it returns that brand's ads instead of "No ads found".
        baseQuery = baseQuery.eq('page_id', q)
      } else if (mode === 'brand') {
        // Exact page_id (captures every display name on that page). NOTE: the
        // seed_terms affiliate OR is intentionally dropped here — an array-contains on
        // the unindexed seed_terms forces a seq-scan that makes the inner-join embed
        // 9s+ (vs 0.3s for page_id=eq). Brand-affiliate ads are deferred until
        // seed_terms gets a GIN index. Otherwise fall back to a fuzzy page_name match.
        if (pageId) baseQuery = baseQuery.eq('page_id', pageId)
        else baseQuery = baseQuery.ilike('page_name', `%${q}%`)
      } else {
        // ── TYPO TOLERANCE ─────────────────────────────────────────────────────────
        // A single-word query is fuzzy-matched (trigram) against the niche vocabulary
        // (~200 rows, tiny). If it's a strong, same-prefix match to a niche it isn't
        // spelled as — e.g. "supplemnet" → "Supplements" — search the corrected term so
        // results still surface. Guarded (len≥5, sim≥0.4, shared 4-char prefix) so real
        // queries aren't rewritten. Best-effort; failure just leaves q untouched.
        if (!/\s/.test(q) && q.length >= 5) {
          try {
            const { data: nc } = await admin.from('niche_counts').select('niche')
            const tri = (s: string) => { const p = ` ${s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()} `; const g = new Set<string>(); for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3)); return g }
            const qg = tri(q); const ql = q.toLowerCase()
            let best: { niche: string; sim: number } | null = null
            for (const r of (nc || []) as any[]) {
              const n = r.niche as string; if (!n) continue
              const ng = tri(n); let inter = 0; qg.forEach(x => { if (ng.has(x)) inter++ })
              const sim = inter / (qg.size + ng.size - inter || 1)
              if (!best || sim > best.sim) best = { niche: n, sim }
            }
            if (best && best.sim >= 0.4 && best.niche.toLowerCase() !== ql && best.niche.slice(0, 4).toLowerCase() === ql.slice(0, 4)) {
              corrected = q; q = best.niche
            }
          } catch { /* correction is best-effort */ }
        }
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
        // PERF (proven via EXPLAIN ANALYZE on 4.4M rows):
        //  • plfts (plainto) on search_vector = 458ms (GIN bitmap, no heap recheck).
        //    phfts (phraseto) = 7.2s — it heap-rechecks every stem-match for phrase adjacency.
        //    So we use plainto for SPEED and drop the romance-novel false-positives in-process
        //    (matchTierWeight already demotes copy-only stem matches below tag/phrase matches).
        //  • The tag dimension was ~30 separate `col.cs.{one}` OR-clauses, which — combined with
        //    LIMIT — flipped the planner to a 5s+ SEQ SCAN. Collapsing each column to ONE array-
        //    OVERLAP (`col.ov.{a,b,c}` = the `&&` operator) makes it a clean BitmapOr: the whole
        //    keyword query drops to ~240ms. Overlap is semantically identical to OR-of-contains.
        // Stash for the ranked-RPC fast path below (search_ads_v2 ranks these IN the DB).
        // SPECIFIC tags only (phrase + compound + concept expansions) — per-word variants like
        // 'men'/'health' hit million-row tag bitmaps and blow the function's index arms (62s
        // measured). The classic or() path below keeps the word variants for recall.
        rpcArgs = { p_q: lcPhrase, p_tags: Array.from(new Set([lcPhrase, compound, ...expandedTags].filter(Boolean))) }
        // Values are already comma/brace-free (clean() strips them), so an unquoted array literal is
        // safe inside or() — spaces are fine in PG array elements ({hair loss} = one element).
        const tagArr = tagVariants.join(',')
        const orParts = [
          ...textVariants.map(v => `search_vector.plfts(english).${v}`),
          `brand_categories.ov.{${tagArr}}`,
          `topics.ov.{${tagArr}}`,
          `industries.ov.{${tagArr}}`,
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
    // Time window (days>0) = "launched in the last N days" = days_running <= N. We window on days_running
    // (now populated), NOT start_date: a start_date window returned a huge planner-estimate count but ~0
    // VISIBLE ads (the freshest launches have no creative yet, and the feed is has_creative-only). And NOT
    // last_seen — that column has no usable index, so a 30d/90d window seq-scanned and hit a 20s timeout.
    // days_running <= N + the days_running ASC sort below both ride mig-130's partial index
    // (days_running, ad_id) WHERE has_creative → an index range scan that's fast for every window AND
    // returns recently-launched ads that actually have creative.
    if (days > 0) {
      baseQuery = baseQuery.lte('days_running', days)
    }
    // GetHookd-parity filters (performance tier, niche, brand volume, run-time,
    // CTA, creative reuse, hide-brands) — rollup-backed, all additive.
    baseQuery = applyHookdFilters(baseQuery)

    // Sort
    // A time window (days>0) orders by days_running ASC so the (has_creative, days_running, ad_id)
    // composite (mig 130) serves BOTH the .lte('days_running', N) predicate AND the sort — index-only
    // scan, no timeout. (is_active is filtered on the small result set.)
    if (days > 0) baseQuery = baseQuery.order('days_running', { ascending: true, nullsFirst: false }).order('ad_id', { ascending: true })
    else if (sort === 'longest') baseQuery = baseQuery.order('days_running', { ascending: false })
    else if (sort === 'oldest') baseQuery = baseQuery.order('start_date', { ascending: true })
    else if (sort === 'recent') baseQuery = baseQuery.order('last_seen', { ascending: false })
    // 'Newest' = fewest days running (launched most recently). Orders by days_running ASC, ad_id —
    // covered EXACTLY by the partial index dai_hascre_days_running (days_running, ad_id) WHERE
    // has_creative (migration 130), so over the has-creative feed it's a pure index scan: instant even
    // under rollup/drain write load. Empirically every OTHER recency order over WHERE has_creative
    // wades or full-sorts (indexed_at DESC / start_date DESC / last_seen DESC all 20-60s → the "index
    // was busy" banner and skeleton grid) because the freshest ads are the un-drained ones with no
    // creative. days_running ASC is also the SAME column the "last N days" filter (.lte below) keys
    // off, so one index serves both. The recency-heavy guard below fails this fast (not a 60s hang) if
    // the index isn't applied yet.
    else if (sort === 'newest') baseQuery = baseQuery.order('days_running', { ascending: true, nullsFirst: false })
    else if (sort === 'performance') baseQuery = baseQuery.order('performance_score', { ascending: false }).order('is_active', { ascending: false })
    else if (sort === 'most_used') baseQuery = baseQuery.order('creative_reuse_count', { ascending: false })
    else if (sort === 'latest_added') baseQuery = baseQuery.order('indexed_at', { ascending: false })
    else if (sort === 'oldest_added') baseQuery = baseQuery.order('indexed_at', { ascending: true })
    else {
      // 'recommended' (default, Atria-style): proven winners first. The FINAL ranking
      // is done in-process by qualityScore (longevity + active + recency + format) over
      // the candidate window below, so the DB ORDER only needs to surface a good
      // candidate POOL — fast. We deliberately order by last_seen (the ONE indexed sort
      // column → 0.2s) instead of the old is_active-led 4-column blend, which had NO
      // composite index and FULL-SORTED the entire has-creative set on every load
      // (~12s server-side → the grid's multi-second skeleton you saw). Leading a sort
      // with the is_active boolean was the specific killer (2-value column → no early
      // cutoff → whole-set sort). last_seen DESC naturally front-loads active ads
      // (active = crawled/seen recently) and qualityScore then promotes the long-running
      // winners within the window — same intent, instant. To restore the exact blend as
      // an index-backed ORDER BY, add the (is_active,days_running,last_seen,ad_id)
      // composite index (migration 038) and switch this back.
      //
      // UPDATE (post full-rollup): order by performance_score DESC instead. Two wins:
      //  (1) Better ranking — proven WINNERS first, which is what "Recommended" should mean.
      //  (2) FIXES THE INNER-JOIN WADE: last_seen DESC front-loads the newest ads, but the newest
      //      ads are the ~815K un-drained ones with NO creative yet — so discovery_creatives!inner
      //      skipped row after row (timing out → perpetual skeletons). High-performance ads are
      //      older/established → already drained → have creatives → the join lands immediately.
      // Index-backed by discovery_ads_perf_score_idx (perf_score DESC NULLS LAST, ad_id) from 038,
      // so we MUST pass nullsFirst:false to match it (NULLS LAST → scored ads first, no full sort).
      //
      // BROWSE ONLY (no q). For a SEARCH this ORDER BY is the nike-timeout culprit: with a query the
      // GIN-indexed OR is selective and a BitmapOr returns the candidate pool in ~0.3s — but ORDER BY
      // performance_score makes the planner instead walk the perf_score index top-down for LIMIT
      // matching rows, and for a near-zero-result term ("nike") it walks millions → 8s timeout
      // (proven: same query without the ORDER BY = 332ms). The client-side qualityScore re-ranks the
      // pool anyway, so for searches we skip the DB perf-order and let the BitmapOr drive. has_creative
      // already removed the inner-join "wade" this perf-order was compensating for.
      if (!q) baseQuery = baseQuery.order('performance_score', { ascending: false, nullsFirst: false })
    }
    // Stable tiebreaker for BROWSE pagination — without a unique final sort key, offset pages shuffle.
    // BROWSE ONLY, same reason as the perf-order above: for a SEARCH, ORDER BY ad_id (the PK) also
    // tempts the planner to walk the PK index for LIMIT matching rows instead of using the selective
    // BitmapOr — which is exactly why nike (0 results) still timed out after the perf-order fix.
    // Searches fetch the BitmapOr pool (fast, ~0.3s) and the client dedups by creative hash, so they
    // don't need the DB tiebreaker for correctness.
    if (!q && days === 0) baseQuery = baseQuery.order('ad_id', { ascending: true })

    // Page STRAIGHT THROUGH the has-creative results (the inner-join already filtered
    // to displayable ads), `limit` per page. CRITICAL: do NOT multiply the offset by
    // an over-fetch factor — that skipped (factor-1)*40 rows per page, so the grid
    // could only ever reach total/factor (the "only 315 of 1238" cap) AND deep pages
    // landed at huge offsets (row 1000+) that scan forever. A small per-page fetch
    // margin lets server-side dedup/cap trim within the page; the client cross-page-
    // dedups the rest by the hashes we expose. Brand mode has no per-brand cap, so it
    // needs no margin; keyword mode keeps a little for the cap. (Future: keyset
    // pagination to kill the deep-offset scan entirely.)
    // NON-OVERLAPPING WINDOW pagination. Each page scans a fresh `fetchLimit`-row
    // window of has-creative ads (page * fetchLimit) and returns ALL unique creatives
    // in it (no `limit` cap). This fixes the heavy-dedup STALL: with the old
    // offset+limit overlap, a brand like hims (2,959 ads → ~986 unique) hit runs of
    // all-duplicate rows → the deduped list stopped growing → infinite-scroll stalled
    // at ~half (the "511 of 986" bug). Window-aligned windows each contribute their
    // fresh unique ads, so the list keeps growing until the raw rows are exhausted.
    const fetchMargin = 2
    const fetchLimit = limit * fetchMargin         // 80-row window → ~50-60 unique/page,
                                                   // so loadMore fires more often (smoother)
    const fetchOffset = page * fetchLimit           // window-aligned — no overlap, no skip
    baseQuery = baseQuery.range(fetchOffset, fetchOffset + fetchLimit - 1)
    // ── RANKED-RPC FAST PATH (search_ads_v2, migration 099) ─────────────────────
    // For a plain keyword search (no filters), skip PostgREST's single-query planner traps entirely:
    // the RPC grabs ≤1,500 candidates via the GIN BitmapOr (~240ms), ranks them IN the DB
    // (phrase-in-copy > tag match > stems-anywhere, then sort key, then perf score) and pages from
    // the ranked set. Fixes both the 10-15s seq-scan/index-walk flips AND the "arbitrary window"
    // relevance problem (novels above hair brands) in one move. Any filter active → the classic
    // or() query below, which expresses them all.
    const bareKeywordSearch = !!rpcArgs && !pageId && mode !== 'brand' && status === 'ALL' &&
      !platforms && !format && !industry && !theme && !language && country === 'ALL' && days === 0 &&
      tiers.length === 0 && niches.length === 0 && activeAdsMin === 0 && runTimeBuckets.length === 0 &&
      ctaTypes.length === 0 && minReuse === 0 && hideBrands.length === 0 && adsPerBrand === 0 &&
      hookTypes.length === 0 && emotions.length === 0 && angles.length === 0 &&
      formatStyles.length === 0 && visualStyles.length === 0 && ctaStyles.length === 0

    // Retry once on a statement_timeout (57014) — these are transient under the rollup/drain write
    // load and were surfacing as the "index was busy" banner after a couple of searches.
    let keywordData: any = null, kwErr: any = null, kwCount: number | null = null
    let usedRpc = false
    if (bareKeywordSearch && rpcArgs) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await admin.rpc('search_ads_v2', { p_q: rpcArgs.p_q, p_tags: rpcArgs.p_tags, p_sort: sort, p_lim: fetchLimit, p_off: fetchOffset })
        keywordData = r.data; kwErr = r.error
        if (!kwErr || kwErr.code !== '57014') break
        await new Promise(res => setTimeout(res, 180))
      }
      usedRpc = !kwErr
      // Migration not applied yet (or any RPC failure) → fall straight back to the classic query.
      if (kwErr) { keywordData = null; kwErr = null }
    }
    if (!usedRpc) {
      // RECENCY-HEAVY GUARD — a Newest sort or a "last N days" filter keys off days_running, which is a
      // pure index scan ONCE migration 130 (dai_hascre_days_running) is applied, but a 20-60s wade/
      // full-sort BEFORE it is. So cap those queries: race against ~9s and, on the cap, return the
      // graceful "index busy, try again" empty (the client already renders it) instead of leaving the
      // grid on skeletons for a minute or 504-ing. Non-recency sorts (perf_score/recommended) are index-
      // backed and fast, so they keep the normal 57014 retry loop.
      const recencyHeavy = sort === 'newest' || days > 0
      const cap = <T,>(p: PromiseLike<T>, ms: number): Promise<any> =>
        Promise.race([p, new Promise(res => setTimeout(() => res({ data: null, error: { code: '57014', message: 'recency_cap' }, count: null }), ms))])
      if (recencyHeavy) {
        const r = await cap(baseQuery, 9000)
        keywordData = r.data; kwErr = r.error; kwCount = r.count
      } else {
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await baseQuery
          keywordData = r.data; kwErr = r.error; kwCount = r.count
          if (!kwErr || kwErr.code !== '57014') break
          await new Promise(res => setTimeout(res, 180))
        }
      }
    }

    if (kwErr) {
      return NextResponse.json({ ads: [], total: 0, totalInDB, source: 'indexed', searchMethod: 'error', timedOut: true })
    }

    // RPC rows arrive WITHOUT the discovery_creatives embed (SETOF returns bare table rows), and the
    // dedup below drops any ad with no creatives — so batch-attach them here (one indexed IN query).
    if (usedRpc && Array.isArray(keywordData) && keywordData.length) {
      const ids = keywordData.map((a: any) => a.ad_id).filter(Boolean)
      const { data: cres } = await admin.from('discovery_creatives')
        .select('ad_id, position, asset_type, r2_url, hash, width, height, poster_url')
        .in('ad_id', ids)
      const byAd: Record<string, any[]> = {}
      for (const c of (cres || []) as any[]) (byAd[c.ad_id] ||= []).push(c)
      for (const a of keywordData as any[]) a.discovery_creatives = byAd[a.ad_id] || []
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
    type Cre = { position: number; asset_type: 'image' | 'video'; r2_url: string; hash: string | null; width: number | null; height: number | null; poster_url: string | null }
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
      // No `>= limit` break — return ALL unique creatives in this window (the window
      // IS the page now). Capping at `limit` while advancing the offset by the full
      // window would skip the window's extra unique creatives.
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
    // HARD-DISABLED (2026-07-14): the semantic fill adds a per-query OpenAI embedding + pgvector
    // round-trip that made search "slower than ever", and on keyword queries it returned loosely-
    // related junk instead of on-point ads — the exact "worse than before HNSW" complaint. Keyword +
    // tag/concept matching (above) is fast and precise. The env gate `SEMANTIC_SEARCH_ENABLED` proved
    // too easy to leave on by accident, so we gate on a code constant now: flip SEMANTIC_FILL to true
    // (and set OPENAI_API_KEY) to re-enable once the semantic ranking is genuinely better than keyword.
    const SEMANTIC_FILL = false
    if (SEMANTIC_FILL && q && mode !== 'brand' && ads.length < limit && process.env.OPENAI_API_KEY && !semanticBlind) {
      try {
        const queryVec = await embedQuery(getOpenAI(), q)
        const { data: vectorResults } = await admin.rpc('search_ads_semantic', {
          query_embedding: queryVec,
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
            // Honour every active filter the RPC couldn't express (days/cta/hook/emotion/angle/
            // hide-brands/theme/language/platform/run-time) so gap-fill can't leak past them.
            if (!passesSemantic(v)) continue
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
        .select('ad_id, position, asset_type, r2_url, hash, width, height, poster_url')
        .in('ad_id', slice)
        .order('asset_type', { ascending: true })
        .order('position', { ascending: true })
      for (const c of (cd || []) as any[]) {
        (creativesByAd[c.ad_id] ||= []).push({ position: c.position, asset_type: c.asset_type, r2_url: c.r2_url, hash: c.hash, width: c.width, height: c.height, poster_url: c.poster_url })
      }
    }

    // ── Transform results ────────────────────────────────────
    // matchReason = the same match TIER used for ranking (literal > exact_tag >
    // synonym > keyword > related > semantic), so provenance and ordering agree.
    // BUG-4: strip leaked {{mustache}} template tokens (e.g. "{{product.brand}}") at the SOURCE so a
    // raw token can never reach any consumer of this payload (grid card, ad-detail, future exports).
    const stripTpl = (s: any) =>
      typeof s === 'string' ? s.replace(/\{\{[^}]*\}\}/g, '').replace(/[ \t]{2,}/g, ' ').trim() : s
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
      body: stripTpl(ad.body),
      title: stripTpl(ad.title),
      caption: stripTpl(ad.caption),
      description: stripTpl(ad.description),
      snapshotUrl: ad.snapshot_url,
      // Poster fallback chain — last two are the crawler's RAW Meta media (Meta's own video
      // preview image / first image), so VIDEO ads that have no R2 creative yet still show a
      // thumbnail in the feed instead of a grey card. Zero-cost (already captured at crawl time).
      // Prefer the pre-resized thumb (creative.poster_url for images = the 480px webp from the
      // drain's B pass) → small + fast. Falls back to full-res r2_url, then raw Meta media.
      thumbnailUrl: imgC?.poster_url || ad.thumbnail_url || imgC?.r2_url || vidC?.poster_url || vidC?.r2_url || ad.raw_video_preview_urls?.[0] || ad.raw_image_urls?.[0] || null,
      videoUrl: ad.video_url || vidC?.r2_url || ad.raw_video_urls?.[0] || null,
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

    const payload = {
      ads: transformed,
      total,
      corrected,   // original query if it was typo-corrected (UI shows "Showing results for …")
      correctedTo: corrected ? q : null,
      page,
      // Robust pagination: there's more iff the RAW fetch filled its window — i.e.
      // discovery_creatives!inner still had `fetchLimit` rows at this offset. This is
      // independent of `total` (count:'planned' is an unreliable estimate and was
      // capping the feed early) and of post-dedup count. Stops only when the brand's
      // has-creative rows are genuinely exhausted. (Plus the semantic gap-fill case.)
      hasMore: (keywordData?.length || 0) >= fetchLimit,
      totalInDB,
      source: usedRpc ? 'rpc' : 'indexed',   // 'rpc' = the ranked search_ads_v2 fast path (visible in DevTools)
      searchMethod,
    }
    // Cache only successful, non-empty pages (an empty result is usually a transient timeout
    // under write load — caching it would pin skeletons). Bound the map so it can't grow forever.
    if (!isEval && transformed.length > 0) {
      if (FEED_CACHE.size > 300) FEED_CACHE.clear()
      FEED_CACHE.set(_cacheKey, { at: Date.now(), body: payload })
    }
    // Write-through the persistent snapshot on a bare-feed miss → it self-populates on the FIRST
    // request after a deploy/migration (never empty, even before the cron's first tick) and
    // self-refreshes from user traffic if the cron is ever down. Best-effort (table may not exist).
    if (isBareFeed && transformed.length > 0) {
      try {
        await createAdminClient()
          .from('discovery_feed_cache')
          .upsert({ key: snapKey, payload, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      } catch { /* table not present yet → ignore */ }
    }
    return NextResponse.json(payload)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
