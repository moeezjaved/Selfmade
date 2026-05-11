/**
 * Ad Indexer — Background crawler
 * Reads terms from discovery_crawl_terms, fetches ads per country,
 * generates OpenAI embeddings for semantic search, classifies with Claude AI.
 * Triggered by Vercel cron every 6 hours OR manually from admin dashboard.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/meta/client'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const V = process.env.META_API_VERSION || 'v20.0'
const APP_TOKEN = `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`

// Meta uses ISO codes — normalize common aliases
const COUNTRY_MAP: Record<string, string> = { UK: 'GB' }
const normalizeCountry = (c: string) => COUNTRY_MAP[c.toUpperCase()] || c.toUpperCase()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

// ── Get best available Meta access token ─────────────────────
async function getMetaToken(admin: any): Promise<string> {
  // Try to get a real user access token from any connected account
  const { data: accounts } = await admin
    .from('meta_accounts')
    .select('access_token')
    .eq('is_primary', true)
    .limit(1)
  if (accounts?.[0]?.access_token) {
    const userToken = decryptToken(accounts[0].access_token)
    if (userToken) return userToken
  }
  // Fallback to app token
  return APP_TOKEN
}

const TERMS_PER_RUN = 10   // terms per cron run
const ADS_PER_TERM = 50    // ads per Meta API call
const PAGES_PER_TERM = 3   // pages to fetch (50 × 3 = 150 ads per term×country)
const EMBED_BATCH = 200    // embed ALL new ads per run (OpenAI handles large batches fine)
const CLASSIFY_BATCH = 25  // ads per Claude call — 25 is safe within token limits

// ── Curation thresholds ──────────────────────────────────────
// MIN_DAYS = 0 means index everything — curation is a UI filter, not a crawl filter.
const MIN_DAYS_ADCOPY   = 0
const MIN_DAYS_BRAND    = 0
const MIN_DAYS_CATEGORY = 0

// External page quality gate: when a keyword search returns ads from pages that are
// NOT the target brand (influencers, marketplaces, review accounts), only keep ads
// from pages with at least this many followers. Filters out micro accounts and junk.
// Set to 0 to disable. Atria-like platforms typically use ~50k as the cutoff.
const MIN_EXTERNAL_PAGE_FOLLOWERS = 50_000

const META_FIELDS = [
  'id','ad_creation_time','ad_delivery_start_time','ad_delivery_stop_time',
  'ad_creative_bodies','ad_creative_link_titles','ad_creative_link_captions',
  'ad_creative_link_descriptions','ad_snapshot_url','page_name','page_id',
  'publisher_platforms','languages',
  // Per-ad list of countries the ad reached (powers proper country filter)
  'ad_reached_countries',
].join(',')

// ── Auth ────────────────────────────────────────────────────
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = request.nextUrl.searchParams.get('secret')
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Vercel Cron / manual secret auth
  if (!cronSecret) return true // no secret set = open (dev only)
  if (secret === cronSecret || authHeader === `Bearer ${cronSecret}`) return true

  // Fallback: allow any authenticated Supabase user (admin dashboard)
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return true
  } catch { /* ignore */ }

  return false
}

// ── Category keyword expansion map ──────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'fashion':        ['fashion','clothing','outfit','apparel','streetwear','style'],
  'beauty':         ['beauty','skincare','makeup','cosmetics','serum','moisturizer'],
  'fitness':        ['fitness','workout','gym','weight loss','muscle','protein'],
  'health':         ['health','wellness','supplement','vitamin','immunity','detox'],
  'food':           ['food','meal delivery','snack','recipe','restaurant','beverage'],
  'coffee':         ['coffee','espresso','cold brew','cafe','beans'],
  'tech':           ['software','saas','app','ai tool','automation','productivity'],
  'finance':        ['investing','crypto','trading','insurance','credit','wealth'],
  'home':           ['home decor','furniture','kitchen','bedroom','interior','cleaning'],
  'baby':           ['baby','toddler','kids','parenting','infant','nursery'],
  'pets':           ['dog','cat','pet','puppy','vet','grooming'],
  'travel':         ['travel','hotel','vacation','flight','holiday','destination'],
  'education':      ['course','coaching','masterclass','certification','training','skills'],
  'ecommerce':      ['shop now','free shipping','sale','discount','limited offer','buy now'],
  'jewelry':        ['jewelry','ring','necklace','bracelet','watch','diamond','gold'],
  'sports':         ['sports','outdoor','hiking','cycling','running','athletic'],
  'gaming':         ['gaming','esports','streamer','console','pc gaming','game'],
  'real estate':    ['real estate','property','mortgage','apartment','rent','listing'],
  'automotive':     ['car','vehicle','auto','truck','electric vehicle','lease'],
  'b2b':            ['b2b','agency','marketing','lead generation','enterprise','consulting'],
}

// ── Single-page Meta fetch helper ───────────────────────────
async function fetchOnePage(
  params: Record<string, string>,
  after = ''
): Promise<{ ads: any[]; nextCursor: string; hasMore: boolean; error?: string }> {
  if (after) params = { ...params, after }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(`https://graph.facebook.com/${V}/ads_archive?` + new URLSearchParams(params), { signal: ctrl.signal })
    clearTimeout(t)
    const data = await res.json()
    if (data.error) return { ads: [], nextCursor: '', hasMore: false, error: data.error.message }
    return {
      ads: data.data || [],
      nextCursor: data.paging?.cursors?.after || '',
      hasMore: !!data.paging?.next,
    }
  } catch (e: any) {
    return { ads: [], nextCursor: '', hasMore: false, error: e.name === 'AbortError' ? 'Timed out after 15s' : e.message }
  }
}

// ── Find a brand's Facebook page_id ─────────────────────────
// Scrapes the public Facebook Ads Library page search (no login required).
// URL: facebook.com/ads/library/?q=BRAND&search_type=page
// ScrapingBee renders the React SPA and we extract page_ids from the HTML.
async function findBrandPageIds(brandName: string, token: string): Promise<string[]> {
  const found = new Set<string>()

  // ── Strategy A: Graph API slug lookup (fast, free) ───────────
  const base = brandName.toLowerCase().replace(/[^a-z0-9]/g, '')
  try {
    const url = `https://graph.facebook.com/${V}/${base}?fields=id,name&access_token=${token}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json() as { id?: string; name?: string; error?: any }
    if (!data.error && data.id) {
      const nameLower = (data.name || '').toLowerCase()
      if (nameLower.includes(base) || base.includes(nameLower.replace(/\s/g, ''))) {
        found.add(data.id)
      }
    }
  } catch { /* ignore */ }

  if (found.size > 0) return Array.from(found)

  // ── Strategy B: Scrape Facebook Ads Library page search ──────
  // This page is PUBLIC — no login needed. It shows brand pages when
  // search_type=page. The rendered HTML contains page_ids in links and data.
  const sbKey = process.env.SCRAPINGBEE_KEY
  if (sbKey) {
    try {
      const adsLibraryUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(brandName)}&search_type=page`
      const params = new URLSearchParams({
        api_key: sbKey,
        url: adsLibraryUrl,
        render_js: 'true',
        premium_proxy: 'true',
        wait: '4000',   // wait for React to load page results
      })
      const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const html = await res.text()
        // Page_ids appear in multiple patterns in the rendered Ads Library HTML
        const patterns = [
          /view_all_page_id=(\d{10,})/g,            // in "See all ads" links
          /"page_id"\s*[=:]\s*['"]*(\d{10,})/g,     // JSON data
          /\/ads\/library\/\?.*?id=(\d{10,})/g,      // ad detail links
          /"advertiserID"\s*:\s*"(\d{10,})"/g,       // advertiser data
          /page_id%3D(\d{10,})/g,                    // URL-encoded
        ]
        const nameLower = brandName.toLowerCase()
        // Collect all candidate page_ids from the HTML
        const candidates = new Set<string>()
        for (const pat of patterns) {
          let m: RegExpExecArray | null
          const regex = new RegExp(pat.source, 'g')
          while ((m = regex.exec(html)) !== null) {
            if (m[1]) candidates.add(m[1])
          }
        }
        // Pick IDs that appear near the brand name in the HTML (within 500 chars)
        for (const id of Array.from(candidates)) {
          const idx = html.indexOf(id)
          if (idx === -1) continue
          const surrounding = html.slice(Math.max(0, idx - 500), idx + 500).toLowerCase()
          if (surrounding.includes(nameLower) || surrounding.includes(base)) {
            found.add(id)
            if (found.size >= 3) break  // enough
          }
        }
        // Fallback: just take first few candidates if proximity check found nothing
        if (found.size === 0) {
          Array.from(candidates).slice(0, 3).forEach(id => found.add(id))
        }
      }
    } catch { /* ignore */ }
  }

  return Array.from(found)
}

// ── Batch-fetch page follower counts from Graph API ─────────
// Used to quality-gate external pages (influencers, marketplaces, etc.).
// Returns a Map<page_id, fan_count>. Missing pages default to 0.
async function getPageFollowers(pageIds: string[], token: string): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (!pageIds.length) return result

  const BATCH = 50 // Graph API ids= endpoint handles up to 50 at once
  for (let i = 0; i < pageIds.length; i += BATCH) {
    const batch = pageIds.slice(i, i + BATCH)
    try {
      const res = await fetch(
        `https://graph.facebook.com/${V}/?ids=${batch.join(',')}&fields=fan_count&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (!res.ok) continue
      const data = await res.json() as Record<string, any>
      for (const [id, page] of Object.entries(data)) {
        if (page?.fan_count != null) result.set(id, page.fan_count as number)
      }
    } catch { /* ignore — missing pages just won't be in the map */ }
  }
  return result
}

// ── Meta Ads Library fetch ──────────────────────────────────
//
// Strategy:
//  1. AD COPY  — keyword search in ad body text (good for topic/product searches)
//  2. BRAND    — discover the brand's actual page_id, then fetch ALL their ads directly
//               This is the key fix: searching "gymshark" as search_terms returns ads
//               that MENTION gymshark (competitors, reviewers). We need to find Gymshark's
//               page_id from the initial results, then fetch ALL ads from that page.
//  3. CATEGORY — expand the term into related keywords (e.g. "fitness" → ["gym","protein",…])
//
// Quality gate: external pages (not the brand itself) must have ≥ MIN_EXTERNAL_PAGE_FOLLOWERS
// followers. This filters out micro-influencers, review spam, and junk pages.
async function fetchAdsForTerm(
  term: string,
  country: string,
  token: string,
  _termType: string = 'all',
  admin?: any,
  preDiscoveredPageIds: string[] = [], // page_ids found by caller before this call
  deadlineMs?: number,                 // absolute epoch ms — stop before this to avoid 300 s timeout
  onLog?: (msg: string) => void,       // stream-visible progress callback
): Promise<{ ads: any[], externalFiltered: number, timedOut: boolean, error?: string }> {
  const log = (msg: string) => { console.log(msg); onLog?.(msg) }
  const metaCountry = normalizeCountry(country)
  const seenIds = new Set<string>()
  const allAds: any[] = []
  const brandPageIds = new Set<string>(preDiscoveredPageIds)
  let timedOut = false

  const addAds = (ads: any[]): number => {
    let added = 0
    for (const ad of ads) {
      if (ad.id && !seenIds.has(ad.id)) {
        seenIds.add(ad.id)
        allAds.push(ad)
        added++
      }
    }
    return added
  }

  const isNearDeadline = () => deadlineMs ? Date.now() > deadlineMs : false

  const baseParams = (searchTerm: string): Record<string, string> => ({
    access_token: token,
    search_terms: searchTerm,
    ad_reached_countries: JSON.stringify([metaCountry]),
    fields: META_FIELDS,
    limit: String(ADS_PER_TERM),
  })

  // ── 1. AD COPY: keyword search — finds all ads mentioning this term ──
  // IMPORTANT: Skip keyword search when we already have a brand page_id.
  // Keyword search for "gymshark" finds Gymshark's own ads AND competitor
  // ads that mention them. Those Gymshark-owned ads end up in seenIds and
  // then the brand page pagination stops early (0 new IDs per page), even
  // though there are 2000+ more ads to fetch from pages 3–60.
  // When page_id is known, brand fetch (step 2) is comprehensive on its own.
  if (preDiscoveredPageIds.length === 0) {
    const params = baseParams(term)
    let cursor = ''
    for (let p = 0; p < PAGES_PER_TERM; p++) {
      if (isNearDeadline()) { timedOut = true; break }
      const { ads, nextCursor, hasMore, error } = await fetchOnePage(params, cursor)
      if (error) break
      addAds(ads)
      if (!hasMore) break
      cursor = nextCursor
    }
  }

  // ── 2. BRAND: fetch ALL ads directly from brand's own page(s) ───────
  // Supplement pre-discovered page_ids with:
  //  a) step-1 results where page_name ≈ term
  //  b) our DB of previously indexed pages
  {
    const termLower = term.toLowerCase()

    allAds
      .filter((ad: any) => ad.page_name && ad.page_name.toLowerCase().includes(termLower))
      .forEach((ad: any) => { if (ad.page_id) brandPageIds.add(ad.page_id) })

    if (admin) {
      const { data: dbPages } = await admin
        .from('discovery_ads_index')
        .select('page_id')
        .ilike('page_name', `%${term}%`)
        .limit(10)
      ;(dbPages || []).forEach((p: any) => { if (p.page_id) brandPageIds.add(p.page_id) })
    }

    const pageIds = Array.from(brandPageIds).slice(0, 10)

    if (pageIds.length && !isNearDeadline()) {
      // search_page_ids format: use comma-separated numeric IDs (e.g. "123456789").
      const pageIdsParam = pageIds.join(',')

      // For brand page crawls, expand beyond the term's single configured country.
      // A brand like Gymshark is UK-based; 90%+ of their ads target GB/AU/CA/US.
      // Searching only "US" returns ~53 ads; searching all English-speaking markets
      // returns the full 2000+ ad library. We include all term countries + standard
      // brand markets. Meta's ad_reached_countries is an OR filter — ads that
      // targeted ANY of the listed countries are returned.
      // Comprehensive list of major markets where global DTC brands run ads.
      // Meta accepts up to ~30 countries per request reliably.
      const BRAND_COUNTRIES = [
        // North America
        'US', 'CA', 'MX',
        // Europe
        'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'SE', 'DK', 'PL', 'IE', 'PT',
        // Asia-Pacific
        'AU', 'NZ', 'IN', 'JP', 'SG', 'HK', 'TH', 'PH', 'ID',
        // Middle East / Africa
        'AE', 'SA', 'KW', 'ZA',
        // Latin America
        'BR', 'AR',
      ]
      const brandCountries = Array.from(new Set([metaCountry, ...BRAND_COUNTRIES]))

      const brandPageParams: Record<string, string> = {
        access_token: token,
        search_page_ids: pageIdsParam,
        ad_reached_countries: JSON.stringify(brandCountries),
        ad_type: 'ALL',
        active_status: 'ALL', // include stopped/paused — historical winners matter
        fields: META_FIELDS,
        limit: String(ADS_PER_TERM),
      }

      // ── Paginate until no new ad_archive_ids, cursor missing, or deadline ──
      // Meta caps results around 50K per query; allow enough pages to drain it.
      const MAX_BRAND_PAGES = 1000 // 1000 × 50 = 50,000 ads max per brand per run

      // Resume from previously saved cursor (so we don't re-fetch pages 1-60
      // every cron tick when the brand has 50K ads). One state row per page_id.
      const firstPageIdForState = pageIds[0]
      let brandCursor = ''
      let pagesTotal = 0
      let resumedFromCursor = false
      let brandExhausted = false
      // Re-crawl brands that were exhausted more than 7 days ago to catch new ads
      const RECRAWL_INTERVAL_DAYS = 7
      try {
        const { data: state } = await admin
          .from('discovery_brand_crawl_state')
          .select('cursor, ads_indexed, exhausted_at')
          .eq('page_id', firstPageIdForState)
          .maybeSingle()
        if (state?.exhausted_at) {
          const daysSinceExhausted = (Date.now() - new Date(state.exhausted_at).getTime()) / 86_400_000
          if (daysSinceExhausted < RECRAWL_INTERVAL_DAYS) {
            log(`  ✅ Brand ${firstPageIdForState} exhausted ${daysSinceExhausted.toFixed(1)}d ago (${state.ads_indexed} ads) — next recheck in ${(RECRAWL_INTERVAL_DAYS - daysSinceExhausted).toFixed(1)}d`)
            brandExhausted = true
          } else {
            log(`  🔄 Brand ${firstPageIdForState} exhausted ${daysSinceExhausted.toFixed(1)}d ago — re-crawling for new ads`)
            // Clear state so we start fresh from page 1
            await admin
              .from('discovery_brand_crawl_state')
              .update({ cursor: null, exhausted_at: null } as any)
              .eq('page_id', firstPageIdForState)
          }
        } else if (state?.cursor) {
          brandCursor = state.cursor
          resumedFromCursor = true
          log(`  ↪️  Resuming brand ${firstPageIdForState} from saved cursor (already ${state.ads_indexed} ads)`)
        }
      } catch { /* state table may not exist on first run */ }

      // Track consecutive 0-new pages — stops re-crawls early when caught up
      let consecZeroNew = 0
      const STOP_AFTER_ZERO_NEW_PAGES = 5

      for (let p = 0; !brandExhausted && p < MAX_BRAND_PAGES; p++) {
        if (isNearDeadline()) {
          timedOut = true
          log(`  ⏰ Brand fetch deadline at page ${p + 1} — ${allAds.length} ads saved so far. Cursor saved for next run.`)
          break
        }
        const { ads: pageAds, nextCursor, hasMore, error } = await fetchOnePage(brandPageParams, brandCursor)
        if (error) {
          log(`  ❌ Brand page ${p + 1} error: ${error}`)
          break
        }
        const newThisPage = addAds(pageAds)
        pagesTotal++
        log(`  📄 Brand page ${p + 1}${resumedFromCursor ? ' (resumed)' : ''}: ${pageAds.length} returned, ${newThisPage} new | running total: ${allAds.length}`)

        // Track consecutive 0-new pages so re-crawls stop early when caught up
        if (newThisPage === 0) consecZeroNew++
        else consecZeroNew = 0
        if (consecZeroNew >= STOP_AFTER_ZERO_NEW_PAGES) {
          log(`  ⏭  ${STOP_AFTER_ZERO_NEW_PAGES} consecutive pages with 0 new ads — caught up, marking exhausted`)
          try {
            await admin.from('discovery_brand_crawl_state').upsert({
              page_id: firstPageIdForState,
              brand_name: term,
              cursor: null,
              exhausted_at: new Date().toISOString(),
              last_run_at: new Date().toISOString(),
              last_run_added: 0,
            } as any)
          } catch { /* ignore */ }
          break
        }

        if (!hasMore || !nextCursor) {
          // Only mark exhausted if we actually GOT ads. If we got zero on the
          // very first page we're probably hitting an API issue — leave state
          // alone so a re-run can try again.
          if (allAds.length > 0) {
            try {
              await admin.from('discovery_brand_crawl_state').upsert({
                page_id: firstPageIdForState,
                brand_name: term,
                cursor: null,
                exhausted_at: new Date().toISOString(),
                last_run_at: new Date().toISOString(),
                last_run_added: newThisPage,
              } as any)
            } catch { /* ignore */ }
          } else {
            log(`  ⚠️  No ads returned on first page — likely API issue. Not marking exhausted.`)
          }
          break
        }
        brandCursor = nextCursor
      }

      // Save the cursor so next run resumes here (only if we didn't fully exhaust)
      if (brandCursor) {
        try {
          await admin.from('discovery_brand_crawl_state').upsert({
            page_id: firstPageIdForState,
            brand_name: term,
            cursor: brandCursor,
            last_run_at: new Date().toISOString(),
            last_run_added: allAds.length,
          } as any, { onConflict: 'page_id' })
          log(`  💾 Saved cursor for brand ${firstPageIdForState} — next run resumes here`)
        } catch { /* ignore */ }
      }

      log(`  ✅ Brand fetch this run — ${pagesTotal} pages → ${allAds.length} ads`)
    }
  }

  // ── 3. CATEGORY: expand term → related keywords, search each ─
  if (!timedOut) {
    const termLower = term.toLowerCase()
    const matchedKey = Object.keys(CATEGORY_KEYWORDS).find(k =>
      termLower.includes(k) || k.includes(termLower)
    )
    const keywords = matchedKey
      ? CATEGORY_KEYWORDS[matchedKey]
      : [] // for brand names don't fall back to raw term — already covered in step 1

    for (const kw of keywords) {
      if (isNearDeadline()) { timedOut = true; break }
      const params = baseParams(kw)
      // 1 page per keyword keeps total volume reasonable
      const { ads, error } = await fetchOnePage(params, '')
      if (!error) addAds(ads)
    }
  }

  // ── Quality gate: filter external pages by follower count ────
  // Brand's own pages → always keep (no filter).
  // Everyone else (influencers, marketplaces, review accounts) → must have
  // at least MIN_EXTERNAL_PAGE_FOLLOWERS followers to be worth indexing.
  // This kills micro-influencer spam and junk one-post pages.
  let filteredAds = allAds
  let externalFiltered = 0

  if (MIN_EXTERNAL_PAGE_FOLLOWERS > 0 && brandPageIds.size > 0) {
    // Find unique external page_ids (ads NOT from the brand's own pages)
    const externalPageIds = Array.from(
      new Set(
        allAds
          .filter((ad: any) => ad.page_id && !brandPageIds.has(ad.page_id))
          .map((ad: any) => ad.page_id)
      )
    ) as string[]

    if (externalPageIds.length) {
      const followerMap = await getPageFollowers(externalPageIds, token)

      filteredAds = allAds.filter((ad: any) => {
        // Brand's own ads: always keep
        if (!ad.page_id || brandPageIds.has(ad.page_id)) return true
        // External page: check follower count
        const fans = followerMap.get(ad.page_id) ?? 0
        if (fans >= MIN_EXTERNAL_PAGE_FOLLOWERS) return true
        externalFiltered++
        return false
      })
    }
  }

  return { ads: filteredAds, externalFiltered, timedOut }
}

// ── Classification helpers ───────────────────────────────────
function detectFormat(ad: any): string {
  const body = (ad.ad_creative_bodies?.[0] || '').toLowerCase()
  if (body.includes('video') || body.includes('watch')) return 'Video'
  return 'Image'
}

function detectIndustries(text: string): string[] {
  const t = text.toLowerCase()
  const map: [string, string[]][] = [
    ['Fashion & Apparel', ['fashion','clothing','apparel','dress','shoes','sneakers','outfit','wear','style','boutique','jeans','shirt','jacket','hoodie']],
    ['Beauty & Skincare', ['skin','serum','moisturizer','beauty','cosmetic','makeup','foundation','glow','wrinkle','anti-aging','sunscreen','retinol','vitamin c','toner','cleanser']],
    ['Health & Wellness', ['health','wellness','supplement','vitamin','probiotic','immunity','gut','detox','natural','organic','collagen','omega']],
    ['Fitness & Sports', ['gym','fitness','workout','exercise','protein','muscle','training','yoga','running','athletic','weight loss','creatine','pre-workout']],
    ['Food & Beverage', ['food','coffee','tea','drink','snack','meal','restaurant','chocolate','wine','vegan','keto','nutrition','recipe','bakery','juice']],
    ['Technology', ['software','app','saas','tech','digital','ai','platform','tool','automation','crm','cloud','code','developer','startup']],
    ['Finance & Investing', ['invest','finance','money','crypto','trading','insurance','loan','credit','wealth','stock','forex','tax','budget']],
    ['Home & Living', ['home','furniture','decor','kitchen','bedroom','cleaning','interior','living','garden','candle','bedding','mattress']],
    ['Baby & Kids', ['baby','kids','child','toddler','parenting','infant','nursery','toy','stroller','diaper']],
    ['Pets', ['dog','cat','pet','puppy','kitten','animal','paw','vet','grooming']],
    ['Travel', ['travel','hotel','flight','vacation','trip','tour','holiday','destination','luggage','passport']],
    ['Education', ['course','learn','training','coaching','certification','study','skills','education','mentor','masterclass']],
    ['E-commerce', ['shop now','buy now','order','sale','discount','free shipping','limited offer','shopify','ecommerce']],
    ['Business & Marketing', ['entrepreneur','marketing','agency','lead generation','branding','freelance','consulting','b2b']],
  ]
  return map.filter(([, kw]) => kw.some(k => t.includes(k))).map(([ind]) => ind)
}

function detectThemes(text: string): string[] {
  const t = text.toLowerCase()
  const themes: string[] = []
  if (/\d+%\s*off|sale|discount|save \$|free shipping|limited time|deal|promo/.test(t)) themes.push('Sale/Discount')
  if (/before.{0,30}after|transform|result|lost \d+|gained \d+|went from/.test(t)) themes.push('Before & After')
  if (/"[^"]{10,}"/.test(t) || /testimonial|review|customer|★|⭐|changed my|best decision/.test(t)) themes.push('Testimonial')
  if (/\?/.test(t)) themes.push('Question')
  if (/introducing|new |launch|announcing|now available|just dropped/.test(t)) themes.push('Announcement')
  if (/how to|step \d|guide|tips|ways to|trick|hack|secret/.test(t)) themes.push('Educational')
  if (/story|journey|started when|founder|built this|my experience/.test(t)) themes.push('Story')
  if (/free trial|try free|risk.?free|guarantee|money back|no commitment/.test(t)) themes.push('Free Trial')
  if (/last chance|expires|today only|hurry|only \d+ left|selling out|limited stock/.test(t)) themes.push('Urgency')
  if (/us vs|vs\.|compared to|unlike|other brands|competitors/.test(t)) themes.push('Us vs Them')
  if (/unboxing|what\'s inside|package arrived|order came/.test(t)) themes.push('Unboxing')
  return themes
}

// ── Transform raw Meta ad → DB row ──────────────────────────
function transformAd(ad: any, term: string, country: string, brandCategories: string[] = []) {
  const body = ad.ad_creative_bodies?.[0] || ''
  const title = ad.ad_creative_link_titles?.[0] || ''
  const caption = ad.ad_creative_link_captions?.[0] || ''
  const description = ad.ad_creative_link_descriptions?.[0] || ''
  const fullText = `${body} ${title} ${description} ${caption}`
  const startDate = ad.ad_delivery_start_time
  const stopDate = ad.ad_delivery_stop_time
  // For stopped ads, use actual run duration (stop - start), not time-since-start
  const endMs = stopDate ? new Date(stopDate).getTime() : Date.now()
  const daysRunning = startDate ? Math.floor((endMs - new Date(startDate).getTime()) / 86400000) : 0
  // Normalize the country list — Meta returns codes like 'US', 'GB', etc.
  const reached: string[] = Array.isArray(ad.ad_reached_countries) ? ad.ad_reached_countries : []
  const targetedCountries = reached.length > 0 ? reached.map(c => String(c).toUpperCase()) : [country]

  return {
    ad_id: ad.id,
    page_id: ad.page_id || '',
    page_name: ad.page_name || '',
    body, title, caption, description,
    snapshot_url: ad.ad_snapshot_url || '',
    start_date: startDate || null,
    stop_date: ad.ad_delivery_stop_time || null,
    platforms: ad.publisher_platforms || [],
    languages: ad.languages || [],
    country,
    targeted_countries: targetedCountries,
    brand_categories: brandCategories,
    is_active: !ad.ad_delivery_stop_time,
    days_running: daysRunning,
    format: detectFormat(ad),
    industries: detectIndustries(fullText),
    themes: detectThemes(fullText),
    seed_terms: [term],
    ai_classified: false,
    indexed_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    thumbnail_url: null as string | null,
    video_url: null as string | null,
  }
}

// ── HTML media extractor ─────────────────────────────────────
function extractMediaFromHtml(html: string): { thumbnail: string | null; videoUrl: string | null } {
  let thumbnail: string | null = null
  let videoUrl: string | null = null

  const dec = (s: string) => s.replace(/\\u0026/g, '&').replace(/\\u0025/g, '%').replace(/&amp;/g, '&').replace(/\\"/g, '"').replace(/\\\//g, '/')

  const videoPatterns = [
    /["']playable_url["']\s*:\s*["'](https:\/\/video[^"'\\]+)["']/,
    /["']playable_url_quality_hd["']\s*:\s*["'](https:\/\/video[^"'\\]+)["']/,
    /"src"\s*:\s*"(https:\/\/video\.xx\.fbcdn\.net[^"]+)"/,
  ]
  for (const pat of videoPatterns) {
    const m = html.match(pat)
    if (m?.[1]?.includes('fbcdn.net')) { videoUrl = dec(m[1]); break }
  }

  const imagePatterns = [
    /property="og:image"\s+content="([^"]+)"/,
    /content="([^"]+)"\s+property="og:image"/,
    /"uri"\s*:\s*"(https:\/\/scontent[^"\\]+\.(?:jpg|jpeg|png|webp)[^"\\]*)"/,
    /"imageURL"\s*:\s*"(https:\/\/[^"\\]+fbcdn[^"\\]+\.(?:jpg|jpeg|png|webp)[^"\\]*)"/,
    /<img[^>]+src="(https:\/\/scontent[^"]{20,}\.(?:jpg|jpeg|png|webp)[^"]*)"/,
    /"image"\s*:\s*\{"uri"\s*:\s*"(https:\/\/[^"\\]+fbcdn[^"\\]+)"}/,
    /fbcdn\.net\/[^"'\s]+\.(?:jpg|jpeg|png|webp)(?:[^"'\s]*)/g,
  ]
  for (const pat of imagePatterns) {
    const m = html.match(pat)
    const url = (m && m[1]) || null
    if (url?.startsWith('http') && !url.includes('emoji') && url.length > 30) {
      thumbnail = dec(url); break
    }
  }

  return { thumbnail, videoUrl }
}

// ── ScrapingBee / Browserless renderer ──────────────────────
// Priority: ScrapingBee (SCRAPINGBEE_KEY) → Browserless (BROWSERLESS_TOKEN) → plain fetch
// ScrapingBee and Browserless both use real headless Chrome with residential IPs —
// the only way to get real ad images from Facebook's JavaScript SPA.
async function fetchRenderedHtml(url: string): Promise<string | null> {
  // 1. ScrapingBee (preferred — simpler API, residential proxies included)
  const sbKey = process.env.SCRAPINGBEE_KEY
  if (sbKey) {
    try {
      const params = new URLSearchParams({
        api_key: sbKey,
        url,
        render_js: 'true',
        premium_proxy: 'true',   // residential IP — bypasses Facebook bot detection
        wait: '8000',            // wait 8s for React to render ad creative
        timeout: '20000',        // 20 s total — keeps per-ad overhead manageable
        block_ads: 'false',      // don't block — we ARE fetching ads
        return_page_source: 'false',
      })
      const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
        signal: AbortSignal.timeout(25000), // 25 s hard cap
      })
      if (res.ok) return await res.text()
    } catch { /* fall through */ }
  }

  // 2. Browserless (legacy / alternative)
  const blToken = process.env.BROWSERLESS_TOKEN
  if (blToken) {
    try {
      const res = await fetch(`https://chrome.browserless.io/content?token=${blToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          gotoOptions: { waitUntil: 'networkidle2', timeout: 25000 },
          waitFor: 2000,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        }),
        signal: AbortSignal.timeout(35000),
      })
      if (res.ok) return await res.text()
    } catch { /* fall through */ }
  }

  // 3. Plain HTTP fetch — fast but fails for Facebook's JS-rendered pages
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

// Legacy alias used by thumbnail route
async function fetchHtml(url: string, timeoutMs = 8000): Promise<string | null> {
  return fetchRenderedHtml(url)
}

// ── Transform ads and attach creatives ──────────────────────
// For term/category discovery: iframes (snapshot_url) handle display — brand logo placeholder only.
// For brand crawls: ScrapingBee is tried as fallback to extract real thumbnail/video URLs,
// ── Transform ads — no ScrapingBee in the crawl path ─────────
// Thumbnails are handled by the dedicated /api/thumbnails background job
// (Browserless screenshot → R2 upload). The crawl just stores metadata.
// Discovery UI shows snapshot_url iframes until thumbnails are processed.
async function attachCreatives(
  rawAds: any[],
  term: string,
  country: string,
  termType: string = 'adcopy',
  deadlineMs?: number,
  hasBrandPageIds: boolean = false,
  brandCategories: string[] = [],
): Promise<{ rows: any[]; skipped: number }> {
  const rows: any[] = []
  for (const ad of rawAds) {
    const row = transformAd(ad, term, country, brandCategories)
    rows.push(row)
  }
  return { rows, skipped: 0 }
}

// ── Generate OpenAI embeddings ───────────────────────────────
async function generateEmbeddings(admin: any): Promise<number> {
  const { data: unembedded } = await admin
    .from('discovery_ads_index')
    .select('ad_id, page_name, body, title, description, industries, themes')
    .is('embedding', null)
    .limit(EMBED_BATCH)

  if (!unembedded?.length) return 0

  const texts = unembedded.map((ad: any) =>
    `${ad.page_name} ${ad.title} ${ad.body} ${ad.description} ${(ad.industries || []).join(' ')} ${(ad.themes || []).join(' ')}`.slice(0, 8000)
  )

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  })

  const updates = unembedded.map((ad: any, i: number) => ({
    ad_id: ad.ad_id,
    embedding: response.data[i].embedding,
  }))

  for (const update of updates) {
    await admin.from('discovery_ads_index')
      .update({ embedding: update.embedding })
      .eq('ad_id', update.ad_id)
  }

  return unembedded.length
}

// ── Claude AI classification ─────────────────────────────────
async function callClaudeWithRetry(prompt: string): Promise<string> {
  let lastErr: any

  // Model fallback chain — newest/most capable first, fast model as safety net.
  // If ANTHROPIC_MODEL env var is set and not already in the list, prepend it.
  // Claude 4.5 series (as of May 2026 — claude-3-haiku-20240307 retired April 20 2026).
  const DEFAULT_MODELS = [
    'claude-sonnet-4-5-20251001',  // primary — reliable, strong classification
    'claude-haiku-4-5-20251001',   // fast fallback — 3x cheaper, still great for JSON tasks
    'claude-3-5-sonnet-20241022',  // legacy safety net in case 4.5 series unavailable
  ]
  const envModel = process.env.ANTHROPIC_MODEL
  const MODELS = envModel && !DEFAULT_MODELS.includes(envModel)
    ? [envModel, ...DEFAULT_MODELS]
    : DEFAULT_MODELS

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i]
    try {
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      })
      return msg.content[0].type === 'text' ? msg.content[0].text : ''
    } catch (e: any) {
      lastErr = e
      const isDeprecated = e?.status === 404 || e?.message?.includes('not_found') || e?.message?.includes('model')
      const isOverloaded = e?.status >= 500 || e?.message?.includes('overloaded') || e?.message?.includes('Internal server error')

      if (isDeprecated) {
        // Model deprecated/not found — skip straight to next model, no wait
        continue
      }
      if (isOverloaded && i < MODELS.length - 1) {
        // Temporary overload — wait briefly then try next model
        await new Promise(r => setTimeout(r, 1500))
        continue
      }
      // Non-retryable error (auth, bad request, etc.)
      break
    }
  }
  throw lastErr
}

async function classifyWithClaude(admin: any): Promise<number> {
  const { data: unclassified } = await admin
    .from('discovery_ads_index')
    .select('ad_id, page_name, body, title, description')
    .eq('ai_classified', false)
    .not('body', 'eq', '')
    .limit(CLASSIFY_BATCH)

  if (!unclassified?.length) return 0

  const adsText = unclassified.map((ad: any, i: number) =>
    `AD ${i + 1} [${ad.ad_id}]:\nBrand: ${ad.page_name}\nHeadline: ${ad.title}\nBody: ${ad.body.slice(0, 400)}`
  ).join('\n\n---\n\n')

  const content = await callClaudeWithRetry(
    `Analyze these ${unclassified.length} ads and classify each one. Return a JSON array only, no explanation.

For each ad return:
{
  "ad_id": "...",
  "hook_type": one of: "Question|Before & After|Testimonial|Story|Announcement|Educational|Urgency|Discount|Unboxing|Us vs Them|Social Proof|Pain Point",
  "emotion": array of 1-3 from: ["curiosity","fear","desire","trust","urgency","hope","excitement","relatability","aspiration","guilt","pride"],
  "angle": one of: "Pain Point|Aspiration|Social Proof|Authority|Scarcity|Curiosity|Value|Story|Comparison",
  "cta": the call-to-action text or "Shop Now" if unclear,
  "tone": one of: "Casual|Professional|Urgent|Inspirational|Humorous|Educational|Emotional",
  "persona": brief target audience description (max 5 words),
  "desire": core desire being addressed (max 5 words),
  "usp": main unique selling point (max 8 words)
}

Ads to classify:
${adsText}

Return only the JSON array.`
  )

  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return 0

  let classifications: any[]
  try {
    classifications = JSON.parse(jsonMatch[0])
  } catch {
    return 0  // malformed JSON — skip, will retry next run
  }

  for (const cls of classifications) {
    await admin.from('discovery_ads_index').update({
      hook_type: cls.hook_type,
      emotion: cls.emotion || [],
      angle: cls.angle,
      cta: cls.cta,
      tone: cls.tone,
      persona: cls.persona,
      desire: cls.desire,
      usp: cls.usp,
      ai_classified: true,
    }).eq('ad_id', cls.ad_id)
  }

  return classifications.length
}

// ── Main handler ─────────────────────────────────────────────
export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()
  const forceTerm = request.nextUrl.searchParams.get('term')
  const forceCountry = request.nextUrl.searchParams.get('country')
  const forcePageId = request.nextUrl.searchParams.get('page_id') // optional: skip slug lookup
  const onlyEmbed = request.nextUrl.searchParams.get('embed') === '1'
  const onlyClassify = request.nextUrl.searchParams.get('classify') === '1'
  const stream = request.nextUrl.searchParams.get('stream') === '1'

  // ── Non-streaming modes (cron jobs) ──
  if (onlyEmbed) {
    const count = await generateEmbeddings(admin)
    return NextResponse.json({ success: true, embedded: count })
  }
  if (onlyClassify) {
    const count = await classifyWithClaude(admin)
    return NextResponse.json({ success: true, classified: count })
  }

  // ── Streaming mode (admin dashboard) ──
  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      const send = (type: string, msg: string) => {
        // Sanitize msg: strip control chars that could break JSON
        const safe = msg.replace(/[\x00-\x1F\x7F]/g, ' ').trim()
        const json = JSON.stringify({ type, msg: safe })
        controller.enqueue(encoder.encode(json + '\n'))
      }

      try {
        // ── Get terms to crawl ──
        let termsToRun: { term: string; countries: string[]; id: string; term_type: string; pageId?: string }[] = []
        if (forceTerm) {
          termsToRun = [{ term: forceTerm, countries: [forceCountry || 'US'], id: 'manual', term_type: 'all', pageId: forcePageId || undefined }]
        } else {
          const { data: terms } = await admin
            .from('discovery_crawl_terms')
            .select('id, term, countries, term_type, page_id, categories')
            .eq('is_active', true)
            .order('last_crawled_at', { ascending: true, nullsFirst: true })
            .limit(TERMS_PER_RUN)
          termsToRun = (terms || []).map((t: any) => ({ ...t, term_type: 'all', pageId: t.page_id || undefined, categories: t.categories || [] }))
        }

        if (!termsToRun.length) {
          send('error', '❌ No active terms found. Add terms in the Terms tab first.')
          controller.close()
          return
        }

        send('log', `📋 Found ${termsToRun.length} terms to crawl (ad copy + brand + category for each)`)

        // ── Get Meta token ──
        const metaToken = await getMetaToken(admin)
        send('log', '🔑 Meta token acquired')

        let totalAdsUpserted = 0

        // Route has 300 s max. Reserve 60 s for embeddings + classification.
        // Crawl must finish within 240 s. We pass this deadline to the fetch
        // functions so they can stop cleanly and save partial results.
        const ROUTE_BUDGET_MS = 240_000
        const crawlDeadline = Date.now() + ROUTE_BUDGET_MS

        // ── Crawl each term × country ──
        for (const { term, countries, id, term_type, pageId: manualPageId, categories: termCategories } of termsToRun as any[]) {
          if (Date.now() > crawlDeadline) {
            send('log', '⏰ Crawl budget exhausted — saving partial results, embeddings & classification will run next tick')
            break
          }
          const countriesToCrawl = forceCountry ? [forceCountry] : (countries || ['US'])

          for (const country of countriesToCrawl) {
            if (Date.now() > crawlDeadline) break
            send('log', `🔍 Crawling "${term}" [${term_type || 'all'}] / ${country}…`)

            // ── Brand page discovery ──────────────────────────────────────
            let knownBrandPageIds: string[] = []
            if (manualPageId) {
              // Admin provided the page_id directly — skip slug lookup entirely
              knownBrandPageIds = [manualPageId]
              send('log', `  🏷 Using provided page_id: ${manualPageId} — fetching ALL their ads`)
            } else {
              send('log', `  🔎 Looking up brand page for "${term}"…`)
              knownBrandPageIds = await findBrandPageIds(term, metaToken)
              if (knownBrandPageIds.length) {
                send('log', `  🏷 Brand page_ids found: ${knownBrandPageIds.join(', ')} — fetching ALL their ads`)
              } else {
                send('log', `  ℹ️ No brand page found — keyword search only (tip: paste page_id in admin)`)
              }
            }

            const { ads, externalFiltered, timedOut: fetchTimedOut, error: fetchError } = await fetchAdsForTerm(
              term, country, metaToken, 'all', admin, knownBrandPageIds,
              crawlDeadline - 30_000,                 // hand over deadline 30 s early for buffer
              (msg) => send('log', msg),              // stream brand-fetch progress to admin UI
            )

            if (fetchTimedOut) {
              send('log', `  ⏰ Deadline reached mid-crawl — saving ${ads.length} partial ads for "${term}"`)
            }

            if (fetchError) {
              send('log', `  ❌ ${term}/${country}: ${fetchError}`)
              await admin.from('discovery_crawl_log').insert({ term, country, ads_fetched: 0, error: fetchError })
              continue
            }

            if (!ads.length) {
              send('log', `  ⚠️ ${term}/${country}: 0 ads returned`)
              continue
            }

            if (externalFiltered > 0) {
              send('log', `  🚫 Skipped ${externalFiltered} ads from small external pages (<${MIN_EXTERNAL_PAGE_FOLLOWERS.toLocaleString()} followers)`)
            }

            // ── Attach creatives then save all ads ───────────────────────
            const { rows } = await attachCreatives(ads, term, country, term_type || 'adcopy', crawlDeadline - 15_000, knownBrandPageIds.length > 0, termCategories || [])
            send('log', `  📦 ${rows.length} ads transformed — thumbnails queued for /api/thumbnails (Browserless → R2)`)

            // ── Deduplicate by ad_archive_id (fallback chain) ────────────
            // Primary key = ad_id (= ad_archive_id from Meta — globally unique).
            // Fallbacks handle edge cases where Meta returns ads without an id.
            const getDedupKey = (r: any): string => {
              if (r.ad_id)        return `archive:${r.ad_id}`
              if (r.snapshot_url) return `snap:${r.snapshot_url}`
              if (r.video_url)    return `vid:${r.video_url}`
              if (r.thumbnail_url && !r.thumbnail_url.includes('graph.facebook.com'))
                                  return `img:${r.thumbnail_url}`
              // Last resort: page + date + body prefix (same as old logic but only as fallback)
              const text = `${r.body || ''}${r.title || ''}`.trim()
              return `text:${r.page_id}:${r.start_date}:${text.slice(0, 80)}`
            }
            const creativeMap = new Map<string, any>()
            for (const row of rows) {
              const key = getDedupKey(row)
              const existing = creativeMap.get(key)
              if (!existing || row.days_running > (existing.days_running ?? 0)) {
                creativeMap.set(key, row)
              }
            }
            const dedupedRows = Array.from(creativeMap.values())
            const dupCount = rows.length - dedupedRows.length
            if (dupCount > 0) send('log', `  🔄 ${dupCount} duplicate ad_ids collapsed — ${dedupedRows.length} unique ads`)

            // ── Batch upsert in chunks of 500 ────────────────────────────
            // Supabase/PostgREST has a request-body size limit; a single
            // 3000-row upsert can silently fail or timeout. Chunk it.
            const UPSERT_CHUNK = 500
            let upsertError: string | undefined
            let savedCount = 0
            for (let i = 0; i < dedupedRows.length; i += UPSERT_CHUNK) {
              const chunk = dedupedRows.slice(i, i + UPSERT_CHUNK)
              const { error: chunkErr } = await admin
                .from('discovery_ads_index')
                .upsert(chunk, { onConflict: 'ad_id', ignoreDuplicates: false })
              if (chunkErr) { upsertError = chunkErr.message; break }
              savedCount += chunk.length
            }

            await admin.from('discovery_crawl_log').insert({
              term, country, ads_fetched: ads.length, ads_new: savedCount, error: upsertError,
            })

            send('log', `  ✅ ${term}/${country}: ${savedCount} unique ads saved${upsertError ? ` (⚠️ partial: ${upsertError})` : ''}`)
            totalAdsUpserted += savedCount
          }

          if (id !== 'manual') {
            await admin.from('discovery_crawl_terms').update({
              last_crawled_at: new Date().toISOString(),
            }).eq('id', id)
          }
        }

        // ── Embeddings ────────────────────────────────────────────
        // For large brand crawls (3000 ads), all 15 batches × 5 s = 75 s.
        // Stop if we're within 60 s of the route hard deadline so we don't
        // get killed mid-batch. The ?embed=1 cron will clean up the rest.
        const EMBED_DEADLINE = crawlDeadline + 60_000 // crawlDeadline + leftover budget
        send('log', '🔢 Generating embeddings for new ads…')
        let embedded = 0
        try {
          let batch = 0
          do {
            if (Date.now() > EMBED_DEADLINE) {
              send('log', `  ⏰ Embedding budget used — ${embedded} done, remainder queued for next cron (?embed=1)`)
              break
            }
            batch = await generateEmbeddings(admin)
            embedded += batch
          } while (batch === EMBED_BATCH)
          send('log', `  ✅ ${embedded} embeddings generated`)
        } catch (e: any) {
          send('log', `  ❌ Embeddings error: ${String(e?.message ?? e)}`)
        }

        // ── Claude classification ─────────────────────────────────
        // Classification is the slowest step (Claude API round-trips).
        // For 3000 newly indexed visual ads with empty body, classifyWithClaude
        // returns 0 immediately (query filters body=''). For text ads it runs.
        // Stop after CLASSIFY_BATCH × 3 batches max per run; ?classify=1 handles rest.
        const CLASS_DEADLINE = crawlDeadline + 90_000
        send('log', '🤖 Classifying ads with Claude…')
        let classified = 0
        try {
          let batch = 0
          let classRuns = 0
          do {
            if (Date.now() > CLASS_DEADLINE) {
              send('log', `  ⏰ Classification budget used — ${classified} done, remainder queued for next cron (?classify=1)`)
              break
            }
            batch = await classifyWithClaude(admin)
            classified += batch
            classRuns++
          } while (batch === CLASSIFY_BATCH && classRuns < 10)
          send('log', `  ✅ ${classified} ads classified`)
        } catch (e: any) {
          const detail = e?.error?.message || e?.message || String(e)
          send('log', `  ⚠️ Classification: ${detail}`)
        }

        // ── Update state ──
        const { count: totalInDB } = await admin
          .from('discovery_ads_index')
          .select('*', { count: 'exact', head: true })

        await admin.from('discovery_index_state').upsert({
          id: 'main',
          last_run_at: new Date().toISOString(),
          total_ads: totalInDB || 0,
          terms_processed: termsToRun.map(t => t.term),
        }, { onConflict: 'id' })

        send('done', `🎉 Done! ${totalAdsUpserted} ads indexed, ${embedded} embeddings, ${classified} classified. Total in DB: ${(totalInDB || 0).toLocaleString()}`)
      } catch (e: any) {
        send('error', `❌ Fatal error: ${String(e?.message ?? e)}`)
      }

      controller.close()
    }
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no',
    },
  })
}
