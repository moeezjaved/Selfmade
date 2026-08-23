/**
 * Internal-link agent (SEO cluster 5, free). Reuses the shared site crawl, builds the current link graph,
 * and suggests the highest-value internal links you DON'T have yet — the "from → to, anchor text, why"
 * moves that spread ranking authority and help users + crawlers navigate. No API.
 *
 * Grounded: only suggests links between pages we actually crawled, and never one that already exists.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { crawlSite } from './crawl-audit'
import { describeBrand } from '@/lib/geo/understand'

export type LinkRec = { from: string; to: string; anchor: string; why: string }
export type LinkResult = { hasData: boolean; recs: LinkRec[]; pages: number; note?: string }

const short = (u: string) => { try { const x = new URL(u); return x.pathname === '/' ? x.hostname.replace(/^www\./, '') : x.pathname } catch { return u } }

export async function suggestInternalLinks(admin: SupabaseClient, userId: string, brandId: string | null): Promise<LinkResult> {
  const crawl = await crawlSite(admin, userId, brandId)
  if ('note' in crawl) return { hasData: false, recs: [], pages: 0, note: crawl.note }
  const { checks } = crawl
  if (checks.length < 2) return { hasData: false, recs: [], pages: checks.length, note: 'I could only read one page — need a few pages to suggest links between them.' }

  const existing = new Set<string>()
  for (const p of checks) for (const l of p.outLinks) existing.add(`${p.url}||${l}`)
  const byUrl = new Map(checks.map((c) => [c.url, c]))

  const u = await describeBrand(admin, userId, brandId)
  const category = u?.category || 'this product'

  let recs: LinkRec[] = []
  try {
    const { llm } = await import('@/lib/llm')
    const pages = checks.map((c) => ({ url: c.url, title: c.title || short(c.url) }))
    const sys = `You are an internal-linking SEO agent for a ${category} brand. Given the site's crawled pages, suggest the highest-value internal links that DON'T already exist — links that spread ranking authority and genuinely help the reader. For each: the "from" page URL (must be one of the pages), the "to" page URL (must be one of the pages, different from "from"), a natural anchor-text phrase, and one line why. Suggest 5-10 of the best. Return ONLY JSON {"links":[{"from","to","anchor","why"}]}.`
    const res: any = await llm.messages.create({ model: 'gpt-4o', max_tokens: 1100, temperature: 0.3, messages: [{ role: 'user', content: `${sys}\n\nPAGES:\n${JSON.stringify(pages)}` }] })
    const txt = res?.content?.[0]?.text || ''
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1))
    recs = (parsed?.links || [])
      .map((r: any) => ({ from: String(r.from || ''), to: String(r.to || ''), anchor: String(r.anchor || '').slice(0, 80), why: String(r.why || '') }))
      .filter((r: LinkRec) => r.from && r.to && r.from !== r.to && byUrl.has(r.from) && byUrl.has(r.to) && !existing.has(`${r.from}||${r.to}`))
      .slice(0, 10)
  } catch { /* fall through */ }

  return { hasData: true, recs, pages: checks.length, note: recs.length ? undefined : 'Your internal linking already looks solid across the pages I crawled — nothing high-value to add.' }
}
