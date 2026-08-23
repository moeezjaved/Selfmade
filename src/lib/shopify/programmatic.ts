/**
 * Programmatic SEO — the scale layer over the blog engine. It enumerates page targets from the store's real
 * data (one buying guide per product, one landing page per collection, one comparison per real competitor),
 * generates each as a grounded article (reusing writeArticle so every page is deep, not thin/templated
 * spam), queues them for review, and bulk-publishes the approved ones to the Shopify blog.
 *
 * Draft-first + deduped: each target has a stable key; we never regenerate a page that already exists.
 * Pages live in geo_assets (kind='pseo'). No new migration.
 */
import { describeBrand } from '@/lib/geo/understand'
import { fetchCollections } from '@/lib/shopify/catalog'
import { writeArticle, renderArticleHtml, generateHero, publishToShopifyBlog } from '@/lib/shopify/blog'
import { tokenFor, type StoreRow } from '@/lib/shopify/client'

export type PageType = 'guide' | 'collection' | 'comparison'
export type PageTarget = { key: string; type: PageType; title: string; topic: string }

/** Enumerate every page we could build from the store's real catalog + competitors. */
export async function planPages(admin: any, store: StoreRow, userId: string): Promise<PageTarget[]> {
  const targets: PageTarget[] = []

  const { data: products } = await admin.from('shopify_products')
    .select('title, handle').eq('store_id', store.id).eq('status', 'active').limit(60)
  const prods: any[] = products || []
  for (const p of prods) {
    const slug = p.handle || String(p.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    targets.push({ key: `guide:${slug}`, type: 'guide', title: `${p.title} — buyer's guide`, topic: `${p.title}: is it worth it? A complete buyer's guide for 2026` })
  }

  try {
    const cols = await fetchCollections(store.shop_domain, tokenFor(store), 30)
    for (const c of cols) targets.push({ key: `collection:${c.id}`, type: 'collection', title: `Best ${c.title}`, topic: `Best ${c.title} in 2026 — how to choose the right one` })
  } catch { /* collections optional */ }

  const brand = await describeBrand(admin, userId, store.brand_id).catch(() => null)
  const comps = (brand?.competitors || []).slice(0, 5)
  const flagship = prods[0]
  if (flagship) for (const comp of comps) {
    targets.push({ key: `vs:${String(comp).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, type: 'comparison', title: `${flagship.title} vs ${comp}`, topic: `${flagship.title} vs ${comp} — which should you buy in 2026?` })
  }

  return targets
}

/** Which target keys already have a generated page (to show remaining + dedupe). */
export async function existingKeys(admin: any, userId: string, brandId: string | null): Promise<Set<string>> {
  let q = admin.from('geo_assets').select('target_prompt').eq('user_id', userId).eq('kind', 'pseo')
  if (brandId) q = q.eq('brand_id', brandId)
  const { data } = await q.limit(1000)
  return new Set((data || []).map((r: any) => String(r.target_prompt)))
}

/** Generate one page (skips if the key already exists). Returns the new draft id or a status. */
export async function generatePage(admin: any, store: StoreRow, userId: string, target: PageTarget, withImage = false): Promise<{ id?: string; skipped?: boolean; failed?: boolean }> {
  const { data: exists } = await admin.from('geo_assets').select('id').eq('user_id', userId).eq('kind', 'pseo').eq('target_prompt', target.key).limit(1)
  if (exists && exists.length) return { skipped: true }
  const article = await writeArticle(admin, store, userId, target.topic)
  if (!article) return { failed: true }
  let heroUrl: string | null = null
  if (withImage) heroUrl = await generateHero(article, store.shop_name || undefined).catch(() => null)
  const html = renderArticleHtml(article, heroUrl)
  const { data: saved } = await admin.from('geo_assets').insert({
    brand_id: store.brand_id, user_id: userId, kind: 'pseo',
    title: article.title, target_prompt: target.key, body_markdown: html, status: 'draft', published_url: heroUrl,
  }).select('id').maybeSingle()
  return { id: saved?.id }
}

/** Generate up to `limit` not-yet-built pages from the plan. */
export async function generateBatch(admin: any, store: StoreRow, userId: string, limit = 5, withImage = false): Promise<{ created: number; failed: number; remaining: number }> {
  const plan = await planPages(admin, store, userId)
  const done = await existingKeys(admin, userId, store.brand_id)
  const todo = plan.filter((t) => !done.has(t.key)).slice(0, Math.min(limit, 12))
  let created = 0, failed = 0
  for (const t of todo) {
    const r = await generatePage(admin, store, userId, t, withImage)
    if (r.id) created++
    else if (r.failed) failed++
  }
  const remaining = plan.filter((t) => !done.has(t.key)).length - created
  return { created, failed, remaining: Math.max(0, remaining) }
}

/** Publish a batch of pseo drafts to the Shopify blog. */
export async function publishBatch(admin: any, store: StoreRow, userId: string, ids: string[]): Promise<{ published: number; failed: number; urls: string[] }> {
  const { data } = await admin.from('geo_assets').select('*').in('id', ids).eq('user_id', userId).eq('kind', 'pseo').eq('status', 'draft')
  const rows: any[] = data || []
  let published = 0, failed = 0
  const urls: string[] = []
  for (const row of rows) {
    const heroUrl = row.published_url && String(row.published_url).startsWith('http') && !String(row.published_url).includes('/blogs/') ? row.published_url : null
    try {
      const res = await publishToShopifyBlog(store, { title: row.title, bodyHtml: row.body_markdown || '', imageUrl: heroUrl, author: store.shop_name || undefined })
      await admin.from('geo_assets').update({ status: 'published', published_url: res.url, shopify_article_id: String(res.articleId) }).eq('id', row.id)
      urls.push(res.url); published++
    } catch { failed++ }
  }
  return { published, failed, urls }
}
