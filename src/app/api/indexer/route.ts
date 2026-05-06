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
// Strategy A: Graph API slug lookup (fast, no credits)
// Strategy B: ScrapingBee scrape of facebook.com/{slug} → extract pageID from HTML
// Facebook always embeds the numeric page_id in the page source.
async function findBrandPageIds(brandName: string, token: string): Promise<string[]> {
  const found = new Set<string>()
  const base = brandName.toLowerCase().replace(/[^a-z0-9]/g, '') // "gymshark"
  const slugs = Array.from(new Set([
    base,
    brandName.toLowerCase().replace(/\s+/g, ''),
    brandName.toLowerCase().replace(/\s+/g, '.'),
  ]))

  // ── Strategy A: Graph API node lookup by slug ────────────────
  await Promise.all(slugs.map(async (slug) => {
    try {
      const url = `https://graph.facebook.com/${V}/${slug}?fields=id,name&access_token=${token}`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      const data = await res.json() as { id?: string; name?: string; error?: any }
      if (data.error || !data.id) return
      const nameLower = (data.name || '').toLowerCase()
      if (nameLower.includes(base) || base.includes(nameLower.replace(/\s/g, ''))) {
        found.add(data.id)
      }
    } catch { /* ignore */ }
  }))

  if (found.size > 0) return Array.from(found)

  // ── Strategy B: ScrapingBee scrape facebook.com/{slug} ──────
  // Facebook embeds the numeric page_id in the page source as:
  //   "pageID":"12345678"  or  "page_id":12345678
  const sbKey = process.env.SCRAPINGBEE_KEY
  if (sbKey) {
    for (const slug of slugs) {
      try {
        const params = new URLSearchParams({
          api_key: sbKey,
          url: `https://www.facebook.com/${slug}`,
          render_js: 'false',   // don't need JS for page source — saves credits
          premium_proxy: 'true',
        })
        const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
          signal: AbortSignal.timeout(20000),
        })
        if (!res.ok) continue
        const html = await res.text()

        // Extract page_id from various embed patterns
        const patterns = [
          /"pageID"\s*:\s*"(\d+)"/,
          /"page_id"\s*:\s*"(\d+)"/,
          /"page_id"\s*:\s*(\d+)/,
          /\\"pageID\\"\s*:\s*\\"(\d+)\\"/,
          /content_id=(\d{10,})/,
          /"entity_id"\s*:\s*"(\d{10,})"/,
        ]
        for (const pat of patterns) {
          const m = html.match(pat)
          if (m?.[1] && m[1].length >= 10) { // FB page IDs are 10-17 digits
            found.add(m[1])
            break
          }
        }
        if (found.size > 0) break
      } catch { /* ignore */ }
    }
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
): Promise<{ ads: any[], externalFiltered: number, error?: string }> {
  const metaCountry = normalizeCountry(country)
  const seenIds = new Set<string>()
  const allAds: any[] = []
  const brandPageIds = new Set<string>(preDiscoveredPageIds)

  const addAds = (ads: any[]) => {
    for (const ad of ads) {
      if (ad.id && !seenIds.has(ad.id)) {
        seenIds.add(ad.id)
        allAds.push(ad)
      }
    }
  }

  const baseParams = (searchTerm: string): Record<string, string> => ({
    access_token: token,
    search_terms: searchTerm,
    ad_reached_countries: JSON.stringify([metaCountry]),
    fields: META_FIELDS,
    limit: String(ADS_PER_TERM),
  })

  // ── 1. AD COPY: keyword search — finds all ads mentioning this term ──
  {
    const params = baseParams(term)
    let cursor = ''
    for (let p = 0; p < PAGES_PER_TERM; p++) {
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

    if (pageIds.length) {
      // search_terms is OPTIONAL when search_page_ids is set.
      // Omitting it returns ALL ads from that page — not just ones mentioning the brand name.
      const brandParams: Record<string, string> = {
        access_token: token,
        search_page_ids: JSON.stringify(pageIds),
        ad_reached_countries: JSON.stringify([metaCountry]),
        fields: META_FIELDS,
        limit: String(ADS_PER_TERM),
      }
      let brandCursor = ''
      // Fetch up to 6 pages = 300 ads from brand page
      for (let p = 0; p < PAGES_PER_TERM * 2; p++) {
        const { ads, nextCursor, hasMore, error } = await fetchOnePage(brandParams, brandCursor)
        if (error) break
        addAds(ads)
        if (!hasMore) break
        brandCursor = nextCursor
      }
    }
  }

  // ── 3. CATEGORY: expand term → related keywords, search each ─
  {
    const termLower = term.toLowerCase()
    const matchedKey = Object.keys(CATEGORY_KEYWORDS).find(k =>
      termLower.includes(k) || k.includes(termLower)
    )
    const keywords = matchedKey
      ? CATEGORY_KEYWORDS[matchedKey]
      : [] // for brand names don't fall back to raw term — already covered in step 1

    for (const kw of keywords) {
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

  return { ads: filteredAds, externalFiltered }
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
function transformAd(ad: any, term: string, country: string) {
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
        wait: '6000',            // wait 6s for React to render ad creative
        timeout: '45000',
        block_ads: 'false',      // don't block — we ARE fetching ads
        return_page_source: 'false',
      })
      const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
        signal: AbortSignal.timeout(35000),
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

// ── Attach creatives to all ads ──────────────────────────────
// Uses Browserless (headless Chrome) when configured so the full page renders
// and image/video URLs are extractable. Every ad gets saved — real creative
// if we can get it, brand profile picture otherwise.
//
// Curation: only keeps ads that have been running at least MIN_DAYS_* days.
//   brand terms   →  7 days  (track known brands closely, catch rising winners early)
//   category terms → 21 days  (balance volume vs quality for industry crawls)
//   adcopy terms  →  30 days  (broad keywords — only proven winners worth storing)
async function attachCreatives(rawAds: any[], term: string, country: string, termType: string = 'adcopy'): Promise<{ rows: any[]; skipped: number }> {
  const hasBrowserless = !!process.env.BROWSERLESS_TOKEN
  // With Browserless: 5 parallel (each takes ~5s → 25s per chunk, well within 300s limit)
  // Without: 10 parallel plain fetches (fast but mostly fail for Facebook SPA)
  const CONCURRENCY = hasBrowserless ? 5 : 10

  // Pick min-days threshold based on the term's intent
  const minDays = termType === 'brand'
    ? MIN_DAYS_BRAND
    : termType === 'category'
    ? MIN_DAYS_CATEGORY
    : MIN_DAYS_ADCOPY

  const results: any[] = []
  let skipped = 0

  for (let i = 0; i < rawAds.length; i += CONCURRENCY) {
    const chunk = rawAds.slice(i, i + CONCURRENCY)
    const settled = await Promise.allSettled(
      chunk.map(async (ad: any) => {
        const row = transformAd(ad, term, country)

        // ── Curation gate ─────────────────────────────────────────
        // Active ads: must have been running for at least minDays to be a proven winner.
        // Stopped ads: already have a final run duration — keep if they ran long enough
        //   (shows they were profitable before stopping), discard if they bombed out early.
        if (row.days_running < minDays) {
          return null  // too new / too short — not a proven winner yet
        }

        // Snapshot URL has access_token embedded — best chance of seeing the real ad
        const snapshotUrl = ad.ad_snapshot_url || ''
        if (snapshotUrl) {
          const html = await fetchRenderedHtml(snapshotUrl).catch(() => null)
          if (html) {
            const { thumbnail, videoUrl } = extractMediaFromHtml(html)
            if (thumbnail) { row.thumbnail_url = thumbnail; row.format = videoUrl ? 'Video' : 'Image' }
            if (videoUrl)  { row.video_url = videoUrl; row.format = 'Video' }
          }
        }

        // Fallback: brand profile picture — always available for public FB pages
        if (!row.thumbnail_url && row.page_id) {
          row.thumbnail_url = `https://graph.facebook.com/${row.page_id}/picture?type=large`
        }

        return row
      })
    )

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value !== null) {
          results.push(r.value)
        } else {
          skipped++
        }
      }
    }

    // Small delay between chunks to be polite to Facebook
    if (i + CONCURRENCY < rawAds.length) await new Promise(r => setTimeout(r, 300))
  }

  return { rows: results, skipped }
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

  // Model fallback chain — newest/most capable first, older as safety nets.
  // If ANTHROPIC_MODEL env var is set and not already in the list, prepend it.
  const DEFAULT_MODELS = [
    'claude-opus-4-5',
    'claude-sonnet-4-5',
    'claude-3-7-sonnet-20250219',
    'claude-3-5-sonnet-20241022',
    'claude-3-opus-20240229',
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
        let termsToRun: { term: string; countries: string[]; id: string; term_type: string }[] = []
        if (forceTerm) {
          termsToRun = [{ term: forceTerm, countries: [forceCountry || 'US'], id: 'manual', term_type: 'all' }]
        } else {
          const { data: terms } = await admin
            .from('discovery_crawl_terms')
            .select('id, term, countries, term_type')
            .eq('is_active', true)
            .order('last_crawled_at', { ascending: true, nullsFirst: true })
            .limit(TERMS_PER_RUN)
          termsToRun = (terms || []).map((t: any) => ({ ...t, term_type: 'all' }))
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

        // ── Crawl each term × country ──
        for (const { term, countries, id, term_type } of termsToRun) {
          const countriesToCrawl = forceCountry ? [forceCountry] : (countries || ['US'])

          for (const country of countriesToCrawl) {
            send('log', `🔍 Crawling "${term}" [${term_type || 'all'}] / ${country}…`)

            // ── Brand page discovery (logged explicitly so we can debug) ──
            send('log', `  🔎 Looking up brand page for "${term}" via Graph API…`)
            const knownBrandPageIds = await findBrandPageIds(term, metaToken)
            if (knownBrandPageIds.length) {
              send('log', `  🏷 Brand page_ids found: ${knownBrandPageIds.join(', ')} — will fetch ALL their ads`)
            } else {
              send('log', `  ℹ️ No brand page found via slug — using keyword search only`)
            }

            const { ads, externalFiltered, error: fetchError } = await fetchAdsForTerm(term, country, metaToken, 'all', admin, knownBrandPageIds)

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
            // ScrapingBee renders the snapshot URL → extracts real image/video URL.
            // Falls back to brand profile picture so every card has a visual.
            send('log', `  🖼 Fetching creatives for ${ads.length} ads…`)
            const { rows, skipped } = await attachCreatives(ads, term, country, term_type || 'adcopy')
            const realCreatives = rows.filter(r => r.thumbnail_url && !r.thumbnail_url.includes('graph.facebook.com')).length
            send('log', `  📸 ${realCreatives} real creatives, ${rows.length - realCreatives} brand logo placeholders`)

            const { error } = await admin
              .from('discovery_ads_index')
              .upsert(rows, { onConflict: 'ad_id', ignoreDuplicates: false })

            await admin.from('discovery_crawl_log').insert({
              term, country, ads_fetched: ads.length, ads_new: error ? 0 : rows.length, error: error?.message,
            })

            send('log', `  ✅ ${term}/${country}: ${rows.length} ads saved`)
            totalAdsUpserted += rows.length
          }

          if (id !== 'manual') {
            await admin.from('discovery_crawl_terms').update({
              last_crawled_at: new Date().toISOString(),
            }).eq('id', id)
          }
        }

        // ── Embeddings (all unembedded ads) ──
        send('log', '🔢 Generating embeddings for all new ads…')
        let embedded = 0
        try {
          // Loop until all new ads are embedded (EMBED_BATCH = 200 so usually one pass)
          let batch = 0
          do {
            batch = await generateEmbeddings(admin)
            embedded += batch
          } while (batch === EMBED_BATCH)
          send('log', `  ✅ ${embedded} embeddings generated`)
        } catch (e: any) {
          send('log', `  ❌ Embeddings error: ${String(e?.message ?? e)}`)
        }

        // ── Claude classification (loop until all classified) ──
        send('log', '🤖 Classifying ads with Claude…')
        let classified = 0
        try {
          let batch = 0
          do {
            batch = await classifyWithClaude(admin)
            classified += batch
          } while (batch === CLASSIFY_BATCH)
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
