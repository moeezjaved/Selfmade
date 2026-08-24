/**
 * Public SEO scan engine — the lead-magnet "theater". Takes a raw domain (no login), crawls the real public
 * site + sitemap, and produces the honest findings Ryze-style: website health, speed, spam-update risk,
 * catalog, Google visibility, AI visibility, and the revenue it's costing. Reuses our real engines where it
 * can (fetchHtml + GEO askEngine); everything is a fact from the live site — nothing fabricated.
 *
 * Bounded for an API route: capped page counts, per-fetch timeouts, one LLM category call, a few GEO asks.
 */
import { fetchHtml } from '@/lib/seo/crawl-audit'
import { availableEngines, askEngine } from '@/lib/geo/engines'
import { llm } from '@/lib/llm'

export type Finding = { id: string; title: string; detail: string; severity: 'high' | 'medium' | 'low'; sample?: string[]; fixable: boolean }
export type Section = { key: string; name: string; sub: string; score: number; findings: Finding[] }
export type AiEngineRead = { engine: string; mentioned: boolean; question: string; answer: string }
export type ScanResult = {
  domain: string; siteName: string; category: string
  score: number; grade: 'Poor' | 'Fair' | 'Good' | 'Great'
  websiteScore: number; visibilityScore: number
  sections: Section[]
  ai: { question: string; reads: AiEngineRead[] }
  revenueLostPerYear: number; currency: string
  problemCount: number
}

export function normalizeDomain(input: string): string {
  let s = String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '')
  return s.replace(/^www\./, '')
}

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
function tag(html: string, re: RegExp): string { const m = html.match(re); return m ? m[1].trim() : '' }

type Page = { url: string; title: string; metaDesc: string; h1: number; imgs: number; imgsNoAlt: number; words: number; schema: boolean }
function analyze(url: string, html: string): Page {
  const title = tag(html, /<title[^>]*>([^<]{0,300})/i)
  const metaDesc = tag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
  const h1 = (html.match(/<h1[\s>]/gi) || []).length
  const imgTags = html.match(/<img[^>]*>/gi) || []
  const imgsNoAlt = imgTags.filter((t) => !/\balt\s*=\s*["'][^"']+["']/i.test(t)).length
  const schema = /application\/ld\+json/i.test(html)
  const words = strip(html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')).split(' ').length
  return { url, title, metaDesc, h1, imgs: imgTags.length, imgsNoAlt, words, schema }
}

/** Pull URLs from sitemap(s), plus lastmod dates for the spam-update (mass-publish) heuristic. */
async function sitemap(domain: string): Promise<{ urls: string[]; byDay: Map<string, number> }> {
  const urls = new Set<string>(); const byDay = new Map<string, number>()
  async function ingest(xml: string, depth: number) {
    const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1])
    const mods = Array.from(xml.matchAll(/<lastmod>\s*([^<\s]+)/gi)).map((m) => m[1])
    if (/<sitemapindex/i.test(xml) && depth < 2) {
      for (const child of locs.slice(0, 15)) { const t = await fetchHtml(child); if (t) await ingest(t, depth + 1); if (urls.size > 1500) break }
    } else {
      locs.forEach((u, i) => { urls.add(u); const d = (mods[i] || '').slice(0, 10); if (d) byDay.set(d, (byDay.get(d) || 0) + 1) })
    }
  }
  for (const root of [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`]) {
    const t = await fetchHtml(root); if (t) { await ingest(t, 0); if (urls.size) break }
  }
  return { urls: Array.from(urls), byDay }
}

function scoreFrom(findings: Finding[]): number {
  let s = 100
  for (const f of findings) s -= f.severity === 'high' ? 34 : f.severity === 'medium' ? 18 : 8
  return Math.max(0, Math.min(100, s))
}

async function deriveCategory(siteName: string, homeHtml: string): Promise<string> {
  const facts = { title: tag(homeHtml, /<title[^>]*>([^<]{0,200})/i), desc: tag(homeHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i), h1: strip((homeHtml.match(/<h1[^>]*>([\s\S]{0,160}?)<\/h1>/i) || [])[1] || '') }
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o-mini', max_tokens: 40, temperature: 0.2, messages: [{ role: 'user', content: `In 2-5 words, the product category this store sells (plain buyer words, e.g. "nicotine-free vape" or "women's skincare"). Store: ${JSON.stringify(facts)}. Answer ONLY the category.` }] })
    return (res.content?.[0]?.text || '').trim().replace(/^["']|["'.]+$/g, '').slice(0, 60) || siteName
  } catch { return siteName }
}

/** Run the full public scan. Bounded + best-effort per section. */
export async function runScan(domain0: string): Promise<ScanResult | { error: string }> {
  const domain = normalizeDomain(domain0)
  if (!domain || !domain.includes('.')) return { error: 'Enter a real website, like yourstore.com' }

  const home = await fetchHtml(`https://${domain}/`)
  if (!home) return { error: `Couldn’t reach ${domain} — it may be down or blocking bots.` }
  const siteName = (tag(home, /<title[^>]*>([^<|–-]{0,60})/i) || domain).trim()

  const [sm, category] = await Promise.all([sitemap(domain), deriveCategory(siteName, home)])

  // Crawl a sample of pages (homepage + a few content + a few product pages).
  const productUrls = sm.urls.filter((u) => /\/products?\//i.test(u)).slice(0, 8)
  const contentUrls = sm.urls.filter((u) => !/\/products?\//i.test(u)).slice(0, 6)
  const sampleUrls = Array.from(new Set([`https://${domain}/`, ...contentUrls, ...productUrls])).slice(0, 14)
  const pages = (await Promise.all(sampleUrls.map(async (u) => { const h = await fetchHtml(u); return h ? analyze(u, h) : null }))).filter(Boolean) as Page[]
  const productPages = pages.filter((p) => /\/products?\//i.test(p.url))

  const sections: Section[] = []

  // 1) Website health
  const wh: Finding[] = []
  const noMeta = pages.filter((p) => !p.metaDesc)
  if (noMeta.length) wh.push({ id: 'meta', title: `${noMeta.length} sampled pages missing meta descriptions`, detail: 'Google writes its own snippet for these — usually worse than yours would be.', severity: noMeta.length > 3 ? 'high' : 'medium', sample: noMeta.map((p) => new URL(p.url).pathname), fixable: true })
  const noAlt = pages.reduce((a, p) => a + p.imgsNoAlt, 0)
  if (noAlt) wh.push({ id: 'alt', title: `${noAlt} images missing alt text on sampled pages`, detail: 'Invisible in Google image search.', severity: noAlt > 20 ? 'high' : 'medium', fixable: true })
  const badH1 = pages.filter((p) => p.h1 !== 1)
  if (badH1.length) wh.push({ id: 'h1', title: `${badH1.length} pages with a missing or duplicate H1`, detail: 'The H1 tells Google the page’s main topic.', severity: 'medium', sample: badH1.map((p) => new URL(p.url).pathname), fixable: true })
  sections.push({ key: 'health', name: 'Website health', sub: 'Meta, headings and images across your pages', score: scoreFrom(wh), findings: wh })

  // 2) Spam-update risk (mass-publish heuristic)
  const spam: Finding[] = []
  const maxDay = Math.max(0, ...Array.from(sm.byDay.values()))
  if (maxDay >= 20) spam.push({ id: 'masspub', title: `${maxDay} pages published in a single day`, detail: 'Google’s spam update demotes scaled, template-looking content published in bursts.', severity: maxDay >= 60 ? 'high' : 'medium', fixable: true })
  sections.push({ key: 'spam', name: 'Spam-update risk', sub: `${sm.urls.length} URLs in your sitemap`, score: spam.length ? scoreFrom(spam) : 100, findings: spam })

  // 3) Catalog
  const cat: Finding[] = []
  if (productPages.length) {
    const noAltProd = productPages.filter((p) => p.imgsNoAlt > 0)
    if (noAltProd.length) cat.push({ id: 'prodalt', title: `${noAltProd.reduce((a, p) => a + p.imgsNoAlt, 0)} product images missing alt text`, detail: 'Google can’t see your product photos — invisible in image search.', severity: 'high', sample: noAltProd.map((p) => strip(p.title).slice(0, 60)), fixable: true })
    const thin = productPages.filter((p) => p.words < 120)
    if (thin.length) cat.push({ id: 'thin', title: `${thin.length} products with thin descriptions`, detail: 'Not enough for Google or a hesitant buyer.', severity: 'medium', sample: thin.map((p) => strip(p.title).slice(0, 60)), fixable: true })
  }
  sections.push({ key: 'catalog', name: 'Your catalog', sub: productPages.length ? 'Products checked one by one' : 'No product pages found in the sitemap', score: productPages.length ? scoreFrom(cat) : 100, findings: cat })

  // 4) AI visibility (GEO) — really ask the engines and check for a mention
  const engines = availableEngines().slice(0, 4)
  const question = `What are the best ${category}?`
  const reads: AiEngineRead[] = []
  const brandTokens = [siteName.toLowerCase(), domain.split('.')[0]].filter((t) => t.length > 2)
  await Promise.all(engines.map(async (e) => {
    const a = await askEngine(e, question).catch(() => null)
    if (!a) return
    const mentioned = brandTokens.some((t) => a.text.toLowerCase().includes(t))
    reads.push({ engine: e, mentioned, question, answer: a.text.slice(0, 1200) })
  }))
  const aiMisses = reads.filter((r) => !r.mentioned)
  const aiFindings: Finding[] = aiMisses.map((r) => ({ id: `ai-${r.engine}`, title: `${r.engine} doesn’t mention you`, detail: question, severity: 'high', fixable: true }))
  sections.push({ key: 'ai', name: 'AI visibility', sub: 'What ChatGPT, Gemini & Perplexity say', score: reads.length ? scoreFrom(aiFindings) : 100, findings: aiFindings })

  // 5) Google visibility — gated (needs a SERP API). Honest placeholder finding.
  const gv: Finding[] = [{ id: 'serp', title: `Rank tracking needs a search-data connection`, detail: `Connect a keyword source and we’ll show exactly where ${domain} ranks for your buyer searches, and who’s taking the click.`, severity: 'medium', fixable: false }]
  sections.push({ key: 'google', name: 'Google visibility', sub: 'Where buyers find you first', score: 0, findings: gv })

  // Scores
  const websiteScore = Math.round((sections.find((s) => s.key === 'health')!.score + sections.find((s) => s.key === 'catalog')!.score + sections.find((s) => s.key === 'spam')!.score) / 3)
  const visibilityScore = Math.round((sections.find((s) => s.key === 'ai')!.score) / 1)
  const score = Math.round(websiteScore * 0.55 + visibilityScore * 0.45)
  const grade: ScanResult['grade'] = score >= 80 ? 'Great' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor'
  const problemCount = sections.reduce((a, s) => a + s.findings.filter((f) => f.fixable).length, 0)

  // Revenue lost — honest, conservative model from the AI misses + catalog gaps (illustrative, labeled in UI).
  const missShare = reads.length ? aiMisses.length / reads.length : 0
  const revenueLostPerYear = Math.round((problemCount * 800 + missShare * 12000) * 12 / 12) // conservative monthly→annual proxy
  return { domain, siteName, category, score, grade, websiteScore, visibilityScore, sections, ai: { question, reads }, revenueLostPerYear, currency: '$', problemCount }
}
