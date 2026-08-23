/**
 * Competitor SEO/GEO intelligence — FREE, no API key. Reads a rival's PUBLIC sitemap + a sample of their
 * pages to learn what content they publish and which topics they target, then computes the content gaps
 * (topics they cover that we don't) that feed programmatic page-building.
 *
 * The paid layer — real organic traffic + keyword rankings per rival — is stubbed on seo_competitors
 * (est_traffic, top_keywords); it fills when Ahrefs / DataForSEO / SimilarWeb is connected. Everything here
 * works today with zero keys.
 */
import { llm } from '@/lib/llm'

export type TopicCount = { topic: string; count: number }
export type CompetitorAnalysis = { domain: string; pageCount: number; blogCount: number; topics: TopicCount[]; sampleTitles: string[] }

export function normalizeDomain(input: string): string {
  return String(input || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
}

async function fetchText(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SelfmadeBot/1.0)' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return await r.text()
  } catch { return null }
}

/** Collect page URLs from a domain's sitemap(s). Handles a sitemap index (nested sitemaps). Bounded. */
async function sitemapUrls(domain: string, cap = 800): Promise<string[]> {
  const roots = [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`]
  const urls = new Set<string>()
  const seenMaps = new Set<string>()

  async function ingest(xml: string) {
    const locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1])
    // sitemap index → fetch child sitemaps (cap the fan-out)
    if (/<sitemapindex/i.test(xml)) {
      for (const child of locs.slice(0, 25)) {
        if (seenMaps.has(child)) continue
        seenMaps.add(child)
        const t = await fetchText(child); if (t) await ingest(t)
        if (urls.size >= cap) return
      }
    } else {
      for (const u of locs) { urls.add(u); if (urls.size >= cap) return }
    }
  }

  for (const root of roots) {
    if (urls.size >= cap) break
    const t = await fetchText(root)
    if (t) await ingest(t)
    if (urls.size) break
  }
  return Array.from(urls).slice(0, cap)
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your', 'you', 'best', 'how', 'what', 'is', 'are', 'vs', 'new', 'shop', 'products', 'collections', 'pages', 'blogs', 'blog', 'com', 'www', 'html', 'index', '2024', '2025', '2026'])

/** Turn content URLs into topic phrases (from slugs) + separate blog/article URLs. */
function topicsFromUrls(domain: string, urls: string[]): { topics: TopicCount[]; blogUrls: string[]; blogCount: number } {
  const blogUrls: string[] = []
  const freq = new Map<string, number>()
  for (const u of urls) {
    const isContent = /\/(blogs?|articles?|guides?|learn|resources?|posts?|news)\//i.test(u)
    if (isContent) blogUrls.push(u)
    const slug = u.replace(/^https?:\/\/[^/]+\//, '').replace(/[?#].*$/, '').replace(/\.(html?|php)$/i, '')
    const words = slug.split(/[\/-_]+/).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w))
    // bigrams read as topics better than single words
    for (let i = 0; i < words.length; i++) {
      const uni = words[i]; freq.set(uni, (freq.get(uni) || 0) + 1)
      if (i + 1 < words.length) { const bi = `${words[i]} ${words[i + 1]}`; freq.set(bi, (freq.get(bi) || 0) + 2) }
    }
  }
  const topics = Array.from(freq.entries()).map(([topic, count]) => ({ topic, count })).filter((t) => t.topic.includes(' ') || t.count > 1).sort((a, b) => b.count - a.count).slice(0, 40)
  return { topics, blogUrls, blogCount: blogUrls.length }
}

/** Pull a few real article titles for flavor + to sharpen gap analysis. */
async function sampleTitles(blogUrls: string[], n = 6): Promise<string[]> {
  const picks = blogUrls.slice(0, n)
  const titles: string[] = []
  for (const u of picks) {
    const html = await fetchText(u, 8000)
    if (!html) continue
    const m = html.match(/<title[^>]*>([^<]+)<\/title>/i) || html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    if (m) titles.push(m[1].replace(/\s+/g, ' ').trim().slice(0, 120))
  }
  return titles
}

/** Full free analysis of one competitor domain. */
export async function analyzeCompetitor(domainRaw: string): Promise<CompetitorAnalysis> {
  const domain = normalizeDomain(domainRaw)
  const urls = await sitemapUrls(domain)
  const { topics, blogUrls, blogCount } = topicsFromUrls(domain, urls)
  const titles = blogCount ? await sampleTitles(blogUrls) : []
  return { domain, pageCount: urls.length, blogCount, topics, sampleTitles: titles }
}

/**
 * Content gaps: buyer-intent topics the rivals cover (by their titles/topics) that our own content doesn't.
 * Uses the LLM to turn the raw signal into clean, buildable page topics.
 */
export async function contentGaps(competitors: CompetitorAnalysis[], ourTitles: string[], category: string): Promise<string[]> {
  const rivalSignal = competitors.map((c) => ({ domain: c.domain, topics: c.topics.slice(0, 20).map((t) => t.topic), titles: c.sampleTitles })).slice(0, 6)
  if (!rivalSignal.length) return []
  const sys = `You are an SEO strategist. Below is what competitors publish (topics from their URLs + real article titles) in the category "${category}", and what WE have already published. Find the highest-value buyer-intent CONTENT GAPS — specific article topics rivals cover that we don't, that a buyer would search before purchasing. Return 8-12 concrete, specific article titles we should write. No fluff, no duplicates of what we have. Return ONLY JSON: {"gaps":["...","..."]}`
  try {
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 800, temperature: 0.4, messages: [{ role: 'user', content: `${sys}\n\nRIVALS:\n${JSON.stringify(rivalSignal)}\n\nWE ALREADY HAVE:\n${JSON.stringify(ourTitles.slice(0, 60))}` }] })
    const t = res.content?.[0]?.text || ''
    const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))
    return Array.isArray(j?.gaps) ? j.gaps.map((x: any) => String(x)).slice(0, 12) : []
  } catch { return [] }
}
