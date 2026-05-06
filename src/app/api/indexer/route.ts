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
const CLASSIFY_BATCH = 15  // ads to classify per Claude call

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

// ── Meta Ads Library fetch ───────────────────────────────────
async function fetchAdsForTerm(term: string, country: string, token: string): Promise<{ ads: any[], error?: string }> {
  const allAds: any[] = []
  let after = ''
  for (let page = 0; page < PAGES_PER_TERM; page++) {
    const params: Record<string, string> = {
      access_token: token,
      search_terms: term,
      ad_reached_countries: JSON.stringify([country]),
      fields: META_FIELDS,
      limit: String(ADS_PER_TERM),
    }
    if (after) params.after = after
    try {
      const res = await fetch(`https://graph.facebook.com/${V}/ads_archive?` + new URLSearchParams(params))
      const data = await res.json()
      if (data.error) return { ads: allAds, error: data.error.message }
      if (!data.data?.length) break
      allAds.push(...data.data)
      if (!data.paging?.next) break
      after = data.paging.cursors?.after || ''
    } catch (e: any) {
      return { ads: allAds, error: e.message }
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

  const msg = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Analyze these ${unclassified.length} ads and classify each one. Return a JSON array only, no explanation.

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
    }]
  })

  const content = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return 0

  const classifications = JSON.parse(jsonMatch[0]) as any[]

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
      const send = (line: string) => {
        controller.enqueue(encoder.encode(line + '\n'))
      }

      try {
        // ── Get terms to crawl ──
        let termsToRun: { term: string; countries: string[]; id: string }[] = []
        if (forceTerm) {
          termsToRun = [{ term: forceTerm, countries: [forceCountry || 'US'], id: 'manual' }]
        } else {
          const { data: terms } = await admin
            .from('discovery_crawl_terms')
            .select('id, term, countries')
            .eq('is_active', true)
            .order('last_crawled_at', { ascending: true, nullsFirst: true })
            .limit(TERMS_PER_RUN)
          termsToRun = terms || []
        }

        if (!termsToRun.length) {
          send(JSON.stringify({ type: 'error', msg: '❌ No active terms found. Add terms in the Terms tab first.' }))
          controller.close()
          return
        }

        send(JSON.stringify({ type: 'log', msg: `📋 Found ${termsToRun.length} terms to crawl` }))

        // ── Get Meta token ──
        const metaToken = await getMetaToken(admin)
        send(JSON.stringify({ type: 'log', msg: '🔑 Meta token acquired' }))

        let totalAdsUpserted = 0

        // ── Crawl each term × country ──
        for (const { term, countries, id } of termsToRun) {
          const countriesToCrawl = forceCountry ? [forceCountry] : (countries || ['US'])

          for (const country of countriesToCrawl) {
            send(JSON.stringify({ type: 'log', msg: `🌐 Crawling "${term}" / ${country}…` }))

            const { ads, error: fetchError } = await fetchAdsForTerm(term, country, metaToken)

            if (fetchError) {
              send(JSON.stringify({ type: 'log', msg: `  ❌ ${term}/${country}: ${fetchError}` }))
              await admin.from('discovery_crawl_log').insert({ term, country, ads_fetched: 0, error: fetchError })
              continue
            }

            if (!ads.length) {
              send(JSON.stringify({ type: 'log', msg: `  ⚠️ ${term}/${country}: 0 ads returned` }))
              continue
            }

            const rows = ads.map((ad: any) => transformAd(ad, term, country))
            const { error } = await admin
              .from('discovery_ads_index')
              .upsert(rows, { onConflict: 'ad_id', ignoreDuplicates: false })

            await admin.from('discovery_crawl_log').insert({
              term, country, ads_fetched: ads.length, ads_new: error ? 0 : ads.length, error: error?.message,
            })

            send(JSON.stringify({ type: 'log', msg: `  ✅ ${term}/${country}: ${ads.length} ads` }))
            totalAdsUpserted += ads.length
          }

          if (id !== 'manual') {
            await admin.from('discovery_crawl_terms').update({
              last_crawled_at: new Date().toISOString(),
            }).eq('id', id)
          }
        }

        // ── Embeddings ──
        send(JSON.stringify({ type: 'log', msg: '🔢 Generating embeddings…' }))
        let embedded = 0
        try {
          embedded = await generateEmbeddings(admin)
          send(JSON.stringify({ type: 'log', msg: `  ✅ ${embedded} embeddings generated` }))
        } catch (e: any) {
          send(JSON.stringify({ type: 'log', msg: `  ❌ Embeddings error: ${e.message}` }))
        }

        // ── Claude classification ──
        send(JSON.stringify({ type: 'log', msg: '🤖 Running Claude classification…' }))
        let classified = 0
        try {
          classified = await classifyWithClaude(admin)
          send(JSON.stringify({ type: 'log', msg: `  ✅ ${classified} ads classified` }))
        } catch (e: any) {
          send(JSON.stringify({ type: 'log', msg: `  ❌ Classification error: ${e.message}` }))
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

        send(JSON.stringify({
          type: 'done',
          msg: `🎉 Done! ${totalAdsUpserted} ads indexed, ${embedded} embeddings, ${classified} classified. Total in DB: ${(totalInDB || 0).toLocaleString()}`,
          totalAdsUpserted,
          embedded,
          classified,
          totalInDB,
          termsProcessed: termsToRun.map(t => t.term),
        }))
      } catch (e: any) {
        send(JSON.stringify({ type: 'error', msg: `❌ Fatal error: ${e.message}` }))
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
