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
  if (rows.length) {
    const brand = await describeBrand(admin, userId, brandId).catch(() => null)
    const analyses: CompetitorAnalysis[] = rows.map((r) => ({ domain: r.domain, pageCount: r.page_count, blogCount: r.blog_count, topics: r.topics || [], sampleTitles: r.sample_titles || [] }))
    gaps = await contentGaps(analyses, await ourTitles(admin, userId, brandId), brand?.category || 'the category').catch(() => [])
  }
  return NextResponse.json({ competitors: rows, gaps })
}

async function storeAnalysis(admin: any, userId: string, brandId: string | null, name: string | null, a: CompetitorAnalysis) {
  await admin.from('seo_competitors').upsert({
    user_id: userId, brand_id: brandId, name: name || a.domain, domain: a.domain,
    page_count: a.pageCount, blog_count: a.blogCount, topics: a.topics, sample_titles: a.sampleTitles,
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
    if (!store) return NextResponse.json({ error: 'Connect Shopify first to draft pages.' }, { status: 400 })
    const article = await writeArticle(admin, store, userId, topic)
    if (!article) return NextResponse.json({ error: 'Could not draft that page.' }, { status: 500 })
    const html = renderArticleHtml(article, null)
    const { data: saved } = await admin.from('geo_assets').insert({
      brand_id: brandId, user_id: userId, kind: 'blog', title: article.title, target_prompt: topic, body_markdown: html, status: 'draft',
    }).select('id').maybeSingle()
    return NextResponse.json({ ok: true, id: saved?.id, title: article.title })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
