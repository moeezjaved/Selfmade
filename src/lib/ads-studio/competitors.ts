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
import { serpDiscover, MARKET_LOCATION, dfsConfigured } from '@/lib/audit/dataforseo'
import { llm } from '@/lib/llm'

export type DiscoveredCompetitor = { domain: string; name: string; reason: string; foundVia: string; positions: number }
export type DiscoveryResult = {
  seed: { name: string; category: string; market: string; queries: string[] }
  competitors: DiscoveredCompetitor[]
  configured: boolean
}

// Sites that are never a DTC brand competitor — marketplaces, platforms, social, publishers, tools.
const NON_BRAND = /(amazon|ebay|walmart|etsy|aliexpress|alibaba|daraz|flipkart|noon|jumia|temu|shein)\.|(shopify|myshopify|wix|squarespace|bigcommerce|godaddy|wordpress|webflow)\.|(facebook|instagram|tiktok|youtube|twitter|x\.com|pinterest|reddit|linkedin|quora|medium|tumblr)\.|(wikipedia|google|bing|yahoo|yelp|trustpilot|glassdoor|indeed|crunchbase)\.|(nytimes|forbes|businessinsider|techcrunch|theguardian|bbc|cnn|healthline|webmd|verywell)\.|\.gov|\.edu|(gumtree|olx|craigslist)\./i

function domainRoot(d: string) { return d.replace(/^www\./, '').toLowerCase() }

/** Step 2 — LLM turns the store context + Brand-Kit knowledge into the PRECISE product niche, its market,
 * and the exact brand-discovery queries a shopper types to find true alternatives. Grounding in the Brand-Kit
 * facts is what makes discovery accurate: it pins the specific product FORM (e.g. "non-electronic flavored-air
 * aromatherapy device"), not a loose category ("nicotine-free vape"). */
async function seedQueries(ctx: StoreContext, facts: string[]): Promise<{ category: string; market: string; queries: string[] }> {
  const products = ctx.products.slice(0, 12).map((p) => p.title).join(' | ') || ctx.description
  const knowledge = facts.length ? facts.slice(0, 18).map((f) => `- ${f}`).join('\n') : '(none)'
  const prompt = `You are a DTC market analyst finding a store's TRUE competitors. Accuracy depends on pinning the PRECISE product form, not a loose category. Use the brand knowledge below — it describes what the product actually is.

STORE: ${ctx.siteName} (${ctx.domain})
DESCRIPTION: ${ctx.description || '(none)'}
PRODUCTS: ${products}
SIGNALS (currency / payment / geography read off the site): ${ctx.signals.join(' · ') || '(none)'}
BRAND KNOWLEDGE (distilled from their real site):
${knowledge}

First, identify the SPECIFIC product form and mechanism (e.g. "non-electronic flavored-air aromatherapy inhaler with replaceable cores", NOT just "nicotine-free vape"). Competitors must make the SAME KIND of product, not merely serve the same goal.

Return ONLY JSON:
{
 "category":"the precise 4-8 word product niche (the specific FORM, not the broad goal)",
 "market":"the primary country the store sells to (infer from signals; US/global if none)",
 "queries":["6-8 Google queries that surface COMPETING BRANDS making this exact kind of product. Mix: exact-form queries ('<precise form> brands', 'buy <precise form>'), close synonyms shoppers use for this form, and 'alternatives to <product/category>'. Prefer the specific form wording over the generic goal so you find same-kind makers, not loosely-related products."]
}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 700, temperature: 0.4, messages: [{ role: 'user', content: prompt }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    return {
      category: String(j?.category || '').slice(0, 80),
      market: String(j?.market || '').slice(0, 40),
      queries: (Array.isArray(j?.queries) ? j.queries : []).map((q: any) => String(q).slice(0, 90)).filter(Boolean).slice(0, 8),
    }
  } catch { return { category: '', market: '', queries: [] } }
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

export async function discoverCompetitors(domain: string): Promise<DiscoveryResult> {
  const configured = dfsConfigured()
  // Crawl the store AND build its Brand Kit in parallel — the Brand-Kit facts sharpen discovery to the
  // exact product niche (Lapis-level accuracy), instead of a loose category guess off the thin crawl.
  const [ctx, kit] = await Promise.all([crawlStore(domain), buildBrandKit(domain).catch(() => null)])
  const facts = kit?.facts ?? []
  const { category, market, queries } = await seedQueries(ctx, facts)
  if (!configured || !queries.length) return { seed: { name: ctx.siteName, category, market, queries }, competitors: [], configured }

  const loc = MARKET_LOCATION[market.trim().toLowerCase()] ?? 2840
  const self = domainRoot(domain)

  // Step 3–4: search every query in the store's market, pool candidate brand domains.
  const serps = await Promise.all(queries.slice(0, 6).map((q) => serpDiscover(q, loc)))
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

  const ranked = await rankCompetitors(ctx, category, facts, candidates)
  const competitors: DiscoveredCompetitor[] = ranked.map((r) => {
    const c = pool.get(r.domain)
    return { domain: r.domain, name: r.name || r.domain, reason: r.reason, foundVia: category || 'category search', positions: c ? Math.round(c.positions / c.hits) : 0 }
  })
  return { seed: { name: ctx.siteName, category, market, queries }, competitors, configured }
}
