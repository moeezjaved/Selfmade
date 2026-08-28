/**
 * Technical SEO Audit (SEO Phase 1) — crawl the brand's real site and report the on-page/technical issues
 * that hurt rankings. Dependency-free: it fetches the homepage + a few internal pages (the same site we
 * resolve for GEO — from the brand's Meta ads or brand_kit) and checks each for real problems. Everything
 * reported is a fact found on a real page, never asserted.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describeBrand } from '@/lib/geo/understand'
import { resolveStore } from '@/lib/shopify/client'

export type Severity = 'high' | 'medium' | 'low'
export type Issue = { severity: Severity; title: string; detail: string; pages: string[] }
export type SeoAudit = { hasData: boolean; site?: string; score?: number; pagesCrawled?: number; issues?: Issue[]; note?: string }

const UA = 'Selfmade-SEO/1.0 (+https://tryselfmade.ai)'

export type PageCheck = {
  url: string
  title: string; titleLen: number
  metaDesc: string; metaLen: number
  h1Count: number
  hasSchema: boolean
  hasCanonical: boolean
  wordCount: number
  imgs: number; imgsNoAlt: number
  noindex: boolean
  outLinks: string[]   // internal links this page points at (for the link graph)
}

export async function fetchHtml(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(9000), redirect: 'follow' })
    if (!r.ok) return null
    const ct = r.headers.get('content-type') || ''
    if (!ct.includes('html')) return null
    return (await r.text()).slice(0, 400_000)
  } catch { return null }
}

function checkPage(url: string, html: string, base: URL): PageCheck {
  const g = (re: RegExp) => re.exec(html)?.[1]?.trim() || ''
  const title = g(/<title[^>]*>([^<]{0,300})/i)
  const metaDesc = g(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,400})/i) || g(/<meta[^>]+content=["']([^"']{0,400})["'][^>]+name=["']description["']/i)
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length
  const hasSchema = /<script[^>]+type=["']application\/ld\+json["']/i.test(html)
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html)
  const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html)
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const wordCount = body ? body.split(' ').length : 0
  const imgTags = html.match(/<img[^>]*>/gi) || []
  const imgsNoAlt = imgTags.filter((t) => !/\balt=/i.test(t)).length
  return { url, title, titleLen: title.length, metaDesc, metaLen: metaDesc.length, h1Count, hasSchema, hasCanonical, wordCount, imgs: imgTags.length, imgsNoAlt, noindex, outLinks: internalLinks(html, base, 60) }
}

function internalLinks(html: string, base: URL, limit: number): string[] {
  const out: string[] = [], seen = new Set<string>()
  const re = /<a[^>]+href=["']([^"'#]+)["']/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < limit) {
    try {
      const u = new URL(m[1], base)
      if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue
      if (!/^https?:$/.test(u.protocol)) continue
      if (/\.(png|jpe?g|gif|svg|webp|pdf|css|js|ico|zip|mp4)$/i.test(u.pathname)) continue
      const key = u.origin + u.pathname
      if (seen.has(key)) continue
      seen.add(key); out.push(key)
    } catch { /* skip */ }
  }
  return out
}

/** Crawl the brand's real site (homepage + a few internal pages) — shared by the audit + the internal-link
 *  agent so we fetch once. Returns the per-page checks, or a note if we couldn't resolve/read the site. */
export async function crawlSite(admin: SupabaseClient, userId: string, brandId: string | null): Promise<{ base: URL; checks: PageCheck[] } | { note: string; site?: string }> {
  const u = await describeBrand(admin, userId, brandId)
  // Prefer the CONNECTED Shopify store domain — brands.website is often a stale signup default (e.g.
  // tryselfmade.ai) that seedBrandWebsite won't overwrite, so a connected store must win.
  const store = await resolveStore(admin as any, userId, brandId).catch(() => null)
  const siteRaw = (store?.shop_domain || u?.website || '').trim()
  if (!siteRaw) return { note: 'I don’t have your website yet — connect your Shopify store (or set your site on the GEO page), then re-run.' }
  let base: URL
  try { base = new URL(siteRaw.startsWith('http') ? siteRaw : `https://${siteRaw}`) } catch { return { note: 'Your website URL looks invalid — set it on the GEO page and re-run.' } }
  // Never audit Selfmade's own domain — if the brand website is the app (no real store connected), tell
  // the user to connect their store instead of auditing tryselfmade.ai (the /login /signup pages, etc.).
  const host = base.hostname.replace(/^www\./, '')
  if (/(^|\.)tryselfmade\.ai$|(^|\.)selfmade\.(ai|com)$|localhost/i.test(host)) {
    return { note: 'Connect your store first — I audit YOUR site, not Selfmade. Connect Shopify (or set your real store URL on the GEO page), then re-run.' }
  }
  const home = await fetchHtml(base.href)
  if (!home) return { site: base.href, note: `Couldn’t fetch ${base.hostname} — it may block bots or be down. I’ll retry next run.` }
  const urls = [base.origin + base.pathname, ...internalLinks(home, base, 12)]
  const uniq = Array.from(new Set(urls)).slice(0, 20)   // match the store-audit crawl depth (was 10, which contradicted the "Crawled 20" carried-over count)
  const checks: PageCheck[] = []
  for (const url of uniq) {
    const html = url === (base.origin + base.pathname) ? home : await fetchHtml(url)
    if (html) checks.push(checkPage(url, html, base))
  }
  if (!checks.length) return { site: base.href, note: `Fetched ${base.hostname} but couldn’t read any pages. I’ll retry.` }
  return { base, checks }
}

export async function runSeoAudit(admin: SupabaseClient, userId: string, brandId: string | null): Promise<SeoAudit> {
  const crawl = await crawlSite(admin, userId, brandId)
  if ('note' in crawl) return { hasData: false, site: crawl.site, note: crawl.note }
  const { base, checks } = crawl

  // ── aggregate real findings ──
  const issues: Issue[] = []
  const add = (severity: Severity, title: string, detail: string, pages: string[]) => { if (pages.length) issues.push({ severity, title, detail, pages: pages.slice(0, 50) }) }
  const P = (pred: (c: PageCheck) => boolean) => checks.filter(pred).map((c) => c.url)

  add('high', 'Missing title tag', 'Pages with no <title> — search engines have nothing to show in results.', P((c) => !c.title))
  add('high', 'Missing meta description', 'Pages with no meta description — you’re letting Google write your snippet.', P((c) => !c.metaDesc))
  add('high', 'No H1 heading', 'Pages missing an <h1> — the main topic signal for the page.', P((c) => c.h1Count === 0))
  add('high', 'Blocked from indexing (noindex)', 'Pages set to noindex — they can’t rank at all. Confirm this is intentional.', P((c) => c.noindex))
  add('medium', 'Multiple H1 headings', 'Pages with more than one <h1> — dilutes the topic signal.', P((c) => c.h1Count > 1))
  add('medium', 'Thin content', 'Pages under ~250 words — usually too little to rank for anything competitive.', P((c) => c.wordCount > 0 && c.wordCount < 250))
  add('medium', 'No structured data (schema)', 'Pages with no JSON-LD schema — you miss rich results and AI/entity understanding.', P((c) => !c.hasSchema))
  add('medium', 'Title too long or too short', 'Titles outside ~30–60 chars get truncated or waste space in results.', P((c) => c.title !== '' && (c.titleLen < 30 || c.titleLen > 65)))
  add('low', 'No canonical tag', 'Pages without a canonical link — risks duplicate-content confusion.', P((c) => !c.hasCanonical))
  add('low', 'Images missing alt text', 'Images without alt text — bad for accessibility and image search.', P((c) => c.imgsNoAlt > 0))

  // ── cannibalization + duplicate tags (grouped by identical value) ──
  const dupBy = (get: (c: PageCheck) => string) => {
    const m = new Map<string, string[]>()
    for (const c of checks) { const v = get(c).trim().toLowerCase(); if (!v) continue; m.set(v, [...(m.get(v) || []), c.url]) }
    const urls: string[] = []; m.forEach((list) => { if (list.length > 1) urls.push(...list) }); return urls
  }
  add('medium', 'Duplicate titles (keyword cannibalization)', 'Multiple pages share the same title — they compete with each other in Google. Give each a distinct target.', dupBy((c) => c.title))
  add('low', 'Duplicate meta descriptions', 'Pages sharing the same meta description — write a unique one per page.', dupBy((c) => c.metaDesc))

  // ── orphan / weakly-linked pages (link graph from the crawl) ──
  const home2 = base.origin + base.pathname
  const inbound = new Map<string, number>()
  for (const c of checks) for (const l of c.outLinks) if (l !== c.url) inbound.set(l, (inbound.get(l) || 0) + 1)
  add('medium', 'Orphan / weakly-linked pages', 'Pages nothing else links to — search engines and users can barely find them. Add internal links.', checks.filter((c) => c.url !== home2 && (inbound.get(c.url) || 0) === 0).map((c) => c.url))

  const weight = { high: 12, medium: 6, low: 2 } as const
  const penalty = issues.reduce((s, i) => s + weight[i.severity] * Math.min(3, Math.ceil(i.pages.length / 3)), 0)
  const score = Math.max(5, 100 - penalty)

  try { await (admin as any).from('seo_audit').insert({ brand_id: brandId, user_id: userId, score, issues, pages_crawled: checks.length, site: base.href }) } catch { /* best-effort */ }
  return { hasData: true, site: base.href, score, pagesCrawled: checks.length, issues: issues.sort((a, b) => weight[b.severity] - weight[a.severity]) }
}

export async function loadSeoAudit(admin: SupabaseClient, userId: string, brandId: string | null): Promise<SeoAudit> {
  try {
    let q = (admin as any).from('seo_audit').select('score, issues, pages_crawled, site, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
    if (brandId) q = q.eq('brand_id', brandId)
    const { data } = await q.maybeSingle()
    if (!data) return { hasData: false }
    return { hasData: true, site: data.site, score: data.score, pagesCrawled: data.pages_crawled, issues: data.issues || [] }
  } catch { return { hasData: false } }
}
