/**
 * POST /api/geo/answer  { prompt, rivals? } → the Content agent writes a GEO answer page for one buyer
 * question the brand is missing, and stores it as a DRAFT (geo_assets). Review/edit before publishing;
 * publishing to the Shopify blog is a later step (needs OAuth). Metered (one LLM write). Brand-scoped.
 *
 * GET /api/geo/answer → list the brand's answer-page drafts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { writeAnswerPage, listAnswerPages, mdToHtml } from '@/lib/geo/content'
import { reserveCredits, commitCredits, refundCredits, InsufficientCreditsError } from '@/lib/credits'
import { resolveStore } from '@/lib/shopify/client'
import { publishToShopifyBlog } from '@/lib/shopify/blog'
import { getPlanId } from '@/lib/entitlements'
import { resolveBillingOwner } from '@/lib/org'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const brandId = await resolveActiveBrandId(admin as any, user.id, (body?.brandId as string) || null).catch(() => null)

  // ── PUBLISH: push a reviewed answer-page draft LIVE to the store's Shopify blog, so AI engines can
  //    actually crawl + cite it. A draft that never publishes has no GEO value. Paid feature (like blog). ──
  if (body?.action === 'publish') {
    const id = String(body?.id || '').trim()
    if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })
    const store = await resolveStore(admin as any, user.id, brandId)
    if (!store) return NextResponse.json({ error: 'no_store', reason: 'Connect your Shopify store first — I publish answer pages to your store’s blog.' }, { status: 400 })
    const owner = await resolveBillingOwner(admin as any, user.id).catch(() => user.id)
    if ((await getPlanId(admin as any, owner).catch(() => 'free' as const)) === 'free') {
      return NextResponse.json({ error: 'upgrade_required', reason: 'Publishing live to your store is a paid feature — drafting stays free. Upgrade to publish.' }, { status: 402 })
    }
    const { data: draft } = await admin.from('geo_assets').select('*').eq('id', id).eq('user_id', user.id).eq('kind', 'answer_page').maybeSingle()
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    try {
      const res = await publishToShopifyBlog(store as any, {
        title: draft.title || draft.target_prompt || 'Answer', bodyHtml: mdToHtml(draft.body_markdown || ''),
        author: (store as any).shop_name || undefined, tags: ['GEO', 'AI answers'],
      })
      await admin.from('geo_assets').update({ status: 'published', published_url: res.url, shopify_article_id: String(res.articleId) }).eq('id', id)
      try { const { recordWin } = await import('@/lib/mello/wins'); await recordWin(admin as any, { userId: user.id, brandId: (store as any).brand_id, category: 'content', title: 'Published a GEO answer page', detail: draft.title, currency: (store as any).currency, meta: { geo_asset_id: id, url: res.url } }) } catch { /* optional */ }
      return NextResponse.json({ ok: true, url: res.url }, { status: 200 })
    } catch (e) {
      return NextResponse.json({ error: 'publish_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
    }
  }

  const prompt = String(body?.prompt || '').trim()
  if (!prompt) return NextResponse.json({ error: 'prompt required' }, { status: 400 })
  // Writing an answer page is one LLM write → charge credits (everyone). Refunded if it fails.
  let txId: string | null = null
  try {
    const tx = await reserveCredits(admin as any, user.id, 'geo_answer')
    txId = tx.id
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return NextResponse.json({ error: 'insufficient_credits', need: e.need, have: e.have, reason: 'Writing a GEO answer page costs credits — top up or upgrade to continue.' }, { status: 402 })
    return NextResponse.json({ error: 'reserve_failed' }, { status: 500 })
  }
  try {
    const asset = await writeAnswerPage(admin as any, user.id, brandId, { prompt, rivals: Array.isArray(body?.rivals) ? body.rivals : undefined })
    await commitCredits(admin as any, txId, { kind: 'geo_answer' }).catch(() => {})
    return NextResponse.json({ asset }, { status: 200 })
  } catch (e) {
    if (txId) await refundCredits(admin as any, txId).catch(() => {})
    return NextResponse.json({ error: 'geo_answer_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const brandId = await resolveActiveBrandId(admin as any, user.id).catch(() => null)
  try {
    const assets = await listAnswerPages(admin as any, user.id, brandId)
    return NextResponse.json({ assets }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: 'geo_assets_failed', detail: String((e as Error)?.message || e).slice(0, 160) }, { status: 500 })
  }
}
