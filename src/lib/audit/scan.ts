/**
 * Public SEO scan engine — the lead-magnet "theater". Takes a raw domain (no login), crawls the real public
 * site + sitemap, and produces the honest findings Ryze-style: website health, spam-update risk, catalog,
 * Google visibility (real ranks via DataForSEO when configured), AI visibility (really asks the assistants),
 * and the revenue it's costing (real volumes × real AOV from the catalog when available).
 *
 * Streamable: scanStream() yields each section as it completes, so the theater shows REAL numbers mid-scan.
 * runScan() collects the stream into one result (for caching + report reload). Everything is a live fact.
 */
import { fetchHtml } from '@/lib/seo/crawl-audit'
import { availableEngines, askEngine } from '@/lib/geo/engines'
import { dfsConfigured, serpGoogle, searchVolume, backlinksSummary } from '@/lib/audit/dataforseo'
import { pagespeedConfigured, pageSpeed } from '@/lib/audit/pagespeed'
import { llm } from '@/lib/llm'

export type Finding = { id: string; title: string; detail: string; severity: 'high' | 'medium' | 'low'; sample?: string[]; fixable: boolean }
export type SerpLadderRow = { keyword: string; volume: number | null; yourPosition: number | null; top: { domain: string; position: number }[] }
export type AiEngineRead = { engine: string; mentioned: boolean; question: string; answer: string }
export type Section = { key: string; name: string; sub: string; score: number; findings: Finding[]; ladder?: SerpLadderRow[]; ai?: { question: string; reads: AiEngineRead[] } }
export type ScanResult = {
  domain: string; siteName: string; category: string; score: number; grade: 'Poor' | 'Fair' | 'Good' | 'Great'
  websiteScore: number; visibilityScore: number; sections: Section[]
  ai: { question: string; reads: AiEngineRead[] }; revenueLostPerYear: number; currency: string; problemCount: number
}
export type ScanEvent =
  | { type: 'meta'; domain: string; siteName: string; category: string }
  | { type: 'section'; section: Section }
  | { type: 'done'; result: ScanResult }
  | { type: 'error'; error: string }

export function normalizeDomain(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '').replace(/^www\./, '')
}

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const tag = (html: string, re: RegExp): string => { const m = html.match(re); return m ? m[1].trim() : '' }

type Page = { url: string; title: string; metaDesc: string; h1: number; imgs: number; imgsNoAlt: number; words: number; schema: boolean; price: number | null }
function analyze(url: string, html: string): Page {
  const title = tag(html, /<title[^>]*>([^<]{0,300})/i)
  const metaDesc = tag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
  const h1 = (html.match(/<h1[\s>]/gi) || []).length
  const imgTags = html.match(/<img[^>]*>/gi) || []
  const imgsNoAlt = imgTags.filter((t) => !/\balt\s*=\s*["'][^"']+["']/i.test(t)).length
  const schema = /application\/ld\+json/i.test(html)
  const words = strip(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')).split(' ').length
  const priceRaw = tag(html, /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/i) || tag(html, /property=["'](?:og:price:amount|product:price:amount)["'][^>]+content=["']([0-9.]+)/i)
  const price = priceRaw ? Number(priceRaw) : null
  return { url, title, metaDesc, h1, imgs: imgTags.length, imgsNoAlt, words, schema, price: price && price > 0 ? price : null }
}

async function sitemap(domain: string): Promise<{ urls: string[]; byDay: Map<string, number> }> {
  const urls = new Set<string>(); const byDay = new Map<string, number>()
  async function ingest(xml: string, depth: number) {
    const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1])
    const mods = Array.from(xml.matchAll(/<lastmod>\s*([^<\s]+)/gi)).map((m) => m[1])
    if (/<sitemapindex/i.test(xml) && depth < 2) {
      for (const child of locs.slice(0, 15)) { const t = await fetchHtml(child); if (t) await ingest(t, depth + 1); if (urls.size > 1500) break }
    } else locs.forEach((u, i) => { urls.add(u); const d = (mods[i] || '').slice(0, 10); if (d) byDay.set(d, (byDay.get(d) || 0) + 1) })
  }
  for (const root of [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`]) {
    const t = await fetchHtml(root); if (t) { await ingest(t, 0); if (urls.size) break }
  }
  return { urls: Array.from(urls), byDay }
}

const scoreFrom = (fs: Finding[]) => Math.max(0, Math.min(100, fs.reduce((s, f) => s - (f.severity === 'high' ? 34 : f.severity === 'medium' ? 18 : 8), 100)))

async function deriveCategory(homeHtml: string, fallback: string): Promise<string> {
  const facts = { title: tag(homeHtml, /<title[^>]*>([^<]{0,200})/i), desc: tag(homeHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) }
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 40, temperature: 0.2, messages: [{ role: 'user', content: `In 2-5 words, the product category this store sells (plain buyer words). Store: ${JSON.stringify(facts)}. Answer ONLY the category.` }] })
    return (res.content?.[0]?.text || '').trim().replace(/^["']|["'.]+$/g, '').slice(0, 60) || fallback
  } catch { return fallback }
}

async function seedKeywords(category: string): Promise<string[]> {
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 100, temperature: 0.3, messages: [{ role: 'user', content: `3 high-intent buyer search queries someone types into Google before buying a "${category}". Return ONLY JSON {"kw":["...","...","..."]}` }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    return Array.isArray(j?.kw) ? j.kw.map((x: any) => String(x)).slice(0, 3) : []
  } catch { return [] }
}

type Ctx = { domain: string; siteName: string; category: string; sm: { urls: string[]; byDay: Map<string, number> }; pages: Page[]; productPages: Page[] }

async function buildContext(domain: string, home: string): Promise<Ctx> {
  const siteName = (tag(home, /<title[^>]*>([^<|–-]{0,60})/i) || domain).trim()
  const [sm, category] = await Promise.all([sitemap(domain), deriveCategory(home, siteName)])
  const productUrls = sm.urls.filter((u) => /\/products?\//i.test(u)).slice(0, 8)
  const contentUrls = sm.urls.filter((u) => !/\/products?\//i.test(u)).slice(0, 6)
  const sampleUrls = Array.from(new Set([`https://${domain}/`, ...contentUrls, ...productUrls])).slice(0, 14)
  const pages = (await Promise.all(sampleUrls.map(async (u) => { const h = await fetchHtml(u); return h ? analyze(u, h) : null }))).filter(Boolean) as Page[]
  return { domain, siteName, category, sm, pages, productPages: pages.filter((p) => /\/products?\//i.test(p.url)) }
}

/* ── Steps ─────────────────────────────────────────────────────────────────────────────────────── */
function stepHealth(ctx: Ctx): Section {
  const f: Finding[] = []
  const noMeta = ctx.pages.filter((p) => !p.metaDesc)
  if (noMeta.length) f.push({ id: 'meta', title: `${noMeta.length} sampled pages missing meta descriptions`, detail: 'Google writes its own snippet for these — usually worse than yours would be.', severity: noMeta.length > 3 ? 'high' : 'medium', sample: noMeta.map((p) => new URL(p.url).pathname), fixable: true })
  const noAlt = ctx.pages.reduce((a, p) => a + p.imgsNoAlt, 0)
  if (noAlt) f.push({ id: 'alt', title: `${noAlt} images missing alt text on sampled pages`, detail: 'Invisible in Google image search.', severity: noAlt > 20 ? 'high' : 'medium', fixable: true })
  const badH1 = ctx.pages.filter((p) => p.h1 !== 1)
  if (badH1.length) f.push({ id: 'h1', title: `${badH1.length} pages with a missing or duplicate H1`, detail: 'The H1 tells Google the page’s main topic.', severity: 'medium', sample: badH1.map((p) => new URL(p.url).pathname), fixable: true })
  return { key: 'health', name: 'Website health', sub: 'Meta, headings and images across your pages', score: scoreFrom(f), findings: f }
}
function stepSpam(ctx: Ctx): Section {
  const f: Finding[] = []
  const maxDay = Math.max(0, ...Array.from(ctx.sm.byDay.values()))
  if (maxDay >= 20) f.push({ id: 'masspub', title: `${maxDay} pages published in a single day`, detail: 'Google’s spam update demotes scaled, template-looking content published in bursts.', severity: maxDay >= 60 ? 'high' : 'medium', fixable: true })
  return { key: 'spam', name: 'Spam-update risk', sub: `${ctx.sm.urls.length} URLs in your sitemap`, score: f.length ? scoreFrom(f) : 100, findings: f }
}
function stepCatalog(ctx: Ctx): Section {
  const f: Finding[] = []
  if (ctx.productPages.length) {
    const noAltProd = ctx.productPages.filter((p) => p.imgsNoAlt > 0)
    if (noAltProd.length) f.push({ id: 'prodalt', title: `${noAltProd.reduce((a, p) => a + p.imgsNoAlt, 0)} product images missing alt text`, detail: 'Google can’t see your product photos — invisible in image search.', severity: 'high', sample: noAltProd.map((p) => strip(p.title).slice(0, 60)), fixable: true })
    const thin = ctx.productPages.filter((p) => p.words < 120)
    if (thin.length) f.push({ id: 'thin', title: `${thin.length} products with thin descriptions`, detail: 'Not enough for Google or a hesitant buyer.', severity: 'medium', sample: thin.map((p) => strip(p.title).slice(0, 60)), fixable: true })
  }
  return { key: 'catalog', name: 'Your catalog', sub: ctx.productPages.length ? 'Products checked one by one' : 'No product pages found in the sitemap', score: ctx.productPages.length ? scoreFrom(f) : 100, findings: f }
}
async function stepAi(ctx: Ctx): Promise<Section> {
  const engines = availableEngines().slice(0, 4)
  const question = `What are the best ${ctx.category}?`
  const reads: AiEngineRead[] = []
  const brandTokens = [ctx.siteName.toLowerCase(), ctx.domain.split('.')[0]].filter((t) => t.length > 2)
  await Promise.all(engines.map(async (e) => {
    const a = await askEngine(e, question).catch(() => null)
    if (!a) return
    reads.push({ engine: e, mentioned: brandTokens.some((t) => a.text.toLowerCase().includes(t)), question, answer: a.text.slice(0, 1400) })
  }))
  const misses = reads.filter((r) => !r.mentioned)
  const f: Finding[] = misses.map((r) => ({ id: `ai-${r.engine}`, title: `${r.engine} doesn’t mention you`, detail: question, severity: 'high', fixable: true }))
  return { key: 'ai', name: 'AI visibility', sub: 'What ChatGPT, Gemini & Perplexity say', score: reads.length ? scoreFrom(f) : 100, findings: f, ai: { question, reads } }
}
async function stepGoogle(ctx: Ctx): Promise<Section> {
  if (!dfsConfigured()) {
    return { key: 'google', name: 'Google visibility', sub: 'Where buyers find you first', score: 0, findings: [{ id: 'serp', title: 'Connect a search source to see your ranks', detail: `We’ll show exactly where ${ctx.domain} ranks for your buyer searches, and who’s taking the click.`, severity: 'medium', fixable: false }] }
  }
  const kws = await seedKeywords(ctx.category)
  const [ladders, volumes] = await Promise.all([
    Promise.all(kws.map((k) => serpGoogle(k, ctx.domain))),
    searchVolume(kws),
  ])
  const rows: SerpLadderRow[] = ladders.filter(Boolean).map((l) => ({ keyword: l!.keyword, volume: volumes[l!.keyword.toLowerCase()] ?? null, yourPosition: l!.yourPosition, top: l!.top }))
  const f: Finding[] = rows.filter((r) => r.yourPosition == null || r.yourPosition > 10).map((r) => ({
    id: `serp-${r.keyword}`, title: `“${r.keyword}” — ${r.yourPosition == null ? 'not in top 50' : `ranked #${r.yourPosition}`}`,
    detail: `${r.volume ? `${r.volume.toLocaleString()} searches/mo · ` : ''}${r.top[0]?.domain || 'a rival'} takes the click uncontested.`, severity: 'high', fixable: true,
  }))
  return { key: 'google', name: 'Google visibility', sub: 'Where buyers find you first', score: rows.length ? scoreFrom(f) : 0, findings: f, ladder: rows }
}

async function stepSpeed(ctx: Ctx): Promise<Section | null> {
  if (!pagespeedConfigured()) return null
  const ps = await pageSpeed(`https://${ctx.domain}/`)
  if (!ps) return null
  const f: Finding[] = []
  if (ps.lcpMs != null) {
    const sec = (ps.lcpMs / 1000).toFixed(1)
    if (ps.lcpMs > 2500) f.push({ id: 'lcp', title: `Pages load in ${sec}s on real devices — over Google’s 2.5s bar`, detail: 'Slow pages lose rankings and buyers on mobile.', severity: ps.lcpMs > 4000 ? 'high' : 'medium', fixable: true })
  } else if (ps.perf != null && ps.perf < 70) {
    f.push({ id: 'perf', title: `Performance score ${ps.perf}/100`, detail: 'Room to speed up your pages.', severity: ps.perf < 50 ? 'high' : 'medium', fixable: true })
  }
  const score = ps.lcpMs != null ? (ps.lcpMs <= 2500 ? 100 : ps.lcpMs < 4000 ? 60 : 30) : (ps.perf ?? 100)
  return { key: 'speed', name: 'Website speed', sub: ps.hasField ? 'Real-visitor load times from Chrome UX data' : 'Lab performance (not enough real-visitor data yet)', score, findings: f }
}

async function stepBacklinks(ctx: Ctx, ladder: SerpLadderRow[]): Promise<Section | null> {
  if (!dfsConfigured()) return null
  const rivalDomain = ladder.find((r) => r.top[0]?.domain && r.top[0].domain !== ctx.domain)?.top[0]?.domain
  const [mine, rival] = await Promise.all([backlinksSummary(ctx.domain), rivalDomain ? backlinksSummary(rivalDomain) : Promise.resolve(null)])
  const f: Finding[] = []
  if (mine && rival && rival.referringDomains > mine.referringDomains * 1.5) {
    f.push({ id: 'bl-gap', title: `${rivalDomain} has ${rival.referringDomains.toLocaleString()} linking domains — you have ${mine.referringDomains.toLocaleString()}`, detail: 'Backlinks are Google’s strongest ranking signal. That gap is a big reason they outrank you.', severity: 'high', fixable: true })
  } else if (mine && mine.referringDomains < 25) {
    f.push({ id: 'bl-thin', title: `Only ${mine.referringDomains.toLocaleString()} domains link to you`, detail: 'Too few for competitive terms. We build high-quality backlinks every month to close the gap.', severity: 'medium', fixable: true })
  }
  return { key: 'backlinks', name: 'Backlinks', sub: 'Who vouches for you across the web', score: f.length ? scoreFrom(f) : 100, findings: f }
}

/* ── Stream ────────────────────────────────────────────────────────────────────────────────────── */
export async function* scanStream(domain0: string): AsyncGenerator<ScanEvent> {
  const domain = normalizeDomain(domain0)
  if (!domain || !domain.includes('.')) { yield { type: 'error', error: 'Enter a real website, like yourstore.com' }; return }
  const home = await fetchHtml(`https://${domain}/`)
  if (!home) { yield { type: 'error', error: `Couldn’t reach ${domain} — it may be down or blocking bots.` }; return }

  const ctx = await buildContext(domain, home)
  yield { type: 'meta', domain, siteName: ctx.siteName, category: ctx.category }

  const sections: Section[] = []
  const emit = (s: Section) => { sections.push(s); return { type: 'section', section: s } as ScanEvent }
  yield emit(stepHealth(ctx))
  const speed = await stepSpeed(ctx); if (speed) yield emit(speed)
  yield emit(stepSpam(ctx))
  yield emit(stepCatalog(ctx))
  const google = await stepGoogle(ctx); yield emit(google)
  const bl = await stepBacklinks(ctx, google.ladder || []); if (bl) yield emit(bl)
  const ai = await stepAi(ctx); yield emit(ai)

  // Scores + revenue
  const get = (k: string) => sections.find((s) => s.key === k)!
  const opt = (k: string) => sections.find((s) => s.key === k)?.score ?? 100
  const websiteScore = Math.round((get('health').score + get('catalog').score + get('spam').score + (speed ? speed.score : 0)) / (speed ? 4 : 3))
  const visibilityScore = Math.round((get('ai').score + get('google').score + opt('backlinks')) / (bl ? 3 : 2))
  const score = Math.round(websiteScore * 0.55 + visibilityScore * 0.45)
  const grade: ScanResult['grade'] = score >= 80 ? 'Great' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor'
  const problemCount = sections.reduce((a, s) => a + s.findings.filter((f) => f.fixable).length, 0)

  const prices = ctx.productPages.map((p) => p.price).filter((p): p is number => !!p).sort((a, b) => a - b)
  const aov = prices.length ? prices[Math.floor(prices.length / 2)] : 60
  const ladder = get('google').ladder || []
  const lostVisits = ladder.filter((r) => r.yourPosition == null || r.yourPosition > 10).reduce((a, r) => a + (r.volume || 0) * 0.3, 0)
  const missShare = ai.ai && ai.ai.reads.length ? ai.ai.reads.filter((r) => !r.mentioned).length / ai.ai.reads.length : 0
  const revenueLostPerYear = Math.round((lostVisits * 0.009 * aov + missShare * 1000) * 12) || (problemCount * 800 + Math.round(missShare * 12000))

  const result: ScanResult = { domain, siteName: ctx.siteName, category: ctx.category, score, grade, websiteScore, visibilityScore, sections, ai: ai.ai!, revenueLostPerYear, currency: '$', problemCount }
  yield { type: 'done', result }
}

/** Persist a scan by domain — the bridge into the logged-in product (best-effort). */
export async function saveScan(admin: any, result: ScanResult): Promise<void> {
  try {
    await admin.from('audit_scans').upsert({
      domain: result.domain, site_name: result.siteName, category: result.category, score: result.score,
      result, updated_at: new Date().toISOString(),
    }, { onConflict: 'domain' })
  } catch { /* additive; never break the scan */ }
}

/** Load a stored scan for a domain — the logged-in SEO surface reads this so numbers carry over from the theater. */
export async function loadScanForDomain(admin: any, domain0: string): Promise<ScanResult | null> {
  try {
    const domain = normalizeDomain(domain0)
    const { data } = await admin.from('audit_scans').select('result').eq('domain', domain).maybeSingle()
    return data?.result || null
  } catch { return null }
}

/** Collect the stream into one result (non-streaming callers + cache). */
export async function runScan(domain: string): Promise<ScanResult | { error: string }> {
  let result: ScanResult | null = null
  for await (const ev of scanStream(domain)) {
    if (ev.type === 'error') return { error: ev.error }
    if (ev.type === 'done') result = ev.result
  }
  return result || { error: 'Scan produced no result.' }
}
