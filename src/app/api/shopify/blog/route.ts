/**
 * Blog / Answer-content agent API.
 *   GET  /api/shopify/blog                       → blog drafts + suggested topics
 *   POST { action:'draft', topic?, withImage? }  → research + write a deep article (+ hero image), store draft
 *   POST { action:'publish', id }                → publish the draft to the Shopify blog
 *   POST { action:'discard', id }                → drop a draft
 * Draft-first: 'draft' never touches the store; 'publish' writes via write_content. Brand-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveBrandId } from '@/lib/brand/active'
import { resolveStore } from '@/lib/shopify/client'
import { writeArticle, generateHero, renderArticleHtml, publishToShopifyBlog, suggestTopics, type Article } from '@/lib/shopify/blog'
import { getPlanId, isGrandfathered } from '@/lib/entitlements'
import { resolveBillingOwner } from '@/lib/org'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

async function ctx(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient() as any
  const brandId = await resolveActiveBrandId(admin, user.id).catch(() => null)
  const store = await resolveStore(admin, user.id, brandId)
  if (!store) return { error: NextResponse.json({ error: 'No Shopify store connected', connected: false }, { status: 400 }) }
  return { admin, store, userId: user.id, userCreatedAt: user.created_at }
}

export async function GET(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, store, userId } = c
  const { data: drafts } = await admin.from('geo_assets')
    .select('id, title, target_prompt, body_markdown, status, published_url, created_at')
    .eq('user_id', userId).eq('kind', 'blog').order('created_at', { ascending: false }).limit(50)
  const topics = await suggestTopics(admin, store, userId).catch(() => [])
  return NextResponse.json({ connected: true, store: { shop_name: store.shop_name, shop_domain: store.shop_domain }, drafts: drafts || [], topics })
}

export async function POST(req: NextRequest) {
  const c = await ctx(req)
  if ('error' in c) return c.error
  const { admin, store, userId, userCreatedAt } = c
  const body = await req.json().catch(() => ({}))
  const action = body.action

  if (action === 'draft') {
    // Content agent is a paid feature — Free plan can't generate (draft or publish). Existing/grandfathered
    // users are exempt. (No credits are charged either way; this is a plan gate, not a credit gate.)
    const owner = await resolveBillingOwner(admin, userId).catch(() => userId)
    if (!isGrandfathered(userCreatedAt) && (await getPlanId(admin, owner)) === 'free') {
      return NextResponse.json({ error: 'upgrade_required', reason: 'The Content agent is a paid feature — upgrade to write and publish blogs.' }, { status: 402 })
    }
    const topic = body.topic ? String(body.topic) : undefined
    const article = await writeArticle(admin, store, userId, topic)
    if (!article) return NextResponse.json({ error: 'Could not write the article. Try a more specific topic.' }, { status: 500 })
    let heroUrl: string | null = null
    if (body.withImage !== false) heroUrl = await generateHero(article, store.shop_name || undefined).catch(() => null)
    const html = renderArticleHtml(article, heroUrl)
    const { data: saved } = await admin.from('geo_assets').insert({
      brand_id: store.brand_id, user_id: userId, kind: 'blog',
      title: article.title, target_prompt: topic || article.dek, body_markdown: html, status: 'draft',
      published_url: heroUrl,   // stash hero url here until published (published_url is overwritten on publish)
    }).select('id, created_at').maybeSingle()
    return NextResponse.json({ ok: true, id: saved?.id || null, article, heroUrl, html })
  }

  if (action === 'publish') {
    // Free to preview/draft, pay to publish live. Existing users are grandfathered.
    const owner = await resolveBillingOwner(admin, userId).catch(() => userId)
    if (!isGrandfathered(userCreatedAt) && (await getPlanId(admin, owner)) === 'free') {
      return NextResponse.json({ error: 'upgrade_required', reason: 'Publishing to your live blog is a paid feature — drafting stays free. Upgrade to publish.' }, { status: 402 })
    }
    const id = String(body.id || '')
    if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })
    const { data: draft } = await admin.from('geo_assets').select('*').eq('id', id).eq('user_id', userId).eq('kind', 'blog').maybeSingle()
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    // the hero url was stashed in published_url at draft time; body already includes it
    const heroUrl = draft.published_url && String(draft.published_url).startsWith('http') && !String(draft.published_url).includes('/blogs/') ? draft.published_url : null
    try {
      const res = await publishToShopifyBlog(store, {
        title: draft.title, bodyHtml: draft.body_markdown || '', imageUrl: heroUrl,
        author: store.shop_name || undefined,
      })
      await admin.from('geo_assets').update({ status: 'published', published_url: res.url, shopify_article_id: String(res.articleId) }).eq('id', id)
      try { const { recordWin } = await import('@/lib/mello/wins'); await recordWin(admin, { userId, brandId: store.brand_id, category: 'content', title: 'Published a blog article', detail: draft.title, currency: store.currency, meta: { geo_asset_id: id, url: res.url } }) } catch { /* optional */ }
      return NextResponse.json({ ok: true, url: res.url })
    } catch (e: any) {
      return NextResponse.json({ error: `Publish failed: ${String(e?.message || e).slice(0, 200)}` }, { status: 500 })
    }
  }

  if (action === 'discard') {
    const id = String(body.id || '')
    await admin.from('geo_assets').delete().eq('id', id).eq('user_id', userId).eq('kind', 'blog').eq('status', 'draft')
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
