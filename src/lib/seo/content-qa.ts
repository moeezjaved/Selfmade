/**
 * Content QA agent (SEO Content Ops, free). Give it a page URL + the keyword it should rank for, and it
 * fetches the live page and checks the on-page SEO fundamentals for that keyword — keyword in title / H1 /
 * intro / a subheading, depth, natural usage, meta description, structured data, internal links — then
 * lists the concrete fixes. No API; everything is read from the real page.
 */
import { fetchHtml } from './crawl-audit'

export type QaCheck = { pass: boolean; label: string; detail: string }
export type QaResult = { hasData: boolean; url?: string; keyword?: string; score?: number; checks?: QaCheck[]; fixes?: string[]; note?: string }

const fold = (s: string) => (s || '').toLowerCase()

export async function qaPage(rawUrl: string, keyword: string): Promise<QaResult> {
  const kw = keyword.trim()
  if (!kw) return { hasData: false, note: 'Give me the keyword this page should rank for.' }
  let url: string
  try { url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`).href } catch { return { hasData: false, note: 'That URL looks invalid.' } }
  const html = await fetchHtml(url)
  if (!html) return { hasData: false, url, note: 'Couldn’t fetch that page — it may block bots or be down.' }

  const g = (re: RegExp) => re.exec(html)?.[1]?.trim() || ''
  const title = g(/<title[^>]*>([^<]{0,300})/i)
  const metaDesc = g(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})/i)
  const h1 = g(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i).replace(/<[^>]+>/g, ' ').trim()
  const headings = (html.match(/<h[23][^>]*>([\s\S]{0,200}?)<\/h[23]>/gi) || []).map((h) => h.replace(/<[^>]+>/g, ' ').trim())
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const words = body ? body.split(' ') : []
  const wordCount = words.length
  const intro = words.slice(0, 120).join(' ')
  const hasSchema = /<script[^>]+type=["']application\/ld\+json["']/i.test(html)
  const internalLinks = (html.match(/<a[^>]+href=["']\/[^"']*["']/gi) || []).length
  const k = fold(kw)
  const occ = (fold(body).match(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  const density = wordCount ? occ / wordCount : 0

  const checks: QaCheck[] = [
    { pass: fold(title).includes(k), label: 'Keyword in the title tag', detail: `Title: “${title || '(none)'}”` },
    { pass: !!h1 && fold(h1).includes(k), label: 'Keyword in the H1', detail: h1 ? `H1: “${h1}”` : 'No H1 found.' },
    { pass: fold(intro).includes(k), label: 'Keyword in the first paragraph', detail: 'Engines weight the opening heavily.' },
    { pass: headings.some((h) => fold(h).includes(k)), label: 'Keyword in a subheading (H2/H3)', detail: `${headings.length} subheadings found.` },
    { pass: fold(metaDesc).includes(k), label: 'Keyword in the meta description', detail: metaDesc ? `“${metaDesc.slice(0, 120)}…”` : 'No meta description.' },
    { pass: wordCount >= 600, label: 'Enough depth (600+ words)', detail: `${wordCount} words.` },
    { pass: occ > 0 && density <= 0.03, label: 'Natural keyword usage (not stuffed)', detail: `Used ${occ}× (${(density * 100).toFixed(1)}% density).` },
    { pass: hasSchema, label: 'Structured data (schema) present', detail: hasSchema ? 'JSON-LD found.' : 'No JSON-LD.' },
    { pass: internalLinks >= 3, label: 'Internal links to other pages', detail: `${internalLinks} internal links.` },
  ]
  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100)
  const fixMap: Record<string, string> = {
    'Keyword in the title tag': `Add “${kw}” to the <title> (near the front).`,
    'Keyword in the H1': `Put “${kw}” in the H1 heading.`,
    'Keyword in the first paragraph': `Mention “${kw}” in the opening 1-2 sentences.`,
    'Keyword in a subheading (H2/H3)': `Use “${kw}” (or a close variant) in at least one H2.`,
    'Keyword in the meta description': `Rewrite the meta description to include “${kw}”.`,
    'Enough depth (600+ words)': 'Expand the page — thin pages rarely rank competitively.',
    'Natural keyword usage (not stuffed)': occ === 0 ? `The keyword doesn’t appear in the body — work it in naturally.` : 'Reduce keyword repetition so it reads naturally.',
    'Structured data (schema) present': 'Add JSON-LD schema (Article/Product/FAQ as fits).',
    'Internal links to other pages': 'Add a few internal links to related pages.',
  }
  const fixes = checks.filter((c) => !c.pass).map((c) => fixMap[c.label]).filter(Boolean)
  return { hasData: true, url, keyword: kw, score, checks, fixes }
}
