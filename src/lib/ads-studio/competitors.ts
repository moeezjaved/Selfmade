/**
 * Competitor DISCOVERY layer — the "Lapis awesomeness": find a store's real rivals from the OPEN WEB,
 * not just from brands already in our crawl corpus. Pipeline:
 *   1. crawl the store  → what it sells + its market (reuses crawlStore signals).
 *   2. LLM              → category + the buyer search queries someone types to find ALTERNATIVES.
 *   3. Google SERP      → candidate brand domains (in the store's own market), across every query.
 *   4. filter           → drop self, marketplaces, blogs/news/social, platforms — keep real brand sites.
 *   5. LLM rank         → keep the true product competitors, each with a one-line "why they compete".
 * The route then enriches each rival with our ad-DNA (hooks/personas/angles) when we already crawled them,
 * and flags the rest as "spyable" so we can pull their live ads on demand. That enrichment is our edge:
 * Lapis shows you competitors; we dissect their ad strategy.
 */
import { crawlStore, type StoreContext } from './store'
import { buildBrandKit } from './brandkit'
import { searchAdLibrary, type LiveAd, type Advertiser } from './adlibrary'
import { serpDiscover, MARKET_LOCATION, dfsConfigured } from '@/lib/audit/dataforseo'
import { llm } from '@/lib/llm'

export type DiscoveredCompetitor = { domain: string; name: string; reason: string; foundVia: string; positions: number; pageId: string | null; liveAds: LiveAd[] }
export type DiscoveryResult = {
  seed: { name: string; category: string; market: string; productForms?: string[]; queries: string[] }
  competitors: DiscoveredCompetitor[]
  configured: boolean
  debug?: Record<string, any>   // populated only when discoverCompetitors is called with { debug: true }
}

/** Market name → Meta Ad Library ISO-2 country (for local advertiser search). ALL = global fallback. */
const MARKET_COUNTRY: Record<string, string> = {
  pakistan: 'PK', india: 'IN', bangladesh: 'BD', 'united states': 'US', usa: 'US', us: 'US', 'united kingdom': 'GB', uk: 'GB',
  uae: 'AE', 'united arab emirates': 'AE', 'saudi arabia': 'SA', canada: 'CA', australia: 'AU', nigeria: 'NG', kenya: 'KE',
  'south africa': 'ZA', philippines: 'PH', indonesia: 'ID', malaysia: 'MY', turkey: 'TR', germany: 'DE', france: 'FR', brazil: 'BR', mexico: 'MX',
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const nameMatch = (a: string, b: string) => { const x = norm(a), y = norm(b); return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)) }

// Sites that are never a DTC brand competitor — marketplaces, platforms, social, publishers, tools.
const NON_BRAND = /(amazon|ebay|walmart|etsy|aliexpress|alibaba|daraz|flipkart|noon|jumia|temu|shein)\.|(kickstarter|indiegogo|gofundme)\.|(shopify|myshopify|wix|squarespace|bigcommerce|godaddy|wordpress|webflow)\.|(facebook|instagram|tiktok|youtube|twitter|x\.com|pinterest|reddit|linkedin|quora|medium|tumblr)\.|(wikipedia|google|bing|yahoo|yelp|trustpilot|glassdoor|indeed|crunchbase)\.|(nytimes|forbes|businessinsider|techcrunch|theguardian|bbc|cnn|healthline|webmd|verywell)\.|\.gov|\.edu|(gumtree|olx|craigslist)\./i

function domainRoot(d: string) { return d.replace(/^www\./, '').toLowerCase() }

/** Step 2 — LLM turns the store context + Brand-Kit knowledge into the PRECISE product niche, its market,
 * and the exact brand-discovery queries a shopper types to find true alternatives. Grounding in the Brand-Kit
 * facts is what makes discovery accurate: it pins the specific product FORM (e.g. "non-electronic flavored-air
 * aromatherapy device"), not a loose category ("nicotine-free vape"). */
async function seedQueries(ctx: StoreContext, facts: string[]): Promise<{ category: string; market: string; productForms: string[]; queries: string[]; adKeywords: string[]; names: string[] }> {
  const products = ctx.products.slice(0, 12).map((p) => p.title).join(' | ') || ctx.description
  const knowledge = facts.length ? facts.slice(0, 18).map((f) => `- ${f}`).join('\n') : '(none)'
  const prompt = `You are a DTC market analyst finding a store's TRUE competitors. A brand often sells SEVERAL distinct product lines (e.g. testosterone GUMMIES and testosterone TABLETS, or a supplement brand with 10 products) — you must cover EVERY line, not just the one that appears most. Accuracy depends on pinning each PRECISE product form, not one loose category.

STORE: ${ctx.siteName} (${ctx.domain})
DESCRIPTION: ${ctx.description || '(none)'}
PRODUCTS: ${products}
SIGNALS (currency / payment / geography read off the site): ${ctx.signals.join(' · ') || '(none)'}
BRAND KNOWLEDGE (distilled from their real site):
${knowledge}

Step 1 — list the DISTINCT product lines/forms this store sells (look at PRODUCTS above): e.g. ["testosterone support gummies","testosterone support tablets"]. Group near-identical variants (flavors/sizes) into ONE line. Return 1-5 lines — the real breadth of the catalog, not just the hero product.
  EXCLUDE generic accessories, consumables and spare parts that are not the brand's core offering — replacement filters/cartridges/refills, cases, chargers, cables, brushes, straps. A store selling a "micro-infusion system" competes on the SYSTEM, not on its "water filter replacements". These pollute the search with unrelated brands, so leave them out of the lines.
Step 2 — competitors must make the SAME KIND of product as one of these lines (same form, not merely the same goal).

Return ONLY JSON:
{
 "category":"the brand's overall niche at BRAND level — broad enough to span ALL the lines below (e.g. 'natural testosterone support supplements', NOT just 'gummies')",
 "market":"the primary country the store sells to. ONLY name a country when the signals give an EXPLICIT, unambiguous cue (currency symbol/code, a shipping-country statement, or a physical address). A single weak hint (one price, a stray mention) is NOT enough — when in doubt return 'global'. Never guess a country from the language alone.",
 "productForms":["each distinct product line/form from Step 1 — 1-5 short phrases"],
 "queries":["8 Google queries that surface COMPETING BRANDS. COVER EVERY product line above — include at least one exact-form query per line ('<line> brands', 'buy <line>') plus a couple brand-level 'alternatives to <brand/category>' queries. Do NOT over-index on a single line."],
 "adKeywords":["6-8 SHORT keyword phrases (1-3 words each) to find COMPETING ADVERTISERS in the Meta Ad Library. Include BOTH: (a) the core product noun per line (e.g. 'testosterone gummies'), AND (b) how rivals describe this product in their OWN ADS — the buyer-outcome / category language a competitor uses as a hook, NOT the literal device name (e.g. for a nicotine-free flavored-air device: 'quit smoking','nicotine free','smoking alternative','vape alternative','stop smoking'; for testosterone gummies: 'testosterone booster','low testosterone'). Short and broad — NOT 'brands'/'buy'/'best'. Max 8."],
 "competitors":["6-10 REAL, well-known direct competitor BRAND NAMES you are genuinely confident about for THIS brand, in its category and market — the actual rival brands a shopper compares it to. Use real names you know (e.g. for a Pakistani cosmetics brand: 'Rivaj','Medora','Masarrat Misbah Makeup','WB by Hemani','Saeed Ghani','J.'; for a US greens brand: 'AG1','Bloom','Supergreen Tonik'). Only names you are CONFIDENT are real brands — if unsure, return fewer or []. Do NOT invent names."]
}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 900, temperature: 0.4, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    return {
      category: String(j?.category || '').slice(0, 80),
      market: String(j?.market || '').slice(0, 40),
      productForms: (Array.isArray(j?.productForms) ? j.productForms : []).map((q: any) => String(q).slice(0, 50)).filter(Boolean).slice(0, 5),
      queries: (Array.isArray(j?.queries) ? j.queries : []).map((q: any) => String(q).slice(0, 90)).filter(Boolean).slice(0, 10),
      adKeywords: (Array.isArray(j?.adKeywords) ? j.adKeywords : []).map((q: any) => String(q).slice(0, 40)).filter(Boolean).slice(0, 8),
      names: (Array.isArray(j?.competitors) ? j.competitors : []).map((q: any) => String(q).slice(0, 60)).filter(Boolean).slice(0, 10),
    }
  } catch { return { category: '', market: '', productForms: [], queries: [], adKeywords: [], names: [] } }
}

/** Step 5 — LLM keeps only the real product competitors (same product FORM) and says why each competes. */
async function rankCompetitors(ctx: StoreContext, category: string, facts: string[], candidates: { domain: string; title: string; snippet: string }[]): Promise<{ domain: string; name: string; reason: string }[]> {
  if (!candidates.length) return []
  const list = candidates.map((c, i) => `${i + 1}. ${c.domain} — ${c.title} :: ${c.snippet}`.slice(0, 260)).join('\n')
  const knowledge = facts.length ? facts.slice(0, 12).map((f) => `- ${f}`).join('\n') : '(none)'
  const prompt = `Store "${ctx.siteName}" makes: ${category || ctx.description}.
WHAT THE STORE ACTUALLY IS (use this to judge who is a TRUE competitor — same kind of product, not merely the same goal):
${knowledge}

Below are websites that showed up when searching. Keep ONLY REAL competing BRANDS that make the SAME KIND of product as "${ctx.siteName}". Drop retailers, marketplaces, blogs, review/"best of" listicles, directories, and products that only share the goal but are a different form (e.g. if the store sells a non-electronic flavored-air device, drop ordinary e-cigarettes/vapes unless they are also non-electronic flavored-air devices).

CANDIDATES:
${list}

Return ONLY JSON: {"competitors":[{"domain":"exact domain from the list","name":"brand name","reason":"one short line naming the concrete overlap in product form with ${ctx.siteName}"}]} — ranked most-direct first, max 10.`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1100, temperature: 0.2, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    return (Array.isArray(j?.competitors) ? j.competitors : [])
      .map((c: any) => ({ domain: domainRoot(String(c.domain || '')), name: String(c.name || '').slice(0, 60), reason: String(c.reason || '').slice(0, 160) }))
      .filter((c: any) => c.domain && c.domain.includes('.'))
      .slice(0, 10)
  } catch { return [] }
}

export async function discoverCompetitors(domain: string, opts?: { debug?: boolean }): Promise<DiscoveryResult> {
  const dbg: Record<string, any> | null = opts?.debug ? {} : null
  const configured = dfsConfigured()
  if (dbg) dbg.serpConfigured = configured
  // Crawl the store AND build its Brand Kit in parallel — the Brand-Kit facts sharpen discovery to the
  // exact product niche (Lapis-level accuracy), instead of a loose category guess off the thin crawl.
  const [ctx, kit] = await Promise.all([crawlStore(domain), buildBrandKit(domain).catch(() => null)])
  const facts = kit?.facts ?? []
  if (dbg) dbg.ctx = { siteName: ctx.siteName, domain: ctx.domain, products: ctx.products.length, descLen: (ctx.description || '').length, signals: ctx.signals, facts: facts.length }
  const { category, market, productForms, queries, adKeywords, names } = await seedQueries(ctx, facts)
  if (dbg) dbg.seed = { category, market, productForms, queries, adKeywords, names }
  // Only give up entirely when we have NOTHING to search with. The Meta Ad Library step below runs on the
  // droplet independently of DataForSEO, so an unconfigured/empty SERP must NOT short-circuit it — that was
  // silently returning zero rivals for brands whose competitors live in the Ad Library, not Google.
  if (!queries.length && !adKeywords.length && !names.length) return { seed: { name: ctx.siteName, category, market, productForms, queries }, competitors: [], configured, debug: dbg ? { ...dbg, stop: 'no queries, adKeywords or names' } : undefined }

  const loc = MARKET_LOCATION[market.trim().toLowerCase()] ?? 2840
  const self = domainRoot(domain)

  // Step 3–4: search every query in the store's market, pool candidate brand domains. Queries span ALL
  // the brand's product lines (gummies AND tablets, etc.) so a multi-product brand isn't reduced to one.
  // Skipped when DataForSEO isn't configured — the Ad Library breadth pass below still finds rivals.
  const serps = configured ? await Promise.all(queries.slice(0, 8).map((q) => serpDiscover(q, loc))) : []
  const pool = new Map<string, { domain: string; title: string; snippet: string; positions: number; hits: number }>()
  serps.forEach((rows) => rows.forEach((r) => {
    const d = domainRoot(r.domain)
    if (d === self || NON_BRAND.test(r.domain) || !d.includes('.')) return
    const cur = pool.get(d)
    if (cur) { cur.hits += 1; cur.positions += r.position; if (r.snippet && !cur.snippet) cur.snippet = r.snippet }
    else pool.set(d, { domain: d, title: r.title, snippet: r.snippet, positions: r.position, hits: 1 })
  }))
  // Rank candidates: appearing across MORE queries beats a single high rank.
  const candidates = Array.from(pool.values())
    .sort((a, b) => (b.hits - a.hits) || (a.positions / a.hits - b.positions / b.hits))
    .slice(0, 22)
  if (dbg) dbg.serp = { queriesRun: configured ? Math.min(queries.length, 8) : 0, serpRows: serps.reduce((n, r) => n + r.length, 0), pool: pool.size, candidates: candidates.map((c) => c.domain) }

  const ranked = await rankCompetitors(ctx, category, facts, candidates)
  if (dbg) dbg.ranked = ranked.map((r) => r.domain)
  const competitors: DiscoveredCompetitor[] = ranked.map((r) => {
    const c = pool.get(r.domain)
    return { domain: r.domain, name: r.name || r.domain, reason: r.reason, foundVia: category || 'category search', positions: c ? Math.round(c.positions / c.hits) : 0, pageId: null, liveAds: [] }
  })

  // ── Meta Ad Library: keyword-search the niche → advertiser pool (live ads + BREADTH Google organic misses).
  // Search the store's DETECTED market (e.g. India → IN) so a regional brand gets regional rivals — the old
  // hardcoded ALL surfaced a Hungarian gummy brand + a US greens brand for an Indian Ayurvedic store. Falls
  // back to ALL only when the market is unknown/global. Short keywords (the search wants broad phrases). ──
  const marketCountry = MARKET_COUNTRY[market.trim().toLowerCase()] || 'ALL'
  // Search the detected market AND globally (ALL). A store's biggest rivals are often global DTC brands
  // that DON'T advertise in a small local market (e.g. FÜM never shows in a Pakistan-only Ad Library
  // search), so a market-only search silently missed them. rankCompetitors filters the extra breadth
  // back down to true niche rivals, so casting wider only helps.
  const countries = Array.from(new Set([marketCountry, 'ALL']))
  // Keywords cover the product lines AND the buyer-language rivals use in ad copy (from seedQueries).
  // HARD-CAP the total Ad Library searches (keywords × countries) — these are Playwright calls on ONE
  // shared droplet, so too many pile up and the background job never finishes. Keep it to ~4 total.
  const maxSearches = 4
  const maxKw = Math.max(2, Math.floor(maxSearches / countries.length))
  const adQueries = (adKeywords.length ? adKeywords : [category, ...productForms]).filter(Boolean).slice(0, maxKw)
  if (dbg) dbg.adSearch = { countries, adQueries }
  const advByPage = new Map<string, Advertiser>()
  try {
    // Time-bound each droplet search so one slow call can't stall the whole background job past its budget.
    const withTimeout = (p: Promise<Advertiser[]>): Promise<Advertiser[]> =>
      Promise.race([p.catch(() => [] as Advertiser[]), new Promise<Advertiser[]>((r) => setTimeout(() => r([]), 35_000))])
    const searches: Promise<Advertiser[]>[] = []
    for (const q of adQueries) for (const cc of countries) searches.push(withTimeout(searchAdLibrary(q, cc)))
    const found = (await Promise.all(searches)).flat()
    for (const a of found) {
      if (!a.pageId || !a.ads.length) continue
      if (a.domain && (NON_BRAND.test(a.domain) || domainRoot(a.domain) === self)) continue
      const cur = advByPage.get(a.pageId)
      if (cur) cur.ads.push(...a.ads.filter((x) => !cur.ads.some((y) => y.adId === x.adId)))
      else advByPage.set(a.pageId, { ...a })
    }
  } catch { /* ad library best-effort */ }
  const advertisers = Array.from(advByPage.values())
  if (dbg) dbg.adLibrary = { countries, adQueries, advertisers: advertisers.map((a) => ({ name: a.pageName, domain: a.domain, ads: a.ads.length })) }

  // NAMED rivals — the LLM's known competitors, resolved DIRECTLY to their Meta page + live ads by
  // brand-name search. This is what a human does by hand, and it works even when Google/SERP returned
  // nothing. A name match is high-confidence, so these skip the relevance re-filter. Bounded droplet calls.
  const namedCompetitors: DiscoveredCompetitor[] = []
  if (names.length) {
    const nameCountry = marketCountry !== 'ALL' ? marketCountry : 'ALL'
    const nameTimeout = (p: Promise<Advertiser[]>): Promise<Advertiser[]> =>
      Promise.race([p.catch(() => [] as Advertiser[]), new Promise<Advertiser[]>((r) => setTimeout(() => r([]), 35_000))])
    const nameTargets = names.slice(0, 6)
    const nameResults = await Promise.all(nameTargets.map(async (nm) => ({ nm, ads: await nameTimeout(searchAdLibrary(nm, nameCountry)) })))
    for (const { nm, ads } of nameResults) {
      // STRICT: only accept an advertiser whose PAGE NAME actually matches the queried brand — otherwise a
      // brand-name search returns resellers / unrelated pages that merely mention the brand in ad copy.
      const best = ads
        .filter((a) => a.pageId && a.ads.length && nameMatch(a.pageName || '', nm) && !(a.domain && (NON_BRAND.test(a.domain) || domainRoot(a.domain) === self)))
        .sort((a, b) => b.ads.length - a.ads.length)[0]
      if (best && !namedCompetitors.some((c) => c.pageId === best.pageId)) {
        namedCompetitors.push({ domain: best.domain || '', name: best.pageName || nm, reason: `A direct competitor of ${ctx.siteName}.`, foundVia: 'Known rival', positions: 0, pageId: best.pageId, liveAds: best.ads.slice(0, 300) })
      }
    }
    if (dbg) (dbg as any).named = { targets: nameTargets, resolved: namedCompetitors.map((c) => c.name) }
  }

  // Attach live ads to the Google-ranked rivals (match by destination domain, else advertiser name).
  const usedPages = new Set<string>()
  for (const c of competitors) {
    const match = advertisers.find((a) => (a.domain && domainRoot(a.domain) === c.domain) || nameMatch(a.pageName || '', c.name))
    if (match) { c.pageId = match.pageId; c.liveAds = match.ads.slice(0, 300); usedPages.add(match.pageId) }
  }

  // BREADTH: advertisers we didn't already surface via Google. The keyword search is broad, so it also
  // pulls unrelated brands (Whole Foods, phone cases, Kickstarter…) — LLM-filter to TRUE niche competitors
  // (same-product-form judgement) before adding them.
  const unmatched = advertisers.filter((a) => !usedPages.has(a.pageId) && a.pageName && a.ads.length && !competitors.some((c) => nameMatch(c.name, a.pageName)))
  let extra: DiscoveredCompetitor[] = []
  if (unmatched.length) {
    const advCandidates = unmatched.map((a) => ({ domain: a.domain || a.pageName, title: a.pageName, snippet: (a.ads[0]?.body || a.ads[0]?.title || '').slice(0, 160) }))
    const relevant = await rankCompetitors(ctx, category, facts, advCandidates)
    const keptDomains = new Set(relevant.map((r) => r.domain))
    extra = unmatched
      .map((a) => {
        const r = relevant.find((r) => (a.domain && r.domain === domainRoot(a.domain)) || nameMatch(r.name, a.pageName))
        return r ? { a, r } : null
      })
      .filter((x): x is { a: Advertiser; r: { domain: string; name: string; reason: string } } => !!x && (keptDomains.size > 0))
      .slice(0, Math.max(0, 12 - competitors.length))
      .map(({ a, r }): DiscoveredCompetitor => ({
        domain: a.domain || '', name: r.name || a.pageName, reason: r.reason || 'Active advertiser in your niche — found in the Meta Ad Library.',
        foundVia: 'Meta Ad Library', positions: 0, pageId: a.pageId, liveAds: a.ads.slice(0, 300),
      }))
  }

  // Named rivals FIRST (highest confidence), then Google-ranked, then breadth — deduped by page/name/domain.
  const merged: DiscoveredCompetitor[] = [...namedCompetitors]
  for (const c of [...competitors, ...extra]) {
    const dup = merged.some((m) => (m.pageId && c.pageId && m.pageId === c.pageId) || (m.domain && c.domain && domainRoot(m.domain) === domainRoot(c.domain)) || nameMatch(m.name, c.name))
    if (!dup) merged.push(c)
  }
  if (dbg) { dbg.extra = extra.map((e) => e.name); dbg.competitorsFinal = merged.map((c) => c.name) }
  return {
    seed: { name: ctx.siteName, category, market, productForms, queries },
    competitors: merged,
    configured,
    debug: dbg || undefined,
  }
}
