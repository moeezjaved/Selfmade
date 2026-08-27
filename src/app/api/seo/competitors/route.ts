/**
 * Competitor SEO/GEO intelligence API.
 *   GET  /api/seo/competitors                     → tracked competitors + their analysis + content gaps
 *   POST { action:'seed' }                        → auto-add competitors from the brand's understanding
 *   POST { action:'add', name?, domain }          → analyze one competitor's public content + store
 *   POST { action:'refresh', id }                 → re-crawl one
 *   POST { action:'remove', id }                  → stop tracking
 *   POST { action:'build', topic }                → draft a blog page for a gap topic (→ /mission/blog)
 * Free (sitemap-based). Brand-scoped. The traffic/keyword layer fills when a keyword API is connected.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { analyzeCompetitor, contentGaps, normalizeDomain, type CompetitorAnalysis } from '@/lib/seo/competitors'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'
import { describeBrand } from '@/lib/geo/understand'
import { resolveStore } from '@/lib/shopify/client'
import { writeArticle, renderArticleHtml } from '@/lib/shopify/blog'
import { dfsConfigured, rankedKeywords, type RankedKeyword } from '@/lib/audit/dataforseo'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function ctx(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  return { admin, userId: user.id, brandId }
}

async function ourTitles(admin: any, userId: string, brandId: string | null): Promise<string[]> {
  const out: string[] = []
  try { const { data } = await admin.from('geo_assets').select('title').eq('user_id', userId).limit(100); (data || []).forEach((r: any) => r.title && out.push(r.title)) } catch { /* noop */ }
  try {
    const store = await resolveStore(admin, userId, brandId)
    if (store) { const { data } = await admin.from('shopify_products').select('title').eq('store_id', store.id).limit(100); (data || []).forEach((r: any) => r.title && out.push(r.title)) }
  } catch { /* noop */ }
  return out
}

export async function GET(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, userId, brandId } = c
  const { data: comps } = await admin.from('seo_competitors').select('*').eq('user_id', userId)
    .eq('brand_id', brandId).order('page_count', { ascending: false }).limit(30)
  const rows: any[] = comps || []
  let gaps: string[] = []
  let keywordGaps: { keyword: string; volume: number; etv: number; competitor: string; theirPosition: number; youRank: boolean }[] = []
  const keywordsLive = dfsConfigured()
  if (rows.length) {
    const brand = await describeBrand(admin, userId, brandId).catch(() => null)
    const analyses: CompetitorAnalysis[] = rows.map((r) => ({ domain: r.domain, pageCount: r.page_count, blogCount: r.blog_count, topics: r.topics || [], sampleTitles: r.sample_titles || [] }))
    gaps = await contentGaps(analyses, await ourTitles(admin, userId, brandId), brand?.category || 'the category').catch(() => [])

    // KEYWORD GAP (real data): the keywords rivals rank for that YOU don't — the exact terms to write for,
    // ranked by traffic opportunity. Needs DataForSEO; we fetch your own ranked set once to mark true gaps.
    if (keywordsLive) {
      const yourKw = new Set<string>()
      try {
        const store = await resolveStore(admin, userId, brandId)
        const yourDomain = store?.shop_domain || brand?.website || ''
        if (yourDomain) (await rankedKeywords(yourDomain, 100).catch(() => [])).forEach((k) => yourKw.add(k.keyword.toLowerCase()))
      } catch { /* if we can't read your ranks, everything shows as opportunity */ }
      const best = new Map<string, { keyword: string; volume: number; etv: number; competitor: string; theirPosition: number; youRank: boolean }>()
      for (const r of rows) {
        for (const k of ((r.top_keywords || []) as RankedKeyword[])) {
          const key = k.keyword.toLowerCase()
          const youRank = yourKw.has(key)
          const cur = best.get(key)
          // keep the rival with the strongest position for each keyword
          if (!cur || k.position < cur.theirPosition) best.set(key, { keyword: k.keyword, volume: k.volume, etv: k.etv, competitor: r.name || r.domain, theirPosition: k.position, youRank })
        }
      }
      keywordGaps = Array.from(best.values()).sort((a, b) => (a.youRank === b.youRank ? b.etv - a.etv : a.youRank ? 1 : -1)).slice(0, 40)
    }
  }
  return NextResponse.json({ competitors: rows, gaps, keywordGaps, keywordsLive })
}

async function storeAnalysis(admin: any, userId: string, brandId: string | null, name: string | null, a: CompetitorAnalysis) {
  // When DataForSEO is connected, pull the rival's REAL ranking keywords (keyword · position · volume ·
  // est. monthly traffic) so we can target the exact terms they win — not just topics from their sitemap.
  let topKeywords: RankedKeyword[] | null = null
  let estTraffic: number | null = null
  if (dfsConfigured()) {
    try {
      const kws = await rankedKeywords(a.domain, 30)
      if (kws.length) { topKeywords = kws; estTraffic = kws.reduce((s, k) => s + (k.etv || 0), 0) }
    } catch { /* keyword layer optional — the sitemap analysis still stands */ }
  }
  await admin.from('seo_competitors').upsert({
    user_id: userId, brand_id: brandId, name: name || a.domain, domain: a.domain,
    page_count: a.pageCount, blog_count: a.blogCount, topics: a.topics, sample_titles: a.sampleTitles,
    ...(topKeywords ? { top_keywords: topKeywords, est_traffic: estTraffic } : {}),
    status: 'ok', error: null, last_crawled: new Date().toISOString(),
  }, { onConflict: 'user_id,brand_id,domain' })
}

export async function POST(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, userId, brandId } = c
  const body = await req.json().catch(() => ({}))
  const action = body.action

  // Analyzing a rival reads its site live via the LLM → charge credits (everyone). Reserve BEFORE the
  // work so a low balance is blocked up front, not after; refunded if the analysis fails.
  const ANALYZE = action === 'add' || action === 'seed' || action === 'refresh'
  let txId: string | null = null
  if (ANALYZE) {
    try { txId = (await reserveCredits(admin, userId, 'competitor_decode')).id }
    catch (e) {
      if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'Analyzing a competitor costs credits — top up or upgrade to continue.' }, { status: 402 })
      return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
    }
  }
  const refund = async () => { if (txId) await refundCredits(admin, txId).catch(() => {}) }
  const commit = async () => { if (txId) await commitCredits(admin, txId, { kind: 'competitor_decode', action }).catch(() => {}) }

  if (action === 'add') {
    const domain = normalizeDomain(body.domain || '')
    if (!domain || !domain.includes('.')) { await refund(); return NextResponse.json({ error: 'Enter a competitor domain, like fum.com' }, { status: 400 }) }
    try {
      const a = await analyzeCompetitor(domain)
      await storeAnalysis(admin, userId, brandId, body.name ? String(body.name) : null, a)
      await commit()
      return NextResponse.json({ ok: true, analysis: a, empty: a.pageCount === 0 })
    } catch (e) { await refund(); return NextResponse.json({ error: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
  }

  if (action === 'seed') {
    try {
      const brand = await describeBrand(admin, userId, brandId).catch(() => null)
      const names = (brand?.competitors || []).slice(0, 5)
      let added = 0
      for (const name of names) {
        const guess = normalizeDomain(String(name).replace(/[^a-z0-9]/gi, '').toLowerCase()) + '.com'
        const a = await analyzeCompetitor(guess)
        if (a.pageCount > 0) { await storeAnalysis(admin, userId, brandId, String(name), a); added++ }
      }
      await commit()
      return NextResponse.json({ ok: true, added, considered: names.length, note: added < names.length ? 'Some competitor domains couldn’t be auto-resolved — add them manually.' : undefined })
    } catch (e) { await refund(); return NextResponse.json({ error: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
  }

  if (action === 'refresh') {
    const { data: row } = await admin.from('seo_competitors').select('domain, name').eq('id', String(body.id)).eq('user_id', userId).maybeSingle()
    if (!row) { await refund(); return NextResponse.json({ error: 'Not found' }, { status: 404 }) }
    try {
      const a = await analyzeCompetitor(row.domain)
      await storeAnalysis(admin, userId, brandId, row.name, a)
      await commit()
      return NextResponse.json({ ok: true, analysis: a })
    } catch (e) { await refund(); return NextResponse.json({ error: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 }) }
  }

  if (action === 'remove') {
    await admin.from('seo_competitors').delete().eq('id', String(body.id)).eq('user_id', userId)
    return NextResponse.json({ ok: true })
  }

  if (action === 'build') {
    const topic = String(body.topic || '').trim()
    if (!topic) return NextResponse.json({ error: 'Missing topic' }, { status: 400 })
    const store = await resolveStore(admin, userId, brandId)
    if (!store) return NextResponse.json({ error: 'no_store', reason: 'Connect your Shopify store first — I draft these pages from your real catalog.' }, { status: 400 })
    // Writing a full article is one LLM write → charge blog_draft (same as the Content agent). Refunded on fail.
    let bTx: string | null = null
    try { bTx = (await reserveCredits(admin, userId, 'blog_draft')).id }
    catch (e) {
      if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'Writing a page costs credits — top up or upgrade to continue.' }, { status: 402 })
      return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
    }
    try {
      // Topics coming from the keyword-opportunities list ARE keywords → SEO-optimize the article to rank
      // for that exact keyword (title/H1/meta/first line). body.keyword lets the client mark it explicitly.
      const kw = String(body.keyword || (body.isKeyword ? topic : '')).trim() || undefined
      // ONE article for a whole keyword CLUSTER: pull related keywords this brand's rivals rank for that
      // share a meaningful word with the primary, so the page also targets close variants (beats thin pages).
      let secondaryKeywords: string[] = []
      if (kw) {
        const primaryTokens = new Set(kw.toLowerCase().split(/\s+/).filter((w) => w.length > 3))
        const { data: cRows } = await admin.from('seo_competitors').select('top_keywords').eq('user_id', userId).eq('brand_id', brandId)
        const pool = new Map<string, number>()
        for (const r of (cRows || []) as any[]) for (const k of ((r.top_keywords || []) as any[])) {
          const kwLc = String(k.keyword || '').toLowerCase()
          if (!kwLc || kwLc === kw.toLowerCase()) continue
          if (Array.from(primaryTokens).some((t) => kwLc.includes(t))) pool.set(k.keyword, Math.max(pool.get(k.keyword) || 0, Number(k.volume) || 0))
        }
        secondaryKeywords = Array.from(pool.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k)
      }
      const article = await writeArticle(admin, store, userId, topic, kw ? { keyword: kw, secondaryKeywords } : undefined)
      if (!article) { await refundCredits(admin, bTx).catch(() => {}); return NextResponse.json({ error: 'Could not draft that page — try again.' }, { status: 500 }) }
      const html = renderArticleHtml(article, null)
      const seo = kw ? { keyword: kw, metaTitle: article.metaTitle, metaDescription: article.metaDescription, secondary: secondaryKeywords } : { metaTitle: article.metaTitle, metaDescription: article.metaDescription }
      const { data: saved } = await admin.from('geo_assets').insert({
        brand_id: brandId, user_id: userId, kind: 'blog', title: article.title, target_prompt: topic, body_markdown: html, status: 'draft', seo,
      }).select('id').maybeSingle()
      await commitCredits(admin, bTx, { kind: 'blog_draft', via: 'competitor_gap', topic }).catch(() => {})
      return NextResponse.json({ ok: true, id: saved?.id, title: article.title, secondary: secondaryKeywords })
    } catch (e) {
      await refundCredits(admin, bTx).catch(() => {})
      return NextResponse.json({ error: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
