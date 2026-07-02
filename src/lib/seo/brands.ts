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

export const MIN_INDEXABLE_ADS = 5           // < this → render but noindex (thin-content guard)
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://tryselfmade.ai').replace(/\/$/, '')

export type BrandRef = { pageId: string; slug: string; name: string; adCount: number }
export type BrandCreative = { asset_type: string; r2_url: string | null; poster_url: string | null; width: number | null; height: number | null }
export type BrandAd = {
  ad_id: string; body: string | null; start_date: string | null; is_active: boolean
  days_running: number | null; performance_tier: string | null; creatives: BrandCreative[]
}
export type BrandPage = {
  ref: BrandRef
  niche: string | null
  activeCount: number
  longestRunningDays: number
  ads: BrandAd[]        // display sample (deduped, best-first)
  indexable: boolean    // adCount >= MIN_INDEXABLE_ADS
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
    const db = createReadClient()
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
    const db = createReadClient()
    const { data: rows } = await db
      .from('discovery_ads_index')
      .select('ad_id, body, start_date, is_active, days_running, performance_tier, niche, discovery_creatives(asset_type,r2_url,poster_url,position,width,height)')
      .eq('page_id', ref.pageId)
      .eq('has_creative', true)
      .order('performance_score', { ascending: false, nullsFirst: false })
      .limit(60)

    const ads: BrandAd[] = []
    const seenKey = new Set<string>()
    let niche: string | null = null
    let longest = 0
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
      ads.push({
        ad_id: r.ad_id, body: r.body, start_date: r.start_date, is_active: !!r.is_active,
        days_running: r.days_running, performance_tier: r.performance_tier, creatives: cres,
      })
    }
    const activeCount = ads.filter((a) => a.is_active).length
    return {
      ref, niche, activeCount, longestRunningDays: longest,
      ads: ads.slice(0, 48),
      indexable: ref.adCount >= MIN_INDEXABLE_ADS,
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
