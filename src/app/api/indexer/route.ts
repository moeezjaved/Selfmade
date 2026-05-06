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
const PAGES_PER_TERM = 2   // pages to fetch (50 × 2 = 100 ads per term×country)
const EMBED_BATCH = 50     // ads to embed per batch
const CLASSIFY_BATCH = 10  // ads to classify per Claude call (smaller = less likely to hit token limits)

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

// ── Meta Ads Library fetch — always runs all 3 strategies ──────
// adcopy: searches ad body text for the term
// brand:  searches by term + fetches all ads from known page IDs
// category: expands the term into related keywords and searches each
async function fetchAdsForTerm(
  term: string,
  country: string,
  token: string,
  _termType: string = 'all', // kept for signature compat, always runs all 3
  admin?: any,
): Promise<{ ads: any[], error?: string }> {
  const metaCountry = normalizeCountry(country)
  const seenIds = new Set<string>()
  const allAds: any[] = []

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

  // ── 1. AD COPY: keyword search in ad creative text ───────────
  {
    const params = baseParams(term)
    let cursor = ''
    for (let p = 0; p < PAGES_PER_TERM; p++) {
      const { ads, nextCursor, hasMore, error } = await fetchOnePage(params, cursor)
      if (error) break  // non-fatal — continue to brand pass
      addAds(ads)
      if (!hasMore) break
      cursor = nextCursor
    }
  }

  // ── 2. BRAND: search by name AND by known page IDs from DB ───
  {
    // Pass 2a — search Meta for ads mentioning the brand name
    const params = baseParams(term)
    let cursor = ''
    for (let p = 0; p < PAGES_PER_TERM; p++) {
      const { ads, nextCursor, hasMore, error } = await fetchOnePage(params, cursor)
      if (error) break
      addAds(ads)
      if (!hasMore) break
      cursor = nextCursor
    }

    // Pass 2b — look up page_ids in our DB and fetch ALL ads directly from those pages
    if (admin) {
      const { data: pages } = await admin
        .from('discovery_ads_index')
        .select('page_id')
        .ilike('page_name', `%${term}%`)
        .limit(30)
      const pageIds = Array.from(new Set((pages || []).map((p: any) => p.page_id).filter(Boolean))) as string[]

      if (pageIds.length) {
        const brandParams: Record<string, string> = {
          access_token: token,
          search_terms: term,
          search_page_ids: JSON.stringify(pageIds),
          ad_reached_countries: JSON.stringify([metaCountry]),
          fields: META_FIELDS,
          limit: String(ADS_PER_TERM),
        }
        let brandCursor = ''
        for (let p = 0; p < PAGES_PER_TERM + 1; p++) {
          const { ads, nextCursor, hasMore, error } = await fetchOnePage(brandParams, brandCursor)
          if (error) break
          addAds(ads)
          if (!hasMore) break
          brandCursor = nextCursor
        }
      }
    }
  }

  // ── 3. CATEGORY: expand term → related keywords, search each ─
  {
    // Find the expansion list for this category (fuzzy match against keys)
    const termLower = term.toLowerCase()
    const matchedKey = Object.keys(CATEGORY_KEYWORDS).find(k =>
      termLower.includes(k) || k.includes(termLower)
    )
    const keywords = matchedKey
      ? CATEGORY_KEYWORDS[matchedKey]
      : [term] // fallback to the raw term if no expansion found

    for (const kw of keywords) {
      const params = baseParams(kw)
      let cursor = ''
      // 1 page per keyword keeps total volume reasonable
      const { ads, error } = await fetchOnePage(params, cursor)
      if (!error) addAds(ads)
    }
  }

  return { ads: allAds }
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
  const daysRunning = startDate ? Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000) : 0
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
  }
}

// ── Batch thumbnail extraction ───────────────────────────────
// Uses graph.facebook.com/{page_id}/picture — publicly accessible for all
// public FB pages, no auth required, always returns a real image URL.
// This gives the brand's profile picture as the card thumbnail, which is
// far more reliable than scraping the ads/library page (requires JS rendering).
async function extractThumbnailsForNewAds(admin: any, limit = 50): Promise<number> {
  const { data: ads } = await admin
    .from('discovery_ads_index')
    .select('ad_id, page_id')
    .is('thumbnail_url', null)
    .not('page_id', 'eq', '')
    .not('page_id', 'is', null)
    .limit(limit)

  if (!ads?.length) return 0

  // Batch-update: use graph.facebook.com/{page_id}/picture directly
  // The browser's <img src> follows the 302 redirect to the actual CDN image.
  // We store the redirect URL — it's stable and doesn't expire.
  const updates = (ads as any[]).map((ad: any) => ({
    ad_id: ad.ad_id,
    thumbnail_url: `https://graph.facebook.com/${ad.page_id}/picture?type=large`,
  }))

  let count = 0
  // Update in parallel chunks (records already exist — no upsert needed)
  for (let i = 0; i < updates.length; i += 25) {
    const chunk = updates.slice(i, i + 25)
    await Promise.all(chunk.map((u: any) =>
      admin.from('discovery_ads_index')
        .update({ thumbnail_url: u.thumbnail_url })
        .eq('ad_id', u.ad_id)
    ))
    count += chunk.length
  }

  return count
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
        for (const { term, countries, id } of termsToRun) {
          const countriesToCrawl = forceCountry ? [forceCountry] : (countries || ['US'])

          for (const country of countriesToCrawl) {
            send('log', `🔍 Crawling "${term}" [ad copy + brand + category] / ${country}…`)

            const { ads, error: fetchError } = await fetchAdsForTerm(term, country, metaToken, 'all', admin)

            if (fetchError) {
              send('log', `  ❌ ${term}/${country}: ${fetchError}`)
              await admin.from('discovery_crawl_log').insert({ term, country, ads_fetched: 0, error: fetchError })
              continue
            }

            if (!ads.length) {
              send('log', `  ⚠️ ${term}/${country}: 0 ads returned`)
              continue
            }

            const rows = ads.map((ad: any) => transformAd(ad, term, country))
            const { error } = await admin
              .from('discovery_ads_index')
              .upsert(rows, { onConflict: 'ad_id', ignoreDuplicates: false })

            await admin.from('discovery_crawl_log').insert({
              term, country, ads_fetched: ads.length, ads_new: error ? 0 : ads.length, error: error?.message,
            })

            send('log', `  ✅ ${term}/${country}: ${ads.length} ads`)
            totalAdsUpserted += ads.length
          }

          if (id !== 'manual') {
            await admin.from('discovery_crawl_terms').update({
              last_crawled_at: new Date().toISOString(),
            }).eq('id', id)
          }
        }

        // ── Thumbnail extraction ──
        send('log', '🖼 Extracting ad thumbnails…')
        try {
          const thumbCount = await extractThumbnailsForNewAds(admin, 20)
          send('log', `  ✅ ${thumbCount} thumbnails extracted`)
        } catch (e: any) {
          send('log', `  ⚠️ Thumbnails: ${String(e?.message ?? e)}`)
        }

        // ── Embeddings ──
        send('log', '🔢 Generating embeddings…')
        let embedded = 0
        try {
          embedded = await generateEmbeddings(admin)
          send('log', `  ✅ ${embedded} embeddings generated`)
        } catch (e: any) {
          send('log', `  ❌ Embeddings error: ${String(e?.message ?? e)}`)
        }

        // ── Claude classification ──
        send('log', '🤖 Running Claude classification…')
        let classified = 0
        try {
          classified = await classifyWithClaude(admin)
          send('log', `  ✅ ${classified} ads classified`)
        } catch (e: any) {
          // Non-fatal — crawler already saved ads and embeddings; classification retried next run
          const detail = e?.error?.message || e?.message || String(e)
          send('log', `  ⚠️ Classification skipped (will retry next run): ${detail}`)
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
