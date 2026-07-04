/**
 * Programmatic-SEO data layer for /brands/[slug].
 *
 * Goal: one page per brand targeting "[brand] facebook ads" / "[brand] ad library" searches — pull
 * traffic from people Googling a competitor straight into our funnel. Content is generated from data
 * we already have (discovery_brand_crawl_state + discovery_ads_index), so marginal content cost = 0.
 *
 * THIN-CONTENT GUARD: only brands with >= MIN_INDEXABLE_ADS get indexed (sitemap + no noindex). Pages
 * for 1-2-ad brands are "doorway/thin" pages Google penalizes — we still render them (deep link works)
 * but mark them noindex so they never dilute the domain.
 *
 * Slug resolution without a slug column (avoids DDL under live drain load): we load the compact list
 * of indexable brands (~thousands now, page_id + name + count) once, cache it, and resolve slugs from
 * it. When the corpus of indexable brands grows past ~50K (post Foreplay import), move the slug to a
 * generated column + a slug index and query directly instead of the in-memory map.
 */
import { unstable_cache } from 'next/cache'
import { createReadClient } from '@/lib/supabase/server'

// Build-safe client: createReadClient throws "supabaseUrl is required" if env is absent (e.g. a
// build step without env, or a transient hiccup). Returning null → the SEO functions degrade to
// empty/fallback so a deploy can never fail on it (pages then generate on-demand at runtime).
function readClientSafe(): ReturnType<typeof createReadClient> | null {
  if (!(process.env.SUPABASE_READ_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try { return createReadClient() } catch { return null }
}

// Only brands with >= this many ads get an SEO page (quality-first — content-rich pages rank, thin
// ones get penalized). Env-tunable so we can lower it as the domain earns authority. Default 100.
export const MIN_INDEXABLE_ADS = parseInt(process.env.SEO_MIN_ADS || '100', 10)
// A brand page is only indexed/sitemapped when the brand has this many REAL ads (with creatives) in
// the index. The `ads_indexed` counter overcounts (crawl-seen ads that may lack creatives), so we
// count actual has_creative ads. Pages BELOW the threshold still exist but stay noindex until they
// reach it. (Set by Moeez, 2026-07-04: minimum 200.)
export const MIN_BRAND_ADS = parseInt(process.env.SEO_MIN_BRAND_ADS || '200', 10)
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export type BrandRef = { pageId: string; slug: string; name: string; adCount: number }
export type BrandCreative = { asset_type: string; r2_url: string | null; poster_url: string | null; width: number | null; height: number | null }
export type BrandAd = {
  ad_id: string; body: string | null; start_date: string | null; is_active: boolean
  days_running: number | null; performance_tier: string | null; creatives: BrandCreative[]
}
export type BrandContent = { headline: string | null; intro_md: string | null; meta_description: string | null }
export type Tally = { label: string; count: number }
export type BrandInsights = { topHooks: Tally[]; topEmotions: Tally[]; topAngles: Tally[]; topFormats: Tally[]; topTopics: Tally[]; classified: number }
export type BrandPage = {
  ref: BrandRef
  niche: string | null
  activeCount: number
  longestRunningDays: number
  insights: BrandInsights      // creative-DNA teasers (top hooks/emotions/angles/formats) from the ad sample
  ads: BrandAd[]        // display sample (deduped, best-first)
  indexable: boolean    // adCount >= MIN_INDEXABLE_ADS
  content: BrandContent | null   // unique AI copy (seo-content-worker); null → page uses the template
}

export function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")   // strip accents
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// The canonical list of brands worth an indexable page — cached (revalidate hourly). Small today
// (~thousands with >=5 ads); powers slug resolution, the sitemap, and generateStaticParams. Collisions
// (two brands slugify identically) are disambiguated by appending a short page_id suffix to the lower-
// ad-count one, so every URL is unique and stable.
export const getIndexableBrands = unstable_cache(
  async (): Promise<BrandRef[]> => {
    const db = readClientSafe()
    if (!db) return []
    const { data, error } = await db
      .from('discovery_brand_crawl_state')
      .select('page_id, brand_name, ads_indexed')
      .gte('ads_indexed', MIN_INDEXABLE_ADS)
      .order('ads_indexed', { ascending: false })
      .limit(50000)
    if (error || !data) return []
    const seen = new Map<string, number>()   // slug -> ad_count of the holder
    const out: BrandRef[] = []
    for (const b of data as any[]) {
      const name = (b.brand_name || '').trim()
      if (!name || !b.page_id) continue
      let slug = slugify(name)
      if (!slug) continue
      if (seen.has(slug)) {
        // collision → suffix with a short page_id tail so both remain reachable
        slug = `${slug}-${String(b.page_id).slice(-6)}`
      }
      seen.set(slug, b.ads_indexed)
      out.push({ pageId: String(b.page_id), slug, name, adCount: Number(b.ads_indexed) || 0 })
    }
    return out
  },
  ['seo-indexable-brands-v1'],
  { revalidate: 3600, tags: ['seo-brands'] },
)

// POPULATED brands only — those that actually render >= MIN_BRAND_ADS real ads (with creatives).
// Used for the sitemap + the directory links so neither exposes empty "being processed" pages.
// Per-brand head-count (bounded concurrency), cached 6h to spare the DB (it's under backfill load).
export const getPopulatedBrands = unstable_cache(
  async (): Promise<BrandRef[]> => {
    const db = readClientSafe()
    if (!db) return []
    // Real ads (has_creative) are a SUBSET of ads_indexed, so a brand can only clear the
    // MIN_BRAND_ADS real-ad bar if ads_indexed is already >= it. Pre-filter to that necessary
    // condition (cuts thousands of candidates → the few hundred that could qualify), then cap —
    // this is what stops the /sitemap.xml build step from timing out (60s static-worker limit).
    const all = (await getIndexableBrands())
      .filter((b) => b.adCount >= MIN_BRAND_ADS)
      .slice(0, 3000)
    const out: BrandRef[] = []
    const CONC = 16
    for (let i = 0; i < all.length; i += CONC) {
      const batch = all.slice(i, i + CONC)
      const flags = await Promise.all(batch.map(async (b) => {
        const { count } = await db.from('discovery_ads_index')
          .select('ad_id', { count: 'exact', head: true })
          .eq('page_id', b.pageId).eq('has_creative', true)
        return (count || 0) >= MIN_BRAND_ADS
      }))
      batch.forEach((b, j) => { if (flags[j]) out.push(b) })
    }
    return out
  },
  ['seo-populated-brands-v1'],
  { revalidate: 21600, tags: ['seo-brands'] },
)

// Resolve a slug → its brand ref (from the cached indexable list). Also matches a bare slug against
// its collision-suffixed variant. Returns null for unknown slugs (→ 404).
export async function resolveSlug(slug: string): Promise<BrandRef | null> {
  const list = await getIndexableBrands()
  const s = slug.toLowerCase()
  return list.find((b) => b.slug === s) || null
}

// Fetch a brand's page payload: display ads (best-first, deduped by first creative) + stats. Cached
// per page_id (revalidate ~6h via unstable_cache; the route also sets ISR revalidate).
export const getBrandPage = unstable_cache(
  async (ref: BrandRef): Promise<BrandPage> => {
    const EMPTY_INSIGHTS: BrandInsights = { topHooks: [], topEmotions: [], topAngles: [], topFormats: [], topTopics: [], classified: 0 }
    const db = readClientSafe()
    if (!db) return { ref, niche: null, activeCount: 0, longestRunningDays: 0, insights: EMPTY_INSIGHTS, ads: [], indexable: false, content: null }
    const { data: rows } = await db
      .from('discovery_ads_index')
      .select('ad_id, body, start_date, is_active, days_running, performance_tier, niche, hook_type, emotion, angle, format_style, topics, discovery_creatives(asset_type,r2_url,poster_url,position,width,height)')
      .eq('page_id', ref.pageId)
      .eq('has_creative', true)
      .order('performance_score', { ascending: false, nullsFirst: false })
      .limit(60)

    const ads: BrandAd[] = []
    const seenKey = new Set<string>()
    let niche: string | null = null
    let longest = 0
    // Creative-DNA frequency tallies over the (top-performing) sample → teasers on the page.
    const hookF = new Map<string, number>(), emoF = new Map<string, number>(), angF = new Map<string, number>(), fmtF = new Map<string, number>(), topF = new Map<string, number>()
    const bump = (m: Map<string, number>, k: any) => { if (k) m.set(String(k), (m.get(String(k)) || 0) + 1) }
    let classified = 0
    for (const r of (rows || []) as any[]) {
      const cres: BrandCreative[] = (r.discovery_creatives || [])
        .slice()
        .sort((a: any, b: any) => (a.asset_type === b.asset_type ? 0 : a.asset_type === 'image' ? -1 : 1) || (a.position - b.position))
      if (!cres.length) continue
      const first = cres[0]
      const key = (first.r2_url || first.poster_url || r.ad_id) as string
      if (seenKey.has(key)) continue           // dedup near-identical variants
      seenKey.add(key)
      if (!niche && r.niche) niche = r.niche
      if ((r.days_running ?? 0) > longest) longest = r.days_running ?? 0
      if (r.hook_type || (r.emotion && r.emotion.length)) classified++
      bump(hookF, r.hook_type); bump(angF, r.angle)
      bump(fmtF, r.format_style || (first.asset_type === 'video' ? 'Video' : 'Image / Graphic'))
      for (const e of (r.emotion || [])) bump(emoF, e)
      for (const t of (r.topics || [])) bump(topF, t)
      ads.push({
        ad_id: r.ad_id, body: r.body, start_date: r.start_date, is_active: !!r.is_active,
        days_running: r.days_running, performance_tier: r.performance_tier, creatives: cres,
      })
    }
    const activeCount = ads.filter((a) => a.is_active).length
    const topN = (m: Map<string, number>, n: number): Tally[] => Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }))
    const insights: BrandInsights = {
      topHooks: topN(hookF, 4), topEmotions: topN(emoF, 5), topAngles: topN(angF, 3),
      topFormats: topN(fmtF, 3), topTopics: topN(topF, 6), classified,
    }

    // Unique AI copy (seo-content-worker) if generated; graceful null → the page falls back to the
    // template. Missing table (pre-migration) also degrades to null.
    let content: BrandContent | null = null
    try {
      const { data: c } = await db
        .from('brand_seo_content')
        .select('headline, intro_md, meta_description')
        .eq('page_id', ref.pageId)
        .maybeSingle()
      if (c) content = c as BrandContent
    } catch { /* table not present yet → template fallback */ }

    // Index only when the brand has >= MIN_BRAND_ADS REAL ads (with creatives) in the index — the
    // render sample is capped at 48, so we head-count the true total rather than ads.length.
    const { count: realAdCount } = await db.from('discovery_ads_index')
      .select('ad_id', { count: 'exact', head: true })
      .eq('page_id', ref.pageId).eq('has_creative', true)

    return {
      ref, niche, activeCount, longestRunningDays: longest, insights,
      ads: ads.slice(0, 48),
      indexable: (realAdCount || 0) >= MIN_BRAND_ADS,   // >=200 real ads — pages below this exist but stay noindex
      content,
    }
  },
  ['seo-brand-page-v1'],
  { revalidate: 21600, tags: ['seo-brands'] },
)

// A few related brands in the same niche for internal linking (helps Google crawl deep + spreads
// link equity). Cheap: pulled from the already-cached indexable list, no extra query.
export async function relatedBrands(ref: BrandRef, niche: string | null, n = 12): Promise<BrandRef[]> {
  const list = await getIndexableBrands()
  return list.filter((b) => b.pageId !== ref.pageId).slice(0, n)   // niche-filtered later once niche is on the ref
}
